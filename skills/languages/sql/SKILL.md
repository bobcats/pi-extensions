---
name: sql
description: SQL query guidance for correctness, indexes, performance, and review. Use when writing, reviewing, or optimizing SQL queries, migrations, reports, or data access code.
metadata:
  bucket: languages
---

# SQL

Write queries that are correct first, then measurable and index-friendly.

## Workflow

1. Identify the required result shape, cardinality, and null semantics.
2. Read schema, constraints, and existing indexes before writing query changes.
3. Prefer explicit columns, explicit joins, and named predicates.
4. Check query plans for non-trivial or high-volume paths.
5. Add tests/fixtures for semantic edge cases, not just happy-path rows.

## Guardrails

- Avoid `SELECT *` in application queries.
- Avoid leading-wildcard `LIKE` on large tables without a search index strategy.
- Avoid function-wrapping indexed columns in predicates unless indexed for it.
- Avoid unbounded queries in request paths.
- Be explicit about timezone, collation, nulls, and inclusive/exclusive ranges.

## Review checklist

- joins preserve intended cardinality
- filters match business semantics
- indexes support common predicates and ordering
- aggregation handles duplicates and missing rows correctly
- data-changing statements are transactional and scoped

## Evidence

Before claiming completion, include evidence for result correctness, semantic edge cases, affected indexes, and query plans for performance-sensitive paths when safe.

## Stop and ask

Ask before destructive changes, broad backfills, ambiguous business semantics, or production-impacting query plans.
