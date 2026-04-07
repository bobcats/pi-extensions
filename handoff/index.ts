import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

function textOfMessage(message: any): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function hasConversationText(entry: any): boolean {
  if (entry?.type !== "message") return false;
  const role = entry.message?.role;
  if (role !== "user" && role !== "assistant") return false;
  return textOfMessage(entry.message).length > 0;
}

async function resolveSummaryModel(ctx: any, provider: string, modelId: string) {
  const preferred = ctx.modelRegistry.find(provider, modelId);
  if (preferred) {
    const preferredAuth = await ctx.modelRegistry.getApiKeyAndHeaders(preferred);
    if (preferredAuth.ok) {
      return { model: preferred, auth: preferredAuth };
    }
  }

  const fallback = ctx.model;
  if (!fallback) return null;
  const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(fallback);
  if (!fallbackAuth.ok) return null;
  return { model: fallback, auth: fallbackAuth };
}

export function createHandoffExtension(
  deps: {
    completeFn?: typeof complete;
    summaryProvider?: string;
    summaryModel?: string;
  } = {},
) {
  const completeFn = deps.completeFn ?? complete;
  void completeFn;
  const SUMMARY_PROVIDER = deps.summaryProvider ?? "anthropic";
  const SUMMARY_MODEL = deps.summaryModel ?? "claude-sonnet-4-5";

  return function handoff(pi: ExtensionAPI) {
    pi.registerCommand("handoff", {
      description: "Transfer context to a new focused session",
      handler: async (args: string, ctx: any) => {
        if (!ctx.hasUI) {
          ctx.ui.notify("Handoff requires interactive mode.", "error");
          return;
        }
        if (!ctx.model) {
          ctx.ui.notify("No model selected.", "error");
          return;
        }
        const goal = args.trim();
        if (!goal) {
          ctx.ui.notify("Usage: /handoff <goal for new session>", "error");
          return;
        }
        const branch = ctx.sessionManager.getBranch();
        if (!branch.some(hasConversationText)) {
          ctx.ui.notify("No conversation to hand off.", "error");
          return;
        }

        const currentEditorText = ctx.ui.getEditorText().trim();
        if (currentEditorText) {
          const ok = await ctx.ui.confirm(
            "Overwrite editor with handoff prompt?",
            "The prompt editor has unsubmitted text. Replace it with the generated handoff prompt?",
          );
          if (!ok) return;
        }

        const resolved = await resolveSummaryModel(ctx, SUMMARY_PROVIDER, SUMMARY_MODEL);
        if (!resolved) {
          ctx.ui.notify("Handoff: no usable model credentials", "error");
          return;
        }
        void resolved;
        // remaining flow implemented in later tasks
      },
    });
  };
}

export default createHandoffExtension();
