---
name: parallelize-work
description: Split independent work across subagents safely with focused prompts, isolated scopes, and explicit integration checks. Use when there are two or more independent investigations, reviews, or edits that can proceed without shared state or file conflicts.
metadata:
  bucket: productivity
---

# Parallelize Work

Parallelize only independent work. If agents would edit the same files or need each other's conclusions, do it sequentially.

## Workflow

1. **Group the work**
   - Identify separate failures, subsystems, documents, skills, or review areas.
   - Check whether each group can be understood and changed without the others.
   - Keep related failures together when one root cause may explain them.

2. **Check isolation**
   Use parallel subagents only when each task has:
   - a distinct scope
   - no shared write targets
   - no required ordering
   - a clear done condition
   - enough context to work without session history

3. **Write focused prompts**
   Each prompt must include:
   - exact files, tests, issue IDs, or subsystem to inspect
   - goal and non-goals
   - constraints on what may be edited
   - required verification or evidence
   - requested return format: findings, patch summary, or recommendation

4. **Dispatch deliberately**
   - Prefer read/review/investigation tasks for parallel agents.
   - For editing tasks, assign non-overlapping files or ask agents to return proposed patches instead of committing.
   - Do not dispatch agents just to read files faster; local reads are cheaper and safer.

5. **Integrate results**
   - Read every returned summary before editing further.
   - Detect conflicting conclusions or overlapping file changes.
   - Apply or merge changes in a controlled order.
   - Run the full relevant verification after integration, not only each agent's narrow command.

## Good uses

- Three unrelated failing test files with separate root causes.
- Separate code review passes for security, performance, and test quality.
- Drafting independent skill files for different workflows, followed by one integration review.
- Researching alternatives that do not mutate the repo.

## Bad uses

- One bug with an unknown root cause.
- A refactor where every agent edits the same module.
- Work that needs a shared design decision first.
- Delegating unclear tasks to avoid thinking.
- Spawning subagents for simple file reads.

## Stop and ask

Ask before dispatch if:

- scopes overlap or write targets conflict
- the user expects one coherent design decision, not parallel options
- agents would need credentials, private data, or destructive commands
- verification cannot be run after integrating results

## Output

Report:

- task groups and why they are independent
- prompts or subagent assignments used
- results received
- integration decisions
- final verification evidence
