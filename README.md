# @bobcats/pi-extensions

Extensions and prompt templates for [pi](https://github.com/badlogic/pi-mono).

## Extensions

| Extension | Description |
|-----------|-------------|
| [auto-name-session](./auto-name-session/) | Auto-names sessions after the first completed exchange using the cheapest model |
| [confirm-rm](./confirm-rm/) | Confirms before any `rm` command |
| [context](./context/) | Shows loaded extensions, context files, and token/cost usage |
| [exa](./exa/) | Adds Exa-powered web search, answers, and research tools |
| [ext-prof](./ext-prof/) | Profiles extension handler execution time |
| [files](./files/) | Lists git-tracked and session-referenced files with quick actions |
| [memory](./memory/) | Persists agent learnings across sessions — reflect, ruminate, dream |
| [notify](./notify/) | Sends desktop notifications via OSC 777 when the agent finishes |
| [session-breakdown](./session-breakdown/) | Shows usage stats, cost by model, and a calendar graph |
| [subagent](./subagent/) | Delegates tasks to isolated subagents — single, parallel, or chained |
| [tldraw-desktop](./tldraw-desktop/) | Reads and manipulates tldraw desktop canvases |

## Prompt Templates

| Template | Slash command |
|----------|--------------|
| [implement.md](./prompts/implement.md) | `/implement` |
| [implement-and-review.md](./prompts/implement-and-review.md) | `/implement-and-review` |
| [scout-and-plan.md](./prompts/scout-and-plan.md) | `/scout-and-plan` |
| [simplify.md](./prompts/simplify.md) | `/simplify` |
| [test-checklist.md](./prompts/test-checklist.md) | `/test-checklist` |

## Install

```bash
pi install /path/to/pi-extensions
```

Or in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["/path/to/pi-extensions"]
}
```

All extensions and prompt templates load automatically. Use `pi config` to enable or disable individual resources.

## Development

Run tests:

```bash
cd confirm-rm && npm test
cd exa && npm test
cd ext-prof && npm test
cd memory && npm test
cd tldraw-desktop && npm test
```

Hot-reload in a running session:

```
/reload
```

## Acknowledgments

- `context`, `files`, `notify`, and `session-breakdown` are forked from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) by Armin Ronacher
- `confirm-rm` is based on the `permission-gate` example in [pi](https://github.com/badlogic/pi-mono)
- `memory` is inspired by [brainmaxxing](https://github.com/poteto/brainmaxxing) by Lauren Tan
- `tldraw-desktop` connects to [tldraw desktop](https://github.com/tldraw/tldraw-desktop) by tldraw

## License

MIT
