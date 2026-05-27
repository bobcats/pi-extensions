---
name: rust
description: Idiomatic Rust guidance for writing, reviewing, and refactoring Rust code. Use for Rust APIs, crates, CLIs, async/concurrency, errors, lifetimes, or code-quality audits.
metadata:
  bucket: languages
---

# Rust

Make invalid states unrepresentable and keep ownership explicit.

## Workflow

1. Read crate/module conventions and public API shape.
2. Prefer strong domain types, enums, and `Result` over sentinel values or panics.
3. Keep lifetimes simple; choose owned data when it materially reduces complexity.
4. Isolate I/O and side effects from pure transformation logic.
5. Add tests at public seams; use property/table tests where invariants matter.
6. Use project-native formatting, linting, and tests as evidence; broaden checks when public APIs, unsafe code, or async behavior changed.

## Guardrails

- Avoid `unwrap`, `expect`, and panics in non-test code unless justified at a hard boundary.
- Avoid global mutable state and hidden runtime initialization.
- Prefer `crate::` paths in non-test code; use re-exports intentionally.
- Do not fight the borrow checker with clones everywhere; revisit ownership shape.
- Keep async cancellation/error behavior explicit.

## Review checklist

- errors use appropriate types and preserve context
- public API exposes domain concepts, not storage details
- ownership and clone costs are intentional
- unsafe code is absent or tightly justified
- tests cover invalid states and edge cases

## Evidence

Before claiming completion, include evidence for formatting, lint/static checks when configured, focused behavior, and invalid-state/async/error paths when relevant.

## Stop and ask

Ask if API stability, ownership model, unsafe code, or async runtime assumptions are unclear.
