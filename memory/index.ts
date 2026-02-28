import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  readVaultIndex,
  listVaultFiles,
  buildVaultIndex,
  detectIndexDrift,
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
import { getInitState, initVault, migrateV1Vault } from "./init.ts";
import { buildMeditateApplyPrompt, buildReflectPrompt, buildRuminatePrompt } from "./prompts.ts";
import { synthesizeFindings, formatSynthesisTable } from "./ruminate.ts";
import { buildVaultSnapshot, runSubagent, parseSessionMessages, batchConversations, encodeProjectSessionPath } from "./subagent.ts";

export default function memoryExtension(
  pi: ExtensionAPI,
  deps: { runSubagent: typeof runSubagent } = { runSubagent },
) {
  let globalDir = path.join(os.homedir(), ".pi", "memories");
  let projectDir = "";
  let globalScope: MemoryScope | null = null;
  let projectScope: MemoryScope | null = null;
  let memoryEnabled = true;
  let lastCtx: ExtensionContext | null = null;

  function loadScope(dir: string): MemoryScope | null {
    const indexContent = readVaultIndex(dir);
    const files = listVaultFiles(dir);
    if (indexContent === null && files.length === 0) return null;
    return { dir, indexContent, fileCount: files.length };
  }

  function refreshScope(scope: "global" | "project") {
    if (scope === "global") {
      globalScope = loadScope(globalDir);
    } else {
      projectScope = loadScope(projectDir);
    }
  }

  function rebuildIndexIfDrift(scope: "global" | "project") {
    const dir = scope === "global" ? globalDir : projectDir;
    if (!detectIndexDrift(dir)) return;
    const newIndex = buildVaultIndex(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.md"), newIndex);
    refreshScope(scope);
  }

  function updateStatus(ctx: ExtensionContext) {
    const globalHasVault = !!globalScope;
    const projectHasVault = !!projectScope;
    const fileCount = (globalScope?.fileCount ?? 0) + (projectScope?.fileCount ?? 0);
    ctx.ui.setStatus("memory", formatMemoryStatus(memoryEnabled, globalHasVault, projectHasVault, fileCount));
  }

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    projectDir = path.join(ctx.cwd, ".pi", "memories");
    globalScope = loadScope(globalDir);
    projectScope = loadScope(projectDir);
    lastMtimeFingerprint = mtimeFingerprint(globalDir) + "||" + mtimeFingerprint(projectDir);
    updateStatus(ctx);
    startPolling();
  });

  pi.on("session_shutdown", async () => {
    stopPolling();
  });

  pi.on("before_agent_start", async (event) => {
    if (!memoryEnabled) return;

    const memoryPrompt = buildMemoryPrompt(globalScope, projectScope);
    const writeInstructions = buildWriteInstructions(globalDir, projectDir);

    if (!memoryPrompt && !writeInstructions) return;

    return {
      systemPrompt: event.systemPrompt + (memoryPrompt || "") + "\n\n" + writeInstructions,
    };
  });

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let lastMtimeFingerprint = "";

  function mtimeFingerprint(dir: string): string {
    try {
      const files = listVaultFiles(dir).map((f) => `${f}.md`);
      const entries = [...files, "index.md"].sort();
      return entries
        .map((f) => {
          try {
            return `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`;
          } catch {
            return `${f}:missing`;
          }
        })
        .join(",");
    } catch {
      return "";
    }
  }

  function startPolling() {
    if (pollInterval) return;
    const interval = setInterval(() => {
      const fingerprint = mtimeFingerprint(globalDir) + "||" + mtimeFingerprint(projectDir);
      if (fingerprint === lastMtimeFingerprint) return;
      lastMtimeFingerprint = fingerprint;

      rebuildIndexIfDrift("global");
      rebuildIndexIfDrift("project");
      globalScope = loadScope(globalDir);
      projectScope = loadScope(projectDir);
      if (lastCtx) updateStatus(lastCtx);
    }, 5000);
    interval.unref();
    pollInterval = interval;
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  pi.on("tool_call", async (event) => {
    if (!memoryEnabled) return undefined;
    if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

    const filePath = event.input.path as string | undefined;
    if (!filePath) return undefined;

    const memPath = isMemoryPath(filePath, globalDir, projectDir);
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
    if (!result?.block && memPath.scope) {
      rebuildIndexIfDrift(memPath.scope);
      if (lastCtx) updateStatus(lastCtx);
    }

    return undefined;
  });

  pi.registerCommand("memory", {
    description: "View and manage agent memory (init/migrate/reflect/meditate/ruminate/on/off/edit)",
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
        const prompt = buildReflectPrompt(globalDir, projectDir);
        pi.sendMessage({
          content: prompt,
          deliverAs: "followUp",
          triggerTurn: true,
        });
        return;
      }

      if (trimmed === "meditate") {
        const snapshot = [buildVaultSnapshot(globalDir), buildVaultSnapshot(projectDir)]
          .filter(Boolean)
          .join("\n\n");

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

        const auditor = await deps.runSubagent(
          auditorAgentPath,
          `Read the vault snapshot at ${snapshotPath} and return your audit report in markdown.`,
          ctx.cwd,
        );

        if (auditor.exitCode !== 0) {
          ctx.ui.notify(`Meditate failed (auditor): ${auditor.stderr || "unknown error"}`, "error");
          fs.rmSync(snapshotPath, { force: true });
          return;
        }

        fs.writeFileSync(auditPath, auditor.output || "# Audit Report\n\nNo findings.");
        const actionable = (auditor.output.match(/^-\s+/gm) ?? []).length;

        let reviewerOutput = "";
        if (actionable >= 3) {
          const reviewer = await deps.runSubagent(
            reviewerAgentPath,
            `Read the vault snapshot at ${snapshotPath} and the audit report at ${auditPath}. Return your review report in markdown.`,
            ctx.cwd,
          );
          if (reviewer.exitCode !== 0) {
            ctx.ui.notify(`Meditate partial (reviewer failed): ${reviewer.stderr || "unknown error"}`, "warning");
          } else {
            reviewerOutput = reviewer.output;
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

        pi.sendMessage({
          content: buildMeditateApplyPrompt(auditor.output, reviewerOutput, globalDir, projectDir),
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

        const promptHint = buildRuminatePrompt(globalDir, projectDir, ctx.cwd, minerAgentPath);
        if (!fs.existsSync(projectSessionsDir)) {
          ctx.ui.notify(`No sessions found for project.\n\n${promptHint}`, "info");
          return;
        }

        const jsonlPaths: string[] = [];
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            if (entry.isFile() && entry.name.endsWith(".jsonl")) jsonlPaths.push(full);
          }
        };
        walk(projectSessionsDir);

        const conversations: string[] = [];
        for (const filePath of jsonlPaths.sort()) {
          const raw = fs.readFileSync(filePath, "utf-8");
          const msgs = parseSessionMessages(raw);
          if (msgs.length === 0) continue;
          conversations.push(msgs.map((m) => `${m.role}: ${m.text}`).join("\n\n"));
        }

        if (conversations.length === 0) {
          ctx.ui.notify("No parseable conversation messages found in project sessions.", "info");
          return;
        }

        const numBatches = Math.max(2, Math.min(10, Math.ceil(conversations.length / 20)));
        const batches = batchConversations(conversations, numBatches).filter((b) => b.length > 0);
        const existingTopics = [...new Set([...listVaultFiles(globalDir), ...listVaultFiles(projectDir)])].sort();

        const ts = Date.now();
        const tempPaths: string[] = [];

        const tasks = batches.map(async (batch, i) => {
          const batchPath = path.join(os.tmpdir(), `memory-ruminate-batch-${ts}-${i}.md`);
          const topicsPath = path.join(os.tmpdir(), `memory-ruminate-topics-${ts}-${i}.md`);
          fs.writeFileSync(batchPath, batch.join("\n\n---\n\n"));
          fs.writeFileSync(topicsPath, existingTopics.join("\n"));
          tempPaths.push(batchPath, topicsPath);

          const result = await deps.runSubagent(
            minerAgentPath,
            `Read conversations at ${batchPath} and existing topics at ${topicsPath}. Return high-signal findings in markdown.`,
            ctx.cwd,
          );

          if (result.exitCode !== 0 || !result.output.trim()) {
            return null;
          }

          return { index: i, output: result.output };
        });

        const minerOutputs = (await Promise.all(tasks))
          .filter((item): item is { index: number; output: string } => item !== null)
          .sort((a, b) => a.index - b.index)
          .map((item) => item.output);

        for (const p of tempPaths) fs.rmSync(p, { force: true });

        const synthesisRows = synthesizeFindings(minerOutputs);
        const synthesisTable = formatSynthesisTable(synthesisRows);

        const summary = `## Ruminate Summary\n\nProcessed ${conversations.length} conversations in ${batches.length} batches.\n\n${synthesisTable}`;
        ctx.ui.notify(summary, "info");
        return;
      }

      if (trimmed === "v2migrate" || trimmed === "v2migrate project") {
        const isProject = trimmed === "v2migrate project";
        const dir = isProject ? projectDir : globalDir;
        const state = getInitState(dir);

        if (state !== "v1") {
          ctx.ui.notify("No legacy MEMORY.md found for migration.", "info");
          return;
        }

        const choice = await ctx.ui.select("Migrate legacy MEMORY.md to v2 vault", [
          { label: "Preserve old content as migrated.md (recommended)", value: "preserve" },
          { label: "Replace with fresh vault", value: "replace" },
          { label: "Cancel", value: "cancel" },
        ]);
        if (choice === "cancel" || choice === undefined) return;

        migrateV1Vault(dir, !isProject, choice as "preserve" | "replace");
        refreshScope(isProject ? "project" : "global");
        updateStatus(ctx);
        ctx.ui.notify("Memory vault migrated to v2.", "success");
        return;
      }

      if (trimmed === "init" || trimmed === "init project") {
        const isProject = trimmed === "init project";
        const dir = isProject ? projectDir : globalDir;
        const state = getInitState(dir);

        if (state === "v2") {
          const files = listVaultFiles(dir);
          const choice = await ctx.ui.select(
            `Vault exists: ${files.length} files. What would you like to do?`,
            [
              { label: "Add missing starter principles only", value: "add" },
              { label: "Replace all principles with defaults (keeps other files)", value: "replace" },
              { label: "Cancel", value: "cancel" },
            ],
          );
          if (choice === "cancel" || choice === undefined) return;

          if (choice === "replace" && !isProject) {
            fs.rmSync(path.join(dir, "principles"), { recursive: true, force: true });
            fs.rmSync(path.join(dir, "principles.md"), { force: true });
          }

          const result = initVault(dir, !isProject);
          refreshScope(isProject ? "project" : "global");
          updateStatus(ctx);
          ctx.ui.notify(
            isProject
              ? "Project memory vault updated."
              : `Global memory vault updated with ${result.principlesInstalled} starter principles.`,
            "success",
          );
          return;
        }

        const result = initVault(dir, !isProject);
        refreshScope(isProject ? "project" : "global");
        updateStatus(ctx);
        const msg = isProject
          ? "Project memory vault initialized."
          : `Global memory vault initialized with ${result.principlesInstalled} starter principles.`;
        ctx.ui.notify(msg, "success");
        return;
      }

      if (trimmed === "edit" || trimmed === "edit global") {
        const dir = trimmed === "edit global" ? globalDir : projectDir;
        const filePath = path.join(dir, MEMORY_INDEX_FILE);
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, "# Memory\n");
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const edited = await ctx.ui.editor(`Edit ${trimmed === "edit global" ? "global" : "project"} ${MEMORY_INDEX_FILE}:`, content);
        if (edited !== undefined && edited !== content) {
          fs.writeFileSync(filePath, edited);
          refreshScope(trimmed === "edit global" ? "global" : "project");
          updateStatus(ctx);
          ctx.ui.notify("Memory updated", "success");
        }
        return;
      }

      globalScope = loadScope(globalDir);
      projectScope = loadScope(projectDir);
      updateStatus(ctx);

      const globalState = getInitState(globalDir);
      const projectState = getInitState(projectDir);
      const display = formatMemoryDisplay(
        { dir: globalDir, state: globalState, fileCount: globalScope?.fileCount ?? 0 },
        { dir: projectDir, state: projectState, fileCount: projectScope?.fileCount ?? 0 },
        memoryEnabled,
      );
      ctx.ui.notify(display, "info");
    },
  });
}
