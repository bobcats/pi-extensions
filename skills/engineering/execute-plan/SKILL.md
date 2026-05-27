---
name: execute-plan
description: Execute a written implementation plan step by step with verification and commits. Use when the user provides a plan file, asks to follow a plan, or wants planned work implemented safely.
metadata:
  bucket: engineering
---

# Execute Plan

Follow the plan; do not freestyle. One checkbox, verified, checked off, then the next.

## Workflow

1. **Load and review the plan**
   - Read the whole plan before changing files.
   - Identify executable `- [ ]` checkbox items and non-executable context sections.
   - Stop before implementation if the plan has optional checkbox work, unclear ordering, missing verification, unsafe operations, or requirements you cannot satisfy.

2. **Execute sequentially**
   - Pick the next unchecked executable checkbox.
   - Do only that item and the minimum supporting work required for it.
   - Use referenced skills when the item calls for them, especially `diagnose`, `tdd`, and `verify`.
   - Do not start the next checkbox while the current one is unverified.
   - Do not satisfy a checkbox by generating many skills/files in one unreviewed burst; for skill work, validate each skill or bucket before marking the parent item complete.

3. **Verify the current item**
   - Run the command or manual check named in the plan.
   - If the plan omits verification, choose the narrowest honest proof and note the gap.
   - For skill batches, include frontmatter/link validation, standalone-read checks, support-file audits, and review or self-review notes before checking off the item.
   - If verification fails, use `diagnose`; do not check off the item until it passes or the user accepts a changed plan.

4. **Update the plan**
   - Check off only completed, verified items: `- [ ]` → `- [x]`.
   - Preserve unchecked deferred work.
   - If the plan needs to change, edit it explicitly and explain why.

5. **Commit at stable checkpoints**
   - When a task boundary closes, commit the completed work with `semantic-commit`.
   - Keep commits atomic to the plan item or task.
   - Do not accumulate a large uncommitted branch unless the plan explicitly requires it.

6. **Finish with evidence**
   - Run final verification for the completed scope.
   - Report checked-off items, commits made, verification output, and remaining unchecked items or gaps.

## Stop and ask

Stop before continuing if:

- the next checkbox is optional, conditional, or can be skipped without changing the goal
- the next action is ambiguous or contradicts current code reality
- required credentials, services, fixtures, or environment are unavailable
- verification fails repeatedly after diagnosis
- the plan requires destructive data changes, production operations, or broad rewrites not explicitly approved

## Red flags

- checking off work before observing verification
- batching multiple checkboxes because they are nearby
- treating a broad checkbox as permission for unreviewed bulk generation
- editing outside the plan without updating it
- claiming completion with unchecked executable items remaining
- turning follow-up ideas into implementation without user approval

## Output

Report:

- plan path
- items completed and items still unchecked
- commits created
- verification evidence
- blockers or plan changes
