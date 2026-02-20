# Beads Extension v2 — Handoff

## What Happened

Branch `feat/beads-v1-rich-recovery` implements Shape D of the beads extension v2 — 7 vertical slices that make beads a durable execution backbone for pi agents. The work was shaped, planned, and implemented across one session.

**Branch:** `feat/beads-v1-rich-recovery` (22 commits ahead of `main`)
**Tests:** 92 pass, 0 fail (`cd beads && npm test`)
**Beads:** All 77 issues closed, 0 open

## What Was Built

| Slice | Feature | How It Works |
|-------|---------|-------------|
| V1 | Rich recovery | `before_agent_start` queries in-progress issue, comments, deps, git status → injects structured ~2KB context block. Survives compaction. |
| V2 | Commit linking | `tool_result` detects `git commit` in bash → auto-comments `commit: <hash> <message>` on the active issue |
| V3 | File tracking | `tool_result` detects write/edit tools → tracks paths in S2 map → flushes "Files modified: ..." comment on close |
| V4 | Pre-compaction checkpoint | `session_before_compact` flushes auto-checkpoint comment with edited files + turn count before context is wiped |
| V5 | Auto-continue | After close, injects `followUp` message → agent automatically runs `br ready` and picks next issue |
| V6 | Checkpoint nudge | `turn_end` counts turns → at 8 without commit/comment, fires notification + `nextTurn` message with command hint |
| V7 | Dep-aware ready | `ready` action enriches first 5 issues with parent + unblocks from `br dep list` |

## Architecture

**Single source of truth:** Beads issues and comments. In-memory stores (S2 `editedFiles`, S3 `checkpointState`, S4 `currentIssueId`) are write buffers flushed to beads at checkpoint moments. Recovery reads from beads only.

**New state in `BeadsState`:**
- `currentIssueId: string | null` — set on claim, cleared on close, set on recovery
- `editedFiles: Map<string, Set<string>>` — file paths per issue
- `checkpointState: { lastCheckpointTurn, turnIndex }` — checkpoint counter

**New lib.ts functions (all pure, all tested):**
- `parseBrDepListJson()`, `formatCheckpointTrail()`, `formatRecoveryMessage()`
- `parseGitStatusPorcelain()`, `buildRecoveryContext()` (async orchestrator)
- `isGitCommitCommand()`, `parseGitCommitOutput()`
- `extractEditedFilePath()`, `formatFileListComment()`
- `shouldNudgeCheckpoint()`, `buildCheckpointNudgeMessage()`
- `buildCheckpointSummary()`, `buildContinueMessage()`
- `formatEnrichedReadyOutput()` + `EnrichedReadyIssue` type

**Hook changes:**
- `before_agent_start` — rich recovery replaces static prime
- `session_before_compact` — auto-checkpoint before compaction
- `tool_result` (new) — commit linking + file tracking
- `turn_end` — checkpoint nudge + existing context warning

**Tool changes:**
- `claim` — initializes S2/S3/S4
- `close` — flushes file list, clears stores, sends continue message
- `comment` — resets checkpoint counter
- `ready` — enriches with dep tree

## Files Changed

```
beads/commands.ts        — BeadsState type (3 new fields)
beads/lib.ts             — 14 new functions + types (+277 lines)
beads/lib.test.ts        — 54 new tests (+534 lines)
beads/hooks.ts           — tool_result handler, enhanced session_before_compact/turn_end (+126/-4)
beads/tool.ts            — enhanced close/comment/ready (+63/-4)
beads/index.ts           — new store init + dep wiring (+31 lines)
beads/docs/shaping/      — frame, shaping, breadboard, slices docs
beads/docs/plans/        — 3 implementation plans (V1, V2+V3+V6, V4+V5+V7)
```

## What Needs Doing

1. **Review and merge** `feat/beads-v1-rich-recovery` into `main`
2. **Smoke test V5 (auto-continue)** — close an issue via beads tool, verify agent auto-picks next ready issue without human prompt
3. **Smoke test V7 (dep-aware ready)** — run beads ready with issues that have parent/child deps, verify enriched output
4. **Consider:** README update for the new behaviors
5. **Consider:** Exposing checkpoint nudge threshold (currently hardcoded at 8 turns) as a flag

## How to Verify

```bash
cd ~/code/bobcats/pi-extensions
git checkout feat/beads-v1-rich-recovery
cd beads && npm test    # 92 pass, 0 fail
```

## Design Docs

All in `beads/docs/shaping/`:
- `frame.md` — problem statement and appetite
- `shaping.md` — 8 requirements, 4 shapes, fit check, Shape D selected
- `breadboard.md` — affordance tables and scenario traces
- `slices.md` — 7 vertical slices with dependency graph
