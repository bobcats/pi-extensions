# Named Brains for the Memory Extension

## Goal

Add globally configured named brains to the memory extension so each project resolves to one isolated memory vault instead of sharing a single universal vault.

## Decisions

- Each brain is a fully separate vault on disk with its own markdown files, git history, operations log, and QMD collection.
- The existing `~/.pi/memories` vault remains the default `main` brain.
- Brain definitions and project-path mappings live in one global config file under `~/.pi/`.
- Project resolution is strict: memory reads and writes only the mapped brain, or `main` when no mapping exists.
- Brain management is available through `/memory brain ...` commands, but the config file remains the underlying source of truth.
- No cross-brain search or fallback reads beyond the resolved active brain.

## Storage Model

- `main` brain path: `~/.pi/memories`
- Additional brain paths: `~/.pi/memory-brains/<name>`
- Global config file: `~/.pi/memory-config.json`
- Global config stores:
  - `defaultBrain`
  - `brains[name].path`
  - `projectMappings[{ projectPath, brain }]`

Example shape:

```json
{
  "defaultBrain": "main",
  "brains": {
    "main": { "path": "~/.pi/memories" },
    "poe": { "path": "~/.pi/memory-brains/poe" }
  },
  "projectMappings": [
    { "projectPath": "/Users/brian/code/poe", "brain": "poe" }
  ]
}
```

## Runtime Behavior

On session start and before memory actions, the extension resolves the active brain from the global config using the current project path. All memory behaviors then use that vault only:

- system prompt memory injection
- widget counts and operation history
- `/memory init`, `reflect`, `dream`, `undo`, `log`, `search`
- `request_reflect`, `search_memory`, `log_operation`
- QMD registration, indexing, and search

The UI should surface which brain is active so isolation is visible, not implicit.

## Command Surface

Add a `brain` namespace under `/memory`:

- `/memory brain list`
- `/memory brain add <name>`
- `/memory brain remove <name>`
- `/memory brain create <name>`
- `/memory brain map <project-path> <brain>`
- `/memory brain unmap <project-path>`
- `/memory brain which`

`create` is the easy path for a new named brain: add config entry, create the vault directory, and initialize it. `add` only registers a path. `remove` deletes the config entry and project mappings must already be cleared first; it does not delete on-disk vault contents in v1.

## Constraints

- Preserve current behavior for users who never configure extra brains.
- Do not move or rename the existing `main` vault.
- Keep the first version global-only; no repo-local overrides.
- Keep strict isolation: no searching or reading across brains.

## Testing Focus

- config bootstrap and persistence
- project-path to brain resolution
- fallback to `main`
- all commands and tools honoring the resolved brain path
- separate QMD collection names per brain
- current `main` vault compatibility without migration
