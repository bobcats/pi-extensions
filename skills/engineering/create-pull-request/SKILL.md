---
name: create-pull-request
description: Open or package a GitHub pull request with fresh verification, scoped diff review, safe body-file usage, and post-create validation. Use when the user explicitly asks to create, open, update, or prepare a PR.
metadata:
  bucket: engineering
---

# Create Pull Request

Verify first, then create a reviewer-ready PR. Existing branch work is not PR work unless the user asks for a PR.

## Preconditions

- Branch contains only in-scope changes.
- All required work is committed or intentionally left out.
- Relevant tests, lint, typecheck, build, or doc validation have fresh observed results.

## Workflow

1. **Confirm branch scope**
   ```bash
   git status --short
   BASE_REF=$(git symbolic-ref --quiet --short refs/remotes/upstream/HEAD 2>/dev/null || git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
   test -n "$BASE_REF" || { echo "No default remote base found; ask for explicit base"; exit 1; }
   BASE_BRANCH=${BASE_REF#*/}
   BASE_SHA=$(git merge-base HEAD "$BASE_REF")
   git diff --stat "$BASE_SHA"...HEAD
   git log --oneline "$BASE_SHA"..HEAD
   ```
   - If the PR should target a stacked or non-default base, replace `BASE_REF`/`BASE_BRANCH` with that explicit base.
   - If unrelated changes or commits are present, split them before opening the PR.

2. **Run verification now**
   - Use the repo's relevant test/lint/build commands.
   - Do not rely on old output from earlier in the session.
   - If verification fails, fix or report the blocker; do not create a ready PR.

3. **Build reviewer context**
   - Problem or motivation
   - Solution summary
   - Key files or behavior changed
   - Verification evidence
   - Risks, rollout notes, and follow-ups

4. **Draft title and body**
   - Title should be concise and semantic when useful: `feat: add eval harness`.
   - Always use a body file; never pass long Markdown through inline `--body`.

   ```bash
   cat > /tmp/pr-body.md <<'EOF'
   ## Summary
   -

   ## Problem
   -

   ## Solution
   -

   ## Verification
   - [ ] `<command>` — <observed result>

   ## Risks / Rollout
   -

   ## Follow-ups
   -
   EOF
   ```

5. **Create or update the PR**
   ```bash
   if gh pr view --json number,url,title,baseRefName >/tmp/current-pr.json 2>/dev/null; then
     gh pr edit --title "<title>" --body-file /tmp/pr-body.md
   else
     gh pr create --base "$BASE_BRANCH" --title "<title>" --body-file /tmp/pr-body.md
   fi
   ```
   Do not change an existing PR's base unless the user requested it or the confirmed scope requires it. Use `--draft`, labels, or reviewers only when requested or repo convention is clear.

6. **Validate the result**
   ```bash
   gh pr view --json url,number,title,state,headRefName,baseRefName
   gh pr checks
   ```
   Report the URL, checks state, verification evidence, and any reviewer risks.

## Stop and ask

Ask before continuing if:

- GitHub auth or repository identity is missing
- base branch is unclear
- verification fails and the user did not ask for a draft PR
- public comments or PR text need the user's voice/approval
- the branch contains unrelated work or private/local artifacts
- the user asks to merge, close, force-push, or alter repo settings

## Output

Report:

- PR URL and number
- base/head branches
- summary of scope
- verification commands and observed result
- checks state and follow-ups
