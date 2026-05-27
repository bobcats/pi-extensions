---
name: buildkite-cli
description: Manage and inspect Buildkite with the `bk` CLI. Use for Buildkite pipelines, builds, jobs, logs, artifacts, agents, annotations, and CI failure diagnosis.
metadata:
  bucket: tools
---

# Buildkite CLI

Use `bk` for Buildkite tasks. Discover the installed CLI shape before assuming flags.

## Workflow

1. **Check access and command shape**
   ```bash
   command -v bk
   bk --help
   bk --version
   ```
   - If unauthenticated, ask the user to authenticate or provide a token through the approved workflow.

2. **Identify scope**
   - organization, pipeline, build number/URL, branch, commit, job, or artifact.
   - Prefer URLs from the user when available.

3. **Inspect before acting**
   - List builds/jobs and fetch failing logs/annotations first.
   - For failures, capture job name, command, exit code, and the first actionable error.

4. **Take write actions carefully**
   - Ask before triggering/retrying/canceling builds unless the user explicitly requested it.
   - Use dry-run or confirmation flags when the CLI supports them.

5. **Report evidence**
   - Link build/job, summarize failure, and include exact command output snippets.

## Stop and ask

Ask before mutating pipelines, canceling/retrying expensive builds, changing agents, or exposing secrets/logs.

## Output

Return commands run, build/job URLs, failure root clue, and next action.
