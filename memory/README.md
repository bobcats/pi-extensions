# memory

Extension that gives the agent persistent memory across sessions. Memories are stored in Markdown files at two scopes — global and project — and injected into the system prompt automatically.

## How it works

On session start, the extension reads memory files from:

- **Global**: `~/.pi/memories/MEMORY.md` (applies to all projects)
- **Project**: `<project>/.pi/memories/MEMORY.md` (specific to the current project)

The content is appended to the system prompt via `before_agent_start`, along with instructions for the agent to save patterns it notices. Topic files (additional `.md` files in the same directories) are listed so the agent can read them on demand.

## Commands

| Command | Description |
|---------|-------------|
| `/memory` | Show memory status and content preview |
| `/memory on` | Enable memory (default) |
| `/memory off` | Disable memory for the current session |
| `/memory edit` | Edit project MEMORY.md in the built-in editor |
| `/memory edit global` | Edit global MEMORY.md in the built-in editor |

## Status bar

The extension publishes a footer status with key `memory`:

- `memory: off` — disabled for this session
- `memory: on · 2 scopes · 3 topics` — enabled with scope/topic counts

## Guardrails

The extension intercepts `write` and `edit` tool calls targeting memory files:

- **MEMORY.md** is limited to **200 lines** — keeps the index concise
- **Topic files** (e.g., `testing.md`) are limited to **500 lines**

If a write would exceed the limit, it's blocked with a reason explaining the constraint.

## File structure

```
~/.pi/memories/
├── MEMORY.md           # Global index (max 200 lines)
├── api-design.md       # Topic file (max 500 lines)
└── testing.md          # Topic file

<project>/.pi/memories/
├── MEMORY.md           # Project index (max 200 lines)
└── conventions.md      # Topic file
```

## Testing

```bash
cd memory && npm test
```
