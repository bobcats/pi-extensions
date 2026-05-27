---
name: write-docs
description: Write or revise README files, guides, API docs, architecture docs, changelogs, and contributor docs with verified examples and links. Use when documenting behavior, setup, architecture, workflows, or user-facing instructions.
metadata:
  bucket: productivity
---

# Write Docs

Documentation must be useful and true. Verify examples and commands before claiming the docs are complete.

## Workflow

1. **Identify the audience and artifact**
   - README, guide, API reference, architecture note, changelog, contributor doc, or runbook.
   - New developer, maintainer, operator, user, reviewer, or future agent.
   - Success criterion: what the reader can do after reading.

2. **Inspect reality first**
   - Read existing docs and follow their structure/style.
   - Read the code, config, tests, commands, API routes, schemas, or workflows being documented.
   - Do not invent commands, flags, paths, env vars, response shapes, or labels.

3. **Choose the location**
   - Follow existing repo conventions over defaults.
   - README belongs at repo root unless updating a package/subsystem README.
   - Architecture/design docs usually belong under `docs/`, `docs/design/`, or the existing equivalent.
   - Keep private/local setup details out of committed docs.

4. **Write for action**
   - Start with what the doc is for.
   - Prefer short sections, concrete commands, and observable outcomes.
   - Use tables only when they improve scanning.
   - Link to primary references instead of duplicating long details.
   - Mark limitations and prerequisites explicitly.

5. **Verify the doc**
   - Run every command or code example that can be run locally.
   - Check internal links and referenced file paths.
   - For API docs, compare examples to real routes/schemas or a running service when available.
   - For architecture docs, verify component names and data flow against code.
   - If something cannot be verified, label it as unverified and explain why.

## Stop and ask

Ask before continuing if:

- the intended audience or doc type is unclear
- documenting truth requires access to a service, secret, or environment you do not have
- existing docs contradict code or each other
- commands would mutate production, publish artifacts, or perform destructive operations
- the user expects marketing/product voice you cannot infer safely

## Output

Report:

- docs created or changed
- source files or systems checked for accuracy
- commands/examples/links verified with observed results
- anything intentionally left unverified
