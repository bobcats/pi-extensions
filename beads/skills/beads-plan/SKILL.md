---
name: beads-plan
description: Write implementation plans mapped to beads issue structure with tasks as plan steps.
---

# Beads Plan

Break down an existing epic's features into a structured task hierarchy. Create comprehensive, granular issues that enable incremental TDD implementation.

## Shared References

- [CLI basics](../shared/cli-basics.md)
- [Session recovery](../shared/session-recovery.md)
- [Verification and close standards](../shared/verification-close.md)
- [Workflow boundary](../shared/workflow-boundary.md)

## Activation

Use this skill when:
- An epic/features already exist and need execution-ready task breakdown
- The user asks for implementation planning, sequencing, or decomposition
- `@beads-storm` output exists but `@beads-code` would be premature

**Announce at start:** "I'm using the beads-plan skill to create execution-ready tasks before coding."

## Iron Laws (Hard Gates)

1. **NO implementation during planning.** Do not edit production code/tests to implement behavior.
2. **NO source-file implementation edits in this phase.** Planning outputs beads tasks + plan docs only.
3. **NO `@beads-code` handoff until entry and exit gates pass.**
4. **NO vague tasks.** Every task must be specific, testable, and small.

If asked to implement during planning, respond:

**"I can't implement code in `@beads-plan`. This phase creates tasks/dependencies/plan docs. After gates pass, run `@beads-code`."**

## Philosophy

**Granular is better.** Many tasks prevent the "one-shotting" failure mode where agents declare victory after implementing a few things.

**When in doubt, add more tasks.** A trivial task closes quickly. A missing task leads to incomplete features.

**Tests come first.** Task structure reflects test-first thinking: write-test tasks block implementation tasks.

## Entry Gate (Required Before Planning)

Run:

```bash
br list --type epic --status open
br list --type feature --status open
```

Planning can proceed only if all checks pass:
- [ ] At least one open epic exists
- [ ] Target epic has feature children
- [ ] Features have clear acceptance criteria (add/update if missing)

If gate fails, stop and say:

**"No plan-ready epic/features found. Run `@beads-storm` first to define epic and user-story features."**

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

Then stop and hand off:

**"Plan saved. Run `@beads-code` to start implementation. I will not implement code in planning mode."**

## Exit Gate (Required Before Handoff)

Do not hand off to `@beads-code` until all are true:
- [ ] Every plan task maps to a beads task ID
- [ ] Test tasks block implementation tasks (TDD encoded)
- [ ] Every feature has verification subtasks
- [ ] Blocking dependencies reflect implementation order
- [ ] Plan file saved with bite-sized steps, exact paths, exact commands
- [ ] Tasks updated with plan references/acceptance criteria

## Stop Conditions

Stop and ask the user before proceeding when:
- Epic/features are missing or unclear
- Acceptance criteria are ambiguous or untestable
- Dependency ordering cannot be justified
- Scope expands beyond the validated storm output

## Dependency Types Reference

| Type | Purpose | Effect on `br ready` | When to Use |
|------|---------|---------------------|-------------|
| `parent-child` | Hierarchy (epic→feature→task) | No blocking | Organizing work |
| `blocks` | Sequencing (B waits for A) | Blocked hidden from ready | Work order matters |
| `related` | Association (A and B connected) | No blocking | Cross-cutting concerns |
| `discovered-from` | Traceability (found B while on A) | No blocking | Tracking bug origins |
