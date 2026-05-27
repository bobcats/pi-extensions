---
name: code-review
description: Produce evidence-backed code review findings for diffs, PRs, branches, or code areas. Use when reviewing code, self-reviewing before merge/PR, checking spec conformance, or evaluating standards, safety, security, performance, tests, and maintainability.
metadata:
  bucket: review
---

# Code Review

Review to find issues, not to fix them. Do not edit code unless the user asks for fixes.

## Scope first

Identify what you are reviewing:

- diff, branch, PR, commit range, or specific files
- expected behavior/spec, if available
- project standards or relevant skill guidance
- risk focus requested by the user

For branch reviews, use the explicit PR/range base when provided. Otherwise resolve the remote default branch and diff from its merge-base:

```bash
BASE_REF=$(git symbolic-ref --quiet --short refs/remotes/upstream/HEAD 2>/dev/null || git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
test -n "$BASE_REF" || { echo "No default remote base found; ask for explicit base"; exit 1; }
BASE_SHA=$(git merge-base HEAD "$BASE_REF")
git diff "$BASE_SHA"...HEAD
```

## Review workflow

1. Read the diff and surrounding code.
2. Trace changed data/control flow through callers, tests, config, and migrations as needed.
3. Compare with nearby established patterns.
4. Check spec conformance: does the change implement the requested behavior and omit forbidden behavior?
5. Check standards conformance: does it follow project language/framework/test conventions?
6. Produce every concrete finding with evidence. Do not stop at the first serious issue.

## Finding standard

A finding must include:

- severity
- exact file/line/function location
- observed code behavior
- concrete impact
- actionable fix or next diagnostic step

Distinguish evidence from suspicion. If you cannot tie a concern to code, either investigate more or label it as an observation.

## Severity labels

- **P0 Blocker** — data loss, security breach, or hard production failure.
- **P1 Critical** — likely user-visible failure, race, missing validation, or serious operational risk.
- **P2 Important** — maintainability, scale, test, observability, or design issue worth addressing.
- **P3 Minor** — clarity, docs, naming, small consistency, or local cleanup.
- **P4 Observation** — question, trade-off, or non-blocking pattern worth noting.

## Review axes

Check the axes relevant to the change:

- correctness, invariants, edge cases, idempotency, concurrency
- security, authorization, tenant isolation, secrets, injection, privacy
- performance, unbounded work, N+1 queries, indexes, memory/CPU cliffs
- operations, logging, metrics, rollback, retries, timeouts, feature flags
- tests, determinism, regression coverage, fixture realism, assertion quality
- design, boundaries, naming, coupling, consistency, future change cost

For skill reviews, also check:

- behavior-shaping trigger, not generic advice
- standalone usability with local fallback for related-skill routing
- small loaded core; long commands/examples/provider details moved to `references/`
- scripts/references/assets copied or intentionally omitted when porting
- explicit stop/ask and evidence gates

## Output

Use this format:

```markdown
Summary:
- P0: 0
- P1: 0
- P2: 0
- P3: 0
- P4: 0

Findings:

**P1 - short title**
- Location: `path/file.ext:123`
- Evidence: what the code does
- Impact: why it matters
- Fix: concrete change or diagnostic step
- Effort: Quick/Short/Medium/Large
```

If there are no findings, say so and summarize what you checked.

## Stop and ask

Ask before reviewing if:

- there is no stable artifact, diff, range, PR, file list, or code area
- the requested spec/requirements review lacks requirements to compare against
- the base branch or review range is unclear and cannot be resolved safely
- the review would require secrets, private data, or unavailable production-only context
- the user actually wants fixes rather than findings

## Guardrails

- No hypothetical findings without code evidence.
- No shipping decision; the reader decides.
- No external research until local context is understood.
- No drive-by rewrites during review.
- Minor findings are valid; include them if they are real.
