import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

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

type HandoffDeps = {
  completeFn?: typeof complete;
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

type ReplacementSessionContext = {
  ui: {
    notify(message: string, level: string): void;
    setEditorText(text: string): void;
  };
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

function textOfMessage(message: { content?: Array<{ type: string; text?: string }> }): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function hasConversationText(entry: SessionEntry): boolean {
  if (entry?.type !== "message") return false;
  const msg = (entry as any).message;
  const role = msg?.role;
  if (role !== "user" && role !== "assistant") return false;
  return textOfMessage(msg).length > 0;
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

function ensureConversation(branch: SessionEntry[], ctx: HandoffCommandContext): boolean {
  if (!branch.some(hasConversationText)) {
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
): Promise<SummaryModelResolution | null> {
  const preferred = ctx.modelRegistry.find(provider, modelId);
  if (preferred) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(preferred);
    if (auth.ok) {
      return { model: preferred, auth };
    }
  }

  const fallback = ctx.model;
  if (!fallback) return null;
  const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(fallback);
  if (!fallbackAuth.ok) return null;
  return { model: fallback, auth: fallbackAuth };
}

function conversationMessagesFromBranch(branch: SessionEntry[]): any[] {
  return branch
    .filter((entry) => entry.type === "message")
    .map((entry) => (entry as any).message);
}

function buildFinalPrompt(params: { goal: string; summary: string; parentSession: string | undefined }): string {
  const { goal, summary, parentSession } = params;
  const parentSection = parentSession
    ? `/skill:session-query\n\n**Parent session:** \`${parentSession}\`\n\n`
    : "";

  return `${goal}\n\n${parentSection}In the handoff note below, "I" refers to the previous assistant.\n\n<handoff_note>\n${summary}\n</handoff_note>`;
}

async function generateSummaryWithLoader(params: {
  ctx: HandoffCommandContext;
  completeFn: typeof complete;
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
        const message = error instanceof Error ? error.message : "unknown error";
        done({ kind: "error", error: message });
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
  const finalPrompt = buildFinalPrompt({ goal, summary, parentSession });
  let postSwitchFailed = false;

  let newSessionResult: { cancelled: boolean };
  try {
    newSessionResult = await ctx.newSession({
      parentSession,
      withSession: async (replacementCtx) => {
        try {
          replacementCtx.ui.setEditorText(finalPrompt);
          replacementCtx.ui.notify("Handoff ready — submit when ready.", "info");
        } catch {
          postSwitchFailed = true;
          try {
            replacementCtx.ui.notify("Failed to prepare handoff prompt.", "error");
          } catch {
            // Ignore replacement-session notification failures.
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

  return !postSwitchFailed;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateHandoffSummary(params: {
  completeFn: typeof complete;
  model: { provider: string; id: string };
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  messages: any[];
  goal: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const conversationText = serializeConversation(convertToLlm(params.messages));
  const userMessage: Message = {
    role: "user",
    content: [
      {
        type: "text",
        text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${params.goal}`,
      },
    ],
    timestamp: Date.now(),
  };

  const response = await params.completeFn(
    params.model,
    { systemPrompt: CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey: params.apiKey, headers: params.headers, signal: params.signal },
  );

  if ((response as any).stopReason === "aborted") return null;

  return response.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => (part as any).text)
    .join("\n")
    .trim();
}

export function createHandoffExtension(deps: HandoffDeps = {}) {
  const completeFn = deps.completeFn ?? complete;
  const SUMMARY_PROVIDER = deps.summaryProvider ?? "openai-codex";
  const SUMMARY_MODEL = deps.summaryModel ?? "gpt-5.3-codex";

  return function handoff(pi: ExtensionAPI) {
    pi.registerCommand("handoff", {
      description: "Transfer context to a new focused session",
      handler: async (args: string, ctx: any) => {
        const hctx = ctx as HandoffCommandContext;

        if (!ensureInteractiveMode(hctx)) return;
        if (!ensureModelSelected(hctx)) return;

        const goal = ensureGoal(args, hctx);
        if (!goal) return;

        const branch = hctx.sessionManager.getBranch();
        if (!ensureConversation(branch, hctx)) return;
        if (!(await confirmOverwriteIfNeeded(hctx))) return;

        const resolved = await resolveSummaryModel(hctx, SUMMARY_PROVIDER, SUMMARY_MODEL);
        if (!resolved) {
          hctx.ui.notify("Handoff: no usable model credentials", "error");
          return;
        }

        const messages = conversationMessagesFromBranch(branch);
        const summary = await generateSummaryWithLoader({ ctx: hctx, completeFn, resolved, messages, goal });
        if (summary === null) {
          hctx.ui.notify("Handoff cancelled.", "info");
          return;
        }

        if (typeof summary !== "string") {
          hctx.ui.notify(`Failed to generate handoff summary: ${summary.error}`, "error");
          return;
        }

        await applyHandoffToNewSession({ ctx: hctx, goal, summary });
      },
    });
  };
}

export default createHandoffExtension();
