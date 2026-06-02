# @bobcats/pi-extensions

Canonical Bobcats repository for Pi extensions, Pi prompt templates, shared agent skills, extension-owned skills, and flattened non-Pi skill installs.

## What lives here

| Source | Purpose |
|--------|---------|
| Top-level extension directories | Pi extensions loaded through `package.json` `pi.extensions` |
| `prompts/*.md` | Pi-native slash-command prompt templates loaded through `pi.prompts` |
| `skills/<bucket>/<skill>/` | Shared authored skills for Pi and flattened installs |
| `memory/skills/memory-ingest/` | Extension-owned skill colocated with the memory extension |
| `scripts/build.py` | Builds and safely installs flattened skills for non-Pi/global skill surfaces |

## Pi resources

Install or update this package with Pi:

```bash
pi install /path/to/pi-extensions
pi update
```

Pi discovers extensions, prompt templates, and authored skill roots from root `package.json`. Prompt templates remain canonical in `prompts/*.md`; generated prompt-skills are only build/install artifacts for other agents.

## Extensions

| Extension | Description |
|-----------|-------------|
| [auto-name-session](./auto-name-session/) | Auto-names sessions after the first completed exchange using the cheapest model |
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

## Skills

Shared skills use the bucketed source layout from `skills/`:

```text
skills/
  engineering/
  design/
  review/
  tools/
  languages/
  prototyping/
  productivity/
  deprecated/
memory/skills/
  memory-ingest/
```

`skills/deprecated/` is excluded from normal builds and used only for deprecated install cleanup. Extension-owned deprecated skills are not supported.

## Prompt templates and generated prompt-skills

Pi prompt templates live in `prompts/*.md` and become slash commands such as `/zoom-out` and `/grill-me`.

`make build` also generates manual prompt-skills named `prompt-<template-name>` under `build/skills/` for agents that support skills but not Pi prompt templates. These generated skills include `disable-model-invocation: true`, metadata pointing back to the source prompt, and wrapper text explaining `$ARGUMENTS`, `$@`, and `$1` as manual invocation input. Whether manual-only behavior is enforced depends on the consuming agent honoring `disable-model-invocation`.

## Non-Pi/global skill install

Build the flattened install tree:

```bash
make build
```

Run installer tests:

```bash
make test
```

Install flattened skills for skill-only agents only when you intend to mutate global skill directories:

```bash
make install
```

Install targets:

- `~/.agents/skills/` for OpenCode, Pi, and other unified skill consumers
- `~/.codex/skills/` for Codex
- `~/.claude/skills/` for Claude Code

The installer tracks managed files in `$XDG_STATE_HOME/bobcats-skills/install-manifest.json` or `~/.local/state/bobcats-skills/install-manifest.json`, preserves unmanaged sibling files, removes stale managed files, and refuses to overwrite local edits unless bootstrapped with `make install FORCE=1`.

## Development

Run repository-level installer tests:

```bash
python3 -m unittest discover -s tests
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
