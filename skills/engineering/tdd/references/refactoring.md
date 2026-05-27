# Refactoring After Green

Use this after a RED/GREEN cycle passes. Never refactor while RED.

## Refactor candidates

Look for improvements the new behavior revealed:

- **Duplication** — extract a helper only when it clarifies the behavior or centralizes a real invariant.
- **Long methods** — split private helpers while keeping tests on the public interface.
- **Shallow modules** — combine pass-through code or deepen the module interface.
- **Feature envy** — move logic closer to the data or concept it actually belongs to.
- **Primitive obsession** — introduce a domain value or typed input shape when primitives obscure invariants.
- **Boundary leakage** — parse/normalize external input at the boundary instead of carrying raw shapes through internals.
- **Existing code friction** — fix touched-path issues that block the current behavior, but do not widen the patch into unrelated cleanup.

## Refactoring discipline

1. Confirm tests are green.
2. Make one refactor step.
3. Rerun the narrow tests.
4. Rerun surrounding tests if the seam or caller contract changed.
5. Stop if the refactor grows beyond the current unit of work.

## What not to do

- Do not add speculative extension points.
- Do not split cohesive behavior only to reduce line count.
- Do not introduce a port for a single adapter unless a real second adapter exists or the test adapter represents a genuine boundary.
- Do not update tests to mirror a new internal structure when observable behavior did not change.
- Do not mix unrelated style cleanup into the TDD commit.

## Output note

When reporting the cycle, distinguish production behavior from refactoring:

- behavior tested
- code added to pass it
- refactors made while green
- verification commands after refactoring
