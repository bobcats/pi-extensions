/**
 * memory — Pi Extension
 *
 * Agent memory vault with three operations:
 * - reflect: review conversation, persist learnings to vault
 * - ruminate: mine past sessions for patterns
 * - dream: endless autonomous vault curation loop
 *
 * JSONL operation history is the sole source of truth.
 * Dashboard is a pure function of state reconstructed from JSONL.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text, truncateToWidth, matchesKey } from "@mariozechner/pi-tui";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as qmd from "./qmd.js";
import { initGitRepo, getChangedFiles, commitVault, undoLastCommit, getGitLog } from "./git.js";
import { OPERATIONS_FILE, readVaultIndex, listVaultFiles, countVaultFiles, initVault } from "./lib.js";
import { MINER_AGENT_PATH, SCRIPTS_DIR, parseRuminateArgs, extractAndBatch, buildRuminatePrompt } from "./session.js";
import { formatElapsed, formatRelativeTime, STATUS_ICONS, parseOperationsJSONL, renderDashboardLines } from "./dashboard.js";
import { buildReflectPrompt, buildDreamPrompt } from "./prompts.js";
import type { OperationType, OperationStatus, OperationResult, MemoryState } from "./types.js";

// ---------------------------------------------------------------------------
// Types (extension-local)
// ---------------------------------------------------------------------------

interface LogDetails {
  operation: OperationResult;
  state: MemoryState;
}

// ---------------------------------------------------------------------------
// Tool Schemas
// ---------------------------------------------------------------------------

const LogOperationParams = Type.Object({
  type: StringEnum(["reflect", "ruminate", "dream"] as const, {
    description: "What kind of memory operation was performed",
  }),
  status: StringEnum(["keep", "noop"] as const, {
    description: "keep = vault was changed, noop = no changes needed",
  }),
  description: Type.String({
    description: "Short description of what this operation did",
  }),
  findings_count: Type.Optional(
    Type.Number({
      description: "Number of findings/changes applied (default: 0)",
    }),
  ),
});

const RequestReflectParams = Type.Object({
  reason: Type.Optional(
    Type.String({
      description: "Optional reason or trigger context for why reflection is requested",
    }),
  ),
});

const SearchMemoryParams = Type.Object({
  query: Type.String({
    description: "Natural language search query for the memory vault",
  }),
  limit: Type.Optional(
    Type.Number({
      description: "Max results to return (default: 5)",
    }),
  ),
});


const VAULT_DIR = path.join(os.homedir(), ".pi", "memories");
const OPERATIONS_PATH = path.join(VAULT_DIR, OPERATIONS_FILE);

export default function memoryExtension(pi: ExtensionAPI) {
  // Register miner agent with the subagent extension.
  // Emit eagerly (works if subagent loaded first) and listen for
  // subagent:discover (works if memory loaded first).
  interface AgentConfig {
    name: string;
    description: string;
    tools?: string[];
    model?: string;
    systemPrompt: string;
    source: "bundled" | "user" | "project";
    filePath: string;
  }

  let minerAgent: AgentConfig | null = null;
  try {
    const minerContent = fs.readFileSync(MINER_AGENT_PATH, "utf-8");
    const fmMatch = minerContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const systemPrompt = fmMatch ? fmMatch[2].trim() : minerContent;
    minerAgent = {
      name: "memory-miner",
      description: "Mines conversation batches for uncaptured patterns",
      tools: ["read", "bash"],
      model: "claude-haiku-4-5",
      systemPrompt,
      source: "bundled",
      filePath: MINER_AGENT_PATH,
    };
    pi.events.emit("subagent:register", [minerAgent]);
  } catch {
    // Agent file missing — ruminate will fail gracefully
  }
  pi.events.on("subagent:discover", () => {
    if (minerAgent) pi.events.emit("subagent:register", [minerAgent]);
  });

  let dashboardExpanded = false;
  let dreamMode = false;
  let memoryEnabled = true;
  let lastCtx: ExtensionContext | null = null;

  let qmdAvailable = false;
  let isQmdInstalled: boolean | null = null;

  // Auto-resume tracking for dream mode
  let lastAutoResumeTime = 0;
  let operationsThisSession = 0;

  // Throttle tool-driven reflect requests to avoid accidental loops/spam
  let lastReflectRequestAt = 0;

  // Track consecutive dream noops to trigger prompt escalation
  let consecutiveNoops = 0;

  // Running operation state (for spinner in fullscreen overlay)
  let runningOperation: { startedAt: number; type: string } | null = null;
  let overlayTui: { requestRender: () => void } | null = null;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;
  const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  let state: MemoryState = {
    operations: [],
    dreamCycle: 0,
  };

  // -----------------------------------------------------------------------
  // State reconstruction
  // -----------------------------------------------------------------------

  const reconstructState = (ctx: ExtensionContext) => {
    state = {
      operations: [],
      dreamCycle: 0,
    };

    // Read from memory-operations.jsonl in the vault
    const jsonlPath = OPERATIONS_PATH;
    try {
      if (fs.existsSync(jsonlPath)) {
        state.operations = parseOperationsJSONL(fs.readFileSync(jsonlPath, "utf-8"));
      }
    } catch {
      // No JSONL yet
    }

    // Initialize vault git repo if it exists
    if (fs.existsSync(VAULT_DIR)) {
      initGitRepo(VAULT_DIR);
    }

    // Initialize QMD collection (async, non-blocking)
    if (isQmdInstalled === null) {
      isQmdInstalled = qmd.isQmdAvailable();
    }
    qmdAvailable = isQmdInstalled;
    if (qmdAvailable) {
      qmd.ensureCollection(VAULT_DIR).catch(() => {});
    }

    updateWidget(ctx);
  };

  const updateWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    lastCtx = ctx;

    const fileCount = countVaultFiles(VAULT_DIR);
    if (state.operations.length === 0 && fileCount === 0) {
      ctx.ui.setWidget("memory", undefined);
      return;
    }

    if (dashboardExpanded) {
      ctx.ui.setWidget("memory", (_tui, theme) => {
        const width = process.stdout.columns || 120;
        const lines: string[] = [];

        const hintText = " ctrl+b collapse • ctrl+shift+b fullscreen ";
        const label = "🧠 memory";
        const fillLen = Math.max(0, width - 3 - 1 - label.length - 1 - hintText.length);
        lines.push(
          truncateToWidth(
            theme.fg("borderMuted", "───") +
              theme.fg("accent", " " + label + " ") +
              theme.fg("borderMuted", "─".repeat(fillLen)) +
              theme.fg("dim", hintText),
            width
          )
        );

        lines.push(...renderDashboardLines(state, width, theme, countVaultFiles(VAULT_DIR)));

        return new Text(lines.join("\n"), 0, 0);
      });
    } else {
      ctx.ui.setWidget("memory", (_tui, theme) => {
        const fc = countVaultFiles(VAULT_DIR);
        const kept = state.operations.filter((r) => r.status === "keep").length;
        const last = state.operations.length > 0 ? state.operations[state.operations.length - 1] : null;

        const parts = [
          theme.fg("accent", "🧠"),
          theme.fg("muted", ` ${fc} ${fc === 1 ? "file" : "files"}`),
          theme.fg("dim", " │ "),
          theme.fg("text", `${state.operations.length} ops`),
          kept > 0 ? theme.fg("success", ` ${kept} kept`) : "",
        ];

        if (last) {
          parts.push(theme.fg("dim", " │ "));
          parts.push(theme.fg("muted", `${last.type} ${formatRelativeTime(last.timestamp)}`));
        }

        if (dreamMode) {
          parts.push(theme.fg("dim", " │ "));
          parts.push(theme.fg("warning", `dream cycle ${state.dreamCycle}`));
        }

        parts.push(theme.fg("dim", "  (ctrl+b expand • ctrl+shift+b fullscreen)"));

        return new Text(parts.join(""), 0, 0);
      });
    }
  };

  pi.on("session_start", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_fork", async (_e, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_e, ctx) => reconstructState(ctx));

  // Reset per-session operation counter when agent starts
  pi.on("agent_start", async () => {
    operationsThisSession = 0;
  });

  // Clear running operation state when agent stops; auto-resume dream if active
  pi.on("agent_end", async (_event, ctx) => {
    runningOperation = null;
    if (overlayTui) overlayTui.requestRender();

    if (!dreamMode) return;

    // Don't auto-resume if no operations ran this session (user likely stopped manually)
    if (operationsThisSession === 0) return;

    // Rate-limit auto-resume to once every 5 minutes
    const now = Date.now();
    if (now - lastAutoResumeTime < 5 * 60 * 1000) return;
    lastAutoResumeTime = now;

    const journalPath = path.join(VAULT_DIR, "dream-journal.md");
    const hasJournal = fs.existsSync(journalPath);

    let resumeMsg =
      `Dream loop ended (likely context limit). Resume the dream — read ${VAULT_DIR}/index.md for vault contents.`;
    if (hasJournal) {
      resumeMsg += ` Check ${journalPath} for promising paths to explore. Prune stale entries.`;
    }
    if (consecutiveNoops >= 2) {
      resumeMsg += ` NOTE: ${consecutiveNoops} consecutive noop cycles before reset — stop exploring and start restructuring.`;
    }

    pi.sendUserMessage(resumeMsg);
  });

  // Inject vault content into system prompt
  pi.on("before_agent_start", async (event, _ctx) => {
    if (!memoryEnabled) return;

    const indexContent = readVaultIndex(VAULT_DIR);
    if (!indexContent) return;

    const fileCount = countVaultFiles(VAULT_DIR);
    let extra =
      "\n\n## Agent Memory\n\n" +
      "Before starting work, read the memory files relevant to this task. " +
      "The vault index below shows what's available. Memory files contain past mistakes, " +
      "project architecture, and patterns — skipping them leads to repeated errors.\n\n" +
      `### Memory vault (${VAULT_DIR}/) — ${fileCount} files\n\n${indexContent}`;

    if (qmdAvailable) {
      extra +=
        "\n\nThe `search_memory` tool is available for semantic search across the vault. " +
        "Use it when you need to find specific knowledge but aren't sure which file contains it.";
    }

    if (dreamMode) {
      const journalPath = path.join(VAULT_DIR, "dream-journal.md");
      const hasJournal = fs.existsSync(journalPath);

      extra += "\n\n" + buildDreamPrompt(VAULT_DIR, consecutiveNoops, SCRIPTS_DIR);

      if (hasJournal) {
        extra += `\n\n💡 Dream journal exists at ${journalPath} — check it for promising paths to explore. Prune stale entries.`;
      }
    }

    return {
      systemPrompt: event.systemPrompt + extra,
    };
  });

  const startReflect = (ctx: ExtensionContext, reason?: string) => {
    memoryEnabled = true;
    updateWidget(ctx);
    ctx.ui.notify("Reflecting on this session…", "info");
    const extraReason = reason?.trim() ? `\n\nRequested reason: ${reason.trim()}` : "";
    pi.sendUserMessage(buildReflectPrompt(VAULT_DIR) + extraReason, { deliverAs: "followUp" });
  };

  // -----------------------------------------------------------------------
  // request_reflect tool — trigger same flow as /memory reflect
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "request_reflect",
    label: "Request Reflect",
    description: "Queue a reflection turn using the same behavior as '/memory reflect'.",
    promptSnippet: "Request a dedicated reflection turn.",
    promptGuidelines: [
      "Use when you discover durable learnings worth capturing in the memory vault.",
      "Prefer at most once per turn unless explicitly requested by the user.",
    ],
    parameters: RequestReflectParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const now = Date.now();
      if (now - lastReflectRequestAt < 30_000) {
        return {
          content: [{ type: "text", text: "Reflect request ignored (cooldown active)." }],
        };
      }

      lastReflectRequestAt = now;
      startReflect(_ctx, params.reason);

      return {
        content: [{ type: "text", text: "Queued reflection turn." }],
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("request_reflect "));
      text += theme.fg("accent", "queued");
      if (args.reason) {
        text += " " + theme.fg("dim", args.reason);
      }
      return new Text(text, 0, 0);
    },
  });

  // -----------------------------------------------------------------------
  // search_memory tool — semantic search over the memory vault
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "search_memory",
    label: "Search Memory",
    description:
      "Search the memory vault using natural language. Returns relevant notes with titles, scores, and snippets. Requires `qmd` to be installed globally (`npm i -g @tobilu/qmd`).",
    promptSnippet: "Semantic search over the memory vault via QMD.",
    promptGuidelines: [
      "Use when you need to find specific knowledge in the memory vault but aren't sure which file contains it.",
      "Prefer reading files directly via the vault index when you already know which file you need.",
      "Returns empty results if qmd is not installed — fall back to reading index.md.",
    ],
    parameters: SearchMemoryParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!qmdAvailable) {
        return {
          content: [
            {
              type: "text",
              text: "qmd is not installed. Install with: npm i -g @tobilu/qmd\nFalling back to vault index at " + VAULT_DIR + "/index.md",
            },
          ],
        };
      }

      const results = await qmd.search(params.query, {
        limit: params.limit ?? 5,
      });

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No results found for "${params.query}". Try broader terms or check ${VAULT_DIR}/index.md directly.`,
            },
          ],
        };
      }

      const lines = results.map(
        (r, i) =>
          `${i + 1}. **${r.title}** (${Math.round(r.score * 100)}%)\n` +
          `   File: ${qmd.toVaultPath(VAULT_DIR, r.file)}\n` +
          (r.snippet ? `   ${r.snippet}\n` : ""),
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} results for "${params.query}":\n\n${lines.join("\n")}`,
          },
        ],
        details: { results },
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("search_memory "));
      text += theme.fg("accent", args.query);
      if (args.limit) text += theme.fg("dim", ` (limit: ${args.limit})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const d = result.details as { results: qmd.QmdSearchResult[] } | undefined;
      if (!d || d.results.length === 0) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? theme.fg("dim", t.text) : "", 0, 0);
      }
      const summary = d.results
        .map((r) => `${Math.round(r.score * 100)}% ${r.title}`)
        .join(" · ");
      return new Text(
        theme.fg("success", `${d.results.length} results: `) + theme.fg("muted", summary),
        0,
        0,
      );
    },
  });

  // -----------------------------------------------------------------------
  // log_operation tool — records a memory operation result
  // -----------------------------------------------------------------------

  pi.registerTool({
    name: "log_operation",
    label: "Log Operation",
    description:
      "Record a memory operation result. Commits vault changes, writes to operation history, updates dashboard.",
    promptSnippet:
      "Log memory operation (type, status, description). Commits vault and writes to history.",
    promptGuidelines: [
      "Call log_operation after making vault changes (reflect, ruminate, dream cycle).",
      "log_operation automatically commits vault changes via git. Do NOT commit manually.",
      "Use status 'keep' if vault was changed. 'noop' if no changes were needed.",
    ],
    parameters: LogOperationParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const t0 = runningOperation?.startedAt ?? Date.now();
      const filesChanged = getChangedFiles(VAULT_DIR);
      const result = commitVault(VAULT_DIR, `${params.type}: ${params.description}`);

      const operation: OperationResult = {
        type: params.type as OperationType,
        status: (result.committed ? params.status : "noop") as OperationStatus,
        description: params.description,
        findingsCount: params.findings_count ?? 0,
        filesChanged: result.committed ? filesChanged : [],
        durationMs: Date.now() - t0,
        timestamp: Date.now(),
      };

      if (dreamMode) {
        operation.cycle = state.dreamCycle;
        state.dreamCycle++;

        if (operation.status === "noop") {
          consecutiveNoops++;
        } else {
          consecutiveNoops = 0;
        }
      }

      state.operations.push(operation);
      operationsThisSession++;

      // Append to JSONL
      try {
        const jsonlPath = OPERATIONS_PATH;
        fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
        fs.appendFileSync(jsonlPath, JSON.stringify({
          operationType: operation.type,
          ...operation,
        }) + "\n");
      } catch {
        // Don't fail if write fails
      }

      // Auto-index QMD after vault changes
      if (qmdAvailable && result.committed) {
        qmd.update().catch(() => {});
      }

      runningOperation = null;
      updateWidget(_ctx);
      if (overlayTui) overlayTui.requestRender();

      const icon = operation.status === "keep" ? "✓" : "·";
      let text = `${icon} Logged #${state.operations.length}: ${operation.type} ${operation.status} — ${operation.description}`;
      if (result.committed) {
        text += `\n📝 Git: committed ${filesChanged.length} file${filesChanged.length === 1 ? "" : "s"}`;
      } else {
        text += `\n📝 Git: nothing to commit`;
      }
      text += `\n(${state.operations.length} operations total)`;

      return {
        content: [{ type: "text", text }],
        details: { operation, state: { ...state } } as LogDetails,
      };
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("log_operation "));
      const color = args.status === "keep" ? "success" : "dim";
      text += theme.fg(color, `${args.type} ${args.status}`);
      text += " " + theme.fg("dim", args.description);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const d = result.details as LogDetails | undefined;
      if (!d) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }

      const { operation: op } = d;
      const color = op.status === "keep" ? "success" : "dim";
      const icon = STATUS_ICONS[op.status];

      let text =
        theme.fg(color, `${icon} `) +
        theme.fg("accent", `#${d.state.operations.length} ${op.type}`);
      text += " " + theme.fg("muted", op.description);
      if (op.findingsCount > 0) {
        text += theme.fg("text", ` (${op.findingsCount} findings)`);
      }

      return new Text(text, 0, 0);
    },
  });

  // -----------------------------------------------------------------------
  // Ctrl+R — toggle dashboard expand/collapse
  // -----------------------------------------------------------------------

  pi.registerShortcut("ctrl+b", {
    description: "Toggle memory dashboard",
    handler: async (ctx) => {
      if (state.operations.length === 0 && countVaultFiles(VAULT_DIR) === 0) {
        ctx.ui.notify("No vault yet — run /memory init to get started", "info");
        return;
      }
      dashboardExpanded = !dashboardExpanded;
      updateWidget(ctx);
    },
  });

  // -----------------------------------------------------------------------
  // Ctrl+Shift+X — fullscreen scrollable dashboard overlay
  // -----------------------------------------------------------------------

  pi.registerShortcut("ctrl+shift+b", {
    description: "Fullscreen memory dashboard",
    handler: async (ctx) => {
      if (state.operations.length === 0 && countVaultFiles(VAULT_DIR) === 0) {
        ctx.ui.notify("No vault yet — run /memory init", "info");
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          let scrollOffset = 0;
          overlayTui = tui;

          // Start spinner interval for elapsed time animation
          spinnerInterval = setInterval(() => {
            spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
            if (runningOperation) tui.requestRender();
          }, 80);

          return {
            render(width: number): string[] {
              const termH = process.stdout.rows || 40;
              // Content gets the full width — no box borders
              const content = renderDashboardLines(state, width, theme, countVaultFiles(VAULT_DIR), 0);

              // Add running operation indicator
              if (runningOperation) {
                const elapsed = formatElapsed(Date.now() - runningOperation.startedAt);
                const frame = SPINNER[spinnerFrame % SPINNER.length];
                content.push(
                  truncateToWidth(
                    `  ${theme.fg("warning", `${frame} ${runningOperation.type}… ${elapsed}`)}`,
                    width
                  )
                );
              }

              const totalRows = content.length;
              const viewportRows = Math.max(4, termH - 4); // leave room for header/footer

              // Clamp scroll
              const maxScroll = Math.max(0, totalRows - viewportRows);
              if (scrollOffset > maxScroll) scrollOffset = maxScroll;
              if (scrollOffset < 0) scrollOffset = 0;

              const out: string[] = [];

              // Header line
              const title = "🧠 memory vault";
              const fillLen = Math.max(0, width - 3 - 1 - title.length - 1);
              out.push(
                truncateToWidth(
                  theme.fg("borderMuted", "───") +
                  theme.fg("accent", " " + title + " ") +
                  theme.fg("borderMuted", "─".repeat(fillLen)),
                  width
                )
              );

              // Content rows
              const visible = content.slice(scrollOffset, scrollOffset + viewportRows);
              for (const line of visible) {
                out.push(truncateToWidth(line, width));
              }
              // Fill remaining viewport
              for (let i = visible.length; i < viewportRows; i++) {
                out.push("");
              }

              // Footer line
              const scrollInfo = totalRows > viewportRows
                ? ` ${scrollOffset + 1}-${Math.min(scrollOffset + viewportRows, totalRows)}/${totalRows}`
                : "";
              const helpText = ` ↑↓/j/k scroll • esc close${scrollInfo} `;
              const footFill = Math.max(0, width - helpText.length);
              out.push(
                truncateToWidth(
                  theme.fg("borderMuted", "─".repeat(footFill)) +
                  theme.fg("dim", helpText),
                  width
                )
              );

              return out;
            },

            handleInput(data: string): void {
              const termH = process.stdout.rows || 40;
              const viewportRows = Math.max(4, termH - 4);
              const totalRows = state.operations.length + (runningOperation ? 1 : 0) + 10; // rough estimate
              const maxScroll = Math.max(0, totalRows - viewportRows);

              if (matchesKey(data, "escape") || data === "q") {
                done(undefined);
                return;
              }
              if (matchesKey(data, "up") || data === "k") {
                scrollOffset = Math.max(0, scrollOffset - 1);
              } else if (matchesKey(data, "down") || data === "j") {
                scrollOffset = Math.min(maxScroll, scrollOffset + 1);
              } else if (matchesKey(data, "pageUp") || data === "u") {
                scrollOffset = Math.max(0, scrollOffset - viewportRows);
              } else if (matchesKey(data, "pageDown") || data === "d") {
                scrollOffset = Math.min(maxScroll, scrollOffset + viewportRows);
              } else if (data === "g") {
                scrollOffset = 0;
              } else if (data === "G") {
                scrollOffset = maxScroll;
              }
              tui.requestRender();
            },

            invalidate(): void {},

            dispose(): void {
              overlayTui = null;
              if (spinnerInterval) {
                clearInterval(spinnerInterval);
                spinnerInterval = null;
              }
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            width: "95%",
            maxHeight: "90%",
            anchor: "center" as const,
          },
        }
      );
    },
  });

  // -----------------------------------------------------------------------
  // /memory command
  // -----------------------------------------------------------------------

  const MEMORY_SUBCOMMANDS: AutocompleteItem[] = [
    { value: "reflect", label: "reflect", description: "Capture learnings from current session" },
    { value: "ruminate", label: "ruminate", description: "Mine past sessions for patterns" },
    { value: "ruminate --from", label: "ruminate --from", description: "Mine sessions modified on or after YYYY-MM-DD" },
    { value: "ruminate --to", label: "ruminate --to", description: "Mine sessions modified on or before YYYY-MM-DD" },
    { value: "search", label: "search", description: "Search the memory vault (requires qmd)" },
    { value: "dream", label: "dream", description: "Start autonomous vault curation loop" },
    { value: "cancel dream", label: "cancel dream", description: "Stop dream mode" },
    { value: "undo", label: "undo", description: "Revert the last memory vault commit" },
    { value: "log", label: "log", description: "Show recent memory vault history" },
    { value: "on", label: "on", description: "Enable memory for this session" },
    { value: "off", label: "off", description: "Disable memory for this session" },
    { value: "init", label: "init", description: "Initialize vault with starter principles" },
  ];

  pi.registerCommand("memory", {
    description: "Memory vault operations (init/reflect/ruminate/dream/undo/log/on/off)",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const filtered = MEMORY_SUBCOMMANDS.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();

      if (trimmed === "off") {
        memoryEnabled = false;
        ctx.ui.notify("Memory: off", "info");
        return;
      }

      if (trimmed === "on") {
        memoryEnabled = true;
        ctx.ui.notify("Memory: on", "info");
        return;
      }

      if (trimmed === "undo") {
        const result = undoLastCommit(VAULT_DIR);
        if (result.success === false) {
          ctx.ui.notify(`Cannot undo: ${result.error}`, "warning");
        } else {
          updateWidget(ctx);
          ctx.ui.notify(`Undone: ${result.undoneMessage}`, "info");
        }
        return;
      }

      if (trimmed === "log") {
        const entries = getGitLog(VAULT_DIR, 20);
        if (entries.length === 0) {
          ctx.ui.notify("No vault history found.", "info");
        } else {
          ctx.ui.notify(entries.join("\n"), "info");
        }
        return;
      }

      if (trimmed === "reflect") {
        startReflect(ctx);
        return;
      }

      if (trimmed === "ruminate" || trimmed.startsWith("ruminate ")) {
        const { error, fromDate, toDate } = parseRuminateArgs(trimmed);
        if (error) {
          ctx.ui.notify(error, "warning");
          return;
        }

        ctx.ui.notify("Extracting sessions…", "info");
        const result = extractAndBatch(ctx.cwd, { fromDate, toDate });
        if ("error" in result) {
          ctx.ui.notify(result.error, "warning");
          return;
        }

        ctx.ui.notify(
          `Found ${result.conversationCount} sessions in ${result.batches.length} batches. Sending to miners…`,
          "info",
        );
        pi.sendUserMessage(buildRuminatePrompt(result, VAULT_DIR));
        return;
      }

      if (trimmed === "dream") {
        dreamMode = true;
        state.dreamCycle = 1;
        consecutiveNoops = 0;
        updateWidget(ctx);
        ctx.ui.notify("Dream mode started", "info");
        pi.sendUserMessage(
          `Dream mode active. Read ${VAULT_DIR}/index.md and ${VAULT_DIR}/dream-journal.md, ` +
          `then start your first cycle. Call log_operation after each batch of changes. NEVER STOP until interrupted.`
        );
        return;
      }

      if (trimmed === "cancel dream") {
        dreamMode = false;
        state.dreamCycle = 0;
        updateWidget(ctx);
        ctx.ui.notify(
          "Dream mode stopped.\n" +
          "dream-journal.md is still in the vault for review.",
          "info",
        );
        return;
      }

      if (trimmed === "search" || trimmed.startsWith("search ")) {
        const query = trimmed === "search" ? "" : trimmed.slice("search ".length).trim();
        if (!query) {
          ctx.ui.notify("Usage: /memory search <query>", "warning");
          return;
        }
        if (!qmdAvailable) {
          ctx.ui.notify("qmd not installed. Install with: npm i -g @tobilu/qmd", "warning");
          return;
        }
        ctx.ui.notify(`Searching vault for: ${query}`, "info");
        const results = await qmd.search(query, { limit: 10 });
        if (results.length === 0) {
          ctx.ui.notify(`No results for "${query}"`, "info");
          return;
        }
        const lines = results.map(
          (r, i) =>
            `${i + 1}. ${Math.round(r.score * 100)}% ${r.title}\n   ${qmd.toVaultPath(VAULT_DIR, r.file)}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (trimmed === "init") {
        const hasVaultAlready = fs.existsSync(path.join(VAULT_DIR, "index.md"));

        if (hasVaultAlready) {
          const existingFiles = listVaultFiles(VAULT_DIR);
          const addLabel = "Add missing starter principles only";
          const replaceLabel = "Replace all principles with defaults (keeps other files)";
          const cancelLabel = "Cancel";
          const choice = await ctx.ui.select(
            `Vault exists: ${existingFiles.length} files. What would you like to do?`,
            [addLabel, replaceLabel, cancelLabel],
          );
          if (choice === cancelLabel || choice === undefined) return;

          if (choice === replaceLabel) {
            fs.rmSync(path.join(VAULT_DIR, "principles"), { recursive: true, force: true });
            fs.rmSync(path.join(VAULT_DIR, "principles.md"), { force: true });
          }

          const result = initVault(VAULT_DIR, true);
          initGitRepo(VAULT_DIR);
          if (qmdAvailable) {
            qmd.ensureCollection(VAULT_DIR).then(() => qmd.update()).catch(() => {});
          }
          updateWidget(ctx);
          ctx.ui.notify(`Vault updated with ${result.principlesInstalled} starter principles.`, "success");
          return;
        }

        const result = initVault(VAULT_DIR, true);
        initGitRepo(VAULT_DIR);
        commitVault(VAULT_DIR, "init: bootstrap vault with starter principles");
        if (qmdAvailable) {
          qmd.ensureCollection(VAULT_DIR).then(() => qmd.update()).catch(() => {});
        }
        memoryEnabled = true;
        updateWidget(ctx);
        ctx.ui.notify(
          `Vault initialized with ${result.principlesInstalled} starter principles.\n` +
          `Location: ${VAULT_DIR}/`,
          "success",
        );
        return;
      }

      // Default: show status
      const fileCount = countVaultFiles(VAULT_DIR);
      const hasVault = fs.existsSync(path.join(VAULT_DIR, "index.md"));
      const hasJournal = fs.existsSync(path.join(VAULT_DIR, "dream-journal.md"));
      ctx.ui.notify(
        `Memory: ${memoryEnabled ? "on" : "off"}\n` +
        `Vault: ${hasVault ? `${fileCount} files` : "no vault"}\n` +
        `Operations: ${state.operations.length}\n` +
        `Dream: ${dreamMode ? `active (cycle ${state.dreamCycle})` : "off"}` +
        (hasJournal ? ` (journal exists)` : "") +
        (qmdAvailable ? `\nQMD: installed (search enabled)` : `\nQMD: not installed (npm i -g @tobilu/qmd)`) +
        `\n\nCommands: reflect, ruminate, dream, cancel dream, search, undo, log, init, on, off`,
        "info",
      );
    },
  });
}
