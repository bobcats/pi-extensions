import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import {
  readVaultIndex,
  listVaultFiles,
  buildMemoryPrompt,
  buildWriteInstructions,
  isMemoryPath,
  checkLineLimit,
  formatMemoryDisplay,
  formatMemoryStatus,
  MEMORY_INDEX_LIMIT,
  MEMORY_INDEX_FILE,
  MEMORY_TOPIC_LIMIT,
  type MemoryScope,
} from "./lib.ts";
import { getInitState, initVault } from "./init.ts";
import { initGitRepo, commitVaultChanges, undoLastCommit, getLog } from "./git.ts";
import { buildMeditateApplyPrompt, buildReflectPrompt, buildRuminateApplyPrompt } from "./prompts.ts";
import { ProgressWidget } from "./widget.ts";
import { buildVaultSnapshot, runSubagent, extractConversations, encodeProjectSessionPath } from "./subagent.ts";
import type { DateFilter } from "./subagent.ts";

export default function memoryExtension(
  pi: ExtensionAPI,
  deps: { runSubagent: typeof runSubagent; staggerMs?: number; vaultDir?: string } = { runSubagent },
) {
  const staggerMs = deps.staggerMs ?? 2000;
  const globalDir = deps.vaultDir ?? path.join(os.homedir(), ".pi", "memories");
  let globalScope: MemoryScope | null = null;
  let memoryEnabled = true;
  let lastCtx: ExtensionContext | null = null;
  const pendingCommitMessages: string[] = [];

  interface BackgroundTask {
    abortController: AbortController;
    promise: Promise<void>;
  }

  const backgroundTasks = new Map<string, BackgroundTask>();

  function loadScope(dir: string): MemoryScope | null {
    const indexContent = readVaultIndex(dir);
    const files = listVaultFiles(dir);
    if (indexContent === null && files.length === 0) return null;
    return { dir, indexContent, fileCount: files.length };
  }

  function refreshScope() {
    globalScope = loadScope(globalDir);
  }

  function updateStatus(ctx: ExtensionContext) {
    ctx.ui.setStatus("memory", formatMemoryStatus(memoryEnabled, !!globalScope, globalScope?.fileCount ?? 0));
  }

  function getCurrentCtx(expectedCwd: string): ExtensionContext | null {
    if (!lastCtx) return null;
    if (lastCtx.cwd !== expectedCwd) return null;
    return lastCtx;
  }

  function launchBackground(name: string, cwd: string, fn: (signal: AbortSignal) => Promise<void>): void {
    const abortController = new AbortController();
    const promise = fn(abortController.signal)
      .catch((error) => {
        getCurrentCtx(cwd)?.ui.notify(
          `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      })
      .finally(() => {
        const task = backgroundTasks.get(name);
        if (task?.promise === promise) backgroundTasks.delete(name);
      });
    backgroundTasks.set(name, { abortController, promise });
  }

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    globalScope = loadScope(globalDir);
    if (globalScope) initGitRepo(globalDir);
    updateStatus(ctx);
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    const running = Array.from(backgroundTasks.entries());

    for (const [name, task] of running) {
      task.abortController.abort();
      ctx.ui.notify(`Cancelled running ${name} before session switch.`, "info");
    }

    await Promise.all(running.map(([, task]) => task.promise));
  });

  pi.on("before_agent_start", async (event) => {
    if (!memoryEnabled) return;

    globalScope = loadScope(globalDir);
    if (lastCtx) updateStatus(lastCtx);

    const memoryPrompt = buildMemoryPrompt(globalScope);
    const writeInstructions = buildWriteInstructions(globalDir);

    if (!memoryPrompt && !writeInstructions) return;

    return {
      systemPrompt: event.systemPrompt + (memoryPrompt || "") + "\n\n" + writeInstructions,
    };
  });

  pi.on("tool_call", async (event) => {
    if (!memoryEnabled) return undefined;
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

    const filePath = event.input.path as string | undefined;
    if (!filePath) return undefined;

    const memPath = isMemoryPath(filePath, globalDir);
    if (!memPath.isMemory) return undefined;

    const limit = memPath.isIndex ? MEMORY_INDEX_LIMIT : MEMORY_TOPIC_LIMIT;

    if (event.toolName === "write") {
      const content = event.input.content as string | undefined;
      if (!content) return undefined;

      const check = checkLineLimit(content, limit);
      if (check.exceeds) {
        return {
          block: true,
          reason: `Memory file would be ${check.lines} lines (limit: ${check.limit}). Trim the content first.`,
        };
      }
    }

    const result = (event as { result?: { block?: boolean } }).result;
    if (!result?.block) {
      refreshScope();
      if (lastCtx) updateStatus(lastCtx);
    }

    return undefined;
  });

  pi.on("agent_end", async () => {
    const message = pendingCommitMessages.shift();
    if (!message) return;
    commitVaultChanges(globalDir, message);
  });

  const MEMORY_SUBCOMMANDS: AutocompleteItem[] = [
    { value: "reflect",   label: "reflect",   description: "Capture learnings from current session" },
    { value: "meditate",  label: "meditate",  description: "Audit and evolve the vault" },
    { value: "ruminate",  label: "ruminate",  description: "Mine past sessions for patterns" },
    { value: "ruminate --from",  label: "ruminate --from",  description: "Mine sessions modified on or after YYYY-MM-DD" },
    { value: "ruminate --to",    label: "ruminate --to",    description: "Mine sessions modified on or before YYYY-MM-DD" },
    { value: "cancel ruminate", label: "cancel ruminate", description: "Cancel running ruminate task" },
    { value: "cancel meditate", label: "cancel meditate", description: "Cancel running meditate task" },
    { value: "undo",      label: "undo",      description: "Revert the last memory commit" },
    { value: "log",       label: "log",       description: "Show recent memory vault history" },
    { value: "on",        label: "on",        description: "Enable memory for this session" },
    { value: "off",       label: "off",       description: "Disable memory for this session" },
    { value: "edit",      label: "edit",      description: "Edit index.md" },
    { value: "init",      label: "init",      description: "Initialize vault with starter principles" },
  ];

  function parseDate(value: string, flag: string): Date | string {
    const d = new Date(value + "T00:00:00");
    return isNaN(d.getTime()) ? `Invalid date format for ${flag}: "${value}". Use YYYY-MM-DD.` : d;
  }

  function parseRuminateArgs(args: string): { error?: string } & DateFilter {
    const parts = args.split(/\s+/);
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    for (let i = 0; i < parts.length; i++) {
      const flag = parts[i];
      if ((flag === "--from" || flag === "--to") && parts[i + 1]) {
        const result = parseDate(parts[i + 1], flag);
        if (typeof result === "string") return { error: result };
        if (flag === "--from") fromDate = result;
        else toDate = result;
        i++;
      }
    }

    return { fromDate, toDate };
  }

  function isCancelledResult(result: { stderr: string }, signal: AbortSignal): boolean {
    return signal.aborted || /cancel/i.test(result.stderr);
  }

  async function runMeditateBackground(cwd: string, signal: AbortSignal): Promise<void> {
    const ctx = getCurrentCtx(cwd);
    if (!ctx) return;

    const snapshot = buildVaultSnapshot(globalDir);
    if (!snapshot.trim()) {
      ctx.ui.notify("No vault content found to audit.", "info");
      return;
    }

    const ts = Date.now();
    const snapshotPath = path.join(os.tmpdir(), `memory-vault-snapshot-${ts}.md`);
    const auditPath = path.join(os.tmpdir(), `memory-audit-report-${ts}.md`);
    const reviewPath = path.join(os.tmpdir(), `memory-review-report-${ts}.md`);
    const auditorAgentPath = path.join(import.meta.dirname, "agents", "auditor.md");
    const reviewerAgentPath = path.join(import.meta.dirname, "agents", "reviewer.md");
    fs.writeFileSync(snapshotPath, snapshot);

    const widget = new ProgressWidget(ctx.ui, "meditate");
    widget.setStep("Auditor", "running");

    try {
      const auditor = await deps.runSubagent(
        auditorAgentPath,
        `Read the vault snapshot at ${snapshotPath} and return your audit report in markdown.`,
        cwd,
        undefined,
        undefined,
        signal,
      );

      if (isCancelledResult(auditor, signal)) {
        ctx.ui.notify("Meditate cancelled.", "info");
        return;
      }

      if (auditor.exitCode !== 0 || !auditor.output.trim()) {
        const reason = auditor.stderr || (auditor.output.trim() ? "unknown error" : "no output");
        widget.setStep("Auditor", "error", `${reason.split("\n")[0].slice(0, 80)} — log: ${auditor.logFile}`);
        ctx.ui.notify(`Meditate failed (auditor): ${reason}\nLog: ${auditor.logFile}`, "error");
        return;
      }

      fs.writeFileSync(auditPath, auditor.output);
      const actionable = (auditor.output.match(/^-\s+/gm) ?? []).length;
      widget.setStep("Auditor", "done", `${actionable} findings`);

      let reviewerOutput = "";
      if (actionable >= 3) {
        widget.setStep("Reviewer", "running");
        const reviewer = await deps.runSubagent(
          reviewerAgentPath,
          `Read the vault snapshot at ${snapshotPath} and the audit report at ${auditPath}. Return your review report in markdown.`,
          cwd,
          undefined,
          undefined,
          signal,
        );

        if (isCancelledResult(reviewer, signal)) {
          ctx.ui.notify("Meditate cancelled.", "info");
          return;
        }

        if (reviewer.exitCode !== 0) {
          widget.setStep("Reviewer", "error", `log: ${reviewer.logFile}`);
          ctx.ui.notify(`Meditate partial (reviewer failed): ${reviewer.stderr || "unknown error"}\nLog: ${reviewer.logFile}`, "warning");
        } else {
          reviewerOutput = reviewer.output;
          widget.setStep("Reviewer", "done");
          fs.writeFileSync(reviewPath, reviewerOutput || "# Review Report\n\nNo additional findings.");
        }
      }

      if (signal.aborted) {
        ctx.ui.notify("Meditate cancelled.", "info");
        return;
      }

      const summary = [
        "## Meditate Summary",
        `- Auditor findings: ${actionable}`,
        `- Reviewer run: ${actionable >= 3 ? (reviewerOutput ? "yes" : "failed") : "skipped"}`,
        "",
        auditor.output ? `### Audit\n${auditor.output}` : "",
        reviewerOutput ? `\n### Review\n${reviewerOutput}` : "",
      ].join("\n");

      ctx.ui.notify(summary, "info");

      pi.sendMessage({
        content: buildMeditateApplyPrompt(auditor.output, reviewerOutput, globalDir),
        deliverAs: "followUp",
        triggerTurn: true,
      });
      pendingCommitMessages.push("meditate: apply audit findings");
    } finally {
      widget.clear();
      fs.rmSync(snapshotPath, { force: true });
      fs.rmSync(auditPath, { force: true });
      fs.rmSync(reviewPath, { force: true });
    }
  }

  async function runRuminateBackground(cwd: string, signal: AbortSignal, options: DateFilter): Promise<void> {
    const ctx = getCurrentCtx(cwd);
    if (!ctx) return;

    const minerAgentPath = path.join(import.meta.dirname, "agents", "miner.md");
    const sessionsRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
    const encodedCwd = encodeProjectSessionPath(cwd);
    const projectSessionsDir = path.join(sessionsRoot, encodedCwd);

    if (!fs.existsSync(projectSessionsDir)) {
      ctx.ui.notify("No sessions found for project.", "info");
      return;
    }

    const ts = Date.now();
    const outputDir = path.join(os.tmpdir(), `memory-ruminate-${ts}`);
    let widget: ProgressWidget | null = null;

    try {
      const jsonlCount = fs.readdirSync(projectSessionsDir).filter((f) => f.endsWith(".jsonl")).length;
      const numBatches = Math.max(2, Math.min(10, Math.ceil(jsonlCount / 20)));

      const extraction = extractConversations(projectSessionsDir, outputDir, numBatches, options);

      if (extraction.conversationCount === 0) {
        ctx.ui.notify("No parseable conversation messages found in project sessions.", "info");
        return;
      }

      const snapshot = buildVaultSnapshot(globalDir);
      const snapshotPath = path.join(outputDir, "vault-snapshot.md");
      fs.writeFileSync(snapshotPath, snapshot);

      widget = new ProgressWidget(ctx.ui, "ruminate");
      widget.setHeader(`Found ${extraction.conversationCount} conversations in ${extraction.batches.length} batches`);
      for (let i = 0; i < extraction.batches.length; i++) {
        widget.setStep(`Miner ${i + 1}`, "running");
      }

      const tasks = extraction.batches.map(async (manifestPath, i) => {
        if (i > 0) await new Promise((r) => setTimeout(r, i * staggerMs));
        if (signal.aborted) return null;

        const result = await deps.runSubagent(
          minerAgentPath,
          `Read the batch manifest at ${manifestPath} — it lists conversation file paths, one per line. Read each conversation file. Also read the vault snapshot at ${snapshotPath} to see what knowledge is already captured. Return high-signal findings in markdown.`,
          cwd,
          undefined,
          undefined,
          signal,
        );

        if (isCancelledResult(result, signal)) return null;

        if (result.exitCode !== 0 || !result.output.trim()) {
          const hint = result.stderr ? result.stderr.split("\n")[0].slice(0, 80) : `exit ${result.exitCode}`;
          widget?.setStep(`Miner ${i + 1}`, "error", `${hint} — log: ${result.logFile}`);
          return null;
        }

        const findings = (result.output.match(/^-\s+/gm) ?? []).length;
        widget?.setStep(`Miner ${i + 1}`, "done", `${findings} findings`);

        return { index: i, output: result.output };
      });

      const minerOutputs = (await Promise.all(tasks))
        .filter((item): item is { index: number; output: string } => item !== null)
        .sort((a, b) => a.index - b.index)
        .map((item) => item.output);

      if (signal.aborted) {
        ctx.ui.notify("Ruminate cancelled.", "info");
        return;
      }

      if (minerOutputs.length === 0) {
        ctx.ui.notify(`Ruminate complete — processed ${extraction.conversationCount} conversations, no findings.`, "info");
        return;
      }

      ctx.ui.notify(`Ruminate complete — ${minerOutputs.length} batches returned findings from ${extraction.conversationCount} conversations.`, "info");

      pi.sendMessage({
        content: buildRuminateApplyPrompt(minerOutputs, globalDir),
        deliverAs: "followUp",
        triggerTurn: true,
      });
      pendingCommitMessages.push("ruminate: apply mined findings");
    } finally {
      widget?.clear();
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }

  pi.registerCommand("memory", {
    description: "View and manage agent memory (init/reflect/meditate/ruminate/undo/log/on/off/edit)",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const filtered = MEMORY_SUBCOMMANDS.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      lastCtx = ctx;
      const trimmed = args.trim();

      if (trimmed === "undo") {
        const result = undoLastCommit(globalDir);
        if (result.success) {
          refreshScope();
          updateStatus(ctx);
          ctx.ui.notify(`Undone: ${result.undoneMessage}`, "info");
        } else {
          ctx.ui.notify(`Cannot undo: ${result.error}`, "warning");
        }
        return;
      }

      if (trimmed === "log") {
        const entries = getLog(globalDir, 20);
        if (entries.length === 0) {
          ctx.ui.notify("No vault history found.", "info");
        } else {
          ctx.ui.notify(entries.join("\n"), "info");
        }
        return;
      }

      if (trimmed === "on") {
        memoryEnabled = true;
        updateStatus(ctx);
        ctx.ui.notify("Memory enabled", "info");
        return;
      }

      if (trimmed === "off") {
        memoryEnabled = false;
        updateStatus(ctx);
        ctx.ui.notify("Memory disabled for this session", "info");
        return;
      }

      if (trimmed === "cancel ruminate" || trimmed === "cancel meditate") {
        const taskName = trimmed.slice("cancel ".length);
        const task = backgroundTasks.get(taskName);
        if (!task) {
          ctx.ui.notify(`No ${taskName} task is running.`, "info");
          return;
        }
        task.abortController.abort();
        ctx.ui.notify(`Cancelling ${taskName}...`, "info");
        return;
      }

      if (trimmed === "reflect") {
        const prompt = buildReflectPrompt(globalDir);
        pi.sendUserMessage(prompt);
        pendingCommitMessages.push("reflect: capture session learnings");
        return;
      }

      if (trimmed === "meditate") {
        if (backgroundTasks.has("meditate")) {
          ctx.ui.notify("Meditate is already running.", "warning");
          return;
        }

        launchBackground("meditate", ctx.cwd, (signal) => runMeditateBackground(ctx.cwd, signal));
        ctx.ui.notify("Meditate started in background.", "info");
        return;
      }

      if (trimmed === "ruminate" || trimmed.startsWith("ruminate ")) {
        const { error, fromDate, toDate } = parseRuminateArgs(trimmed);
        if (error) {
          ctx.ui.notify(error, "warning");
          return;
        }

        if (backgroundTasks.has("ruminate")) {
          ctx.ui.notify("Ruminate is already running.", "warning");
          return;
        }

        launchBackground("ruminate", ctx.cwd, (signal) =>
          runRuminateBackground(ctx.cwd, signal, { fromDate, toDate }),
        );
        ctx.ui.notify("Ruminate started in background.", "info");
        return;
      }

      if (trimmed === "init") {
        const state = getInitState(globalDir);

        if (state === "v2") {
          const files = listVaultFiles(globalDir);
          const addLabel = "Add missing starter principles only";
          const replaceLabel = "Replace all principles with defaults (keeps other files)";
          const cancelLabel = "Cancel";
          const choice = await ctx.ui.select(
            `Vault exists: ${files.length} files. What would you like to do?`,
            [addLabel, replaceLabel, cancelLabel],
          );
          if (choice === cancelLabel || choice === undefined) return;

          if (choice === replaceLabel) {
            fs.rmSync(path.join(globalDir, "principles"), { recursive: true, force: true });
            fs.rmSync(path.join(globalDir, "principles.md"), { force: true });
          }

          const result = initVault(globalDir, true);
          initGitRepo(globalDir);
          refreshScope();
          updateStatus(ctx);
          ctx.ui.notify(`Global memory vault updated with ${result.principlesInstalled} starter principles.`, "success");
          return;
        }

        const result = initVault(globalDir, true);
        initGitRepo(globalDir);
        refreshScope();
        updateStatus(ctx);
        ctx.ui.notify(`Global memory vault initialized with ${result.principlesInstalled} starter principles.`, "success");
        return;
      }

      if (trimmed === "edit") {
        const filePath = path.join(globalDir, MEMORY_INDEX_FILE);
        fs.mkdirSync(globalDir, { recursive: true });
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, "# Memory\n");
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const edited = await ctx.ui.editor(`Edit ${MEMORY_INDEX_FILE}:`, content);
        if (edited !== undefined && edited !== content) {
          fs.writeFileSync(filePath, edited);
          refreshScope();
          updateStatus(ctx);
          ctx.ui.notify("Memory updated", "success");
        }
        return;
      }

      refreshScope();
      updateStatus(ctx);

      const state = getInitState(globalDir);
      const display = formatMemoryDisplay(
        { dir: globalDir, state, fileCount: globalScope?.fileCount ?? 0 },
        memoryEnabled,
      );
      ctx.ui.notify(display, "info");
    },
  });
}
