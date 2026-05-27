---
name: go
description: Idiomatic Go guidance for writing, reviewing, and refactoring Go code. Use for Go APIs, packages, tests, errors, concurrency, performance, or code-quality audits.
metadata:
  bucket: languages
---

# Go

Keep Go simple, explicit, and boring. Prefer clear data flow over clever abstractions.

## Workflow

1. Read nearby package conventions before editing.
2. Keep package APIs small; unexport unless callers need it.
3. Return errors with context; do not panic outside tests, `main`, or truly unrecoverable programmer errors.
4. Pass `context.Context` as the first argument for request-scoped cancellation, deadlines, and values.
5. Prefer table-driven tests through public behavior; keep fixtures plain.
6. Use project-native formatting and tests as evidence; broaden checks when public APIs, concurrency, or performance changed.

## Guardrails

- Avoid package-level mutable state.
- Avoid interface definitions until there are multiple implementations or a real seam.
- Do not ignore errors with `_` unless deliberately documented.
- Prefer composition over inheritance-like embedding for behavior reuse.
- Use goroutines only with a clear owner, cancellation path, and error path.
- Keep channels for synchronization/ownership transfer; do not use them as generic queues by habit.

## Review checklist

- exported names have useful comments when public API
- errors preserve enough context for diagnosis
- tests cover failure and edge cases, not only happy paths
- race/concurrency paths have cancellation and cleanup
- allocations or reflection are justified in hot paths

## Evidence

Before claiming completion, include evidence for formatting, focused behavior, affected packages, and race/concurrency paths when relevant.

## Stop and ask

Ask if API ownership, concurrency semantics, compatibility, or error behavior is ambiguous.
