# Git-Backed Brain

## Goal

Safety net and history for the memory vault. Undo bad meditate/reflect runs, see how the brain evolves over time.

No remote, no sync — local git only.

## Design

### Git initialization

On `session_start`, if `~/.pi/memories/` exists but is not a git repo, `git init` + commit all existing files. If already a repo, do nothing. One-time lazy migration.

`memories/` gets its own repo — not the parent `~/.pi` repo. The parent tracks extensions and contains sensitive files (`auth.json`, `sessions/`). Separate repos keep concerns clean.

### Auto-commit after commands

Three commands trigger commits: `reflect`, `meditate`, `ruminate`.

Each command sets a `pendingCommitMessage` string on the extension state:
- `"reflect: capture session learnings"`
- `"meditate: apply audit findings"`
- `"ruminate: apply mined findings"`

### Commit timing via `agent_end`

The `agent_end` hook checks:
1. Is `pendingCommitMessage` set?
2. Does `git status --porcelain` show changes in the vault?

If both yes: `git add -A && git commit -m "${pendingCommitMessage}"`, then clear the flag.

If `agent_end` fires with no changes (agent didn't write anything, or user interrupted), clear the flag silently.

This handles the timing correctly:
- `reflect` uses `sendUserMessage` → agent turn → `agent_end`
- `meditate`/`ruminate` use `sendMessage({ deliverAs: "followUp" })` → agent turn → `agent_end`

Partial changes from interrupted turns still get committed — better to have a recoverable snapshot than lose work.

### `/memory undo`

Reverts the last vault commit:
1. Check repo has ≥2 commits
2. Show what's being undone: `git log -1 --oneline`
3. `git reset --hard HEAD~1`
4. `refreshScope()` to update in-memory state
5. Notify: "Undone: `<commit message>`"

For deeper history, use git directly: `git -C ~/.pi/memories log`.

### `/memory log`

Shows recent vault history: `git log --oneline -20` displayed in a notification.

## What doesn't change

- Vault structure, file conventions, wikilinks
- `tool_call` hook (line limit guard)
- `before_agent_start` hook (prompt injection)
- Ad-hoc writes during conversation (not auto-committed — low risk, would create noise)

## New autocomplete entries

```
undo    Revert the last memory commit
log     Show recent memory vault history
```
