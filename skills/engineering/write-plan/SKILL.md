---
name: write-plan
description: Create executable implementation plans before code changes. Use when a task has requirements or a spec and needs multi-step implementation, decomposition, sequencing, verification, or handoff to another agent.
metadata:
  bucket: engineering
---

# Write Plan

Plan before mutating code. The output must be executable by `execute-plan`, not a vague strategy memo.

## Workflow

1. **Clarify the target**
   - Identify the requested outcome, non-goals, constraints, risks, and success criteria.
   - If requirements conflict or the goal is still exploratory, stop and ask or use a discovery skill first.

2. **Inspect reality**
   - Read the relevant code, tests, docs, build config, and nearby patterns.
   - Check official docs/specs when unfamiliar frameworks, protocols, or APIs matter.
   - Do not edit production files while planning.

3. **Choose the shape**
   - Decide the smallest safe sequence that produces reviewable, deployable progress.
   - Split independent subsystems into separate plans.
   - Prefer TDD slices for production behavior; include foundation or hardening work when safety requires it.

4. **Write the plan**
   - Save to the user-requested path, or `docs/plans/YYYY-MM-DD-<short-name>.md` when no path is given.
   - Start with goal, approach, assumptions, and out-of-scope notes.
   - Every executable item must use `- [ ]` checkbox syntax.
   - Every checkbox must be required; put follow-ups/deferred ideas in plain bullets under a non-executable section.

5. **Make each task runnable**
   - Name exact files to create/modify/read.
   - Include the verification command and expected signal for each task.
   - Include commit checkpoints at stable task boundaries.
   - Call out required skills for execution, such as `tdd`, `diagnose`, `verify`, or `code-review`.

6. **Review before handoff**
   - Read the plan as the next agent would: is the next action unambiguous?
   - Check for optional checkbox tasks, missing verification, hidden decisions, and uninspected assumptions.
   - If the plan is risky or large, request a plan/codebase review before execution.

## Stop and ask

Ask the user before finishing the plan if:

- success criteria or user-visible behavior is ambiguous
- the task spans independent deliverables that should be split
- a required dependency, credential, environment, or domain decision is missing
- safe execution depends on a destructive migration, production operation, or irreversible data change
- the plan would require optional or conditional executable branches

## Output

Return:

- plan path
- summary of the execution sequence
- verification strategy
- assumptions and open decisions
- whether it is ready for `execute-plan`
