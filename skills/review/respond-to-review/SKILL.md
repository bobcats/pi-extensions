---
name: respond-to-review
description: Triage and act on code review feedback with verification. Use when receiving human, reviewer, PR, or subagent feedback before accepting, rejecting, implementing, or replying to review comments.
metadata:
  bucket: review
---

# Respond to Review

Review feedback is evidence to evaluate, not a command queue. Verify before changing code.

## Workflow

1. **Read and classify**
   - Read all feedback before responding.
   - Identify source and intent: analysis-only, implement-now, PR reply, or unclear.
   - Classify each item: valid, likely valid, unclear, duplicate, out of scope, or probably wrong.

2. **Clarify before partial action**
   - If any required item is unclear, ask before implementing related work.
   - If the user gave an explicit ordered list, do not silently skip unknown items.
   - If intent is ambiguous, ask whether they want triage only or implementation.

3. **Verify against code reality**
   - Inspect the exact code, tests, docs, and requirements the feedback references.
   - Check whether the suggestion breaks existing behavior, violates constraints, or conflicts with prior decisions.
   - For “do it properly” suggestions, confirm the feature is actually used before adding machinery.

4. **Choose the response**
   - Accept valid feedback and state the concrete change to make.
   - Push back on wrong or risky feedback with code-backed reasoning.
   - Defer out-of-scope improvements explicitly instead of smuggling them into the current change.
   - Escalate architectural conflicts or product decisions to the user.

5. **Implement one item at a time when asked**
   - Fix blocking issues first, then small safe fixes, then complex changes.
   - Use `tdd` when available for behavior changes; otherwise create or reuse a failing behavior check/regression test before changing code here.
   - Run verification after each fix or coherent batch.
   - For multi-step work, use `write-plan`/`execute-plan` when available; otherwise write an explicit executable plan instead of improvising here.

6. **Reply with evidence**
   - Summarize what changed, where, and how it was verified.
   - If pushing back, cite the code path, test, requirement, or compatibility constraint.
   - Avoid performative agreement; use technical acknowledgment and observed facts.

## Stop and ask

Ask before continuing if:

- feedback is ambiguous and could change implementation direction
- reviewer advice conflicts with user requirements or previous architecture decisions
- you cannot verify the claim without missing access, fixtures, credentials, or production data
- the requested fix would expand scope beyond the current task
- review asks for destructive data changes or risky migrations

## Red flags

- “You are right” before checking the code
- implementing every suggestion because it came from a reviewer
- fixing clear items while ignoring unclear related items
- batching review fixes without tests
- arguing from preference instead of evidence
- replying to PR comments at the wrong level instead of the original thread

## Output

Return:

- triage for each feedback item
- accepted fixes and rejected/deferred items with reasons
- files changed, if any
- verification commands/results
- review replies or recommended replies
