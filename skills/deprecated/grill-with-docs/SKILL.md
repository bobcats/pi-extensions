---
name: grill-with-docs
description: Deprecated. Replaced by grill-with-memory, which captures durable language as project-brain CONTEXT glossary notes and decisions as ADR-style decision notes.
metadata:
  bucket: engineering
---

# Grill With Docs

Deprecated. Use `grill-with-memory` for active work. This archived skill wrote `CONTEXT.md` and ADR files in the repo; the replacement keeps the same glossary and decision-record formats as project-brain memory notes.

Interrogate the plan until the domain language and tradeoffs are crisp. Ask one question at a time; explore the code instead when the answer is already there.

## Workflow

1. **Load domain context**
   - Look for `CONTEXT-MAP.md`, local `CONTEXT.md` files, and `docs/adr/`.
   - Read nearby code and tests for the area under discussion.
   - Do not create docs until a term or decision is actually resolved.

2. **Find pressure points**
   - Identify overloaded terms, hidden actors, ambiguous states, lifecycle transitions, invariants, and cross-context boundaries.
   - Compare user language with existing glossary terms and code behavior.
   - Surface contradictions immediately.

3. **Question one branch at a time**
   - Ask one concrete question.
   - Include your recommended answer and why.
   - Prefer scenario questions that force boundaries: edge cases, failures, permissions, timing, partial success, rollback, and ownership.
   - Wait for the user's answer before the next question.

4. **Capture language inline**
   - When a domain term is resolved, update the relevant `CONTEXT.md` immediately.
   - Keep `CONTEXT.md` as a domain glossary, not a spec, plan, or implementation notebook.
   - Use [the context format](references/context-format.md).

5. **Capture decisions sparingly**
   - Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real tradeoff.
   - If any condition is missing, record the decision in the session summary instead.
   - Use [the ADR format](references/adr-format.md).

6. **Finish with shared understanding**
   - Summarize resolved terminology, accepted decisions, rejected alternatives, open questions, and docs updated.
   - If implementation is ready, recommend `write-plan`; if uncertainty remains, name the next discovery step.

## Stop and ask

Ask before continuing if:

- the plan depends on product/domain decisions only the user can make
- existing docs and code disagree and neither source is clearly authoritative
- multiple bounded contexts use the same word differently
- a proposed ADR would encode a decision the user has not actually made
- the conversation has become implementation planning instead of domain clarification

## Red flags

- asking questions the code can answer
- batching ten questions at once
- writing implementation details into `CONTEXT.md`
- creating ADRs for routine choices
- smoothing over vocabulary conflicts
- treating a prototype or plan as domain truth without checking

## Output

Return:

- questions asked and answers resolved
- glossary terms added or changed
- ADRs created or proposed
- contradictions found between docs, user language, and code
- remaining decisions before `write-plan`
