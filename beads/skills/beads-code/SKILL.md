---
name: beads-code
description: Execute implementation work on beads issues — select leaf task, TDD, checkpoint, verify, close, bubble up.
disable-model-invocation: true
---

# Beads Code

Implement beads issues one at a time with TDD, checkpointing, and structured close.

## Shared References

- [CLI basics](../shared/cli-basics.md)
- [Session recovery](../shared/session-recovery.md)
- [Verification and close standards](../shared/verification-close.md)
- [Workflow boundary](../shared/workflow-boundary.md)

**Core principle:** Continuous execution — close the current leaf task, then immediately pick the next ready leaf task. Stop only on blockers or when explicitly told to stop.

## When to Use

- After `@beads-plan` has created a plan with mapped beads tasks
- When picking up ready work from the backlog
- When resuming after context compaction or a new session

**Announce at start:** "I'm using the beads-code skill to implement beads issues."

## Session Start Protocol

**ALWAYS begin every session with these steps, in order:**

### 1. Verify Working Directory

```bash
pwd
git log --oneline -10
```

Confirm you're in the project root. Understand recent commits.

### 2. Check for In-Progress Work First

```bash
br list --status in_progress
```

If something is in progress, resume it. Read its comments to recover context:

```bash
br show <id>
```

Comments contain checkpoint information from previous work. This is critical for continuity after context compaction.

### 3. Otherwise, Find Ready Work

```bash
br ready --sort priority
```

### 4. Drill Down to Leaf Task

Pick the top item. If it's an epic or feature, drill down to find the actual leaf task:

```bash
br show <id> --json
```

Look at dependents with `"dependency_type": "parent-child"`. If there are open children, pick the first one and repeat until you reach a leaf (no open children).

**Drill-down loop:**
1. `br show <id> --json` — check for open `parent-child` dependents
2. If open children exist → mark current as `in_progress`, examine first open child, repeat
3. If no open children → this is the leaf task

### 5. Claim the Leaf Task

```bash
br update <task-id> --status in_progress
br show <task-id>
```

Read the task details carefully. If the task has notes referencing a plan, load the plan file.

### 6. Verify Codebase Health

Run the project's test suite before any new work:

```bash
# whatever the project uses: npm test, pytest, go test, etc.
```

If tests fail, fix them first. Do not start new work on a broken codebase.

## Implementation

### Load Plan (if exists)

If the task's notes reference a plan:

```bash
br show <task-id>
# notes: "Plan: docs/plans/YYYY-MM-DD-feature.md, Task N"
```

Read the plan and follow the exact steps for this task.

### Test-Driven Development

**No production code without a failing test first.** No exceptions.

Before writing tests or code, search the codebase for similar implementations and understand existing patterns.

**The cycle:**

1. **RED** — Write one minimal failing test. Use Arrange-Act-Assert. One behavior per test, clear name, real code (mocks only if unavoidable).

2. **Verify RED** — Run the test. Confirm it fails for the expected reason (feature missing, not typos). **Never skip this step.**

3. **GREEN** — Write the simplest code to pass the test. Don't add features or refactor other code.

4. **Verify GREEN** — Run the test. Confirm it passes and other tests still pass. **Never skip this step.**

5. **REFACTOR** — Clean up while tests stay green. Remove duplication, improve names, extract helpers. Don't add behavior.

6. **Repeat** — Next failing test for next behavior.

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |

### Checkpoint Progress

**Context compaction can happen at any time.** Checkpoint frequently so state survives.

**When to checkpoint:**
- After completing a subtask or test cycle
- After making a key design decision
- Before any risky operation
- Every ~15 minutes of active work

**Checkpoint format:**

```bash
br comments add <task-id> "Checkpoint: [brief description]
- Done: [what you just completed]
- Approach: [current strategy]
- Next: [immediate next step]
- Blockers: [any issues discovered]"
```

### Commit Frequently

Small, frequent commits. One logical change per commit, don't mix unrelated changes. Before committing, check for debug statements, stray TODOs, and commented-out code.

Commits also serve as checkpoints. Uncommitted work is lost work.

### Discovered Work

If you find additional work needed:

```bash
br create "Found: [description]" --type task
```

If it blocks current work:

```bash
br dep add <current-task> <new-task> --type blocks
br comments add <current-task> "Blocked: discovered <new-task> needs to be done first"
br update <current-task> --status open
```

Stop and ask for guidance.

## Verification and Close

### Verify Before Closing

**No completion claims without fresh verification evidence.** If you haven't run the verification command in this message, you cannot claim it passes.

Before closing any issue:

1. **Check acceptance criteria:** `br show <task-id>` — walk through each criterion
2. **Run automated tests** — report command, pass/fail counts, exit code
3. **Run linter/type checks** if applicable
4. **Clean state check:**
   - [ ] No debug statements
   - [ ] No unresolved TODOs
   - [ ] No commented-out dead code
   - [ ] No skipped tests introduced to force green

Good close reason: "Ran `npm test` — 38 passed, 0 failed. Acceptance criteria verified."

Bad close reason: "Done" or "Looks good."

### Close the Leaf Task

```bash
br close <task-id> --reason "Verified: [what you tested and how]"
```

The `--reason` must include concrete evidence.

### Bubble Up: Close Parents

After closing a leaf task, check if parent can be closed:

```bash
br show <parent-id> --json
```

If ALL children with `dependency_type: "parent-child"` are closed:

```bash
br close <parent-id> --reason "All child tasks complete"
```

Repeat for epic level if all features are closed.

### Continue Execution Loop (default behavior)

After closing and bubbling up:

1. Run `br list --status in_progress` — resume any remaining in-progress work first
2. Else run `br ready --sort priority`
3. Select the next ready top-priority item
4. Drill down to the next leaf task
5. Claim and continue implementation

Do not pause between issues unless:
- a blocker is hit
- verification fails and cannot be resolved quickly
- the user explicitly asks to stop after the current issue

## Session End

After completing work:

1. **Commit** all changes

2. **Add session context** to the parent feature:

```bash
br comments add <feature-id> "Session summary:
- Tasks completed: [list task IDs]
- What was implemented
- What was verified
- Decisions made
- What's next"
```

3. **Only stop when appropriate:**
- No ready/in-progress issues remain
- A blocker requires user input
- User explicitly requested single-issue mode

If stopping, provide a concise status summary and next recommended issue.

## Critical Rules

1. **One issue at a time.** Do not work on multiple issues simultaneously.
2. **Never close without verification.** `--reason` must contain evidence.
3. **Never start on a broken codebase.** Fix failing tests first.
4. **Never stop without committing.** Uncommitted work is lost work.
5. **Never stop without checkpointing.** Future sessions depend on issue comments.
6. **Never skip TDD.** Write the failing test first for every code change.
7. **Always drill to leaf.** Work on leaf tasks, not features or epics directly.

## Handling Problems

| Problem | Action |
|---------|--------|
| Tests fail at session start | Fix them before new work |
| Blocked by another issue | Wire dependency, update status, ask user |
| Running out of context | Checkpoint immediately, commit WIP, notify user |
| Task too large | Decompose into subtasks via `@beads-create` |
| Design unclear | Add comment with questions, ask user |
