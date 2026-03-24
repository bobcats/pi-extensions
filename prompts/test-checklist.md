---
description: Audit branch test changes for production value, then review each case one-by-one
---
Audit all tests added or changed on this branch for production value.

## Scope

- Review only tests added/changed in this branch (diff against `origin/main`, fall back to `main`/`master`)
- Include changed test cases inside existing files, not just new files
- Do not review untouched tests

## Classification

- **✅ Keep** — production-grade behavior/contract coverage worth long-term maintenance
- **⚠️ Rewrite** — valid intent, but fragile/implementation-coupled test design
- **❌ Remove** — no production value (TDD scaffold, redundant, noise)

## Evaluation Criteria

For each changed test case:
1. **Behavior focus** — validates observable behavior, not incidental internals
2. **Production relevance** — covers realistic regression risk
3. **Determinism** — no flaky assumptions (time, ordering, network)
4. **Maintainability** — non-redundant, clear purpose, worth owning
5. **Assertion quality** — precise, meaningful failure signal

**Tie-breaks:** Uncertain between ✅ and ⚠️ → choose ⚠️. Between ⚠️ and ❌ → choose ⚠️ only if a concrete rewrite exists.

## Phase 1: Report

1. Summary counts: total / ✅ keep / ⚠️ rewrite / ❌ remove
2. Checklist by file — one line per test: `[status] test name — rationale`
3. For each ⚠️: concrete rewrite suggestion
4. For each ❌: deletion recommendation
5. Branch verdict: 1-3 sentence quality assessment

## Phase 2: Interactive Review

After the report, walk through each test one at a time:
- Case number (e.g. `Case 3/17`)
- File + test name
- Classification + 1-2 sentence rationale
- Proposed action
- Prompt: `Approve or change?`

Wait for my response before proceeding. Continue until all cases are reviewed.
