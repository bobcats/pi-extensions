# memory

Persistent agent memory extension with a single global vault.

## Overview

The extension stores memory in one vault at `~/.pi/memories/`. Project-specific knowledge lives under `projects/<project-name>/` by convention — the agent manages the organization.

## Vault structure

```text
~/.pi/memories/
├── index.md
├── principles.md
├── principles/
│   └── *.md
├── projects/
│   ├── my-project/
│   │   └── *.md
│   └── other-project/
│       └── *.md
└── *.md
```

## Injection behavior

On `before_agent_start`, the extension injects:

1. `index.md` contents (if present)
2. Trimmed write instructions

It does **not** inline full note contents. The model reads specific note files on demand.

## Commands

| Command | Description |
|---|---|
| `/memory` | Show vault status and command hints |
| `/memory on` | Enable memory for this session |
| `/memory off` | Disable memory for this session |
| `/memory edit` | Edit `index.md` |
| `/memory init` | Initialize vault with starter principles |
| `/memory reflect` | Queue an in-context reflection pass |
| `/memory meditate` | Run auditor/reviewer subagents via `pi --mode json` |
| `/memory ruminate` | Mine past sessions via miner subagents |

## Guardrails

- `index.md` line limit: **200**
- Topic file line limit: **500**

## Testing

```bash
cd memory && npm test
```
