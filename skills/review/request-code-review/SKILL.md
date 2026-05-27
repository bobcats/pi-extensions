---
name: request-code-review
description: Request a focused code review with clean scope and evidence. Use after completing a task, before merge/PR, when a plan calls for review, or when you need a fresh reviewer on a diff, branch, PR, or artifact.
metadata:
  bucket: review
---

# Request Code Review

Ask for review with scoped context, not a transcript dump. The reviewer needs the work product, requirements, and risk focus.

## Workflow

1. **Define the review target**
   - Identify the artifact: diff, commit range, branch, PR, files, plan, or spec.
   - Identify the expected behavior or requirements.
   - Identify the review focus: correctness, security, performance, tests, design, operations, or spec conformance.

2. **Prepare evidence**
   - Get a clean git range when reviewing code. Use the explicit PR/range base when provided; otherwise resolve the remote default branch:
     ```bash
     BASE_REF=$(git symbolic-ref --quiet --short refs/remotes/upstream/HEAD 2>/dev/null || git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)
     test -n "$BASE_REF" || { echo "No default remote base found; ask for explicit base"; exit 1; }
     BASE_SHA=$(git merge-base HEAD "$BASE_REF")
     HEAD_SHA=$(git rev-parse HEAD)
     ```
   - Do not fall back to `HEAD~1`; that silently under-scopes multi-commit branches.
   - Run or collect the relevant verification command output if available.
   - Check that unrelated local changes are not mixed into the review scope.

3. **Dispatch the reviewer**
   - Provide only the scoped context:
     - what changed
     - what it should do
     - git range or artifact paths
     - relevant plan/spec path
     - verification already run
     - specific risks to inspect
   - Prefer a dedicated reviewer/subagent when available; otherwise ask the current agent to use `code-review` on the same scope.

4. **Handle results**
   - Treat review feedback as input, not orders.
   - Use `respond-to-review` when available; otherwise classify findings, verify them against code reality, fix valid issues, and push back with evidence here.
   - Do not continue planned implementation past serious review findings unless the user explicitly accepts the risk.

## Dispatch shape

```text
Review <artifact>. Compare against <plan/spec/requirements>. Scope: <git range or paths>. Summary: <brief change summary>. Verification: <commands/results>. Focus: <risk areas>.
```

## Stop and ask

Ask before requesting review if:

- there is no stable artifact or diff to review
- requirements are unavailable and review would be pure guesswork
- the diff includes unrelated work that should be split first
- secrets, private data, or production-only context would be exposed to an external reviewer
- the user wants immediate fixes rather than review findings

## Red flags

- sending the whole session transcript as review context
- asking for review without a git range, file list, or artifact path
- hiding failing verification output
- treating low-confidence reviewer feedback as fact without checking code
- using review as a replacement for running tests

## Output

Return:

- reviewer or review mode used
- scope/range reviewed
- context supplied
- verification supplied
- next action for feedback
