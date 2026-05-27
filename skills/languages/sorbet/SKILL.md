---
name: sorbet
description: Sorbet guidance for typed Ruby code. Use when writing, reviewing, or refactoring Ruby with `sig`, `T::Struct`, `T::Enum`, RBI files, or type-safety migrations.
metadata:
  bucket: languages
---

# Sorbet

Use Sorbet to encode real contracts, not to decorate unsafe Ruby. Keep runtime Ruby behavior and tests in view.

## Workflow

1. Check the file strictness and nearby typed patterns.
2. Prefer precise signatures at public seams and boundary parsers.
3. Replace repeated hashes with `T::Struct`/value objects when shape matters.
4. Use `T::Enum` or domain types for closed sets.
5. Use typecheck and focused runtime tests as evidence after changes.

## Guardrails

- Avoid `T.untyped`, `T.unsafe`, broad `T.any`, and `T.cast` except at narrow documented interop boundaries.
- Do not raise strictness without fixing the real errors.
- Do not model dynamic shapes with weak hashes when the shape is stable.
- Keep nilability honest; parse once instead of sprinkling `T.must`.
- RBI changes must match runtime behavior.

## Review checklist

- signatures capture nilability and failure modes
- type escapes are isolated and justified
- structs/enums improve domain clarity rather than adding ceremony
- tests still cover runtime behavior, not just typecheck

## Evidence

Before claiming completion, include evidence for typecheck, focused runtime behavior, RBI/runtime agreement, and nilability or boundary parsing when relevant.

## Stop and ask

Ask if runtime shape, strictness target, or RBI ownership is unclear.
