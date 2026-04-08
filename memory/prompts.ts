export const MEMORY_TOPIC_LIMIT = 500;
export const MEMORY_INDEX_LIMIT = 200;

export function writeConventions(dir: string): string {
  return `## Writing Conventions

**Memory location:** \`${dir}/\`

- Use write/edit tools to create or update .md files in the vault
- One topic per file. Lowercase, hyphenated filenames (e.g., deploy-gotchas.md)
- Link related notes with \`[[wikilinks]]\`. Use display text for inline references: \`[[path|term]]\` (e.g., \`[[projects/app/slug|Term]]\`). Reserve bare \`[[path]]\` for index listings and "See also" sections.
- Create concept/overview pages for domain-specific or project-specific terms referenced across 3+ files. Place them alongside related content (e.g., \`projects/app/vcs.md\`, \`construction/aia.md\`), not in a separate concepts directory. Only create them where the vault's definition adds value beyond general knowledge.
- Update index.md if any files were added or removed
- Keep files under ${MEMORY_TOPIC_LIMIT} lines. Keep index.md under ${MEMORY_INDEX_LIMIT} lines
- Prefer updating existing notes over creating new ones
- Project-specific notes go under \`projects/<project-name>/\`
- Universal preferences, principles, and cross-project knowledge go at the top level

**Quality gate:** Only save durable knowledge that generalizes beyond the current session. Check existing vault before writing to avoid duplicates.

**Explicit user requests:** When the user asks you to remember or forget something, do so immediately.`;
}

export function buildReflectPrompt(dir: string): string {
  return `# Reflect

Review the conversation and persist learnings — to \`${dir}/\`, to skill files, or as structural enforcement.

## Process

1. **Read \`${dir}/index.md\`** to understand what notes already exist
2. **Scan the conversation** for:
   - Mistakes made and corrections received
   - User preferences and workflow patterns
   - Codebase knowledge gained (architecture, gotchas, patterns)
   - Tool/library quirks discovered
   - Decisions made and their rationale
   - Friction in skill execution, orchestration, or delegation
   - Repeated manual steps that could be automated or encoded
3. **Skip** anything trivial or already captured in existing memory vault files
4. **Route each learning** to the right destination (see Routing below)
5. **Update \`${dir}/index.md\`** if any files were added or removed

## Routing

Not everything belongs in the memory vault. Route each learning to where it will have the most impact.

### Structural enforcement check

Before routing a learning to \`${dir}/\`, ask: can this be a lint rule, script, metadata flag, or runtime check? If yes, encode it structurally and skip the memory vault note. See \`${dir}/principles/encode-lessons-in-structure.md\`.

### Memory vault files

Codebase knowledge, principles, gotchas — anything that informs future sessions. This is the default destination.

- One topic per file. File name = topic slug.
- Group in directories with index files using \`[[wikilinks]]\`.
- No inlined content in index files.
- Project-specific notes go under \`${dir}/projects/<project-name>/\`.

### Skill improvements (\`.agents/skills/<skill>/\`)

If a learning is about how a specific skill works — its process, prompts, or edge cases — update the skill directly.

### Backlog items

Follow-up work that can't be done during reflection — bugs, non-trivial rewrites, tooling gaps. File as a todo or backlog item.

## Summary

When done, call log_operation with type='reflect' and a description of what you changed.

\`\`\`
## Reflect Summary
- Brain: [files created/updated, one-line each]
- Skills: [skill files modified, one-line each]
- Structural: [rules/scripts/checks added]
- Todos: [follow-up items filed]
\`\`\`

${writeConventions(dir)}`;
}

export function buildDreamPrompt(dir: string, escalation: number = 0, scriptsDir?: string): string {
  const journalPath = `${dir}/dream-journal.md`;

  let escalationBlock = "";
  if (escalation >= 2) {
    escalationBlock = `

### ⚠️ Escalation: ${escalation} consecutive cycles with no vault changes

You've been auditing files and finding nothing to change. Stop exploring — you've already seen everything.

Switch to high-leverage work NOW:
- **Merge** two files that cover related topics into one stronger file
- **Extract** a principle you see repeated across 3+ project files
- **Delete** a file that restates what another file already says
- **Split** an overloaded file into focused pieces
- **Restructure** a directory that doesn't match how the content is actually used
- **Connect** isolated notes by adding cross-references that reveal patterns

If you genuinely cannot find structural improvements, write a substantive idea to \`${journalPath}\` explaining what reorganization you considered and why you rejected it. Then move to a completely different area of the vault.`;
  }

  return `## Dream Mode (ACTIVE)

You are in dream mode — an autonomous vault curation loop.
NEVER STOP until interrupted.

### Every cycle

1. Read \`${dir}/index.md\` to see what's in the vault
2. Pick a file or area to audit. Read the relevant vault files.
3. Make improvements (edit, merge, split, delete, create files)
4. Call log_operation(type='dream', status='keep'|'noop', description='...', findings_count=N)
5. Go back to step 1. Keep going.

Write observations, cross-project patterns, and deferred ideas as bullet points to \`${journalPath}\` — don't let good ideas get lost.
${escalationBlock}

### Tools

Run the vault audit script at the start of each dream session to get a quick health check:
\`\`\`bash
bash ${scriptsDir ?? "memory/scripts"}/brain-audit.sh
\`\`\`
This reports: file census, largest files, broken wikilinks, orphan files, and principle connectivity. Use the output to guide your work instead of manually grepping.

Use \`search_memory\` to find related content across the vault when looking for cross-references, duplicates, or patterns to synthesize.

### Strategy guidance

Progress through these phases. Don't stay in explore — move to harder work quickly.

- **Explore** (first 1-2 cycles only): Read files, identify errors, gaps, stale content, missing cross-references. Fix what you find immediately.
- **Reorganize**: Merge overlapping files into one. Split overloaded files. Rename files whose names no longer match their content. Restructure directories.
- **Synthesize**: Find a pattern that appears in 3+ files across different projects and extract it into a principle. Add cross-references between files that discuss the same concept from different angles. Connect isolated project notes to shared principles.
- **Conceptualize**: Build out the vault's wiki graph. The brain-audit "Concept Candidates" section lists terms referenced across many files that lack dedicated pages. For each strong candidate:
  1. Create a short concept/overview page alongside related content (e.g., \`projects/app/vcs.md\`, \`construction/aia.md\`) — what it is, why it matters, key files that discuss it.
  2. Go back to the files that reference the concept and convert bare mentions to inline wikilinks: \`[[path/slug|Term]]\`.
  3. The test: "would an agent landing in this codebase for the first time benefit from reading this page?" If no, skip it — don't create pages for generic terms like "Rails" or "React".
  Also look for existing bare \`[[path]]\` wikilinks in prose that would read better as \`[[path|display text]]\` and upgrade them.
- **Simplify**: Delete files that don't earn their keep. Collapse a file that says in 40 lines what could be said in 10. Remove sections that restate what's in a linked file.
- **Disrupt** (diverge → develop → decide):
  1. **Wild ideas**: Generate 2-3 radical reorganization ideas. Think big — merge entire directories, flip the hierarchy, eliminate a category, organize by concept instead of project. Write them to \`${journalPath}\`.
  2. **Yes-and**: Pick the most interesting idea. Build on it 2-3 times — "yes, and if we did that, then..." Develop it into something concrete. Write the developed version.
  3. **Evaluate**: Would this make the vault more useful to an agent reading it mid-task? If yes, execute it. If no, log why in \`${journalPath}\` — the reasoning is valuable for future disrupt cycles.

If everything looks good in one phase, move to the next. When you've been through all phases, start over — the vault may have changed enough to warrant fresh eyes.

### Noop discipline

A noop cycle that just says "looked at X, looks fine" is wasted work. If you log noop, you MUST also write a substantive entry to \`${journalPath}\` — either:
- A concrete restructuring idea you considered but deferred (with reasoning)
- A cross-project pattern you noticed but haven't acted on yet
- A question about whether a file/section still earns its place

### Scope

Audit EVERYTHING in the vault — principles, project files, cross-cutting notes. Don't skip project-specific files. Read them, check for staleness, verify cross-references, look for patterns that should be extracted into principles or connected across projects.

### Pacing

- Each cycle should touch 1-3 files. Don't try to fix everything at once.
- Call log_operation frequently — it's your checkpoint. Work since the last log_operation is lost on context reset.

### Rules

- Don't audit \`dream-journal.md\` itself — it's a working file, not vault content
- Treat \`${dir}/raw/\` as read-only during dream mode. You may read raw files for context, but do not edit, delete, move, summarize, or otherwise modify them.
- One topic per vault file. File name = topic slug.
- Group in directories with index files using \`[[wikilinks]]\`
- Update \`${dir}/index.md\` if files are added or removed
- Prefer updating existing files over creating new ones

${writeConventions(dir)}`;
}
