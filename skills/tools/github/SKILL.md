---
name: github
description: Use GitHub through the `gh` CLI. Use for GitHub issues, PRs, reviews, checks, workflow runs, releases, and API queries.
metadata:
  bucket: tools
---

# GitHub

Use `gh` for GitHub operations. Prefer explicit repository scope and machine-readable output.

## Workflow

1. **Confirm context**
   ```bash
   gh auth status
   gh repo view --json nameWithOwner,url
   ```
   - Use `--repo owner/name` when not clearly inside the target repo.

2. **Read before writing**
   - Issues: `gh issue view <id> --comments --json ...`
   - PRs: `gh pr view <id> --comments --json ...`
   - Checks: `gh pr checks <id>` or `gh run view <run-id> --log-failed`

3. **Use JSON for automation**
   ```bash
   gh pr view <id> --json title,body,headRefName,baseRefName,reviewDecision,statusCheckRollup
   ```

4. **Write safely**
   - Use body files for long issue/PR/comment text.
   - Preview generated text before creating public artifacts.
   - Ask before closing issues, merging PRs, force-pushing, deleting branches, or changing repo settings.

## Common tasks

```bash
gh pr view <url-or-number> --comments
gh pr diff <number>
gh run list --branch <branch>
gh run view <run-id> --log-failed
gh api repos/:owner/:repo/pulls/<pr>/comments/<id>/replies -f body='...'
```

## Stop and ask

Ask when auth is missing, destructive actions are requested, or public comments need user voice/approval.

## Output

Return exact commands, URLs, IDs, and observed GitHub state.
