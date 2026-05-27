---
name: semantic-commit
description: Create small Conventional Commit-style git commits with clean staged scope and evidence. Use when committing changes, splitting work into checkpoints, or writing a commit message.
metadata:
  bucket: engineering
---

# Semantic Commit

Commit one logical change with a useful semantic message. Do not hide unrelated work in the commit.

## Workflow

1. **Inspect state**
   ```bash
   git status --short
   git diff --stat
   git diff --cached --stat
   ```
   - If unrelated files are present, ask what to include or split the change.
   - If the tree contains someone else's changes, do not stage them without permission.

2. **Review the staged scope**
   - Stage only files for the completed checkpoint.
   - Read the staged diff before writing the message:
     ```bash
     git diff --cached
     ```
   - Remove debug prints, commented-out code, skipped tests, local paths, secrets, and generated noise.
   - Run noise checks against staged files where practical. If no code files are staged, say so instead of treating “No files were searched” as meaningful.
   - Classify debug-grep matches in staged scripts: remove debug noise, but keep intentional CLI/user output such as legitimate `print(...)` paths and mention they were reviewed.

3. **Confirm verification evidence**
   - Prefer a fresh test/lint/build/doc validation command for the committed scope.
   - If verification is not possible, say why in the final report; do not imply it passed.

4. **Choose the type**
   - `feat` — new user-visible capability
   - `fix` — user-visible bug fix
   - `docs` — documentation only
   - `test` — test additions or corrections
   - `refactor` — code change with no behavior change
   - `perf` — performance improvement
   - `build` — dependencies or build system
   - `ci` — CI configuration
   - `chore` — maintenance

5. **Write the message**
   - Format: `<type>[optional scope]: <imperative summary>`
   - Use a scope only when it clarifies the affected area.
   - Keep the subject specific and outcome-oriented.
   - Add a body only for rationale, risk, or non-obvious verification context.

6. **Commit and report**
   ```bash
   git commit -m "<type>: <summary>"
   ```
   - Report the commit SHA, message, included scope, and verification evidence.

## Stop and ask

Ask before committing if:

- staged and unstaged changes are mixed or unrelated
- verification failed or was not run and the user expected a clean checkpoint
- the commit would include secrets, private data, local transcripts, or generated artifacts
- the right type/scope is ambiguous because the change mixes concerns

## Good messages

- `feat: add triage skill`
- `fix(parser): handle empty session windows`
- `docs: document eval fixture privacy`
- `refactor: simplify skill validation script`

## Output

Return:

- commit SHA and message
- files included or logical scope
- verification command and observed result
- any remaining uncommitted changes
