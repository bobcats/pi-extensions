---
name: beads-plan
description: Write implementation plans mapped to beads issue structure with tasks as plan steps.
disable-model-invocation: true
---

# Beads Plan

Break down an existing epic's features into a structured task hierarchy. Create comprehensive, granular issues that enable incremental TDD implementation.

## Shared References

- [CLI basics](../shared/cli-basics.md)
- [Session recovery](../shared/session-recovery.md)
- [Verification and close standards](../shared/verification-close.md)
- [Workflow boundary](../shared/workflow-boundary.md)

## Philosophy

**Granular is better.** Many tasks prevent the "one-shotting" failure mode where agents declare victory after implementing a few things.

**When in doubt, add more tasks.** A trivial task closes quickly. A missing task leads to incomplete features.

**Tests come first.** Task structure reflects test-first thinking: write-test tasks block implementation tasks.

## Prerequisites

Run `@beads-storm` first to create the epic and features. If no epic exists:

**"No epic found. Run `@beads-storm` first to explore the idea and define features."**

## The Process

### Step 1: Load Feature Context

```bash
br list --type epic --status open
br dep tree <epic-id>
br show <feature-id>
```

Review each feature's description and acceptance criteria.

### Step 2: Break Down Features into Tasks

For each feature, identify technical implementation steps:
- What code changes are needed?
- What tests are required? (write tests FIRST)
- What infrastructure/config is needed?
- What migrations are needed?

Tasks should be 15-60 minutes. If larger, create subtasks.

### Step 3: Create Tasks with TDD Ordering

For EACH capability within a feature, create tasks in this pattern:

1. **Write failing test** for the capability
2. **Implement** the capability to pass the test
3. The test task **blocks** the implementation task

```bash
br create "Write tests for [capability]" --type task --priority 2 --description "Test [specific scenarios]"
# Returns: <test-task-id>

br create "Implement [capability]" --type task --priority 2 --description "Implement to pass tests"
# Returns: <impl-task-id>

br dep add <test-task-id> <feature-id> --type parent-child
br dep add <impl-task-id> <feature-id> --type parent-child
br dep add <impl-task-id> <test-task-id> --type blocks
```

This encodes TDD into the issue structure itself — implementation can't start until tests exist.

### Step 4: Add Mandatory Verification Tasks

**Every feature MUST end with verification subtasks.**

```bash
br create "Verify [feature name]" --type task --priority 2
# Returns: <verify-id>

br create "Run test suite" --type task --priority 2 --description "Run all tests, report failures"
# Returns: <test-suite-id>

br create "Run linting and type checks" --type task --priority 2 --description "Run project linters and type checker, report violations"
# Returns: <lint-id>

br create "Clean commits check" --type task --priority 2 --description "Check for debug statements, TODOs, commented-out code, AI slop"
# Returns: <clean-id>

# Wire hierarchy
br dep add <test-suite-id> <verify-id> --type parent-child
br dep add <lint-id> <verify-id> --type parent-child
br dep add <clean-id> <verify-id> --type parent-child
br dep add <verify-id> <feature-id> --type parent-child

# Block verification on last implementation task
br dep add <verify-id> <last-impl-task-id> --type blocks
```

If UI changes exist, add a manual verification subtask too.

### Step 5: Wire Blocking Dependencies

Use `blocks` when work MUST be done in order:

```bash
br dep add <later-id> <earlier-id> --type blocks
```

**Common blocking patterns:**
- Database schema → API endpoint → UI
- Auth system → protected features
- Core models → features that use them
- Test tasks → implementation tasks (TDD)

### Step 6: Update Tasks with Plan References

For each task, add notes referencing the plan:

```bash
br update <task-id> --notes "Plan: docs/plans/YYYY-MM-DD-<feature>.md, Task N"
```

Add acceptance criteria if not already set:

```bash
br update <task-id> --acceptance-criteria "Tests pass, linter clean, feature works as described"
```

### Step 7: Save Plan Document

Save to `docs/plans/YYYY-MM-DD-<feature-name>.md`.

Plans should have bite-sized steps (2-5 minutes each), exact file paths, complete code (not "add validation"), and exact commands with expected output.

```markdown
# [Feature Name] Implementation Plan

> Use @beads-code to implement this plan.

**Goal:** [from feature description]

**Architecture:** [2-3 sentences]

**Tech Stack:** [key technologies]

**Beads Feature:** <feature-id>

---

### Task 1: [task title] — <task-id>

**Files:**
- Create: `exact/path/to/file.ts`
- Test: `tests/path/to/test.ts`

**Step 1: Write failing test**
[exact code]

**Step 2: Verify RED**
[exact command + expected output]

**Step 3: Implement**
[exact code]

**Step 4: Verify GREEN**
[exact command + expected output]

**Step 5: Commit**
[exact command]
```

### Step 8: Show Result and Hand Off

```bash
br dep tree <epic-id>
br ready --sort priority
br count --by-type
```

**"Plan saved. Run `@beads-code` to start implementation."**

## Dependency Types Reference

| Type | Purpose | Effect on `br ready` | When to Use |
|------|---------|---------------------|-------------|
| `parent-child` | Hierarchy (epic→feature→task) | No blocking | Organizing work |
| `blocks` | Sequencing (B waits for A) | Blocked hidden from ready | Work order matters |
| `related` | Association (A and B connected) | No blocking | Cross-cutting concerns |
| `discovered-from` | Traceability (found B while on A) | No blocking | Tracking bug origins |

## Verification

- [ ] Every plan task maps to a beads task ID
- [ ] Test tasks block implementation tasks (TDD encoded)
- [ ] Every feature has verification subtasks
- [ ] Blocking dependencies reflect implementation order
- [ ] Plan has bite-sized steps with exact file paths and commands
- [ ] Tasks updated with plan reference in notes
