---
name: postgres
description: PostgreSQL-specific guidance for queries, indexes, migrations, constraints, and safe DDL. Use when working with PostgreSQL.
metadata:
  bucket: languages
---

# PostgreSQL

Use PostgreSQL features deliberately and make schema changes safe for live data.

## Workflow

1. Apply SQL fundamentals too: result shape, cardinality, null semantics, and index-aware predicates.
2. Inspect schema, constraints, indexes, row counts, and query plans.
3. Prefer database constraints for invariants that must survive all writers.
4. Design indexes from real predicates/orderings; measure with `EXPLAIN`.
5. For migrations, consider locks, table size, backfills, and rollback.

## Guardrails

- Use `CREATE INDEX CONCURRENTLY` for large live tables where framework supports it.
- Avoid long transactions around backfills or DDL.
- Add `NOT NULL` constraints safely: backfill, validate, then enforce.
- Use partial/expression indexes only when predicates match actual queries.
- Understand isolation and locking before adding `SELECT ... FOR UPDATE`.

## Review checklist

- constraints match application invariants
- indexes are not redundant and support observed queries
- migrations are safe under production load
- query plan uses expected indexes and cardinality estimates are sane
- JSONB, arrays, and enums are chosen intentionally

## Evidence

Before claiming completion, include evidence for query plans when performance matters, constraint behavior, migration safety, and lock/backfill assumptions.

## Stop and ask

Ask before table rewrites, large backfills, lock-prone DDL, or isolation/locking changes.
