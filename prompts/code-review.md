---
description: Run code review with language-specific skills loaded
---
Review the changes on this branch using the diff against the merge base with main:

```bash
git diff $(git merge-base HEAD origin/main)..HEAD
```

Be careful to review only the changes that the branch is introducing. Check main and origin/main to be sure you're reviewing the right changes.

Focus on: $@

Before reviewing, load the relevant skills:
1. Load the `code-review` skill and follow its instructions.
2. Identify which languages are used in the files being reviewed (e.g., TypeScript, Python, Go, Ruby, Rust) and load the matching language skill for each one.
3. Apply both the code-review process and the language-specific patterns/anti-patterns during your review.
