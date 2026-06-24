import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT = `Extract relevant context from the conversation. Write from first person
perspective ("I did...", "I told you...").

Consider what's useful based on the user's request. Questions that might
be relevant:
  - What did I just do or implement?
  - What instructions did I already give you which are still relevant
    (e.g. follow patterns in the codebase)?
  - Did I provide a plan or spec that should be included?
  - What did I already tell you that's important (certain libraries,
    patterns, constraints, preferences)?
  - What important technical details did I discover (APIs, methods,
    patterns)?
  - What caveats, limitations, or open questions did I find?
  - What files did I tell you to edit that I should continue working on?

Extract what matters for the specific request. Don't answer questions
that aren't relevant. Pick an appropriate length based on the complexity
of the request.

Focus on capabilities and behavior, not file-by-file changes. Avoid
excessive implementation details (variable names, storage keys, constants)
unless critical.

Format: Plain text with bullets. No markdown headers, no bold/italic,
no code fences. Use workspace-relative paths for files.`;

// ── Local types ───────────────────────────────────────────────────────────────

type Message = {
  role: string;
  content: unknown;
  timestamp?: number;
};

type CompleteFn = (model: any, context: any, options?: any) => Promise<any>;

let cachedCompleteFn: CompleteFn | undefined;

async function loadCompatComplete(): Promise<CompleteFn> {
  if (cachedCompleteFn) return cachedCompleteFn;

  const rootEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"));
  const compatUrl = pathToFileURL(join(dirname(rootEntry), "compat.js")).href;
  const compat = await import(compatUrl) as { complete?: CompleteFn };
  if (typeof compat.complete !== "function") {
    throw new Error("@earendil-works/pi-ai compat complete() is unavailable");
  }
  cachedCompleteFn = compat.complete;
  return cachedCompleteFn;
}

type HandoffDeps = {
  completeFn?: CompleteFn;
  summaryProvider?: string;
  summaryModel?: string;
};

type AuthOk = {
  ok: true;
  apiKey?: string;
  headers?: Record<string, string>;
};

type AuthError = {
  ok: false;
  error: string;
};

type AuthResult = AuthOk | AuthError;

type SummaryModelResolution = {
  model: { provider: string; id: string };
  auth: AuthOk;
};

type SummaryModelResolutionResult =
  | { ok: true; resolved: SummaryModelResolution }
  | { ok: false; error: string };

type HandoffToolContext = {
  hasUI: boolean;
  ui: {
    setEditorText(text: string): void;
    notify(message: string, level: string): void;
  };
};

type ReplacementSessionContext = {
  ui: {
    notify(message: string, level: string): void;
    setEditorText(text: string): void;
  };
};

type SessionHeaderLike = {
  type?: unknown;
  parentSession?: unknown;
};

type HandoffCommandContext = {
  hasUI: boolean;
  model: { provider: string; id: string } | undefined;
  modelRegistry: {
    find(provider: string, modelId: string): { provider: string; id: string } | null;
    getApiKeyAndHeaders(model: { provider: string; id: string }): Promise<AuthResult>;
  };
  sessionManager: {
    getBranch(): SessionEntry[];
    getSessionFile(): string;
  };
  newSession(options: {
    parentSession: string;
    withSession?: (ctx: ReplacementSessionContext) => Promise<void>;
  }): Promise<{ cancelled: boolean }>;
  ui: {
    notify(message: string, level: string): void;
    getEditorText(): string;
    confirm(title: string, message: string): Promise<boolean>;
    setEditorText(text: string): void;
    custom<T>(builder: any): Promise<T>;
  };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTimestampMs(timestamp: unknown): number {
  if (typeof timestamp !== "string") return Date.now();
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function textOfMessage(message: { content?: string | Array<{ type: string; text?: string }> }): string {
  if (typeof message?.content === "string") return message.content.trim();
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function entryToHandoffMessage(entry: SessionEntry): any | undefined {
  switch (entry?.type) {
    case "message":
      return (entry as any).message;
    case "compaction":
      return {
        role: "compactionSummary",
        summary: (entry as any).summary ?? "",
        tokensBefore: (entry as any).tokensBefore ?? 0,
        timestamp: toTimestampMs((entry as any).timestamp),
      };
    case "branch_summary":
      return {
        role: "branchSummary",
        summary: (entry as any).summary ?? "",
        fromId: (entry as any).fromId ?? "",
        timestamp: toTimestampMs((entry as any).timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: (entry as any).customType ?? "",
        content: (entry as any).content ?? "",
        display: Boolean((entry as any).display),
        details: (entry as any).details,
        timestamp: toTimestampMs((entry as any).timestamp),
      };
    default:
      return undefined;
  }
}

function hasHandoffContextText(message: any): boolean {
  switch (message?.role) {
    case "user":
    case "assistant":
    case "custom":
      return textOfMessage(message).length > 0;
    case "compactionSummary":
    case "branchSummary":
      return typeof message.summary === "string" && message.summary.trim().length > 0;
    default:
      return false;
  }
}

function ensureInteractiveMode(ctx: HandoffCommandContext): boolean {
  if (!ctx.hasUI) {
    ctx.ui.notify("Handoff requires interactive mode.", "error");
    return false;
  }
  return true;
}

function ensureModelSelected(ctx: HandoffCommandContext): boolean {
  if (!ctx.model) {
    ctx.ui.notify("No model selected.", "error");
    return false;
  }
  return true;
}

function ensureGoal(args: string, ctx: HandoffCommandContext): string | null {
  const goal = args.trim();
  if (!goal) {
    ctx.ui.notify("Usage: /handoff <goal for new session>", "error");
    return null;
  }
  return goal;
}

function ensureConversation(messages: any[], ctx: HandoffCommandContext): boolean {
  if (!messages.some(hasHandoffContextText)) {
    ctx.ui.notify("No conversation to hand off.", "error");
    return false;
  }
  return true;
}

async function confirmOverwriteIfNeeded(ctx: HandoffCommandContext): Promise<boolean> {
  const currentEditorText = ctx.ui.getEditorText().trim();
  if (!currentEditorText) return true;
  return ctx.ui.confirm(
    "Overwrite editor with handoff prompt?",
    "The prompt editor has unsubmitted text. Replace it with the generated handoff prompt?",
  );
}

async function resolveSummaryModel(
  ctx: HandoffCommandContext,
  provider: string,
  modelId: string,
): Promise<SummaryModelResolutionResult> {
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    return { ok: false, error: `${provider}/${modelId} is not registered` };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    return { ok: false, error: `${provider}/${modelId} credentials unavailable: ${auth.error}` };
  }

  return { ok: true, resolved: { model, auth } };
}

export function handoffMessagesFromBranch(branch: SessionEntry[]): any[] {
  const lastCompactionIndex = branch.map((entry) => entry.type).lastIndexOf("compaction");
  if (lastCompactionIndex < 0) {
    return branch.map(entryToHandoffMessage).filter((message) => message !== undefined);
  }

  const compaction = branch[lastCompactionIndex] as any;
  const firstKeptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
  const branchToSummarize = [
    branch[lastCompactionIndex],
    ...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, lastCompactionIndex) : []),
    ...branch.slice(lastCompactionIndex + 1),
  ];

  return branchToSummarize.map(entryToHandoffMessage).filter((message) => message !== undefined);
}

function readParentSessionPath(sessionPath: string): string | null {
  if (!existsSync(sessionPath)) return null;

  try {
    const firstLine = readFileSync(sessionPath, "utf8").split(/\r?\n/, 1)[0];
    if (!firstLine?.trim()) return null;
    const header = JSON.parse(firstLine) as SessionHeaderLike;
    if (header.type !== "session" || typeof header.parentSession !== "string" || !header.parentSession.trim()) {
      return null;
    }
    return resolve(dirname(sessionPath), header.parentSession);
  } catch {
    return null;
  }
}

function buildSessionLineage(startSessionPath: string | undefined, maxDepth = 50): string[] {
  if (!startSessionPath) return [];

  const lineage: string[] = [];
  const seen = new Set<string>();
  let current: string | null = resolve(startSessionPath);

  while (current && lineage.length < maxDepth && !seen.has(current)) {
    lineage.push(current);
    seen.add(current);
    current = readParentSessionPath(current);
  }

  return lineage;
}

function formatSessionReferenceSection(sessionLineage: string[]): string {
  if (sessionLineage.length === 0) return "";
  if (sessionLineage.length === 1) return `/skill:session-query\n\n**Parent session:** \`${sessionLineage[0]}\`\n\n`;

  const lineageList = sessionLineage.map((sessionPath, index) => `${index + 1}. \`${sessionPath}\``).join("\n");
  return `/skill:session-query\n\n**Session lineage (newest to oldest):**\n${lineageList}\n\n`;
}

function buildFinalPrompt(params: { goal: string; summary: string; sessionLineage: string[] }): string {
  const { goal, summary, sessionLineage } = params;
  const sessionReferenceSection = formatSessionReferenceSection(sessionLineage);

  return `${goal}\n\n${sessionReferenceSection}In the handoff note below, "I" refers to the previous assistant.\n\n<handoff_note>\n${summary}\n</handoff_note>`;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

function prepareToolHandoff(ctx: HandoffToolContext, params: { goal: string }) {
  if (!ctx.hasUI) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Handoff via the handoff tool requires interactive mode. Run `/handoff ...` in an interactive Pi session.",
        },
      ],
      details: { ok: false },
    };
  }

  const command = `/handoff ${params.goal}`;
  ctx.ui.setEditorText(command);
  ctx.ui.notify("Handoff command ready in editor. Submit to continue.", "info");

  return {
    content: [
      {
        type: "text" as const,
        text: "Prepared a `/handoff ...` command in the editor. Submit it to create the new session safely.",
      },
    ],
    details: {
      ok: true,
      command,
      requiresUserSubmit: true,
    },
  };
}

async function generateSummaryWithLoader(params: {
  ctx: HandoffCommandContext;
  completeFn: CompleteFn;
  resolved: SummaryModelResolution;
  messages: any[];
  goal: string;
}): Promise<string | null | { kind: "error"; error: string }> {
  const { ctx, completeFn, resolved, messages, goal } = params;
  return ctx.ui.custom<string | null | { kind: "error"; error: string }>((tui: any, theme: any, _kb: any, done: any) => {
    const loader = new BorderedLoader(tui, theme, "Generating handoff prompt...");
    loader.onAbort = () => done(null);

    generateHandoffSummary({
      completeFn,
      model: resolved.model,
      apiKey: resolved.auth.apiKey,
      headers: resolved.auth.headers,
      messages,
      goal,
      signal: loader.signal,
    })
      .then(done)
      .catch((error) => {
        done({ kind: "error", error: errorToMessage(error) });
      });

    return loader;
  });
}

async function applyHandoffToNewSession(params: {
  ctx: HandoffCommandContext;
  goal: string;
  summary: string;
}): Promise<boolean> {
  const { ctx, goal, summary } = params;
  const parentSession = ctx.sessionManager.getSessionFile();
  const sessionLineage = buildSessionLineage(parentSession);
  const finalPrompt = buildFinalPrompt({ goal, summary, sessionLineage });
  let postSwitchFailed = false;
  let postSwitchFailureMessage: string | null = null;
  let postSwitchNotificationFailureMessage: string | null = null;

  let newSessionResult: { cancelled: boolean };
  try {
    newSessionResult = await ctx.newSession({
      parentSession,
      withSession: async (replacementCtx) => {
        try {
          replacementCtx.ui.setEditorText(finalPrompt);
          replacementCtx.ui.notify("Handoff ready — submit when ready.", "info");
        } catch (error) {
          postSwitchFailed = true;
          postSwitchFailureMessage = errorToMessage(error);
          try {
            replacementCtx.ui.notify("Failed to prepare handoff prompt.", "error");
          } catch (notifyError) {
            postSwitchNotificationFailureMessage = errorToMessage(notifyError);
          }
        }
      },
    });
  } catch {
    ctx.ui.notify("Failed to create new session.", "error");
    return false;
  }

  if (newSessionResult.cancelled) {
    ctx.ui.notify("New session cancelled.", "info");
    return false;
  }

  if (postSwitchNotificationFailureMessage) {
    console.warn(
      `Handoff failed to prepare the replacement session prompt (${postSwitchFailureMessage ?? "unknown error"}) ` +
        `and could not notify the replacement session (${postSwitchNotificationFailureMessage}).`,
    );
  }

  return !postSwitchFailed;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateHandoffSummary(params: {
  completeFn: CompleteFn;
  model: { provider: string; id: string };
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  messages: any[];
  goal: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const llmMessages = convertToLlm(params.messages);
  const conversationText = serializeConversation(llmMessages);
  const promptText = `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${params.goal}`;
  const userMessage: Message = {
    role: "user",
    content: [
      {
        type: "text",
        text: promptText,
      },
    ],
    timestamp: Date.now(),
  };

  const response = await params.completeFn(
    params.model,
    { systemPrompt: CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey: params.apiKey, headers: params.headers, signal: params.signal },
  );

  const stopReason = (response as any).stopReason;
  const errorMessage = (response as any).errorMessage;
  if (stopReason === "aborted") return null;

  const contentParts = Array.isArray(response.content) ? response.content : [];
  const textParts = contentParts.filter((part: any) => part.type === "text");
  const diagnosticSuffix =
    `stopReason=${stopReason ?? "unknown"}; errorMessage=${errorMessage || "none"}; ` +
    `inputMessages=${params.messages.length}; llmMessages=${llmMessages.length}; ` +
    `conversationChars=${conversationText.length}; promptChars=${promptText.length}; ` +
    `contentParts=${contentParts.length}; ` +
    `partTypes=${contentParts.map((part: any) => part?.type ?? "unknown").join(", ") || "none"}; ` +
    `textLengths=${textParts.map((part: any) => String(part?.text ?? "").length).join(", ") || "none"}`;

  if (stopReason === "error") {
    throw new Error(`summary generation provider error from ${params.model.provider}/${params.model.id}; ${diagnosticSuffix}`);
  }
  const summary = textParts
    .map((part: any) => (part as any).text ?? "")
    .join("\n")
    .trim();

  if (!summary) {
    throw new Error(`empty summary from ${params.model.provider}/${params.model.id}; ${diagnosticSuffix}`);
  }

  return summary;
}

export function createHandoffExtension(deps: HandoffDeps = {}) {
  const SUMMARY_PROVIDER = deps.summaryProvider ?? "openai-codex";
  const SUMMARY_MODEL = deps.summaryModel ?? "gpt-5.5";

  return function handoff(pi: ExtensionAPI) {
    pi.registerTool({
      name: "handoff",
      label: "Handoff",
      description:
        "Prepare a safe `/handoff <goal>` command in the editor for the user to submit. ONLY use this when the user explicitly asks for a handoff. The tool does not switch sessions or auto-submit.",
      promptSnippet: "Prepare a safe `/handoff <goal>` command in the editor for the user to review and submit.",
      promptGuidelines: [
        "Only use the handoff tool when the user explicitly asks for a handoff.",
        "The handoff tool only drafts a slash command; the user must submit it to create the new session.",
      ],
      parameters: Type.Object({
        goal: Type.String({ description: "The goal/task for the new session" }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        return prepareToolHandoff(ctx as HandoffToolContext, { goal: params.goal });
      },
    });

    pi.registerCommand("handoff", {
      description: "Transfer context to a new focused session",
      handler: async (args: string, ctx: any) => {
        const hctx = ctx as HandoffCommandContext;

        if (!ensureInteractiveMode(hctx)) return;
        if (!ensureModelSelected(hctx)) return;

        const goal = ensureGoal(args, hctx);
        if (!goal) return;

        const branch = hctx.sessionManager.getBranch();
        const messages = handoffMessagesFromBranch(branch);
        if (!ensureConversation(messages, hctx)) return;
        if (!(await confirmOverwriteIfNeeded(hctx))) return;

        const resolved = await resolveSummaryModel(hctx, SUMMARY_PROVIDER, SUMMARY_MODEL);
        if (!resolved.ok) {
          hctx.ui.notify(`Handoff summary model unavailable: ${resolved.error}`, "error");
          return;
        }

        const completeFn = deps.completeFn ?? await loadCompatComplete();
        const summary = await generateSummaryWithLoader({ ctx: hctx, completeFn, resolved: resolved.resolved, messages, goal });
        if (summary === null) {
          hctx.ui.notify("Handoff cancelled.", "info");
          return;
        }

        if (typeof summary !== "string") {
          hctx.ui.notify(`Failed to generate handoff summary: ${summary.error}`, "error");
          return;
        }

        if (!summary.trim()) {
          hctx.ui.notify("Failed to generate handoff summary: empty summary returned by generator", "error");
          return;
        }

        await applyHandoffToNewSession({ ctx: hctx, goal, summary: summary.trim() });
      },
    });
  };
}

export default createHandoffExtension();
