---
name: create-branch
description: Create a git branch from a fresh remote base with safe naming and upstream tracking. Use when starting new work, splitting work into a branch, or preparing a branch for a PR.
metadata:
  bucket: engineering
---

# Create Branch

Branch from a remote ref, not stale local `main`. First push sets upstream to the new branch.

## Workflow

1. **Preflight**
   ```bash
   git status --short
   ```
   - If the tree is dirty, stop and ask whether to commit, stash, or include the changes.
   - Stop if a merge, rebase, cherry-pick, or revert is in progress.

2. **Fetch and choose the base**
   ```bash
   git fetch --all --prune
   ```
   - Use the user's requested base for release branches or stacked work.
   - Otherwise resolve the remote default branch, preferring `upstream/HEAD` then `origin/HEAD`.
   - If no remote default exists, ask for the base.

3. **Name the branch**
   - Preferred: `<type>/<ticket>-<slug>` or `<type>/<slug>`.
   - Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`.
   - Use lowercase kebab-case and a short outcome-oriented slug.

4. **Check for collisions**
   ```bash
   git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"
   git ls-remote --exit-code --heads "$PUSH_REMOTE" "$BRANCH_NAME"
   ```
   - If local or remote branch already exists, stop and ask whether to reuse it or choose a new name.

5. **Create without tracking the base**
   ```bash
   git checkout -b "$BRANCH_NAME" --no-track "$BASE"
   ```
   `--no-track` prevents the new branch from accidentally tracking `origin/main` before first push.

6. **Set upstream on first push**
   ```bash
   git push -u "$PUSH_REMOTE" HEAD
   git status -sb
   git branch -vv
   git rev-parse --abbrev-ref --symbolic-full-name @{u}
   ```

## Base resolution snippet

```bash
if BASE=$(git symbolic-ref --quiet --short refs/remotes/upstream/HEAD 2>/dev/null); then
  :
elif BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
  :
else
  echo "Could not determine remote default branch; ask for explicit base." >&2
  exit 1
fi
PUSH_REMOTE=$(git config --get remote.pushDefault || echo origin)
```

## Stop and ask

Ask before continuing if:

- uncommitted changes are present
- the target base is unclear
- branch name collisions exist
- remote auth or push permissions fail
- the user asks for force-push, deletion, or history rewriting

## Output

Report:

- branch name
- base ref and commit
- push remote and upstream ref
- verification commands and observed tracking state
