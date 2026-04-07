# Handoff Extension

## Goal

Ship a pi extension that matches real Amp's `/handoff` *content* fidelity — first-person context extraction, parent-session tracking, empty-thread rejection — while using pi's canonical session-switch API (`ctx.newSession` + `ctx.ui.setEditorText`) for the UX. Deliberately simpler than [pi-amplike's handoff](https://github.com/pasky/pi-amplike/blob/main/extensions/handoff.ts): no agent-callable tool, no inline mode/model flags, no `globalThis`-based cross-session coordination.

## Decisions

| Topic | Decision |
|---|---|
| Entry points | `/handoff <goal>` slash command only |
| Agent-callable tool | Not shipped (user who wants handoff mid-turn can paste `/handoff` themselves) |
| Inline `-mode` / `-model` flags | Not shipped (no modes infra in this repo; `-model` would be the only useful flag, which we drop for simplicity) |
| Handoff-mode / countdown / editable preview | Not shipped (explicit divergence from real Amp's TUI UX) |
| Extraction prompt | Real Amp's `create_handoff_context` system prompt, verbatim |
| Extraction output format | Free-text (no JSON parsing, no tool-call-based structured output) |
| Summary model | Hardcoded `anthropic/claude-sonnet-4-5`, fall back to `ctx.model` if unavailable |
| Session-switch API | `ctx.newSession({ parentSession })` + `ctx.ui.setEditorText(finalPrompt)` |
| Submit | Manual — user presses Enter after reviewing the pre-filled editor |
| Editor-collision handling | Confirm overwrite via `ctx.ui.confirm` if `getEditorText().trim()` is non-empty |
| Parent tracking | `parentSession` field in new session header; no in-prompt reference |
| Session-query integration | None (separable concern) |
| Code structure | Follow `auto-name-session` dependency-injection pattern for testability |

## Flow

```
/handoff <goal>
  │
  ├─ validate:
  │    hasUI, model, goal non-empty, conversation non-empty
  │
  ├─ editor-collision check:
  │    if getEditorText().trim() → confirm "Overwrite editor?" (abort on deny)
  │
  ├─ generate summary via pi-ai complete():
  │    model:   anthropic/claude-sonnet-4-5 (fallback to ctx.model)
  │    system:  CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT (verbatim from Amp binary)
  │    user:    "## Conversation History\n\n{serialized}\n\n
  │              ## User's Goal for New Thread\n\n{goal}"
  │    UI:      BorderedLoader with Esc to cancel
  │
  ├─ assemble finalPrompt = `${goal}\n\n${summary}`
  │
  ├─ ctx.newSession({ parentSession: currentSessionFile })
  │    └─ pi fires session_shutdown for parent; memory, ext-prof,
  │       subagent react; new session_start fires for child
  │
  ├─ ctx.ui.setEditorText(finalPrompt)
  └─ ctx.ui.notify("Handoff ready — submit when ready.", "info")
```

After the user presses Enter, pi fires `before_agent_start` → `memory` injects the vault into the system prompt; `agent_start` / `agent_end` → `auto-name-session` names the child.

## Guardrails

| Condition | Message | Action |
|---|---|---|
| `!ctx.hasUI` | "Handoff requires interactive mode." | `notify("error")`, return |
| `!ctx.model` | "No model selected." | `notify("error")`, return |
| `!goal.trim()` | "Usage: /handoff \<goal for new session\>" | `notify("error")`, return |
| Conversation is empty (see predicate below) | "No conversation to hand off." | `notify("error")`, return |
| Editor has unsubmitted text | "Overwrite editor with handoff prompt?" | `confirm`, return on deny |
| LLM generation aborted (Esc) | "Handoff cancelled." | `notify("info")`, return |
| `newSession()` cancelled by another extension | "New session cancelled." | `notify("info")`, return |
| No usable model credentials after fallback | "Handoff: no usable model credentials" | `notify("error")`, return |

**"Conversation is empty" predicate (exact):** after filtering the current branch to `SessionEntry.type === "message"` entries, the conversation is considered empty if the filtered list contains zero entries whose `message.role` is `"user"` or `"assistant"` with at least one non-empty text content block. System messages and tool-only entries do not count. This keeps the check deterministic for tests and avoids the edge case of handing off a session that contains only tool traces or empty placeholders.

## Model selection

```typescript
const SUMMARY_PROVIDER = "anthropic";
const SUMMARY_MODEL = "claude-sonnet-4-5";  // exact ID confirmed at implementation

let summaryModel = ctx.modelRegistry.find(SUMMARY_PROVIDER, SUMMARY_MODEL);
let summaryAuth = summaryModel
  ? await ctx.modelRegistry.getApiKeyAndHeaders(summaryModel)
  : null;

if (!summaryModel || !summaryAuth?.ok) {
  // Silent fallback: no Anthropic key / model not in registry → use current session model
  summaryModel = ctx.model;
  summaryAuth = await ctx.modelRegistry.getApiKeyAndHeaders(summaryModel);
}

if (!summaryAuth?.ok) {
  ctx.ui.notify("Handoff: no usable model credentials", "error");
  return;
}
```

The fallback keeps handoff working for users without an Anthropic key. Sonnet is preferred over `ctx.model` because:
- Summary generation is an ancillary task; burning Opus tokens on it is wasteful (same reasoning auto-name-session uses to hardcode Haiku).
- Sonnet is ~3× faster than Opus on long conversations, so the loader feels responsive.
- Sonnet's extraction quality is materially better than Haiku's on dense 30k-token conversations (where Haiku misses context the child session needs).

## Extraction prompt

Verbatim from Amp binary's `create_handoff_context` tool description:

```
Extract relevant context from the conversation. Write from first person
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
no code fences. Use workspace-relative paths for files.
```

This system prompt is the source of fidelity to real Amp. It will be stored as a `const CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT` and snapshot-tested so drift is caught immediately.

**Explicit non-inclusions** (vs pi-amplike):

- No memory-vault preamble (the `memory` extension re-injects the vault into the child's system prompt via `before_agent_start`)
- No `/skill:session-query` marker (we don't ship session-query)
- No `**Parent session:** <path>` text line (parent lives in the session file header, not in the prompt text)

## Final prompt assembly

```typescript
const finalPrompt = `${goal}\n\n${summary}`;
```

Goal-first so the top line of the editor immediately shows what this handoff is about when the user lands in the new session.

## Extension interaction contract

Observed via a survey of every extension in this repo that registers a session-lifecycle hook:

| Extension | Hooks | Interaction with handoff | Handoff's responsibility |
|---|---|---|---|
| `memory` | `session_start`/`_switch`/`_fork`/`_tree`, `before_agent_start`, `agent_end` | Rebuilds state for child on `session_start`; re-injects vault into child's system prompt on first `before_agent_start` | **Do not** duplicate vault content in the handoff prompt |
| `auto-name-session` | `agent_end` | Names child session from first user message + assistant response | **Do not** call `pi.setSessionName` from handoff |
| `subagent` | `session_start`, `session_shutdown` | On handoff, `session_shutdown` fires for the parent → closes any running async subagent tmux panes | **Document** in README — same behavior as `/new` |
| `ext-prof` | `session_start` | Refreshes status bar for child | No action |
| `notify` | `agent_end` | Posts notification when child's first turn ends (normal behavior, no duplicate during summary generation since `complete()` doesn't fire `agent_end`) | No action |
| `context`, `confirm-rm`, `session-breakdown`, `files`, `tldraw-desktop`, `exa`, `hypura` | Tool/command only or unrelated event | No conflict | No action |

The `files` extension also calls `setEditorText` via its `@file` mention helper, but only in response to user interaction, so there is no race with handoff's `setEditorText`.

## File layout

```
handoff/
├── index.ts                    ~200 lines — main extension
├── index.test.ts               ~250 lines — heavier test coverage
├── package.json                tsx --test script
└── README.md                   behavior + extension interaction contract
```

Root `package.json` must add `"./handoff/index.ts"` to the `pi.extensions` array.

## API shape

Follows the dependency-injection pattern from `auto-name-session/index.ts`:

```typescript
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

export const CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT = `...`;  // exported for snapshot tests

export function createHandoffExtension(deps: {
  completeFn?: typeof complete;
  summaryProvider?: string;   // default "anthropic"
  summaryModel?: string;      // default "claude-sonnet-4-5"
} = {}) {
  const completeFn = deps.completeFn ?? complete;
  const SUMMARY_PROVIDER = deps.summaryProvider ?? "anthropic";
  const SUMMARY_MODEL = deps.summaryModel ?? "claude-sonnet-4-5";

  return function handoff(pi: ExtensionAPI) {
    pi.registerCommand("handoff", {
      description: "Transfer context to a new focused session",
      handler: async (args, ctx) => { /* flow from §Flow */ },
    });
  };
}

export default createHandoffExtension();
```

## Testing strategy

Uses the harness pattern from `auto-name-session/index.test.ts`: mock `pi` with a `commands` Map (capturing registered handlers), mock `ctx` with `modelRegistry`, `ui`, `sessionManager`, `newSession`; inject `completeFn`.

### Test cases (13)

1. **Happy path** — Sonnet available, conversation present, no editor text → generates summary, switches session, sets editor text, notifies "Handoff ready"
2. **`!ctx.hasUI`** → notifies "Handoff requires interactive mode", returns without LLM call
3. **`!ctx.model`** → notifies "No model selected", returns without LLM call
4. **Empty goal** (whitespace) → notifies usage string
5. **Empty conversation** (branch has no message entries) → notifies "No conversation to hand off"
6. **Editor has text → user denies overwrite** → `confirm` called, returns without LLM call
7. **Editor has text → user confirms** → proceeds normally
8. **Sonnet fallback (not in registry)** → `ctx.modelRegistry.find` returns `null` → falls back to `ctx.model`, succeeds
9. **Sonnet fallback (auth fails)** → Sonnet present but `getApiKeyAndHeaders` returns `ok: false` → falls back to `ctx.model`, succeeds
10. **Generation aborted** (`response.stopReason === "aborted"`) → notifies "Handoff cancelled", does not call `newSession`
11. **`newSession` cancelled by another extension** → notifies "New session cancelled"
12. **System prompt snapshot** — `CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT` matches the expected text exactly (guards against silent drift from Amp's prompt)
13. **No `setSessionName` regression** — harness asserts `pi.setSessionName` is not called from handoff (guards against accidentally stepping on auto-name-session)
14. **Both-models-unauthed error path** — Sonnet's auth fails *and* `ctx.model`'s auth also fails → notifies "Handoff: no usable model credentials" and does not call `newSession`; exercises the final error branch in model selection

All tests use `tsx --test --test-timeout=5000`, matching repo convention.

## What we explicitly ruled out

These all came up during brainstorming and were rejected with reasons captured:

- **Agent-callable `handoff` tool** — would require pi-amplike's `agent_end` + `context` event dance to defer the session switch past tool-result recording; user can type `/handoff` themselves if needed mid-turn.
- **`-mode` flag** — no modes infrastructure in this repo.
- **`-model` flag** — out of scope for simplicity; user can change model after the switch via pi's normal model picker.
- **Countdown + editable preview** — Amp's stateful TUI mode is expensive to replicate faithfully in pi's TUI; the main editor is already a review surface.
- **Full-screen `ctx.ui.editor()` modal before switch** — extra friction for the >95% case where the generated summary is fine.
- **Structured JSON output / tool-call-based extraction** — free-text output goes straight into the editor; downstream has no consumer for a separate `relevantFiles` field.
- **Parent-banner UI on child session** — requires pi TUI changes; the `parentSession` header field is enough for `/resume` navigation.
- **Empty-child cleanup** — requires tracking whether the user "bailed" on the new session; adds state for a rare edge case.
- **Session-query integration** — separable concern; if a session-query extension is built later, it can read the `parentSession` header independently.
- **`globalThis` pending-handoff stash + `session_start` handler** — pi-amplike's auto-submit machinery is only needed to push a message into a new session without user intervention; we let the user press Enter.
- **`context` event message-filtering hack** — only needed by pi-amplike's tool-path handoff.

## Open questions

- **Exact Sonnet model ID.** `claude-sonnet-4-5` vs `claude-sonnet-4-6` — verify the correct current ID against `@mariozechner/pi-ai`'s registry at implementation time. The fallback to `ctx.model` means this is not load-bearing, but the default should point at a real model.

  **Done condition for this question:** during implementation, call `modelRegistry.find("anthropic", CANDIDATE_ID)` for each candidate Sonnet ID against a freshly-launched pi and pick the one that resolves to a non-null model. Update `SUMMARY_MODEL` constant accordingly and verify one happy-path test runs green against the real registry (not just the mock). No code changes ship until this is resolved.

## References

- `auto-name-session/index.ts` — dependency-injection pattern, canonical LLM-call pattern, hardcoded-cheap-model pattern
- Pi canonical handoff example: `$PI_ROOT/examples/extensions/handoff.ts`
- Pi extensions API: `$PI_ROOT/docs/extensions.md` (`ctx.newSession`, `ctx.ui.setEditorText`, `ctx.ui.confirm`)
- Real Amp binary `create_handoff_context` tool description (extracted via `strings ~/.amp/bin/amp`)
- pi-amplike handoff source: `https://github.com/pasky/pi-amplike/blob/main/extensions/handoff.ts` (what we are deliberately simplifying away from)
