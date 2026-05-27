---
name: fetch-ci-build
description: Fetch CI build results and diagnose failures across providers. Use when given a CI URL, failing check, branch, commit, or request to inspect GitHub Actions, Buildkite, or CircleCI results.
metadata:
  bucket: tools
---

# Fetch CI Build

Fetch the real CI failure before guessing. CI diagnosis starts with logs and exact failing commands.

## Workflow

1. **Detect provider**
   - URL or repo files: GitHub Actions (`.github/workflows`), Buildkite (`.buildkite`), CircleCI (`.circleci`).
   - For provider details, read the matching optional reference: `references/github.md`, `references/buildkite.md`, or `references/circleci.md`.

2. **Locate the failing run**
   - Identify branch, commit SHA, workflow/pipeline, job, and attempt.
   - If multiple failures exist, prioritize required checks and earliest root failure.

3. **Fetch actionable logs**
   - Use provider tools or bundled helpers: `scripts/fetch_buildkite_failures.py` and `scripts/fetch_circleci_failures.py`.
   - Capture job name, failing step, command, exit code, and error text.
   - Ignore downstream failures caused by the first failing build/test step unless relevant.

4. **Classify failure**
   - code/test failure
   - infrastructure/flaky failure
   - dependency/cache/environment failure
   - credentials/permission failure

5. **Recommend next action**
   - For code failures, point to the failing test/file and use `diagnose`.
   - For flakes, rerun only when evidence supports flakiness and policy allows it.

## Stop and ask

Ask if CI access is missing, logs contain secrets, rerun/cancel actions are needed, or the failing provider is unsupported.

## Output

Return provider, run/job URL, failing command, key log excerpt, classification, and next action.
