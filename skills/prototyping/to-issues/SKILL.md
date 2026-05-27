---
name: to-issues
description: Convert a plan, spec, PRD, or prototype result into reviewable implementation issues using thin tracer-bullet slices. Use when the user wants tickets, issue decomposition, or work split for agents or humans.
metadata:
  bucket: prototyping
---

# To Issues

Turn shaped work into independently grabbable issues. Issues describe outcomes and acceptance criteria, not a step-by-step implementation plan.

## Workflow

1. **Gather source material**
   - Read the plan, spec, PRD, prototype notes, parent issue, and relevant comments.
   - If the source is only a vague idea, use `grill-with-memory` or `prototype` before creating issues.
   - Identify the target tracker: GitHub, Linear, local markdown, or another workflow.

2. **Inspect enough code reality**
   - Read nearby code, tests, domain docs, and ADRs so issue language matches the project.
   - Do not over-plan file-level implementation; that belongs in `write-plan` per issue.

3. **Draft tracer-bullet slices**
   - Each issue should deliver a narrow, verifiable path through the required layers.
   - Prefer many thin, demoable slices over one broad umbrella ticket.
   - Mark each slice as:
     - **AFK** — an agent can implement from the issue without more user input.
     - **HITL** — needs human decision, design review, product judgment, or access.
   - Record dependencies explicitly.

4. **Review the breakdown with the user**
   - Present titles, AFK/HITL status, dependencies, and covered user stories or requirements.
   - Ask whether slices are too coarse/fine, dependencies are right, and HITL boundaries are correct.
   - Iterate until approved before publishing.

5. **Publish or write issues**
   - Publish in dependency order so blockers have real identifiers.
   - If tracker details are missing, ask or write local markdown drafts instead of guessing.
   - Do not close, rewrite, or mutate the parent issue unless explicitly asked.

## Issue body shape

```markdown
## Parent

<parent issue/spec link, if any>

## What to build

<end-to-end behavior for this slice; avoid stale file-level instructions>

## Acceptance criteria

- [ ] <observable criterion>
- [ ] <observable criterion>

## Blocked by

<issue links or "None - can start immediately">

## Notes

<prototype decisions, domain terms, constraints, or risks>
```

## Stop and ask

Ask before publishing if:

- the tracker or label/status workflow is unknown
- source requirements conflict or do not define observable outcomes
- issue boundaries require product/design decisions
- a slice cannot be verified independently
- the user has not approved the proposed breakdown

## Red flags

- horizontal tickets like “build database layer” with no user-verifiable path
- file-by-file implementation scripts masquerading as issues
- publishing before user approval
- marking a human-decision issue as AFK
- duplicating existing issues instead of linking or updating the breakdown

## Output

Return:

- approved issue list with AFK/HITL and dependencies
- tracker/location used
- issues created or drafts written
- parent links and labels/statuses applied
- unresolved decisions
