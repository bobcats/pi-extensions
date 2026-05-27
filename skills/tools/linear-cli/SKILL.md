---
name: linear-cli
description: Manage Linear issues, projects, teams, comments, and cycles using `linear-cli`. Use when the user mentions Linear or identifiers like ENG-123.
metadata:
  bucket: tools
---

# Linear CLI

Use `linear-cli` for Linear. Choose supported output formats deliberately and use explicit identifiers.

## Output formats

Most data-producing commands support these output flags:

- `--json`: use for automation, multi-field reads, comments/relationships, or values that will drive follow-up commands.
- `--table`: use for quick human scans, list/status checks, and concise terminal review.
- `--markdown`: use when pasting issue/project/comment details into Markdown notes, PRs, or user-facing summaries.
- `--csv`: use for spreadsheet-style exports, bulk comparison, or handing tabular issue lists to another tool.

For create/update/comment commands, draft and preview plain text or Markdown body content before writing.

## Workflow

1. **Check installation/auth**
   ```bash
   command -v linear-cli
   linear-cli --help
   linear-cli auth status
   ```
   - If auth is missing, ask the user to authenticate.

2. **Read issue/project context**
   - Fetch by identifier (`ENG-123`) or URL.
   - Include comments and linked relationships when planning work.
   - Note team, status, assignee, labels, priority, cycle, and project.

3. **Use explicit write operations**
   - For create/update/comment, prepare the body first.
   - Ask before changing status, assignee, priority, due dates, or closing issues unless explicitly requested.

4. **Preserve tracker semantics**
   - Use existing team labels/statuses; do not invent workflow states.
   - Link related issues instead of duplicating context.

## Stop and ask

Ask if workspace/team is ambiguous, auth is missing, or the write would change ownership/status/priority unexpectedly.

## Output

Return issue IDs/URLs, fields read or changed, comments created, and unresolved tracker decisions.
