# memory

Persistent agent memory extension with a structured v2 vault.

## Overview

The extension stores memory in two scopes:

- **Global**: `~/.pi/memories/`
- **Project**: `<project>/.pi/memories/`

V2 uses an Obsidian-style vault with `index.md` root indexes and `[[wikilinks]]` between notes.

## Vault structure (v2)

```text
~/.pi/memories/
├── index.md
├── principles.md
├── principles/
│   └── *.md
└── *.md

<project>/.pi/memories/
├── index.md
└── *.md
```

## Injection behavior

On `before_agent_start`, the extension injects:

1. Global `index.md` (if present)
2. Project `index.md` (if present)
3. Trimmed write instructions

It does **not** inline full note contents. The model reads specific note files on demand.

## Commands

| Command | Description |
|---|---|
| `/memory` | Show status, scope state, and command hints |
| `/memory on` | Enable memory for this session |
| `/memory off` | Disable memory for this session |
| `/memory edit` | Edit project `index.md` |
| `/memory edit global` | Edit global `index.md` |
| `/memory init` | Initialize global v2 vault + starter principles |
| `/memory init project` | Initialize project v2 vault (no starter principles) |
| `/memory v2migrate` | Migrate legacy global `MEMORY.md` to v2 |
| `/memory v2migrate project` | Migrate legacy project `MEMORY.md` to v2 |
| `/memory reflect` | Queue an in-context reflection pass |
| `/memory meditate` | Run auditor/reviewer subagents via `pi --mode json` |
| `/memory ruminate` | Mine past sessions via miner subagents |

## Migration path (v1 → v2)

If `MEMORY.md` is detected, run:

- `/memory v2migrate` (global)
- `/memory v2migrate project` (project)

Modes:

- **Preserve**: renames legacy file to `migrated.md`
- **Replace**: removes legacy file and initializes fresh vault

## Guardrails

- `index.md` line limit: **200**
- Topic file line limit: **500**
- Index auto-rebuild runs when vault file set drifts from indexed wikilinks
- Polling safety net checks for external edits every 5s

## Testing

```bash
cd memory && npm test
```
