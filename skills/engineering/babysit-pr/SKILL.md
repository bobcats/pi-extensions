---
name: babysit-pr
description: Continuously monitor a GitHub pull request for CI, review comments, mergeability, and blockers until it is merged/closed or user help is required. Use when asked to watch, monitor, babysit, or keep an eye on an open PR.
metadata:
  bucket: engineering
---

# Babysit PR

Stay with the PR. A green snapshot is progress, not a stop condition while the PR remains open.

## Workflow

1. **Resolve the PR**
   - Accept a PR URL, number, or infer from the current branch.
   - Confirm GitHub auth and repository context.
   - Work only on the PR head branch.

2. **Start monitoring**
   - Prefer continuous watch for real babysitting:
     ```bash
     python3 scripts/gh_pr_watch.py --pr auto --watch
     ```
   - Use one-shot mode only for diagnostics:
     ```bash
     python3 scripts/gh_pr_watch.py --pr auto --once
     ```

3. **Handle each snapshot**
   - Check first whether the PR is merged or closed.
   - Inspect review comments, CI actions, and mergeability before acting.
   - Prioritize actionable review feedback over rerunning stale checks; a review-fix push will retrigger CI.

4. **Act safely**
   - For branch-related CI failures: inspect failed logs, patch the root cause, verify, commit, push, then keep watching.
   - For likely flakes: retry failed checks only when the watcher recommends it and retry budget remains.
   - For valid review feedback: patch, verify, commit, push, resolve the thread, then keep watching.
   - For non-actionable or invalid review feedback from another author: reply once with an `[agent]` prefix and evidence.

5. **Continue until a strict stop**
   - Stop only when the PR is merged/closed or a user-help-required blocker appears.
   - Keep watching while checks are pending, mergeability is unknown, review approval is pending, or the PR is green but still open.

## References

- CI and review heuristics: `references/heuristics.md`
- GitHub API notes: `references/github-api-notes.md`
- Watcher script: `scripts/gh_pr_watch.py`

## Stop and ask

Ask before continuing if:

- GitHub auth, permissions, or repository identity are missing
- unrelated local changes are present
- review feedback is ambiguous or requires product judgment
- CI failure looks like infrastructure after retry budget is exhausted
- resolving a comment, posting publicly, merging, closing, or force-pushing would exceed the user's instructions

## Output

During monitoring, report only status changes and useful heartbeats. Final output includes:

- PR URL and final SHA
- CI summary and retry count
- mergeability / conflict state
- review comments handled
- fixes pushed
- blocker or terminal state
