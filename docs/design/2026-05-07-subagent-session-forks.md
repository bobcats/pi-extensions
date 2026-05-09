# Subagent Session Forks

## Status

Approved for planning.

## Context

The subagent extension currently launches synchronous subagents with `pi --mode json -p --no-session`, so each subagent starts without the parent conversation history. Async subagents already run with `--session <temp-file>`, but those session files are blank and temporary.

Pi sessions are JSONL trees. `SessionManager.createBranchedSession(leafId)` can extract the parent session's active branch into a new session file without replacing the parent UI session. This is the right primitive for giving subagents an inspectable fork of the current conversation.

## Goals

- Let callers opt in per subagent tool call to inherited conversation context.
- Give every forked subagent an inspectable child session file.
- Preserve current task-only behavior by default.
- Keep parent session/UI state untouched.
- Support single, parallel, async single, and async parallel subagents in the first version.

## Non-goals

- No filesystem isolation. Forked subagents still share the working directory unless the caller uses git worktrees or other sandboxing.
- No `chain` support for forked context in the first version.
- No automatic disk-state restore from Pi session forks.
- No use of `ctx.fork()`, because it is a session-replacement API for the active UI session.

## User-facing API

Add one optional parameter to the `subagent` tool:

```ts
context?: "task-only" | "fork-session"
```

Default: `"task-only"`.

Behavior:

- `task-only`: current behavior.
- `fork-session`: create one child Pi session file per subagent invocation, branched from the parent session's current leaf.
- `chain` plus `fork-session`: reject with a clear error.

Forked child sessions are always preserved. Parent tool output should include each child session path visibly and in result details.

## Architecture

Introduce a small `SessionForker` seam in the subagent runtime. It should be dependency-injected so tests can simulate fork success and failure without opening real Pi sessions.

Responsibilities:

- Read the parent session file and current leaf from `ctx.sessionManager`.
- Validate that both exist when `context: "fork-session"` is requested.
- Create a branched child session with `createBranchedSession(leafId)` or an equivalent SDK-level wrapper.
- Return the child session file path.

The process runners then choose between:

- `--no-session` for `task-only`.
- `--session <child-session-file>` for `fork-session`.

The task prompt remains the existing `Task: ...` style. Lightweight metadata, if needed, belongs in the task text rather than as an extra custom session entry.

## Data flow

### Synchronous single and parallel

1. Parse the `context` parameter.
2. For `task-only`, keep `--no-session`.
3. For `fork-session`, validate parent session state and create one child session per subagent.
4. Pass the child `sessionFile` into the single-agent runner.
5. Spawn `pi --mode json -p --session <child-session-file> ...`.
6. Attach `sessionFile` to each `SingleResult`.
7. Include the session paths in visible output and structured `details`.

Parallel mode should create all child sessions before spawning any agents. If any fork fails, abort the whole tool call before launching processes. Any child sessions already created before the failure must be preserved and reported in the tool error details so they are not orphaned silently.

### Async single and parallel

1. For `task-only`, keep the existing blank async session behavior.
2. For `fork-session`, replace blank temp session creation with child session creation.
3. Store the child `sessionFile` on the `AsyncRun`.
4. Do not include forked child session files in temp cleanup.
5. Include session paths in the start message and async completion steer message.

Async parallel should create all child sessions before creating tmux panes. If fork creation fails after some child sessions were created, preserve and report those session paths in the returned tool error details. If tmux setup fails after sessions are created, clean tmux resources and prompt temp files, but preserve and report child sessions. The visible async start/error text must include `Session: <path>` lines; do not rely on nested details rendering for human inspectability.

### Chain

Reject `context: "fork-session"` during request parsing with a clear message. Chain behavior depends on `{previous}` and needs a separate design if forked chain execution becomes important.

## Error handling

When `fork-session` is requested, fail loudly if:

- The parent session is not persisted.
- The parent has no current leaf.
- The session fork call throws.
- The returned child session file is missing or unusable.

Do not silently fall back to `task-only`; that would violate the user's explicit request for inherited context.

Child process failures should still preserve and report the child session path so the user can inspect the failed run. The runtime error path must return any started forked `SingleResult` records instead of replacing details with an empty result list.

If session creation fails after one or more child sessions have already been created, the tool should fail loudly while returning those session paths in structured details and visible error text.

The `runSubagentRequest` to tool `execute` boundary must preserve session metadata. Async start metadata, partial-failure `sessionFiles`, and failed child `results` cannot live only in helper structs that `execute` later discards. The returned tool result and returned tool error must merge these fields into `SubagentDetails`.

When `fork-session` is used, visible output should state once that session forks do not isolate filesystem state.

## Result shape

Add `sessionFile?: string` to `SingleResult`.

Extend `SubagentDetails` with optional session metadata:

- `sessionFiles?: string[]` for any child sessions created outside completed `results` records, such as partial fork failures.
- `asyncStarted?: { runId?: string; runIds?: string[]; windowName?: string; sessionFile?: string; sessionFiles?: string[] }` for async launches.

`SubagentDetails.results[*].sessionFile` should be present for forked sync results, including failed child process results. If the runtime converts a failed child run into a top-level tool error, the returned details must still include the child result and session path.

Async start metadata must include structured session paths:

- async single: `details.asyncStarted.sessionFile`
- async parallel: `details.asyncStarted.sessionFiles` aligned with `runIds`

Async completion steer messages must include structured session paths in `sendMessage.details` and visible message text:

- async single completion: `details.sessionFile` and a `Session: <path>` line in content.
- async parallel completion: each per-run completion carries `details.sessionFile` and a `Session: <path>` line in content; batch-level cleanup may additionally report `sessionFiles` if emitting aggregate metadata later.

Visible output should include a compact `Session: <path>` line per forked subagent, including async start messages, async completion messages, and error messages.

## Testing plan

- Request parsing:
  - default `context` is `task-only`
  - accepts `fork-session`
  - rejects `chain` plus `fork-session`
- Process args:
  - task-only uses `--no-session`
  - fork-session uses `--session <child>` and not `--no-session`
- Runtime:
  - single and parallel fork once per subagent
  - results include `sessionFile`
  - failed forked child process results still include `sessionFile` in returned details
  - fork failure aborts before spawning agents
  - partial fork failures report already-created session paths in `details.sessionFiles`
- Async:
  - forked async uses the child session file
  - forked child sessions are not deleted as temp cleanup
  - start metadata includes structured session path fields on `details.asyncStarted`
  - async parallel `details.asyncStarted.sessionFiles` order matches `runIds`
  - completion message details include `sessionFile`
  - visible start and completion message text includes `Session: <path>` lines
  - async fork succeeds for some children and tmux setup then fails: child sessions are preserved, prompt temp files/tmux resources are cleaned, and returned error details include `sessionFiles`
- Rendering/output:
  - visible output includes session paths
  - details include session paths
- Regression:
  - existing task-only tests remain unchanged

## Future work

- Add optional git worktree/checkpoint integration for filesystem isolation.
- Design forked chain semantics if needed.
- Add a command or renderer shortcut to open child sessions from parent results.
