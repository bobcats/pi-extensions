---
name: diagnose
description: Disciplined diagnosis loop for bugs, failing tests, unexpected behavior, and performance regressions. Use when debugging, reproducing a reported problem, investigating broken behavior, or before proposing fixes for failures.
metadata:
  bucket: engineering
---

# Diagnose

No fixes before root cause. The feedback loop is the speed limit: build one, reproduce, hypothesize, instrument, then fix.

## Workflow

1. **Build the feedback loop first**
   - Prefer a failing test at the real seam.
   - Otherwise use a script, curl request, CLI invocation, browser check, trace replay, or minimal harness.
   - For hard or flaky repros, use the loop menu in [feedback loops](references/feedback-loops.md).
   - For flakes, raise the reproduction rate with loops, stress, fixed seeds, or timing control.
   - If no loop is possible, stop and ask for access, logs, HAR/core dumps, screenshots with timestamps, or permission for temporary instrumentation.

2. **Reproduce the user's symptom**
   - Run the loop and capture the exact failure: message, wrong output, timing, or visible behavior.
   - Confirm it is the same bug, not a nearby failure.
   - Check recent changes and similar working examples before guessing.

3. **Rank hypotheses before testing**
   - Write 3-5 falsifiable hypotheses.
   - Format: “If X is the cause, then Y probe/change will show Z.”
   - Share the list when useful; proceed with your ranking if the user is unavailable.

4. **Instrument one prediction at a time**
   - Use debugger/REPL first when available.
   - Otherwise add targeted logs at boundaries that distinguish hypotheses.
   - Tag temporary logs with a unique prefix like `[DEBUG-a4f2]` so cleanup is grep-able.
   - For performance, measure with a baseline/profiler/query plan before changing code.

5. **Fix the root cause**
   - Turn the minimized repro into a failing regression test when a correct seam exists.
   - Watch it fail for the expected reason.
   - Apply the smallest root-cause fix.
   - Watch the regression test pass and rerun the original feedback loop.

6. **Clean up and report**
   - Remove all debug instrumentation and throwaway harnesses.
   - State the confirmed root cause, evidence, fix, and verification command/output.
   - If no correct test seam exists, document that architectural gap.

## Circuit breakers

Stop and reassess when:

- you are about to try a fix without a reproduced symptom
- a hypothesis has no falsifiable prediction
- two fix attempts failed; do not attempt a third without re-investigating
- three attempts failed or fixes reveal new coupling each time; discuss architecture instead of patching symptoms

## Output

Report:

- feedback loop used
- reproduced symptom
- confirmed root cause
- fix made or reason you stopped
- regression coverage or seam gap
- verification evidence
