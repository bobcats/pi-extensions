# ext-prof

Durable profiler for Pi extension handler execution time.

Ext-prof records aggregate timing deltas for extension event handlers, slash-command handlers, and tool `execute` handlers. Handler wrappers stay on the hot path and only update in-memory counters; a background recorder flushes aggregate JSONL rows to disk.

## Commands

| Command | Description |
|---------|-------------|
| `/ext-prof on` | Start one active recording run |
| `/ext-prof off` | Stop the active recording run and write a final `recording_end` row |
| `/ext-prof status` | Show recorder state, current run, sequence, cwd, and write-failure details |
| `/ext-prof` | Force-flush if recording is active, then show a report from all v2 profile files |

Keyboard shortcut: `Ctrl+Alt+P` toggles recording on/off.

## Status bar

- `prof:off` — no active recording
- `prof:on` — recording is active and instrumentation is patched
- `prof:on!write` — recording is active but profile writes have recently failed
- `prof:on!patch` — recording is active but instrumentation patching is not healthy

## Profile files

Each recording run writes one JSONL file under:

```text
~/.pi/profiles/ext-prof/v2/<timestamp>-<runId>.jsonl
```

Rows use schema version 2:

- `recording_start` — run lifecycle start
- `aggregate_delta` — one self-contained aggregate row for a flush window and handler key
- `recording_end` — run lifecycle end

`aggregate_delta` rows include `runId`, `seq`, `windowStart`, `windowEnd`, `cwd`, `extensionPath`, `surface`, `name`, `calls`, `totalMs`, `maxMs`, and `errorCount`.

The storage directory is global. The current working directory is recorded as row metadata (`cwd`) so reports can show both global leaders and handlers for the current cwd.

## Recording model

- `/ext-prof on` starts a process-global recorder runtime and writes `recording_start` before enabling recording.
- Wrapped handlers do no filesystem IO. They only measure duration and update the in-memory delta collector.
- A background 10s timer flushes non-empty aggregate deltas and is unref'd so it does not keep the process alive.
- `/ext-prof` force-flushes an active run before reading all global v2 JSONL files.
- `/ext-prof off` drains pending deltas, waits for queued writes, writes `recording_end`, and clears active collectors.
- Reloads and session switches flush but keep the run open; Pi quit closes the run.
- Three consecutive write failures auto-disable recording and leave the last write error visible in status.

## Testing

```bash
npx tsx --test --test-timeout=5000 *.test.ts
```
