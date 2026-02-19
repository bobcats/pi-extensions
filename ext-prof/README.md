# ext-prof

Extension profiler that attributes execution time to individual extension handlers.

## Commands

| Command | Description |
|---------|-------------|
| `/ext-prof on` | Enable profiling |
| `/ext-prof off` | Disable profiling |
| `/ext-prof` | Show profiling summary |
| `/ext-prof status` | Show instrumentation coverage |
| `/ext-prof save [path]` | Save snapshot to JSONL |
| `/ext-prof reset` | Clear collected data |

Keyboard shortcut: `Ctrl+Alt+P` enables profiling.

## Status bar

- `prof:off` — disabled
- `prof:on` — enabled and patched
- `prof:on!patch` — enabled but patching failed

## What gets profiled

- Event handlers
- Command handlers
- Tool execute handlers

Each is attributed to its source extension with timing, call count, and error count.

## Snapshots

`/ext-prof save` writes JSONL with `session_meta` and `aggregate` records.

Default path: `~/.pi/profiles/<project>/<timestamp>.jsonl`

## Testing

```bash
npm test
```
