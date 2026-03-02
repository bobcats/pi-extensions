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
import { buildMeditateApplyPrompt, buildReflectPrompt, buildRuminateApplyPrompt } from "./prompts.ts";
import { ProgressWidget } from "./widget.ts";
import { synthesizeFindings, formatSynthesisTable } from "./ruminate.ts";
import { buildVaultSnapshot, runSubagent, extractConversations, encodeProjectSessionPath } from "./subagent.ts";
import { ActivityOverlay } from "./activity-overlay.ts";
import type { StreamEvent } from "./subagent.ts";

function openActivityOverlay(
  ctx: ExtensionCommandContext,
  initialAgent: string,
): { overlay: ActivityOverlay; hide: () => void } | null {
  if (!ctx.hasUI) return null;

  const overlay = new ActivityOverlay();
  let handle: { hide: () => void } | undefined;

  ctx.ui.custom(
    () => {
      overlay.setAgent(initialAgent);
      return {
        render: (w: number) => overlay.render(w),
        invalidate: () => overlay.invalidate(),
        handleInput: () => {},
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "right-center",
        width: "40%",
        minWidth: 30,
        maxHeight: "80%",
        visible: (tw: number) => tw >= 100,
      },
      onHandle: (h) => { handle = h; },
    },
  );

  return { overlay, hide: () => handle?.hide() };
}

export default function memoryExtension(
  pi: ExtensionAPI,
  deps: { runSubagent: typeof runSubagent; staggerMs?: number } = { runSubagent },
) {
  const staggerMs = deps.staggerMs ?? 2000;
  let globalDir = path.join(os.homedir(), ".pi", "memories");
  let globalScope: MemoryScope | null = null;
  let memoryEnabled = true;
  let lastCtx: ExtensionContext | null = null;

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

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    globalScope = loadScope(globalDir);
    updateStatus(ctx);
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

  const MEMORY_SUBCOMMANDS: AutocompleteItem[] = [
    { value: "reflect",   label: "reflect",   description: "Capture learnings from current session" },
    { value: "meditate",  label: "meditate",  description: "Audit and evolve the vault" },
    { value: "ruminate",  label: "ruminate",  description: "Mine past sessions for patterns" },
    { value: "on",        label: "on",        description: "Enable memory for this session" },
    { value: "off",       label: "off",       description: "Disable memory for this session" },
    { value: "edit",      label: "edit",      description: "Edit index.md" },
    { value: "init",      label: "init",      description: "Initialize vault with starter principles" },
  ];

  pi.registerCommand("memory", {
    description: "View and manage agent memory (init/reflect/meditate/ruminate/on/off/edit)",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const filtered = MEMORY_SUBCOMMANDS.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();

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

      if (trimmed === "reflect") {
        const prompt = buildReflectPrompt(globalDir);
        pi.sendUserMessage(prompt);
        return;
      }

      if (trimmed === "meditate") {
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

        const activityPanel = openActivityOverlay(ctx, "Auditor");

        const auditor = await deps.runSubagent(
          auditorAgentPath,
          `Read the vault snapshot at ${snapshotPath} and return your audit report in markdown.`,
          ctx.cwd,
          undefined,
          (event) => {
            if (event.type === "text_delta") {
              activityPanel?.overlay.appendText(event.text);
            }
          },
        );

        if (auditor.exitCode !== 0 || !auditor.output.trim()) {
          const reason = auditor.stderr || (auditor.output.trim() ? "unknown error" : "no output");
          widget.setStep("Auditor", "error", `${reason.split("\n")[0].slice(0, 80)} — log: ${auditor.logFile}`);
          activityPanel?.hide();
          ctx.ui.notify(`Meditate failed (auditor): ${reason}\nLog: ${auditor.logFile}`, "error");
          fs.rmSync(snapshotPath, { force: true });
          return;
        }

        fs.writeFileSync(auditPath, auditor.output);
        const actionable = (auditor.output.match(/^-\s+/gm) ?? []).length;
        widget.setStep("Auditor", "done", `${actionable} findings`);

        let reviewerOutput = "";
        if (actionable >= 3) {
          widget.setStep("Reviewer", "running");
          activityPanel?.overlay.setAgent("Reviewer");
          const reviewer = await deps.runSubagent(
            reviewerAgentPath,
            `Read the vault snapshot at ${snapshotPath} and the audit report at ${auditPath}. Return your review report in markdown.`,
            ctx.cwd,
            undefined,
            (event) => {
              if (event.type === "text_delta") {
                activityPanel?.overlay.appendText(event.text);
              }
            },
          );
          if (reviewer.exitCode !== 0) {
            widget.setStep("Reviewer", "error", `log: ${reviewer.logFile}`);
            ctx.ui.notify(`Meditate partial (reviewer failed): ${reviewer.stderr || "unknown error"}\nLog: ${reviewer.logFile}`, "warning");
          } else {
            reviewerOutput = reviewer.output;
            widget.setStep("Reviewer", "done");
            fs.writeFileSync(reviewPath, reviewerOutput || "# Review Report\n\nNo additional findings.");
          }
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
        activityPanel?.hide();
        widget.clear();

        pi.sendMessage({
          content: buildMeditateApplyPrompt(auditor.output, reviewerOutput, globalDir),
          deliverAs: "followUp",
          triggerTurn: true,
        });

        fs.rmSync(snapshotPath, { force: true });
        fs.rmSync(auditPath, { force: true });
        fs.rmSync(reviewPath, { force: true });
        return;
      }

      if (trimmed === "ruminate") {
        const minerAgentPath = path.join(import.meta.dirname, "agents", "miner.md");
        const sessionsRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
        const encodedCwd = encodeProjectSessionPath(ctx.cwd);
        const projectSessionsDir = path.join(sessionsRoot, encodedCwd);

        if (!fs.existsSync(projectSessionsDir)) {
          ctx.ui.notify("No sessions found for project.", "info");
          return;
        }

        const ts = Date.now();
        const outputDir = path.join(os.tmpdir(), `memory-ruminate-${ts}`);

        const jsonlCount = fs.readdirSync(projectSessionsDir).filter((f) => f.endsWith(".jsonl")).length;
        const numBatches = Math.max(2, Math.min(10, Math.ceil(jsonlCount / 20)));

        const extraction = extractConversations(projectSessionsDir, outputDir, numBatches);

        if (extraction.conversationCount === 0) {
          ctx.ui.notify("No parseable conversation messages found in project sessions.", "info");
          fs.rmSync(outputDir, { recursive: true, force: true });
          return;
        }

        const existingTopics = listVaultFiles(globalDir).sort();
        const topicsPath = path.join(outputDir, "existing-topics.txt");
        fs.writeFileSync(topicsPath, existingTopics.join("\n"));

        const widget = new ProgressWidget(ctx.ui, "ruminate");
        widget.setHeader(`Found ${extraction.conversationCount} conversations in ${extraction.batches.length} batches`);
        for (let i = 0; i < extraction.batches.length; i++) {
          widget.setStep(`Miner ${i + 1}`, "running");
        }

        const activityPanel = openActivityOverlay(ctx, "Miner 1");

        const tasks = extraction.batches.map(async (manifestPath, i) => {
          if (i > 0) await new Promise((r) => setTimeout(r, i * staggerMs));
          const result = await deps.runSubagent(
            minerAgentPath,
            `Read the batch manifest at ${manifestPath} — it lists conversation file paths, one per line. Read each conversation file. Also read existing topics at ${topicsPath}. Return high-signal findings in markdown.`,
            ctx.cwd,
            undefined,
            (event) => {
              if (event.type === "text_delta") {
                activityPanel?.overlay.setLabel(`Miner ${i + 1}`);
                activityPanel?.overlay.appendText(event.text);
              }
            },
          );

          if (result.exitCode !== 0 || !result.output.trim()) {
            const hint = result.stderr ? result.stderr.split("\n")[0].slice(0, 80) : `exit ${result.exitCode}`;
            widget.setStep(`Miner ${i + 1}`, "error", `${hint} — log: ${result.logFile}`);
            return null;
          }

          const findings = (result.output.match(/^-\s+/gm) ?? []).length;
          widget.setStep(`Miner ${i + 1}`, "done", `${findings} findings`);

          return { index: i, output: result.output };
        });

        const minerOutputs = (await Promise.all(tasks))
          .filter((item): item is { index: number; output: string } => item !== null)
          .sort((a, b) => a.index - b.index)
          .map((item) => item.output);

        fs.rmSync(outputDir, { recursive: true, force: true });

        const synthesisRows = synthesizeFindings(minerOutputs);
        const synthesisTable = formatSynthesisTable(synthesisRows);

        activityPanel?.hide();
        widget.clear();

        if (synthesisRows.length === 0) {
          ctx.ui.notify(`Ruminate complete — processed ${extraction.conversationCount} conversations, no high-signal findings.`, "info");
          return;
        }

        ctx.ui.notify(`Ruminate complete — ${synthesisRows.length} findings from ${extraction.conversationCount} conversations.`, "info");

        pi.sendMessage({
          content: buildRuminateApplyPrompt(synthesisTable, globalDir),
          deliverAs: "followUp",
          triggerTurn: true,
        });
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
          refreshScope();
          updateStatus(ctx);
          ctx.ui.notify(`Global memory vault updated with ${result.principlesInstalled} starter principles.`, "success");
          return;
        }

        const result = initVault(globalDir, true);
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
