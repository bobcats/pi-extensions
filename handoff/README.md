# handoff

Create a new focused session from the current conversation.

## Usage

```
/handoff <goal>
```

Example:

```
/handoff continue the auth cleanup
/handoff implement phase two of the plan
/handoff check other places that need this fix
```

The command:

1. Validates that the current conversation has meaningful user/assistant text (system messages and tool-only entries do not count)
2. Confirms before overwriting any unsubmitted editor text
3. Generates a first-person handoff summary using Amp's `create_handoff_context` extraction prompt
4. Creates a new session with `parentSession` tracking
5. Pre-fills the new session's editor with `goal + summary` — goal first so the top line immediately shows what this handoff is about
6. User reviews and presses Enter to submit

## Model selection

Prefers `anthropic/claude-sonnet-4-6` for summary generation. If that model is not in the registry or its credentials are unavailable, falls back silently to `ctx.model` (the current session's model). If neither model has usable credentials, the command emits an error and returns.

Sonnet is preferred because summary generation is an ancillary task — burning Opus tokens on it is wasteful — and Sonnet's extraction quality on dense long conversations is materially better than Haiku's.

## Parent session tracking

The new session is created with:

```ts
ctx.newSession({ parentSession: currentSessionFile })
```

This writes the parent session path into the new session's file header. A future `/resume` command or session browser can use it for navigation.

## Deliberate non-features

- **No agent-callable `handoff` tool** — users who want a handoff mid-turn can type `/handoff` themselves
- **No `-mode` / `-model` flags** — out of scope; users can change the model after switching via pi's normal model picker
- **No countdown / preview mode** — the editor is already a review surface; an extra modal would add friction for the common case where the summary is fine
- **No session-query integration** — separable concern; a future session-query extension can read the `parentSession` header independently
- **No auto-submit** — user presses Enter after reviewing the pre-filled editor

## Extension interactions

| Extension | What happens on handoff |
|---|---|
| `memory` | Fires `session_start` for the child; re-injects the vault into the child's system prompt on the first `before_agent_start`. **Do not** duplicate vault content in the handoff prompt. |
| `auto-name-session` | Fires `agent_end` for the child's first turn; names the child session from the first user message + assistant response. Handoff deliberately does **not** call `pi.setSessionName()`. |
| `subagent` | Fires `session_shutdown` for the parent on handoff — same behavior as `/new`. Any running async subagent tmux panes opened by the parent session are terminated. |
| `ext-prof` | Fires `session_start` for the child; refreshes the status bar. No action needed from handoff. |
| `notify` | Fires `agent_end` for the child's first completed turn and posts a desktop notification. Normal behavior — no duplicate fires during summary generation because `complete()` does not fire `agent_end`. |

## Tests

```bash
npm test
```

All tests use `tsx --test --test-timeout=5000`.
