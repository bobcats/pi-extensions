# Subagent Effect Migration

## Goal

Convert the `subagent` extension to use Effect for the parts of the extension where Effect has clear value: child process execution, tmux lifecycle, temp resources, cancellation, concurrency, background watchers, and typed failure handling.

This is a structural migration, not a feature change. The public `subagent` tool API, result shape, rendering behavior, synchronous modes, and asynchronous tmux behavior should remain compatible unless a behavior change is explicitly called out during implementation.

## Why `subagent`

`subagent` is the strongest candidate for Effect because it coordinates several failure-prone resources at once:

- spawned `pi` child processes
- stdout event parsing
- stderr collection
- abort and kill escalation
- temp prompt/session files
- tmux panes and windows
- async background watchers
- concurrency limits and spawn staggering
- cleanup across success, failure, cancellation, reload, and shutdown

Those are Effect's strengths: scoped resources, interruption, fibers, typed errors, and structured concurrency.

## Decisions

| Topic | Decision |
|---|---|
| Migration target | `subagent` extension |
| PR shape | Single PR-sized migration |
| First phase | Throwaway compatibility spike in real pi runtime |
| Runtime boundary | Pi remains the host runtime; `subagent` internals become Effect-native |
| Shared helper | Not introduced yet; keep Effect glue local until a second extension needs it |
| Primary dependency | Prefer `effect` only |
| Platform packages | Test `@effect/platform-node` in the spike, but adopt only if it is clearly compatible and useful |
| Public behavior | Preserve current tool API and observable behavior |
| Pure helpers | Keep plain TypeScript |
| Effect ownership | Effects, resources, cancellation, concurrency, and typed failures |
| Verification | Real `pi -e` tmux user-path spike plus unit/runtime checks |

## Runtime boundary

Pi owns the outer process and host lifecycle:

- extension loading through jiti
- command and tool registration
- tool `execute(...)` callback shape
- `AbortSignal` creation
- session reload/shutdown lifecycle
- TUI rendering
- message delivery
- tool error semantics

The migration should not try to turn Pi itself into an Effect application. Instead, `subagent/index.ts` should stay as the Pi adapter. It parses the Pi-facing input, calls the Effect runtime through `Effect.runPromise(..., { signal })`, and maps runtime results or typed failures back into Pi tool results.

There should be two explicit Effect ownership modes:

- **Tool-call scope:** synchronous single, parallel, and chain runs are owned by the current tool call. They run through `Effect.runPromise(..., { signal })`, and all scoped resources close when the tool call completes or is interrupted.
- **Extension-lifetime scope:** async tmux watchers must outlive the starting tool call. They should be forked into an extension-owned runtime/scope, with fiber handles stored in extension state and interrupted from `session_shutdown`/reload cleanup.

Inside that boundary, the subagent execution domain should be Effect-native. Effect should own the actual execution program: scoped resources, child processes, tmux resources, cancellation, fibers, concurrency, and typed failures.

## Phase 0: compatibility spike

Before changing `subagent`, run a throwaway probe extension that proves Effect works in the real pi extension runtime.

### Probe shape

- Create a temporary extension outside committed source, for example under `/tmp/pi-effect-probe-*`.
- Add a temporary `package.json` with `effect` as needed.
- Launch the probe with actual `pi -e <probe-extension>` inside a private tmux socket/session.
- Avoid real model calls. The probe should use extension commands and deterministic markers.

### Probe capabilities

The probe should register slash commands that prove:

1. **Import/load**
   - The extension can import `effect`.
   - Pi can load the extension through jiti.
   - Commands can be registered successfully.

2. **Command execution**
   - A command can run an Effect program through `Effect.runPromise(...)`.
   - The command prints or notifies deterministic success text.

3. **Abort and finalizers**
   - A command starts a scoped resource with an acquire/release finalizer.
   - Cancellation, reload, or shutdown causes the finalizer to run.
   - A temp log records finalizer execution.

4. **Background fiber lifecycle**
   - A command starts a delayed background fiber.
   - The fiber can complete and write a sentinel.
   - Reload or shutdown interrupts it and records cleanup.

5. **Subagent-shaped process resource**
   - A command spawns a harmless local child process.
   - Scope closure kills or cleans the process deterministically.
   - Post-run checks show no live probe child remains.

6. **Optional platform package branch**
   - If cheap, test whether `@effect/platform-node` imports and runs.
   - Do not depend on it for the migration unless the spike shows it works cleanly and materially simplifies implementation.

### Probe verification

Verification must inspect real artifacts, not summaries:

- tmux capture contains deterministic success markers.
- temp log contains acquire/release/interruption markers.
- process cleanup checks show no leaked probe children.
- tmux cleanup checks show no leaked probe sessions/panes/windows.
- temporary probe files are removed afterward.

The probe is not committed. Its result should be summarized in the implementation plan and PR description, including the exact tmux/pi commands run and artifact paths inspected so the verification can be repeated.

## Target architecture

Keep Pi-facing adapter code in `subagent/index.ts` and move effectful execution into focused internal modules.

### `subagent/index.ts`

Owns:

- TypeBox schemas
- `registerTool(...)`
- rendering functions
- pure formatting helpers that are tightly coupled to display
- parsing raw tool params into trusted internal requests
- calling the Effect runtime with Pi's `AbortSignal`
- mapping runtime results into Pi tool result objects
- mapping expected runtime failures into current user-visible behavior

### Effect-owned modules

Candidate modules:

| Module | Responsibility |
|---|---|
| `subagent/runtime.ts` | High-level execution entrypoints: single, parallel, chain, async single, async parallel |
| `subagent/process-effect.ts` | Spawn child `pi`, parse stdout events, collect stderr, handle abort and kill escalation |
| `subagent/tmux-effect.ts` | Scoped tmux pane/window acquisition, sentinel polling, finalizers |
| `subagent/temp-effect.ts` | Scoped temp prompt/session files and temp directories |
| `subagent/errors.ts` | Tagged expected failures |
| `subagent/types.ts` | Shared internal request/result types if extraction reduces `index.ts` size |

This split is a guide, not a mandate. The implementation should keep files cohesive and avoid premature shared abstractions.

## Internal request model

The Pi tool schema stays unchanged, but raw params should not flow through the runtime. The adapter should parse params once into a trusted discriminated union.

Conceptual request variants:

- single synchronous run
- parallel synchronous run
- chain synchronous run
- async single tmux run
- async parallel tmux batch

Boundary parsing should handle:

- exactly one selected mode: single, parallel, or chain
- required fields for the selected mode
- rejection of async chain mode
- task count bounds
- default `agentScope`
- `confirmProjectAgents` behavior
- model override validation
- cwd resolution policy
- project-agent confirmation
- resolving raw agent names to trusted `AgentConfig` values where practical

After parsing, runtime code should use exhaustive switches over trusted request variants rather than repeated optional-field checks.

## Effect lifecycle semantics

### Scoped temp resources

Temp prompt files, temp system-prompt files, async session files, and temp directories should be acquired with scoped finalizers. Finalizers must run on success, failure, and interruption.

Async session files may intentionally outlive the initial tool call while an async watcher owns them. Ownership transfer must be explicit in the data model so cleanup is not accidental or forgotten.

### Child processes

Child `pi` execution should be modeled as an interruptible Effect resource:

- spawn `pi` with the same arguments and cwd behavior as today
- parse stdout JSON event lines into typed event variants at the boundary
- collect stderr
- update current result state from parsed events
- on interruption, send `SIGTERM`
- after a fixed timeout, escalate to `SIGKILL` if still alive
- finalizer removes abort listeners and kills a live child if the scope closes

Expected process failures should be typed. Unexpected defects should not be swallowed.

### Tmux resources

Tmux pane/window creation should be scoped:

- acquire pane/window
- register finalizer to close it
- poll for the sentinel with `Effect.sleep` and interruption support
- close resources on success, failure, or interruption

For async runs, ownership can transfer from the starting tool call to a background watcher fiber. That transfer must be represented explicitly so finalizers do not close panes before watchers observe completion.

### Concurrency

Replace the custom concurrency limiter with Effect concurrency:

- use Effect's bounded concurrency for parallel synchronous tasks
- preserve existing `MAX_CONCURRENCY`
- preserve spawn staggering if it remains necessary by modeling it as an explicit sleep before each spawned run
- preserve result ordering by source task order

### Background async watchers

Async tmux watchers should be fibers tied to extension lifetime, not the starting tool-call scope.

The extension should create an explicit async-run owner during extension initialization, such as a managed runtime/scope plus a map of watcher fiber handles. Starting async mode should acquire or transfer ownership of tmux panes/windows/temp files into that extension-lifetime owner before returning from the tool call. The tool-call scope must not close resources that the watcher still needs.

Requirements:

- starting async mode registers watcher fibers in extension state
- watcher-owned resources have clear ownership after the tool call returns
- watcher completion sends the same `subagent_result` message as today
- watcher failure cleans up state and resources
- `session_shutdown` interrupts outstanding watcher fibers and closes the extension-lifetime scope
- reload/shutdown finalizers clean panes/windows/temp files
- widget refresh starts/stops consistently with the async run map

## Error model

Use tagged expected failures for known domain errors, for example:

- unknown agent
- invalid request shape after boundary parse
- invalid model override
- project agent rejected by user
- tmux unavailable
- tmux command failed
- child process failed
- child process aborted
- child stdout parse error when the event matters
- temp file cleanup failure when it affects correctness

The adapter should decide which failures become user-visible tool text and which should throw so Pi marks the tool result as failed. Runtime code should avoid hidden `throw`s for expected cases.

## Dependency policy

The default dependency is `effect` only.

Because `subagent` currently has no local `package.json`, the implementation should add runtime dependencies where pi package loading will reliably resolve them. If `subagent` imports `effect` directly, the likely placement is the root package `dependencies`, not an extension-local dev dependency.

`@effect/platform-node` should not be included by default. It can be added only if the Phase 0 spike proves it works inside pi extensions and the migration gets a clear simplification from it.

## Testing plan

### Unit tests

Existing `subagent` tests should continue to pass. Add focused tests for:

- request parsing for single, parallel, chain, async single, async parallel
- invalid combinations such as async chain and missing required fields
- model override and project-agent confirmation outcomes
- typed error-to-tool-result mapping
- stdout JSON event parsing from child `pi`
- abort behavior resolving deterministically
- temp file cleanup on success, failure, and abort
- tmux sentinel polling success, timeout, and abort paths
- result ordering for bounded parallel execution

Tests should avoid flaky timing. Use explicit timeouts and deterministic fake processes/tmux adapters where possible.

### Runtime verification

Runtime verification must exercise the real user path:

1. Run the Phase 0 tmux compatibility spike.
2. Run synchronous single mode through actual pi where possible.
3. Run synchronous parallel mode and verify result ordering.
4. Run chain mode and verify previous output flows into the next task.
5. Run async single mode in tmux and verify pane creation, sentinel detection, message delivery, and cleanup.
6. Run async parallel mode in tmux and verify batch window cleanup after all runs finish.
7. Run cancellation/reload/shutdown paths and verify no leaked child processes, tmux resources, or temp files.

### Project checks

Run the relevant test commands with explicit timeouts:

- `npx tsx --test --test-timeout=5000` for `subagent` tests
- any repo-level checks affected by root dependency changes
- `slop_scan subagent` after meaningful TypeScript edits

## Acceptance criteria

- Phase 0 proves Effect compatibility in a real pi extension runtime.
- The public `subagent` tool schema remains compatible.
- Synchronous single, parallel, and chain modes behave as before.
- Async single and async parallel tmux modes behave as before.
- Cancellation, reload, and shutdown cleanup are deterministic and verified.
- Expected failures are represented as tagged runtime failures, not scattered hidden throws.
- Raw optional Pi params are parsed once at the boundary into trusted internal request types.
- Pure formatting/rendering helpers remain plain TypeScript.
- No shared Effect abstraction is introduced without a second extension needing it.
- Dependency placement is justified by actual pi package-loading behavior.

## Non-goals

- Rewriting other extensions to Effect.
- Creating a shared Effect helper package.
- Changing subagent tool parameters or result details.
- Replacing Pi's extension runtime.
- Adding new subagent user-facing features.
- Depending on unstable Effect platform APIs without spike proof.
