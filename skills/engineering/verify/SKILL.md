---
name: verify
description: Evidence gate before completion, fix, passing, merge, or PR claims. Use when about to say work is done, tests pass, a bug is fixed, requirements are met, or before committing/creating a PR.
metadata:
  bucket: engineering
---

# Verify

No completion claims without fresh evidence.

## Gate

Before claiming success:

1. **Identify the claim**
   - What exactly are you about to say is true?

2. **Choose proof**
   - tests for behavior
   - typecheck/lint/build for static and integration confidence
   - manual/browser/CLI flow for user-visible behavior
   - requirement checklist for spec completion

3. **Run fresh commands**
   - run the full relevant command, not a stale or partial result
   - read the output and exit code
   - if output is truncated or ambiguous, inspect enough to know the result

4. **Check clean state**
   - no debug prints or tagged instrumentation
   - no commented-out dead code
   - no skipped tests added to force green
   - no placeholder branches or untracked accidental files
   - no private transcripts, local eval cases, secrets, or generated artifacts staged by accident

5. **Check source-port completeness when relevant**
   - If porting/adapting existing material, compare source and target `SKILL.md`, `scripts/`, `references/`, `assets/`, executable bits, and links.
   - Run safe `--help` or smoke checks for copied scripts.
   - Report useful omissions as intentional, not accidental.

6. **Report evidence**
   - command(s) run
   - observed pass/fail counts or exit status
   - manual steps and observed outcome when applicable
   - gaps, if any

## If verification fails

Do not soften it into success language. State the actual status, the failing command, and the next needed action.

## Common claim mapping

- “Tests pass” requires test command output with zero failures.
- “Build works” requires build command exit 0.
- “Bug fixed” requires the original repro no longer reproduces and regression coverage or a documented seam gap.
- “Requirements met” requires checking each requirement, not just green tests.
- “Ready for PR” requires relevant tests plus clean diff/state.
- “Skill port complete” requires frontmatter/link checks plus a source/target support-file audit when adapted from an existing skill.

## Red flags

Stop if you are about to write:

- “should work”
- “looks good”
- “probably fixed”
- “done”
- “all set”
- “tests should pass”

Those phrases need evidence first.

## Output

Use this shape:

```markdown
Verification:
- `command`: observed result
- `command`: observed result
- Manual: steps and observed result

Status: pass/fail/partial, with gaps if partial.
```
