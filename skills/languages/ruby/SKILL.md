---
name: ruby
description: Idiomatic Ruby guidance for writing, reviewing, and refactoring Ruby code. Use for Ruby services, scripts, tests, APIs, DSLs, or code-quality audits.
metadata:
  bucket: languages
---

# Ruby

Write explicit Ruby with clear object boundaries and behavior-focused tests.

## Workflow

1. Read nearby conventions for object shape, naming, errors, and tests.
2. Prefer small modules/classes with one reason to change.
3. Parse inputs at boundaries; do not pass option hashes through layers without structure.
4. Prefer behavior tests over testing private methods.
5. Use project-native tests and lint/static checks as evidence; broaden checks when public APIs or shared object boundaries changed.

## Guardrails

- Avoid metaprogramming in application code unless the project already relies on it and the win is real.
- Avoid `method_missing`, broad monkey patches, and hidden callbacks for core behavior.
- Do not rescue `StandardError` broadly without preserving/reporting the failure.
- Prefer keyword arguments or value objects over ambiguous positional booleans/options hashes.
- Keep mutation and side effects obvious.

## Review checklist

- public methods have clear inputs, outputs, and failure modes
- errors are domain-appropriate and debuggable
- tests cover unhappy paths and edge cases
- dependency injection is used for true seams, not ceremony
- names match domain language, not generic `Manager`/`Processor` sprawl

## Evidence

Before claiming completion, include evidence for focused behavior, syntax/static checks when configured, and edge cases around errors and mutation.

## Stop and ask

Ask if object ownership, domain terminology, or error behavior is unclear.
