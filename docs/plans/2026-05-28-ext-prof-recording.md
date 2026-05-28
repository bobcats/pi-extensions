# Ext-prof durable recording workflow

## Goal

Replace ext-prof's manual in-memory snapshot workflow with a simple durable recording workflow:

```text
/ext-prof on
/ext-prof off
/ext-prof status
/ext-prof
```

`/ext-prof on` starts one active recording run and writes aggregate JSONL deltas in the background. Plain `/ext-prof` reports from all v2 recorded JSONL files globally.

## Approach

Implement this as a TDD refactor in small slices:

1. Extend collector aggregation to include `cwd` in handler keys.
2. Replace snapshot persistence with v2 append/read/report primitives.
3. Add a process-global recorder runtime with no hot-path IO.
4. Wire wrappers/controller/index to the runtime and simplified command API.
5. Update docs and remove old `/save` and `/reset` behavior.

## Assumptions

- Accepted design is recorded in project memory ADR `projects/pi-extensions/adrs/0002-ext-prof-records-global-aggregate-deltas.md`.
- `ctx.cwd` is available on normal extension handler contexts; fallback is `process.cwd()`.
- Profile files live under `~/.pi/profiles/ext-prof/v2/<timestamp>-<runId>.jsonl`.
- Background flush interval is hardcoded to `10_000ms` for the first implementation.
- Old v1 snapshot rows are silently ignored by the new report reader.

## Out of scope

- Per-invocation tracing rows.
- Histograms/percentiles/slow-sample rows.
- Report filters such as `since`, `recent`, or `gc`.
- Surviving full Pi process restarts as an active recording; only flushed data survives.
- Shortening `extensionPath` display paths.

## Success criteria

- `/ext-prof on` writes `recording_start`, enables recording, starts one unref'd flush timer, and fails without enabling if patching or initial write fails.
- Handler wrappers do no filesystem IO; they only update in-memory collectors.
- Flushes append self-contained `aggregate_delta` rows with `schemaVersion: 2`, `runId`, `seq`, `windowStart`, `windowEnd`, `cwd`, `extensionPath`, `surface`, `name`, `calls`, `totalMs`, `maxMs`, and `errorCount`.
- `cwd` is captured at handler invocation start and is part of the delta aggregation key.
- `/ext-prof off` disables recording, drains deltas, waits for queued writes, writes `recording_end`, clears active collectors, and is safe when inactive.
- Plain `/ext-prof` force-flushes if active, reads all v2 files globally, silently ignores unknown/legacy rows, and reports top extensions/handlers globally plus top handlers for current cwd when present.
- Recording remains open across `session_shutdown` reasons `reload`, `new`, `resume`, and `fork`; only explicit off and `quit` close the run.
- Three consecutive write failures auto-disable recording; failed drained deltas are discarded and status reports the last write error.

## Plan

- [x] Inspect current ext-prof behavior and establish the failing test baseline.
  - Read: `ext-prof/collector.ts`, `ext-prof/wrapper.ts`, `ext-prof/patcher.ts`, `ext-prof/commands.ts`, `ext-prof/persistence.ts`, `ext-prof/formatter.ts`, `ext-prof/index.ts`, `ext-prof/*.test.ts`, `ext-prof/README.md`.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 *.test.ts`.
  - Expected signal: existing tests pass before behavior changes.
  - Required skill: `verify`.

- [x] TDD collector support for cwd-aware handler aggregation.
  - Modify tests first: `ext-prof/collector.test.ts`, `ext-prof/lib.test.ts` if compatibility expectations need updating.
  - Modify implementation: `ext-prof/collector.ts`.
  - Required behavior: `recordInvocation` accepts `cwd`; handler aggregation key is `cwd + extensionPath + surface + name`; extension totals remain aggregatable by extension globally; summaries expose `cwd` on handler rows and support current-cwd filtering later.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 collector.test.ts lib.test.ts`.
  - Expected signal: new cwd-key tests fail before implementation and pass after.
  - Commit checkpoint: `test(ext-prof): add cwd-aware collector coverage` with implementation if green.
  - Required skill: `tdd`.

- [x] Replace snapshot persistence with v2 JSONL append/read primitives.
  - Modify tests first: `ext-prof/persistence.test.ts`.
  - Modify implementation: `ext-prof/persistence.ts`; create `ext-prof/report.ts` and `ext-prof/report.test.ts` if keeping read/report parsing separate is clearer.
  - Required behavior: append JSONL lines safely, create parent directories, write `recording_start`, `aggregate_delta`, and `recording_end` shapes, read all `*.jsonl` files under a supplied v2 profile directory, silently ignore unknown row types and malformed partial lines, aggregate by extension and handler sorted by `totalMs` descending.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 persistence.test.ts report.test.ts`.
  - Expected signal: v2 persistence/report tests pass; no remaining tests assert `session_meta` or `aggregate` v1 output.
  - Commit checkpoint: `feat(ext-prof): add v2 profile persistence and reporting`.
  - Required skill: `tdd`.

- [x] Add the process-global recorder runtime.
  - Create tests first: `ext-prof/runtime.test.ts`.
  - Create implementation: `ext-prof/runtime.ts`.
  - Required behavior: process-global singleton owns active run state, total/delta collectors, output path, timer, write queue, seq, last write error, and consecutive failure count; `start()` is idempotent; `stop()` is no-op when inactive; `record()` updates memory only; `flush()` drains by swapping delta collectors before queued writes; empty flushes write nothing and do not increment seq; timer calls `.unref()`; successful writes reset failure count; three consecutive write failures auto-disable with reason `write_failures` when possible.
  - Use dependency injection for home directory, clock, random/run id, write functions, and timer hooks so tests do not touch real global state or home directories.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 runtime.test.ts collector.test.ts persistence.test.ts`.
  - Expected signal: runtime tests cover idempotency, no hot-path IO, flushing, write failures, final stop, and reload-safe singleton behavior.
  - Commit checkpoint: `feat(ext-prof): add global recorder runtime`.
  - Required skill: `tdd`.

- [x] Wire wrappers to capture cwd at invocation start and record through the runtime.
  - Modify tests first: `ext-prof/wrapper.test.ts`, `ext-prof/patcher.test.ts`.
  - Modify implementation: `ext-prof/wrapper.ts`, `ext-prof/patcher.ts`.
  - Required behavior: event/command/tool wrappers extract cwd from call arguments at invocation start, fall back to runtime last cwd or `process.cwd()`, preserve return values and thrown errors, and call runtime recording without awaiting filesystem work.
  - Ensure wrappers use a runtime lookup/callback that remains valid across reloads and does not close over stale module-local collectors.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 wrapper.test.ts patcher.test.ts runtime.test.ts`.
  - Expected signal: cwd capture and stale-collector regression tests pass.
  - Commit checkpoint: `feat(ext-prof): route wrapped handler timings through recorder runtime`.
  - Required skill: `tdd`.

- [ ] Simplify controller commands to `on`, `off`, `status`, and default report.
  - Modify tests first: `ext-prof/commands.test.ts`, `ext-prof/formatter.test.ts`.
  - Modify implementation: `ext-prof/commands.ts`, `ext-prof/formatter.ts`.
  - Required behavior: remove public `save`/`reset`; `on` ensures patch success before `recording_start`; `off` waits for final flush/end; `status` shows runtime state only; empty args force-flush if active and render global/current-cwd report; unknown subcommands return a clear error.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 commands.test.ts formatter.test.ts report.test.ts runtime.test.ts`.
  - Expected signal: autocomplete-oriented expectations can be updated later, command semantics are covered here.
  - Commit checkpoint: `feat(ext-prof): simplify command API around recording`.
  - Required skill: `tdd`.

- [ ] Integrate the runtime into the extension entrypoint and lifecycle.
  - Modify tests first: `ext-prof/index.test.ts`.
  - Modify implementation: `ext-prof/index.ts`.
  - Required behavior: autocomplete returns only `on`, `off`, `status`; status bar shows `prof:off`, `prof:on`, `prof:on!write`, or `prof:on!patch`; `Ctrl+Alt+P` toggles `on`/`off`; `session_shutdown` reason `quit` closes the run; `reload`, `new`, `resume`, and `fork` flush but keep recording open; `session_start` refreshes status and keeps global runtime state.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 index.test.ts runtime.test.ts commands.test.ts`.
  - Expected signal: lifecycle tests explicitly prove reload/session switch do not write `recording_end`.
  - Commit checkpoint: `feat(ext-prof): integrate durable recording lifecycle`.
  - Required skill: `tdd`.

- [ ] Update user-facing documentation and remove obsolete snapshot language.
  - Modify: `ext-prof/README.md`.
  - Required behavior: document only `/ext-prof on`, `/ext-prof off`, `/ext-prof status`, and `/ext-prof`; describe global path `~/.pi/profiles/ext-prof/v2/`, background aggregate deltas, status bar meanings, and the no-hot-path-IO design.
  - Run: `rg -n "save|reset|snapshot|session_meta|~/.pi/profiles/<project>" ext-prof README.md`.
  - Expected signal: matches only appear where intentionally discussing removed legacy behavior; preferably no ext-prof docs mention the old workflow.
  - Commit checkpoint: `docs(ext-prof): document durable recording workflow`.
  - Required skill: `write-docs`.

- [ ] Run full ext-prof verification and repository hotspot scan.
  - Run: `cd ext-prof && npx tsx --test --test-timeout=5000 *.test.ts`.
  - Run: `slop_scan` on `ext-prof`.
  - Run: `git diff --check`.
  - Expected signal: all ext-prof tests pass, no whitespace errors, slop-scan findings are either addressed or explicitly judged unrelated.
  - Required skill: `verify`.

- [ ] Request a focused code review before final handoff.
  - Scope: ext-prof durable recording workflow implementation and tests.
  - Include in review prompt: no hot-path IO, reload/session lifecycle correctness, write-failure behavior, v2 row parsing/reporting, and removal of `save`/`reset` public API.
  - Expected signal: no blocking findings, or blocking findings are fixed and re-verified.
  - Commit checkpoint: final cleanup commit after review fixes if any.
  - Required skill: `code-review` or `request-code-review`.

## Deferred ideas

- Add `/ext-prof since 24h`, `/ext-prof recent`, or `/ext-prof gc` once global file volume becomes a problem.
- Add histograms, percentiles, or `slow_sample` rows if aggregate max/average are insufficient.
- Add machine/host metadata if profile files are commonly copied between machines.
- Add path compaction for display once full paths become noisy.
