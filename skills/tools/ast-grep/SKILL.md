---
name: ast-grep
description: Structural code search and rewrite with ast-grep. Use when finding code by syntax structure or doing multi-file transformations where regex/sed would be unsafe.
metadata:
  bucket: tools
---

# ast-grep

Use AST structure when the change depends on syntax, nesting, names, or language constructs.

## Workflow

1. **Choose ast-grep when structure matters**
   - multi-file call/import/field/argument rewrites
   - finding patterns like “function call with option X”
   - avoiding regex matches inside strings/comments

2. **Identify language and pattern**
   - Use the project language parser (`--lang ts`, `--lang rust`, etc.).
   - Start with a narrow search pattern before rewriting.
   - For YAML rules, constraints, and advanced matching, read [the rule reference](references/rule_reference.md).

3. **Preview matches**
   ```bash
   ast-grep --lang <lang> -p '<pattern>' <path>
   ```
   - Inspect matches and false positives.
   - Refine with metavariables or rule YAML when needed.

4. **Rewrite only after preview**
   ```bash
   ast-grep --lang <lang> -p '<pattern>' -r '<replacement>' <path>
   ```
   - Prefer the smallest path scope that covers the intended files.
   - Review the diff before formatting.

5. **Verify**
   - Run formatter and relevant tests/typecheck.
   - Use `git diff` to inspect every transformed shape.

## Guardrails

- Do not use ast-grep when plain text search is clearer and no rewrite is needed.
- Do not run broad rewrites from repo root without first previewing matches.
- Avoid regex/sed for structural rewrites across code.
- If ast-grep cannot express the condition cleanly, write a small language-aware script or stop and ask.

## Output

Report pattern used, files touched, false positives considered, and verification run.
