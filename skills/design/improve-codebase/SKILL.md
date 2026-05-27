---
name: improve-codebase
description: Audit a codebase for evidence-backed architecture, refactoring, testability, type, dead-code, and performance improvement opportunities. Use when the user asks to improve architecture, reduce tech debt, find refactors, or make code easier to change.
metadata:
  bucket: design
---

# Improve Codebase

Find improvement opportunities; do not rewrite code during the audit. Good candidates improve locality, leverage, testability, deployability, or domain fit.

For architecture work, use the shared vocabulary in [architecture language](references/language.md): **module**, **interface**, **implementation**, **depth**, **seam**, **adapter**, **leverage**, and **locality**. Say **seam**, not “boundary,” unless discussing DDD bounded contexts.

## Workflow

1. **Scope the audit**
   - Identify the code area, product goal, recent pain, or feature pressure.
   - If scope is “the whole codebase,” ask for a subsystem or time box.
   - Read domain docs (`CONTEXT.md`, `CONTEXT-MAP.md`) and ADRs that govern the area.

2. **Explore for friction**
   - Trace real callers, tests, data flow, and operational edges.
   - Use relevant language/framework skills for idioms and anti-patterns.
   - Look for evidence of:
     - shallow pass-through modules
     - concepts scattered across many files
     - duplicated invariants or validation
     - seams with only one adapter and no real variation
     - hard-to-test behavior hidden behind implementation details
     - dead code, weak types, skipped tests, or happy-path-only coverage
     - performance cliffs such as N+1 queries, unbounded work, or hot allocations
   - For deepening audits, use [deepening guidance](references/deepening.md) to classify dependencies before recommending a seam.

3. **Apply the deletion test**
   - For a suspected module, imagine deleting it.
   - If complexity disappears, it may be pass-through code.
   - If complexity spreads into callers, the module is earning its keep.
   - The interface is the test surface; callers and tests should cross the same seam.
   - Do not propose a seam unless it concentrates complexity or has real variation.
   - One adapter means a hypothetical seam; two adapters means a real seam.

4. **Prioritize candidates**
   - Prefer improvements tied to current pain, upcoming work, production risk, or test gaps.
   - Avoid aesthetic churn and style-only refactors.
   - Mark ADR conflicts explicitly and only recommend reopening them when friction is real.

5. **Present options before implementation**
   - For each candidate include:
     - files/modules involved
     - evidence observed
     - problem and impact
     - proposed direction, not a full implementation
     - benefit to locality, leverage, tests, or performance
     - risk/effort
   - Use domain vocabulary from `CONTEXT.md` and architecture vocabulary from [architecture language](references/language.md).
   - Do not propose detailed interfaces yet unless the user asks to explore a selected candidate.
   - Ask which candidate to explore or plan.

6. **Move into the right next step**
   - For domain/interface uncertainty, use `grill-with-memory` when available; otherwise continue with one-question-at-a-time interrogation and capture terms/decisions here.
   - When exploring alternative interfaces for a chosen deepening candidate, use [interface design](references/interface-design.md).
   - If a deepened module needs a new domain term or the user rejects a candidate for a load-bearing reason, capture the term or decision through `grill-with-memory` when available; otherwise record it in the audit output.
   - For clear multi-step implementation, use `write-plan` when available; otherwise write an executable plan with required verification here.
   - For approved production changes, use `tdd`/`verify` when available; otherwise require a failing behavior check or regression test before changing behavior, then verify before claiming completion here.
   - When the user wants work split for agents or humans, use `to-issues` when available; otherwise turn candidates into independently verifiable issues here.

## Stop and ask

Ask before continuing if:

- the audit scope is too broad to inspect honestly
- evidence is too weak to distinguish taste from improvement
- a change would contradict an ADR or product decision
- the proposed work would be a rewrite rather than an incremental improvement
- the user wants implementation, not an audit

## Red flags

- proposing interfaces before understanding callers
- saying “boundary” when you mean seam
- creating abstractions for hypothetical future adapters
- refactoring because a name or pattern feels ugly
- ignoring domain vocabulary and ADRs
- mixing audit findings with unrequested code edits
- treating low test coverage as proof of bad design without tracing behavior

## Output

Return:

- prioritized findings
- evidence and exact locations
- recommended next workflow for each candidate
- risks and expected verification strategy
- items intentionally not recommended and why
