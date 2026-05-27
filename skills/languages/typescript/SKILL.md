---
name: typescript
description: TypeScript guidance for type-safe implementation, review, and refactoring. Use when writing or reviewing TypeScript, APIs, generics, schemas, React code, or type migrations.
metadata:
  bucket: languages
---

# TypeScript

Use types to encode contracts and parse unknown data at boundaries.

## Workflow

1. Read project tsconfig, lint rules, and nearby type patterns.
2. Define domain types from behavior and data contracts, not implementation convenience.
3. Parse external input once at the boundary; keep internals typed.
4. Prefer discriminated unions for state variants and closed sets.
5. Use project-native type checks and focused tests as evidence after each behavior change.

## Guardrails

- Avoid `any`, double casts, `@ts-ignore`, and non-null assertions as shortcuts.
- Avoid weak `Record<string, unknown>` blobs once shape is known.
- Do not export internal helper types unless callers need them.
- Keep generics constrained and useful; do not genericize for aesthetics.
- Prefer `unknown` at trust boundaries, then narrow or parse.

## Review checklist

- impossible states are impossible or explicitly handled
- runtime validation exists where data crosses trust boundaries
- callback and event types reflect actual payloads
- async errors/loading states are represented
- tests cover semantic invalid cases as well as shape errors

## Evidence

Before claiming completion, include evidence for type safety, focused behavior, runtime boundary validation, and semantic invalid cases when relevant.

## Stop and ask

Ask if runtime data contracts, public API shape, or type-safety tradeoffs are unclear.
