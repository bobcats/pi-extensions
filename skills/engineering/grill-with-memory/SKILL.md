---
name: grill-with-memory
description: Stress-test a plan against project memory, code reality, and domain language while capturing resolved terms as project-brain CONTEXT glossary notes and decisions as ADR-style decision notes. Use before planning or implementation when terminology, boundaries, tradeoffs, or prior context are unclear.
metadata:
  bucket: engineering
---

# Grill With Memory

Interrogate the plan until the domain language and tradeoffs are crisp. Ask one question at a time; explore memory and code instead when the answer is already there.

Durable capture belongs in the project-specific part of the active memory system, using CONTEXT formatting for glossaries and ADR formatting for decision records.

## Workflow

1. **Load domain context**
   - Inspect project memory for project-brain `CONTEXT-MAP` and `CONTEXT` notes and ADR-style decision notes.
   - Read nearby code and tests for the area under discussion.
   - Do not write to memory until a term or decision is actually resolved.

2. **Find pressure points**
   - Identify overloaded terms, hidden actors, ambiguous states, lifecycle transitions, invariants, and cross-context boundaries.
   - Compare user language with memory, docs, and code behavior.
   - Surface contradictions immediately.

3. **Question one branch at a time**
   - Ask one concrete question.
   - Include your recommended answer and why.
   - Prefer scenario questions that force boundaries: edge cases, failures, permissions, timing, partial success, rollback, and ownership.
   - Wait for the user's answer before the next question.

4. **Capture resolved knowledge in project memory**
   - When a domain term is resolved, update the relevant project-brain `CONTEXT` note, following `CONTEXT-MAP` when multiple contexts exist.
   - Keep context as a domain glossary, not a spec, plan, or implementation notebook.
   - Use [the context format](references/context-format.md).
   - After editing memory, use the available memory operation logger with a concise description of what changed.

5. **Capture decisions sparingly**
   - Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real tradeoff.
   - If any condition is missing, record the decision in the session summary instead.
   - Use [the ADR format](references/adr-format.md).
   - Add the ADR-style decision note to project memory.
   - After editing memory, use the available memory operation logger with a concise description of what changed.

6. **Finish with shared understanding**
   - Summarize resolved terminology, accepted decisions, rejected alternatives, open questions, and memory updated.
   - If implementation is ready, recommend `write-plan`; if uncertainty remains, name the next discovery step.


## Stop and ask

Ask before continuing if:

- the plan depends on product/domain decisions only the user can make
- existing memory and code disagree and neither source is clearly authoritative
- multiple bounded contexts use the same word differently
- a proposed ADR would encode a decision the user has not actually made
- the conversation has become implementation planning instead of domain clarification

## Red flags

- asking questions memory or code can answer
- batching ten questions at once
- writing implementation details into context
- creating ADRs for routine choices
- smoothing over vocabulary conflicts
- treating a prototype or plan as domain truth without checking

## Output

Return:

- questions asked and answers resolved
- glossary terms added or changed
- ADRs created or proposed
- contradictions found between memory, docs, user language, and code
- remaining decisions before `write-plan`
