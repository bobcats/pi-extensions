# Background Ruminate/Meditate

Allow user to continue working in the main session while ruminate/meditate runs in the background.

## Problem

The ruminate and meditate command handlers `await` subagent work inline. While the handler's Promise is pending, the user can't type messages. These operations take minutes — that's wasted time.

## Design

### Core Pattern: Fire-and-Forget with Deferred Apply

The command handler kicks off subagent work as a background promise and returns immediately, unblocking user input.

```
/memory ruminate  →  handler validates, starts background work, returns
                     ↓
                     user types messages, works normally
                     ↓
                     background: miners run, widget/overlay show progress
                     ↓
                     background completes → pi.sendMessage({ deliverAs: "followUp" })
                     ↓
                     user's current turn finishes naturally
                     ↓
                     apply prompt delivered, agent processes findings
```

Handler changes:
- Extract async subagent work into `runRuminateBackground()` / `runMeditateBackground()`
- Handler calls without `await`, stores promise + AbortController in module-level state
- Switch from `ctx` (command context, may not outlive handler) to `lastCtx` (module-level, always current session) for UI operations inside background work
- `.catch()` on the promise to notify errors via `lastCtx.ui.notify()`

Module-level state:

```typescript
interface BackgroundTask {
  abort: AbortController;
  promise: Promise<void>;
}
let ruminateTask: BackgroundTask | null = null;
let meditateTask: BackgroundTask | null = null;
```

### Concurrency and Guards

Ruminate and meditate are independent — both can run concurrently. Duplicate invocations of the same operation are rejected:

```
/memory ruminate  →  if ruminateTask !== null → notify "Ruminate already running" → return
/memory meditate  →  if meditateTask !== null → notify "Meditate already running" → return
```

### Cancel

```
/memory cancel ruminate  →  abort controller signal, kill subagent processes, cleanup
/memory cancel meditate  →  same
```

When cancelled:
- `abort.abort()` signals the background work
- Background checks `signal.aborted` before launching each subagent (no point starting miner 5 if cancelled after miner 2)
- Signal flows into `runSubagent` which kills the child process
- Cleanup: temp files removed, widget cleared, overlay hidden, task set to `null`
- Notify: "Ruminate cancelled" / "Meditate cancelled"

Completion (success or error) always sets task back to `null` in a `finally` block.

### Cancel on Session Switch

Listen to `session_before_switch`: abort both tasks if running. Findings from the old project context aren't useful in a new session.

### UI During Background Work

No visual changes — user just isn't blocked anymore.

- **Widget** — already works independently via `setInterval` timer with `.unref()`. Use `lastCtx.ui` instead of `ctx.ui`.
- **Activity overlay** — created via `openActivityOverlay()`. Change to use `lastCtx`. Handle persists; `.hide()` works anytime.
- **Notifications** — background completion/error uses `lastCtx.ui.notify()`.

### Changes to `runSubagent`

Add `signal?: AbortSignal` as 6th parameter:

```typescript
export async function runSubagent(
  agentPath: string,
  task: string,
  cwd: string,
  timeoutMs?: number,
  onData?: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<SubagentResult>
```

When signal fires: kill child process, resolve with `{ output: "", exitCode: 1, stderr: "Cancelled", logFile }`. Same pattern as existing timeout handler.

## Files Changed

**`subagent.ts`**
- Add `signal?: AbortSignal` as 6th param to `runSubagent`
- When signal fires, kill child process and resolve with cancelled result

**`index.ts`**
- Module-level `ruminateTask` and `meditateTask` state
- Extract `runRuminateBackground()` and `runMeditateBackground()` async functions
- Command handler: validate, guard against duplicate, create AbortController, fire-and-forget, return
- Background functions: use `lastCtx` instead of `ctx`, check `signal.aborted` before each subagent launch, `finally` block to null out task state
- Pass `signal` through to `runSubagent` calls
- Add `/memory cancel ruminate` and `/memory cancel meditate` subcommands
- Listen to `session_before_switch`: abort both tasks if running
- Add autocomplete entries for cancel subcommands

**`subagent.test.ts`**
- `runSubagent` respects abort signal

**`index.test.ts`**
- Ruminate/meditate return immediately (handler doesn't await)
- Guard rejects second invocation while running
- Cancel aborts running task
- Session switch cancels running tasks
- Autocomplete count update
