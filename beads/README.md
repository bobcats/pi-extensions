# beads

Issue tracking extension for pi, backed by the `br` CLI.

## Commands

| Command | Description |
|---------|-------------|
| `/beads` | Interactive picker for ready issues (optional filter) |
| `/beads-ready` | List ready issues sorted by priority |
| `/beads-status` | Show stats, blocked issues, and current in-progress |
| `/beads-claim <id>` | Mark issue in_progress |
| `/beads-close <id>` | Prompt for reason and close issue |
| `/beads-mode [on\|off\|status]` | Toggle beads mode |

## Mode

- **ON** — full runtime behavior: priming, hooks, guards, reminders, status bar.
- **OFF** — ambient behavior disabled. Skills still available via `/skill:beads-*`.

## Hooks

| Hook | Behavior |
|------|----------|
| `session_start` | Detect beads project, publish status bar |
| `before_agent_start` | Inject beads guardrails into context |
| `session_before_compact` | Re-arm priming after compaction |
| `tool_call` | Block `br close` if git tree is dirty |
| `turn_end` | One-time reminder at 85%+ context usage |

## Skills

Workflow skills shipped with the extension (manual-only, invoked via `/skill:beads-*`):

| Skill | Description |
|-------|-------------|
| [beads-storm](./skills/beads-storm/) | Brainstorm a feature area into beads issues |
| [beads-plan](./skills/beads-plan/) | Break issues into implementation plans |
| [beads-code](./skills/beads-code/) | Execute implementation with TDD and checkpoints |
| [beads-create](./skills/beads-create/) | Create issues with correct CLI flags and wiring |

The extension handles runtime mechanics; skills handle reasoning.

## Testing

```bash
npm test
```
