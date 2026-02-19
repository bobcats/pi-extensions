# confirm-rm

Safety extension that prompts for confirmation before any bash command containing `rm`.

## Behavior

When the LLM calls the `bash` tool with a command matching `\brm\b`:

- **Interactive mode** — shows a select dialog: `Yes` / `No`. Blocks the command if the user selects `No`.
- **Non-interactive mode** (print mode, no UI) — blocks the command automatically since there's no way to confirm.

Commands without `rm` pass through unchanged.

## Commands

None. This extension is event-only.

## Example

When the agent runs `rm -rf dist/`:

```
⚠️  This command uses rm:

  rm -rf dist/

Allow?
❯ Yes
  No
```

Selecting `No` blocks execution with reason: `"rm command blocked by user"`.

## How it works

Registers a single `tool_call` handler that checks the `bash` tool's `command` input against `/\brm\b/`. The word-boundary match avoids false positives on commands like `arms` or `groom`.
