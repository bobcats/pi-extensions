import * as os from "node:os";
import * as path from "node:path";

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

Codebase knowledge, principles, gotchas — anything that informs future sessions. This is the default destination. Use the memory vault skill for writing conventions.

- One topic per file. File name = topic slug.
- Group in directories with index files using \`[[wikilinks]]\`.
- No inlined content in index files.
- Project-specific notes go under \`${dir}/projects/<project-name>/\`.

### Skill improvements (\`.agents/skills/<skill>/\`)

If a learning is about how a specific skill works — its process, prompts, or edge cases — update the skill directly.

### Backlog items

Follow-up work that can't be done during reflection — bugs, non-trivial rewrites, tooling gaps. File as a todo or backlog item.

## Summary

\`\`\`
## Reflect Summary
- Brain: [files created/updated, one-line each]
- Skills: [skill files modified, one-line each]
- Structural: [rules/scripts/checks added]
- Todos: [follow-up items filed]
\`\`\``;
}

export function buildMeditateApplyPrompt(
  auditReport: string,
  reviewReport: string,
  dir: string,
): string {
  return `# Meditate Apply Handoff

Read the reports below and prepare concrete vault updates.

## Inputs

### Audit Report
${auditReport || "(no audit report)"}

### Review Report
${reviewReport || "(no review report)"}

## Apply workflow

1. Propose concrete edits to memory vault files under \`${dir}/\`.
2. Identify adds/updates/deletes and explain each change briefly.
3. Ask for approval if there are any destructive changes or uncertain merges.
4. Apply approved changes directly to vault files.
5. Update \`${dir}/index.md\` if files were added or removed.

Apply approved changes directly and keep edits scoped to findings with clear evidence.
`;
}

export function buildRuminateApplyPrompt(
  minerOutputs: string[],
  dir: string,
): string {
  const findings = minerOutputs
    .map((output, i) => `### Batch ${i + 1}\n\n${output}`)
    .join("\n\n");

  return `# Ruminate Findings

Review the raw findings below from mining past conversations. Deduplicate, filter, and present them to the user.

## Raw Miner Outputs

${findings || "(no findings)"}

## Apply workflow

1. Read all findings across batches. Deduplicate semantically — merge findings that describe the same insight in different words.
2. Filter by frequency and impact. Prefer recurring patterns over one-offs. Discard aggressively — 3 high-signal findings beats 9 with noise.
3. Present a consolidated table to the user with columns: finding, frequency/evidence, proposed action. Be honest about which are one-offs vs. recurring patterns.
4. Ask which findings the user wants to persist.
5. Route each approved finding:
   - **Memory vault**: Create or update files under \`${dir}/\`. One topic per file, use \`[[wikilinks]]\`, prefer updating existing notes over creating new ones. Project-specific notes go under \`${dir}/projects/<project-name>/\`.
   - **Skill files**: If a finding is about how a specific skill works, update the skill's SKILL.md directly. Read the skill first to avoid duplication.
6. Update \`${dir}/index.md\` if files were added or removed.
`;
}
