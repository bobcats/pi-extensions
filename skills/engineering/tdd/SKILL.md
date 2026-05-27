---
name: tdd
description: Test-driven development through public interfaces with a red-green-refactor loop. Use when implementing features, bug fixes, behavior changes, or when the user asks for TDD, test-first work, or red-green-refactor.
metadata:
  bucket: engineering
---

# TDD

Production behavior needs a failing test first. Tests should verify behavior through public interfaces, not implementation details. Use optional references when judgment is needed: [test shape](references/tests.md), [mocking](references/mocking.md), [interface design](references/interface-design.md), [deep modules](references/deep-modules.md), and [refactoring](references/refactoring.md).

## Before code

1. Search for similar tests and implementation patterns.
2. Identify the public interface or user-visible behavior.
3. If only implementation-detail tests seem possible, check [interface design](references/interface-design.md) before writing a shallow test.
4. List behaviors to cover in priority order.
5. If the interface or behavior is unclear, ask before writing code.

## Red-green-refactor loop

Work in vertical slices. Do not write all tests first and all implementation later.

For each behavior:

1. **RED** — write one focused test
   - name the behavior, not the method internals
   - use real code paths where practical
   - follow [test shape](references/tests.md) when choosing the seam
   - mock only slow or external edges; treat deep mocks as coupling feedback using [mocking](references/mocking.md)
   - structure Arrange / Act / Assert with clear separation

2. **Verify RED** — run the narrow test command
   - it must fail for the expected reason
   - if it passes, the test is wrong or behavior already exists
   - if it errors for setup/typos, fix the test and rerun until the failure is meaningful

3. **GREEN** — write the smallest production change
   - enough to pass this test only
   - no speculative options, refactors, or unrelated cleanup

4. **Verify GREEN** — run the test again
   - it must pass
   - run relevant surrounding tests when the change can affect them

5. **Refactor only while green**
   - improve names, remove duplication, deepen modules
   - use [deep modules](references/deep-modules.md) and [refactoring](references/refactoring.md) when test friction reveals design friction
   - run tests after each refactor step

Repeat for the next behavior.

## Bug fixes

For a bug, use the existing repro from `diagnose` or create one. The regression test must fail on the broken behavior before you change production code.

If there is no honest seam for a regression test, say so. Do not write a shallow test that cannot catch the real bug pattern.

## Stop and ask

Ask the user before continuing if:

- tests cannot run in the environment
- required behavior or public interface is ambiguous
- only implementation-detail tests seem possible
- the user explicitly wants throwaway prototype work instead of production code

## Red flags

- code before test
- test passes immediately
- mock assertions replace behavior assertions
- refactoring while red
- “I’ll add tests after”
- multiple behaviors in one test because it is faster

## Output

Report each cycle compactly:

- behavior tested
- RED command and observed failure
- GREEN command and observed pass
- refactors made, if any
- remaining untested seams or risks
