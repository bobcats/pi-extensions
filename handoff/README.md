# handoff

Create a new focused session from the current conversation.

## Usage

```
/handoff <goal>
```

Examples:

```
/handoff continue the auth cleanup
/handoff implement phase two of the plan
/handoff check other places that need this fix
```

## What the command does

1. Validates that the current conversation has meaningful handoff context (user/assistant text, compaction summaries, branch summaries, or custom context; system messages and tool-only entries do not count)
2. Confirms before overwriting any unsubmitted editor text
3. Generates a first-person handoff summary using Amp's `create_handoff_context` extraction prompt
4. Creates a new session with `parentSession` tracking
5. Pre-fills the new session's editor with the goal, `/skill:session-query`, the visible session lineage, a brief framing sentence, then the summary wrapped in `<handoff_note>...</handoff_note>` — goal first so the top line shows what this handoff is about
6. User reviews and presses Enter to submit

## Agent-callable tool

This extension also registers a safe `handoff` tool for agents.

The tool only prepares this command in the editor:

```text
/handoff <goal>
```

It does **not** create a new session, switch sessions, send a message, or auto-submit anything. The user must review the drafted slash command and press Enter.

In non-interactive mode, the tool returns a clear error explaining that an interactive Pi session is required and does not touch the editor.

## Guardrails and error handling

- `!ctx.hasUI` → `Handoff requires interactive mode.`
- `!ctx.model` → `No model selected.`
- empty goal → `Usage: /handoff <goal for new session>`
- no meaningful conversation text → `No conversation to hand off.`
- generation aborted (Esc) → `Handoff cancelled.`
- summary generation failure or blank model output → `Failed to generate handoff summary: <error>` with model/input/output diagnostics; the command does not create a new session
- `newSession` cancelled → `New session cancelled.`
- `newSession` throws → `Failed to create new session.`
- preferred summary model missing or unauthenticated → `Handoff summary model unavailable: <reason>`

## Model selection

Uses `openai-codex/gpt-5.5` for summary generation. If that model is not in the registry or lacks credentials, the command emits a hard error and returns; it does not fall back to the current session model.

`gpt-5.5` is used because summary generation is an ancillary task and this model provides a good quality/cost tradeoff for extracting concise handoff context.

## Parent session tracking

The new session is created with `parentSession` tracking, and post-switch editor updates run inside `withSession` so the extension uses the fresh replacement-session context instead of the stale pre-switch command context:

```ts
ctx.newSession({
  parentSession: currentSessionFile,
  withSession: async (ctx) => {
    ctx.ui.setEditorText(finalPrompt);
  },
})
```

This writes the parent session path into the new session's file header for future navigation by a `/resume` command or session browser.

The generated child prompt also includes the session path visibly. If there is only one parent, it stays compact:

```md
/skill:session-query

**Parent session:** `/path/to/session.jsonl`
```

If the parent itself was created from another session, the prompt includes the full linked list from newest to oldest:

```md
/skill:session-query

**Session lineage (newest to oldest):**
1. `/path/to/current-parent.jsonl`
2. `/path/to/grandparent.jsonl`
3. `/path/to/root.jsonl`
```

That lets the child model call the `session_query` tool against any prior session if the handoff note missed a detail.

## Extension interactions

| Extension | What happens on handoff |
|---|---|
| `memory` | Fires `session_start` for the child; re-injects the vault into the child's system prompt on the first `before_agent_start`. Do not duplicate vault content in the handoff prompt. |
| `auto-name-session` | Fires `agent_end` for the child's first turn; names the child session from the first user message + assistant response. Handoff deliberately does **not** call `pi.setSessionName()`. |
| `subagent` | Fires `session_shutdown` for the parent on handoff — same as `/new`. Any async subagent tmux panes opened by the parent are terminated. |
| `ext-prof` | Fires `session_start` for the child; refreshes the status bar. No action needed from handoff. |
| `notify` | Fires `agent_end` for the child's first completed turn and posts a desktop notification. No duplicate fires during summary generation — `complete()` does not fire `agent_end`. |

## Deliberate non-features

- **No auto-switching tool** — the agent-callable `handoff` tool only drafts `/handoff <goal>` in the editor and requires user submission
- **No `-mode` / `-model` flags** — out of scope; users can change the model after switching via pi's normal model picker
- **No auto-submit** — user presses Enter after reviewing the pre-filled editor

## Tests

```bash
npm test
```

All tests use `tsx --test --test-timeout=5000`.
