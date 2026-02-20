# beads

Issue tracking extension for pi, backed by the `br` CLI. Provides durable execution context that survives compaction and session restarts.

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
| `before_agent_start` | Rich recovery — injects structured context with task, checkpoints, deps, uncommitted files |
| `session_before_compact` | Auto-checkpoint — flushes progress summary to issue before context is wiped |
| `tool_call` | Block `br close` if git tree is dirty |
| `tool_result` | Commit linking (git commit → issue comment) and file tracking (write/edit → per-issue file set) |
| `turn_end` | Checkpoint nudge at 8 turns without commit/comment; context usage warning at 85% |

## Automatic Behaviors

### Rich Recovery (V1)

On session start or after compaction, if an issue is in-progress, `before_agent_start` builds a structured ~2KB context block:

- Task details (id, title, type, priority, status)
- Checkpoint trail (last 5 comments with relative timestamps)
- Dependency context (parent issue, blocked-by)
- Uncommitted files from `git status`

Falls back to a static prime message when no issue is in-progress.

### Commit Linking (V2)

When the agent runs `git commit`, the `tool_result` hook detects it, parses the commit hash and message, and auto-comments on the active issue:

```
commit: a1b2c3d feat: add parser
```

Commits also reset the checkpoint nudge counter — agents that commit regularly are never nagged.

### File Tracking (V3)

Every `write` or `edit` tool call is tracked per-issue. On close, a summary comment is attached:

```
Files modified: src/parser.ts, src/types.ts, tests/parser.test.ts
```

Truncated to 30 files.

### Auto-Checkpoint (V4)

Before compaction (`session_before_compact`), if an issue is active, a checkpoint comment is flushed with:

- Files edited this session
- Turns since last checkpoint

This ensures recovery (V1) has fresh context even after a compaction.

### Auto-Continue (V5)

After closing an issue via the beads tool, a follow-up message is injected prompting the agent to run `br ready` and pick the next issue. No human intervention needed to keep the work loop going.

### Checkpoint Nudge (V6)

After 8 turns without a commit or comment, a notification fires with a hint to checkpoint progress. The counter resets on:

- Git commits (V2)
- Manual `br comments add` via bash
- Beads tool `comment` action
- Pre-compaction auto-checkpoint (V4)

### Dep-Aware Ready (V7)

The `ready` action enriches the first 5 issues with dependency info from `br dep list`:

```
[P2] bd-a1b (task) Implement widget parser
  ↳ parent: bd-x9z Widget system
  ↳ unblocks: bd-c3d Widget renderer
[P3] bd-g7h (bug) Fix crash on empty input
```

Each issue shows its parent and what it would unblock if completed. Dep queries use a 5s timeout with graceful degradation.

## Beads Tool

LLM-callable tool wrapping `br` CLI with structured output:

| Action | Description |
|--------|-------------|
| `ready` | List ready issues (dep-enriched) |
| `show` | Show issue details |
| `claim` | Mark in_progress, initialize file tracking + checkpoint state |
| `close` | Flush file list, close issue, trigger auto-continue |
| `comment` | Add comment, reset checkpoint counter |
| `create` | Create new issue |
| `status` | Show beads stats |

## Skills

Workflow skills shipped with the extension (manual-only, invoked via `/skill:beads-*`):

| Skill | Description |
|-------|-------------|
| [beads-storm](./skills/beads-storm/) | Brainstorm a feature area into beads issues |
| [beads-plan](./skills/beads-plan/) | Break issues into implementation plans |
| [beads-code](./skills/beads-code/) | Execute implementation with TDD and checkpoints |
| [beads-create](./skills/beads-create/) | Create issues with correct CLI flags and wiring |

The extension handles runtime mechanics; skills handle reasoning.

## Design

**Single source of truth:** Beads issues and comments. In-memory stores (`editedFiles`, `checkpointState`, `currentIssueId`) are write buffers flushed to beads at checkpoint moments. Recovery reads from beads only.

Design docs in `docs/shaping/`:
- `frame.md` — problem statement and appetite
- `shaping.md` — requirements, shapes, fit check
- `breadboard.md` — affordance tables and scenario traces
- `slices.md` — 7 vertical slices with dependency graph

## Testing

```bash
npm test
```
