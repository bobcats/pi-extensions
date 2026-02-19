---
shaping: true
---

# Beads Extension v2 — Shaping

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Agent recovers full working context after compaction or new session without manual re-discovery | Core goal |
| R1 | Checkpoints happen automatically at key moments (pre-compaction, on commit, periodically) without agent initiative | Must-have |
| R2 | Git commits are automatically linked to the in-progress issue | Must-have |
| R3 | Work selection shows dependency-aware information (what's blocked, what unblocks next) | Must-have |
| R4 | After closing an issue, agent automatically continues to next ready issue without human prompt | Must-have |
| R5 | Extension works with zero additional configuration beyond `br init` | Must-have |
| R6 | Rich recovery context includes: file inventory, test state, approach, decisions, what's left | Must-have |
| R7 | Extension does not bloat context — injections are compact and structured | Must-have |
| R8 | All new behavior respects beads-mode on/off toggle | Must-have |

---

## CURRENT: Existing System

| Part | Mechanism |
|------|-----------|
| **C1** | **Project detection** — `session_start` runs `br info --json`, sets `isBeadsProject` / `beadsEnabled` |
| **C2** | **Status bar** — Shows mode, issue count, in-progress issue(s) in footer via `ctx.ui.setStatus` |
| **C3** | **Priming** — `before_agent_start` injects static prime message with workflow rules; re-arms after compaction |
| **C4** | **Dirty-tree guard** — `tool_call` hook blocks `br close` via bash if git working tree is dirty |
| **C5** | **Context warning** — `turn_end` checks usage %, one-time warning at 85% + `followUp` message |
| **C6** | **Beads tool** — LLM-callable tool wrapping br CLI (ready/show/claim/close/comment/create/status) |
| **C7** | **Commands** — `/beads` picker, `/beads-ready`, `/beads-status`, `/beads-claim`, `/beads-close`, `/beads-mode` |
| **C8** | **Skills** — beads-storm, beads-plan, beads-code, beads-create provide reasoning/process guidance |
| **C9** | **Observability** — Optional `--beads-observe` flag for tool lifecycle diagnostics |

---

## A: Smart Recovery Engine

Focus on making context survival bulletproof. Invest heavily in what happens after compaction/session start.

| Part | Mechanism |
|------|-----------|
| **A1** | **Rich recovery builder** — On `before_agent_start` (when priming), query `br show <id> --json` for in-progress issue, extract all comments as checkpoint trail, build structured context |
| **A2** | **File inventory** — Run `git diff --name-only HEAD~3` and `git status --porcelain` to capture recently touched files and uncommitted changes, include in recovery context |
| **A3** | **Dependency context** — Run `br dep tree <id>` to show what the current task is part of (parent feature/epic) and what it unblocks |
| **A4** | **Compact recovery context format** — Structured markdown block with sections: Task, Checkpoints, Files, Dependencies, Next Steps — kept under 2KB |
| **A5** | **Pre-compaction checkpoint** — Hook `session_before_compact` to automatically run `br comments add` with a summary of recent work before context is lost |

---

## B: Automated Work Loop

Focus on eliminating manual lifecycle steps. Make the agent flow through claim→work→close→next automatically.

| Part | Mechanism |
|------|-----------|
| **B1** | **Auto-claim on work start** — `tool_call` hook detects when agent starts editing files related to an open issue (heuristic: first edit after priming) and auto-runs `br update <id> --status in_progress` |
| **B2** | **Auto-continue after close** — When beads tool `close` action succeeds, inject a `followUp` message: "Issue closed. Checking for next ready issue..." then auto-run `br ready --sort priority` |
| **B3** | **Periodic checkpoint** — Track turns since last checkpoint; after N turns (configurable), inject a `nextTurn` reminder to checkpoint |
| **B4** | **Auto-checkpoint on commit** — `tool_result` hook for bash: if command was `git commit`, extract commit message and auto-add as beads comment |
| **B5** | **Smart close guard** — Enhance dirty-tree guard: also check if acceptance criteria exist and warn if agent hasn't mentioned them |

---

## C: Git-Issue Bridge

Focus on tight git↔beads integration. Commits, branches, and diffs all connect to issues.

| Part | Mechanism |
|------|-----------|
| **C1** | **Commit-to-issue linking** — `tool_result` hook for bash: detect `git commit` commands, extract commit hash + message, auto-run `br comments add <in-progress-id> "commit: <hash> <message>"` |
| **C2** | **Branch-per-issue** — When claiming an issue via beads tool, auto-create and switch to branch `beads/<issue-id>` if not already on it |
| **C3** | **Diff summary on close** — Before allowing close, run `git log --oneline <branch-base>..HEAD` to build a change summary, attach as close metadata |
| **C4** | **File-to-issue mapping** — Track which files are modified while an issue is in-progress (via `tool_result` on write/edit tools), attach as comment on close |

---

## D: Composite — Recovery + Loop + Bridge (selected parts)

Cherry-pick the highest-impact parts from A, B, and C into a focused shape.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **D1** | **Rich recovery builder** (= A1 + A2 + A3 + A4) — Full context reconstruction on session start / post-compaction | |
| **D2** | **Pre-compaction checkpoint** (= A5) — Auto-save progress to issue comments before compaction | |
| **D3** | **Commit-to-issue linking** (= C1) — Auto-comment on issue when git commits happen | |
| **D4** | **Auto-continue after close** (= B2) — Inject follow-up to pick next ready issue | |
| **D5** | **Periodic checkpoint reminder** (= B3) — Nudge after N turns without checkpoint | |
| **D6** | **Dependency-aware ready** — Enhance beads tool `ready` action to include parent context and what each issue unblocks | |
| **D7** | **File tracking** (= C4) — Track edited files per issue, include in recovery context | |

---

## Fit Check

| Req | Requirement | Status | A | B | C | D |
|-----|-------------|--------|---|---|---|---|
| R0 | Agent recovers full working context after compaction or new session | Core goal | ✅ | ❌ | ❌ | ✅ |
| R1 | Checkpoints happen automatically at key moments | Must-have | ✅ | ✅ | ❌ | ✅ |
| R2 | Git commits are automatically linked to in-progress issue | Must-have | ❌ | ❌ | ✅ | ✅ |
| R3 | Work selection shows dependency-aware information | Must-have | ✅ | ❌ | ❌ | ✅ |
| R4 | After closing, agent automatically continues to next ready issue | Must-have | ❌ | ✅ | ❌ | ✅ |
| R5 | Zero additional configuration beyond `br init` | Must-have | ✅ | ✅ | ❌ | ✅ |
| R6 | Rich recovery includes files, tests, approach, decisions | Must-have | ✅ | ❌ | ❌ | ✅ |
| R7 | Injections are compact and structured | Must-have | ✅ | ✅ | ✅ | ✅ |
| R8 | Respects beads-mode on/off | Must-have | ✅ | ✅ | ✅ | ✅ |

**Notes:**
- A fails R2: No git integration
- A fails R4: No auto-continue behavior
- B fails R0: No recovery improvements
- B fails R3: No dependency awareness
- B fails R6: No rich recovery
- C fails R0: No recovery improvements
- C fails R1: No checkpoint automation
- C fails R3: No dependency awareness in work selection
- C fails R4: No auto-continue
- C fails R5: Branch-per-issue (C2) requires git workflow convention that may conflict with existing workflows

**D passes all checks** by composing the best parts of A, B, and C while dropping the problematic ones (branch-per-issue, auto-claim heuristic, smart close guard).

---

## Selected Shape: D — Composite

Shape D combines the highest-impact, lowest-risk parts into a coherent whole.

**Core design principle: Beads is the single source of truth.** All durable state lives in beads issue comments. In-memory stores (editedFiles, checkpointState) are write buffers flushed to beads at checkpoint moments. Recovery reads from beads comments only — never from git history or in-memory state. The sole exception is `git status` for real-time uncommitted changes that beads can't know.

### What's deferred (can add later)
- Branch-per-issue (C2) — too opinionated about git workflow
- Auto-claim heuristic (B1) — too magical, hard to get right
- Smart close guard (B5) — acceptance criteria validation is better as a skill concern
- Diff summary on close (C3) — nice-to-have, not core

---

## Breadboard

Shape D has been breadboarded into concrete affordances. See [breadboard.md](./breadboard.md) for the full detail.

**Summary of new affordances by lifecycle hook:**

| Hook | New Affordances |
|------|----------------|
| `before_agent_start` | Rich recovery builder — queries issue, comments, deps, git, tracked files → structured 2KB context |
| `session_before_compact` | Auto-checkpoint — summarizes recent activity + files → saves as beads comment |
| `tool_execution_end` (bash) | Commit detection — parses git commit output → links commit to issue as comment |
| `tool_execution_end` (write/edit) | File tracking — records edited file paths in per-issue set |
| `turn_end` | Periodic checkpoint reminder — nudge after N turns without checkpoint |
| Beads tool: `ready` | Dependency enrichment — adds parent + unblocks info to each ready issue |
| Beads tool: `close` | File list attachment + auto-continue followUp message |
| Beads tool: `claim` | Initialize file tracking + checkpoint state for claimed issue |

**New data stores (in-memory buffers, flushed to beads):** `editedFiles` (per-issue file set), `checkpointState` (turn counter), `currentIssueId` (cached). Recovery never reads from these — only from beads comments.

**Sliced** — see [slices.md](./slices.md) for 7 vertical slices with per-slice affordance tables and demo statements.
