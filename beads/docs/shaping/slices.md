---
shaping: true
---

# Beads Extension v2 — Slices

Vertical slices for Shape D, ordered so each builds on the last and is independently demo-able.

**Design principle reminder:** Beads is the single source of truth. In-memory stores are write buffers flushed to beads. Recovery reads from beads comments only.

---

## Slice Summary

| # | Slice | Mechanism | Demo |
|---|-------|-----------|------|
| V1 | Rich recovery | D1 | "Compact or restart → agent gets structured context with task, checkpoints, deps, uncommitted files" |
| V2 | Commit-to-issue linking | D3 | "Agent runs git commit → beads issue gets comment with commit hash and message" |
| V3 | File tracking | D7 | "Agent edits files, closes issue → closing comment lists all files modified" |
| V4 | Pre-compaction checkpoint | D2 | "Trigger /compact → auto-checkpoint comment with progress and file list appears on issue" |
| V5 | Auto-continue after close | D4 | "Close issue → agent automatically queries ready and picks next without human prompt" |
| V6 | Checkpoint reminder | D5 | "Work 8+ turns without checkpointing → reminder notification fires" |
| V7 | Dependency-aware ready | D6 | "Run beads ready → each issue shows parent and what it unblocks" |

### Dependency Graph

```
V1 (recovery + stores + enhanced claim)
├── V2 (commit linking) — uses S3, S4 from V1
├── V3 (file tracking) — uses S2, S4 from V1
│   └── V4 (pre-compaction checkpoint) — reads S2, S3 from V2+V3
├── V5 (auto-continue) — independent, enhances close action
├── V6 (checkpoint reminder) — uses S3 from V1
└── V7 (dep-aware ready) — independent, uses N23 from V1
```

V1 must be first (introduces stores and recovery). V4 should follow V2+V3 (reads their stores). V5, V6, V7 are independent of each other.

---

## V1: Rich Recovery

**Mechanism:** D1 — Full context reconstruction on session start / post-compaction.

**Demo:** Claim an issue with existing comments. Trigger `/compact`. New turn starts → agent sees structured recovery message with task details, checkpoint trail from comments, dependency context, and uncommitted files.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| S2 | `editedFiles` | In-memory `Map<issueId, Set<string>>` — initialized empty on claim |
| S3 | `checkpointState` | In-memory `{ lastCheckpointTurn: number, turnIndex: number }` — initialized on claim |
| S4 | `currentIssueId` | Cached in-progress issue ID — set on claim, cleared on close |
| N3 | `buildRecoveryContext()` | Orchestrator: calls N10, N11, N12, N15 → assembles recovery block |
| N10 | `queryInProgressIssue()` | `br list --status in_progress --json` → first issue → S4 |
| N11 | `queryIssueDetails()` | `br show <S4> --json` → title, description, all comments |
| N12 | `queryDependencyContext()` | `br dep list <S4> --direction up --json` (parent) + `--direction down` (blockers) |
| N15 | `queryUncommittedFiles()` | `git status --porcelain` → list of uncommitted files |
| U3 | Rich recovery message | Injected via `before_agent_start` return `{ message: ... }` |

### Changes to Existing Code

| What | Change |
|------|--------|
| `BeadsState` | Add fields: `currentIssueId`, extend type |
| `before_agent_start` hook | Replace static prime with `buildRecoveryContext()` when in-progress issue exists; fall back to static prime when no issue |
| `session_before_compact` hook | (existing) re-arm shouldPrime — no change yet |
| Beads tool `claim` action | After successful claim: set S4, initialize S2 entry, reset S3 |
| Beads tool `close` action | After successful close: clear S4, delete S2 entry |
| `lib.ts` | New functions: `buildRecoveryContext()`, `formatRecoveryMessage()`, `parseDepListJson()` |
| `lib.test.ts` | Tests for recovery builder, dep parsing, message formatting, fallback to static prime |

### Recovery Message Format

```markdown
# Beads Workflow Context

## Core Rules
- Use beads for ALL task tracking (`br create`, `br ready`, `br close`)
- Do NOT use TodoWrite, TaskCreate, or markdown task files for tracking
- Create beads issue BEFORE writing code
- Mark issue in_progress when starting work

## Essential Commands
- br ready
- br list --status in_progress
- br show <id>
- br close <id> --reason "Verified: ..."

## Resuming: br-a1b — Implement widget parser
**Status:** in_progress | **Type:** task | **Priority:** P2
**Parent:** br-x9z — Widget system (feature)
**Unblocks:** br-c3d — Widget renderer

### Checkpoint Trail
- [2h ago] Done: parser skeleton. Approach: recursive descent. Next: handle nested brackets.
- [45m ago] Checkpoint: bracket parsing works for depth≤3. Next: handle escapes.

### Uncommitted Changes
src/parser.ts (M), tests/parser.test.ts (M)
```

**Truncation rules:**
- Checkpoint trail: last 5 comments, each truncated to 200 chars
- Uncommitted files: max 15 entries
- Total target: ≤ 2KB

---

## V2: Commit-to-Issue Linking

**Mechanism:** D3 — Auto-comment on issue when git commits happen.

**Demo:** Agent is working on a claimed issue. Runs `git commit -m "feat: add parser"`. Check `br show <id>` → new comment: `"commit: a1b2c3d feat: add parser"`. No manual action needed.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| N32 | `detectGitCommit()` | In `tool_result`: check if toolName=bash, `event.input.command` matches `/^\s*git\s+commit/`, not `event.isError` |
| N33 | `linkCommitToIssue()` | Parse commit hash + message from `event.details.stdout`, run `br comments add <S4> "commit: <hash> <message>"` |
| N36 | `detectManualCheckpoint()` | In `tool_result`: if bash command matches `/^\s*br\s+comments\s+add/` and success → reset S3. Also: beads tool `comment` action resets S3 directly. |

### Changes to Existing Code

| What | Change |
|------|--------|
| `hooks.ts` | Add `tool_result` handler with commit detection + manual checkpoint detection |
| `lib.ts` | New functions: `isGitCommitCommand()`, `parseGitCommitOutput()` |
| `lib.test.ts` | Tests for commit detection regex, output parsing (various git commit output formats) |

### Commit Detection

```typescript
// Match: git commit, git commit -m "...", git commit -am "...", etc.
function isGitCommitCommand(command: string): boolean {
  return /^\s*git\s+commit\b/.test(command);
}

// Parse: "[main a1b2c3d] feat: add parser\n 2 files changed..."
function parseGitCommitOutput(stdout: string): { hash: string; message: string } | null {
  const match = stdout.match(/^\[[\w/.-]+\s+([a-f0-9]+)\]\s+(.+)/m);
  if (!match) return null;
  return { hash: match[1], message: match[2] };
}
```

### Side Effect

Commit resets `S3.lastCheckpointTurn = S3.turnIndex` — a commit is a natural checkpoint. This prevents the checkpoint reminder (V6) from nagging an agent that's committing regularly.

---

## V3: File Tracking

**Mechanism:** D7 — Track edited files per issue, attach list as comment on close.

**Demo:** Agent claims an issue, edits `src/parser.ts`, `src/types.ts`, and `tests/parser.test.ts`. Closes the issue. Check `br show <id>` → comment: `"Files modified: src/parser.ts, src/types.ts, tests/parser.test.ts"`.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| N34 | `trackEditedFile()` | In `tool_result`: if toolName is write or edit, extract `event.input.path`, add to `S2.get(S4)` |
| N53 | `attachFileListOnClose()` | In beads tool close: read `S2.get(id)`, if non-empty run `br comments add <id> "Files modified: ..."`, delete S2 entry |

### Changes to Existing Code

| What | Change |
|------|--------|
| `hooks.ts` | Extend `tool_result` handler (from V2): detect write/edit tools, extract `event.input.path`, update S2 |
| `tool.ts` | Enhance `close` action: call `attachFileListOnClose()` before close (so comment is on the issue before it closes) |
| `lib.ts` | New functions: `isFileEditTool()`, `extractEditedFilePath()`, `formatFileListComment()` |
| `lib.test.ts` | Tests for file path extraction from write/edit tool events, file list formatting |

### File Path Extraction

```typescript
// tool_result event has: toolName, event.input (the input params)
// For write: event.input.path
// For edit: event.input.path
function extractEditedFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "write" || toolName === "edit") {
    return typeof input.path === "string" ? input.path : null;
  }
  return null;
}
```

---

## V4: Pre-Compaction Auto-Checkpoint

**Mechanism:** D2 — Auto-save progress to issue comments before compaction.

**Demo:** Agent is working (has edited files from V3, made a commit from V2). Trigger `/compact`. Check `br show <id>` → new comment: `"Auto-checkpoint (pre-compaction): Done: [recent activity]. Files: [from S2]. Turns: N since last checkpoint."` Then recovery (V1) picks up this checkpoint on the next turn.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| N41 | `autoCheckpoint()` | Orchestrator in `session_before_compact`: calls N42, N43, writes to beads via N26 |
| N42 | `buildCheckpointSummary()` | Reads S2 (edited files), S3 (turns since checkpoint) → formats summary string |
| N43 | `getRecentSessionActivity()` | Reads `event.branchEntries` (provided directly by `session_before_compact` hook) → extracts what agent did |

### Changes to Existing Code

| What | Change |
|------|--------|
| `hooks.ts` | Enhance `session_before_compact` handler: after re-arming prime, call `autoCheckpoint()` if S4 is set. Use `event.branchEntries` for activity scan. `br comments add` timeout: 3s, fail silently. |
| `lib.ts` | New functions: `buildCheckpointSummary()`, `extractRecentActivity()` |
| `lib.test.ts` | Tests for summary building, activity extraction from session entries |

### Session Activity Extraction

```typescript
// Scan recent session entries for tool calls
// Look for: bash commands run, files edited/written, test results
// Produce a brief summary like: "Ran tests (3 passed), edited src/parser.ts, committed a1b2c3d"
function extractRecentActivity(entries: SessionEntry[]): string {
  // Take last ~20 entries, look for toolResult entries
  // Summarize by tool type: "edited N files, ran M commands, N commits"
}
```

### Auto-Checkpoint Format

```
Auto-checkpoint (pre-compaction):
- Activity: edited 3 files, ran 5 commands, 1 commit
- Files this session: src/parser.ts, src/types.ts, tests/parser.test.ts
- Turns since last checkpoint: 4
```

---

## V5: Auto-Continue After Close

**Mechanism:** D4 — Inject followUp message to pick next ready issue.

**Demo:** Agent closes an issue via beads tool. Without any human prompt, agent says "Checking for next ready work..." and calls `beads ready`.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| N54 | `injectContinueMessage()` | After close succeeds: `pi.sendMessage(...)` with `deliverAs: "followUp"`, `triggerTurn: true` |
| U6 | Auto-continue message | The followUp message the agent sees and acts on |

### Changes to Existing Code

| What | Change |
|------|--------|
| `tool.ts` | Enhance `close` action: after existing close logic, call `injectContinueMessage()` |
| `index.ts` | Pass `pi.sendMessage` reference (or wrapper) into tool deps |
| `lib.ts` | New function: `buildContinueMessage()` |
| `lib.test.ts` | Tests for continue message content |

### Continue Message

```typescript
function buildContinueMessage(closedId: string): string {
  return [
    `Issue ${closedId} closed.`,
    `Check for next ready work: run \`br ready --sort priority\` to pick the next issue.`,
    `If no ready issues remain, summarize what was accomplished and ask the user what's next.`,
  ].join("\n");
}
```

---

## V6: Periodic Checkpoint Reminder

**Mechanism:** D5 — Nudge after N turns without checkpoint.

**Demo:** Agent claims an issue, works for 8+ turns without committing or manually checkpointing. On turn 8, notification appears: "Consider checkpointing progress." Agent sees a `nextTurn` message with the specific command to run.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| N35 | `checkCheckpointDue()` | In `turn_end`: increment `S3.turnIndex`, check if `turnIndex - lastCheckpointTurn >= 8` |
| U5 | Checkpoint reminder | Notification + `nextTurn` message with `br comments add` command |

### Changes to Existing Code

| What | Change |
|------|--------|
| `hooks.ts` | Extend `turn_end` handler: after context warning check, call `checkCheckpointDue()` |
| `lib.ts` | New functions: `shouldNudgeCheckpoint()`, `buildCheckpointNudgeMessage()` |
| `lib.test.ts` | Tests for nudge threshold logic, message formatting |

### Nudge Behavior

- Fires once when threshold is reached, then not again until checkpoint resets the counter
- A commit (V2, N33) resets the counter → agents who commit frequently never see this
- A manual `br comments add` via beads tool `comment` action resets the counter (N55 in tool.ts)
- A manual `br comments add` via bash resets the counter (N36, detected in `tool_result` handler from V2)
- Pre-compaction auto-checkpoint (V4, N42) resets the counter
- Configurable threshold (default: 8 turns) — could expose as flag later

---

## V7: Dependency-Aware Ready

**Mechanism:** D6 — Enrich ready output with parent and unblocks info.

**Demo:** Run beads tool `ready` → each issue shows its parent feature/epic and what issues it would unblock if completed.

### New Affordances

| # | Affordance | Description |
|---|------------|-------------|
| N51 | `enrichReadyWithDeps()` | For first 5 ready issues: `br dep list <id> --direction up` (parent) + `--direction down` (what depends on this) |
| U7 | Dep-aware ready output | Enhanced format with `↳ parent:` and `↳ unblocks:` lines |

### Changes to Existing Code

| What | Change |
|------|--------|
| `tool.ts` | Enhance `ready` action: after getting issues, call `enrichReadyWithDeps()` |
| `lib.ts` | New functions: `parseDepListJson()`, `formatEnrichedReadyOutput()` |
| `lib.test.ts` | Tests for dep parsing (up/down), enriched output formatting, empty deps |

### Enhanced Ready Output

```
[P2] br-a1b (task) Implement widget parser
  ↳ parent: br-x9z Widget system
  ↳ unblocks: br-c3d Widget renderer, br-e5f Widget tests
[P2] br-g7h (task) Add error handling
  ↳ parent: br-x9z Widget system
  ↳ unblocks: (none)
[P3] br-j9k (bug) Fix crash on empty input
  ↳ unblocks: (none)
```

### Performance

- Dep queries limited to first 5 ready issues (avoids O(n) `br dep list` calls)
- Each issue needs 2 calls (up + down) → max 10 `br dep list` calls
- All calls run with 5s timeout
- If any dep query fails, that issue shows without dep info (graceful degradation)

---

## Implementation Order

```
V1 ──→ V2 ──→ V4
  │      │
  ├───→ V3 ──→ V4
  │
  ├───→ V5 (independent)
  ├───→ V6 (uses S3 from V1)
  └───→ V7 (independent)
```

**Critical path:** V1 → V2 → V3 → V4 (each builds on stores from the previous)

**Parallel after V1:** V5, V6, V7 can be done in any order after V1.
