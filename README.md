# @bobcats/pi-extensions

Canonical Bobcats repository for Pi extensions, Pi prompt templates, and
extension-owned skills.

## What lives here

| Source | Purpose |
|--------|---------|
| Top-level extension directories | Pi extensions loaded through `package.json` `pi.extensions` |
| `prompts/*.md` | Pi-native slash-command prompt templates loaded through `pi.prompts` |
| `memory/skills/*/` | Extension-owned skills colocated with the memory extension |

General shared and Pi-only skills live in the parent
[`bobcats/skills`](https://github.com/bobcats/skills) repository.

## Pi resources

Install or update this package with Pi:

```bash
pi install /path/to/pi-extensions
pi update
```

Pi discovers extensions, prompt templates, and the memory extension's owned
skill from root `package.json`.

## Extensions

| Extension | Description |
|-----------|-------------|
| [auto-name-session](./auto-name-session/) | Auto-names sessions after the first completed exchange using the cheapest model |
| [claude-code-tmux](./claude-code-tmux/) | Drives Claude Code through an isolated interactive tmux session |
| [confirm-rm](./confirm-rm/) | Confirms before any `rm` command |
| [context](./context/) | Shows loaded extensions, context files, and token/cost usage |
| [exa](./exa/) | Adds Exa-powered web search, answers, and research tools |
| [ext-prof](./ext-prof/) | Profiles extension handler execution time |
| [files](./files/) | Lists git-tracked and session-referenced files with quick actions |
| [handoff](./handoff/) | Prepares safe `/handoff` commands for review |
| [hypura](./hypura/) | Hypura integration extension |
| [memory](./memory/) | Persists agent learnings across sessions — reflect, ruminate, dream, forget, ingest, and named brains |
| [notify](./notify/) | Sends desktop notifications via OSC 777 when the agent finishes |
| [openai-fast](./openai-fast/) | Toggles OpenAI priority service tier for configured models |
| [session-breakdown](./session-breakdown/) | Shows usage stats, cost by model, and a calendar graph |
| [slop-scan](./slop-scan/) | Adds a `slop_scan` checkpoint tool and `/slop-scan` command for JS/TS slop analysis |
| [subagent](./subagent/) | Delegates tasks to isolated subagents — single, parallel, or chained |
| [tldraw-desktop](./tldraw-desktop/) | Reads and manipulates tldraw desktop canvases |

## Prompt templates

Pi prompt templates live in `prompts/*.md` and become slash commands such as `/zoom-out` and `/grill-me`.

## Development

Install the shared workspace dependencies:

```bash
npm install
```

All extension workspaces resolve the exact Pi development packages declared in the root `package.json`; the root `package-lock.json` is the only npm lockfile. Upgrade the four `@earendil-works/pi-*` versions together and regenerate the root lockfile.

Run all extension and root TypeScript tests:

```bash
npm test
```

Import-smoke every extension listed in `package.json` `pi.extensions` against the shared Pi 0.82 workspace deps:

```bash
npm run smoke
```

Run selected extension tests:

```bash
cd confirm-rm && npm test
cd exa && npm test
cd ext-prof && npm test
cd memory && npm test
cd openai-fast && npm test
cd slop-scan && npm test
cd tldraw-desktop && npm test
```

Run memory-ingest skill script tests from the repo root:

```bash
npx tsx --test --test-timeout=5000 memory/skills/memory-ingest/scripts/*.test.ts
```

Hot-reload a running Pi session after package changes:

```text
/reload
```

## Memory brains

The memory extension defaults to the `main` brain at `~/.pi/memories`. Global brain config lives at `~/.pi/memory-config.json`.

Example commands:

```text
/memory brain create poe
/memory brain map /Users/brian/code/poe poe
```

## Acknowledgments

- `context`, `files`, `notify`, and `session-breakdown` are forked from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) by Armin Ronacher
- `confirm-rm` is based on the `permission-gate` example in [pi](https://github.com/badlogic/pi-mono)
- `memory` is inspired by [brainmaxxing](https://github.com/poteto/brainmaxxing) by Lauren Tan
- `openai-fast` is vendored from [buildrtech/dotagents](https://github.com/buildrtech/dotagents/tree/main/pi-extensions/openai-fast)
- `tldraw-desktop` connects to [tldraw desktop](https://github.com/tldraw/tldraw-desktop) by tldraw

## License

MIT
