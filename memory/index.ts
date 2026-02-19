import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  readMemoryIndex,
  listTopicFiles,
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

export default function memoryExtension(pi: ExtensionAPI) {
  let globalDir = path.join(os.homedir(), ".pi", "memories");
  let projectDir = "";
  let globalScope: MemoryScope | null = null;
  let projectScope: MemoryScope | null = null;
  let memoryEnabled = true;
  let lastCtx: ExtensionContext | null = null;

  function updateStatus(ctx: ExtensionContext) {
    const scopeCount = (globalScope ? 1 : 0) + (projectScope ? 1 : 0);
    const topicCount =
      (globalScope?.topicFiles.length ?? 0) + (projectScope?.topicFiles.length ?? 0);
    ctx.ui.setStatus("memory", formatMemoryStatus(memoryEnabled, scopeCount, topicCount));
  }

  function loadScope(dir: string): MemoryScope | null {
    const content = readMemoryIndex(dir);
    const topicFiles = listTopicFiles(dir);
    if (content === null && topicFiles.length === 0) return null;
    return { content, topicFiles };
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
      const entries = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
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

    return undefined;
  });

  pi.registerCommand("memory", {
    description: "View and manage agent memory (on/off/edit/edit global)",
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

      if (trimmed === "edit" || trimmed === "edit global") {
        const dir = trimmed === "edit global" ? globalDir : projectDir;
        const filePath = path.join(dir, MEMORY_INDEX_FILE);
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, "");
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const edited = await ctx.ui.editor(`Edit ${trimmed === "edit global" ? "global" : "project"} MEMORY.md:`, content);
        if (edited !== undefined && edited !== content) {
          fs.writeFileSync(filePath, edited);
          // Reload scope
          if (trimmed === "edit global") {
            globalScope = loadScope(globalDir);
          } else {
            projectScope = loadScope(projectDir);
          }
          updateStatus(ctx);
          ctx.ui.notify("Memory updated", "success");
        }
        return;
      }

      // Default: show display
      // Re-read fresh
      globalScope = loadScope(globalDir);
      projectScope = loadScope(projectDir);
      updateStatus(ctx);
      const display = formatMemoryDisplay(
        { dir: globalDir, content: globalScope?.content ?? null, topicFiles: globalScope?.topicFiles ?? [] },
        { dir: projectDir, content: projectScope?.content ?? null, topicFiles: projectScope?.topicFiles ?? [] },
        memoryEnabled,
      );
      ctx.ui.notify(display, "info");
    },
  });
}
