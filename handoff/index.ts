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

export function createHandoffExtension(deps: { completeFn?: typeof complete } = {}) {
  const completeFn = deps.completeFn ?? complete;
  void completeFn;

  return function handoff(_pi: ExtensionAPI) {
    // implemented in later tasks
  };
}

export default createHandoffExtension();
