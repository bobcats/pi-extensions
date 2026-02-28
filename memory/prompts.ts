import * as os from "node:os";
import * as path from "node:path";

export function buildReflectPrompt(globalDir: string, projectDir: string): string {
  return `# Reflect

Review the conversation and persist learnings — to \`${globalDir}/\`, to skill files, or as structural enforcement.

## Process

1. **Read \`${globalDir}/index.md\` and \`${projectDir}/index.md\`** to understand what notes already exist
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
5. **Update \`${globalDir}/index.md\` and \`${projectDir}/index.md\`** if any files were added or removed

## Routing

Not everything belongs in the memory vault. Route each learning to where it will have the most impact.

### Structural enforcement check

Before routing a learning to \`${globalDir}/\` or \`${projectDir}/\`, ask: can this be a lint rule, script, metadata flag, or runtime check? If yes, encode it structurally and skip the memory vault note. See \`${globalDir}/principles/encode-lessons-in-structure.md\`.

### Memory vault files

Codebase knowledge, principles, gotchas — anything that informs future sessions. This is the default destination. Use the memory vault skill for writing conventions.

- One topic per file. File name = topic slug.
- Group in directories with index files using \`[[wikilinks]]\`.
- No inlined content in index files.

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

export function buildMeditatePrompt(
  snapshotPath: string,
  auditorAgentPath: string,
  reviewerAgentPath: string,
  globalDir: string,
  projectDir: string,
): string {
  return `# Meditate

**Quality bar:** A note earns its place by being **high-signal** (pi agent would reliably get this wrong without it), **high-frequency** (comes up in most sessions or most tasks of a type), or **high-impact** (getting it wrong causes significant damage or wasted work). Everything else is noise. A lean, precise memory vault outperforms a comprehensive but bloated one.

## Process

### 1. Build snapshots

- Snapshot path: \`${snapshotPath}\`
- Global vault: \`${globalDir}/\`
- Project vault: \`${projectDir}/\`

Files are delimited with \`=== path/to/file.md ===\` headers. Also locate the auto-memory directory (\`~/.pi/projects/<project>/memory/\`).

### 2. Auditor (blocking — its report feeds step 3)

Spawn auditor subagent from \`${auditorAgentPath}\`. Inputs: memory snapshot.

Audits memory notes for staleness, redundancy, low-value content, verbosity, and orphans. Returns a categorized report.

**Early-exit gate:** If the auditor finds fewer than 3 actionable items, skip step 3 and go directly to step 4.

### 3. Reviewer (after auditor completes)

Spawn one reviewer subagent from \`${reviewerAgentPath}\`. Inputs: memory snapshot, auditor report, \`${globalDir}/principles.md\`, and \`${projectDir}/principles.md\` if present.

Combines three concerns in a single pass:
- **Synthesis**: Proposes missing wikilinks, flags principle tensions, suggests clarifications.
- **Distillation**: Identifies recurring patterns that reveal unstated principles. New principles must be (1) independent, (2) evidenced by 2+ notes, (3) actionable.
- **Skill review**: Cross-references skills against memory vault principles. Finds contradictions, missed structural enforcement, redundant instructions.

### 4. Review reports

Present the user with a consolidated summary.

### 5. Route skill-specific learnings

Check all reports for findings that belong in skill files, not the memory vault. Update the skill's SKILL.md or references/ directly. Read the skill first to avoid duplication.

### 6. Apply changes

Apply all changes directly. The user reviews the diff.

- **Outdated notes**: Update or delete
- **Redundant notes**: Merge into the stronger note, delete the weaker
- **Low-value notes**: Delete
- **Verbose notes**: Condense in place
- **New connections**: Add \`[[wikilinks]]\`
- **Tensions**: Reword to clarify boundaries
- **New principles**: Only from the distillation section, only if genuinely independent. Write memory files and update principles index files
- **Merge principles**: Look for principles that are subsets or specific applications of each other — merge the narrower into the broader
- **Stale memories**: Delete or rewrite

### 7. Housekeep

Update \`${globalDir}/index.md\` and \`${projectDir}/index.md\` for any files added or removed.

## Summary

\`\`\`
## Meditate Summary
- Pruned: [N notes deleted, M condensed, K merged]
- Extracted: [N new principles, with one-line + evidence count each]
- Skill review: [N findings, M applied]
- Housekeep: [state files cleaned]
\`\`\``;
}

export function buildRuminatePrompt(
  globalDir: string,
  projectDir: string,
  projectCwd: string,
  minerAgentPath: string,
): string {
  const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
  const encodedCwd = "--" + projectCwd.replace(/^\/+/, "").replace(/\//g, "--") + "--";
  const projectSessionsDir = path.join(sessionsDir, encodedCwd);

  return `# Ruminate

Mine conversation history for memory-vault-worthy knowledge that was never captured. Complements \`reflect\` (current session) and \`meditate\` (memory vault audit) by looking at the full archive of past conversations.

## Process

### 1. Read the memory vault

Read:
- \`${globalDir}/index.md\`
- \`${projectDir}/index.md\`

### 2. Locate conversations

Find the project conversation directory:

\`\`\`
${projectSessionsDir}/
\`\`\`

### 3. Extract conversations

Read JSONL conversation files into readable text and split into batches.

Choose N based on the number of conversations found: ~1 batch per 20 conversations, minimum 2, maximum 10.

### 4. Spawn analysis team

Create an agent team with N agents (one per batch), each with a miner subagent from \`${minerAgentPath}\`. Run all N in parallel.

Each agent's prompt should include:

- The batch input path
- The output path
- The list of topics **already captured** in the memory vault — so agents skip known knowledge
- Instructions to extract from each conversation:
  - **User corrections**: times the user corrected the assistant's approach, code, or understanding
  - **Recurring preferences**: things the user explicitly asked for or pushed back on repeatedly
  - **Technical learnings**: codebase-specific knowledge, gotchas, patterns discovered
  - **Workflow patterns**: how the user prefers to work
  - **Frustrations**: friction points, wasted effort, things that went wrong
  - **Skills wished for**: capabilities the user expressed wanting

Agents write structured findings to their output files.

### 5. Synthesize

After all agents complete, read all findings files. Cross-reference with existing memory vault content. Deduplicate across batches.

**Filter by frequency and impact.** Most findings won't be worth adding. Apply these filters before presenting:

- **Frequency**: Did this come up in multiple conversations, or was the user correcting the same mistake repeatedly? One-off corrections are usually not worth a memory vault entry — the memory vault should capture *patterns*, not incidents.
- **Factual accuracy**: Is something in the memory vault now wrong? These are always worth fixing regardless of frequency.
- **Impact**: Would failing to capture this cause repeated wasted effort in future sessions?

**Discard aggressively.** It's better to present 3 high-signal findings than 9 that include noise.

### 6. Present and apply

Present findings to the user in a table with columns: finding, frequency/evidence, and proposed action. Be honest about which findings are one-offs vs. recurring patterns — let the user decide what's worth adding.

**Route skill-specific learnings.** Check if any findings are about how a specific skill should work — its process, prompts, edge cases, or troubleshooting. Update the skill's SKILL.md directly. Read the skill first to avoid duplicating or contradicting existing content.

Apply only the changes the user approves. Follow memory vault writing conventions:

- One topic per file, organized in directories
- Use \`[[wikilinks]]\` to connect related notes
- Update \`${globalDir}/index.md\` and \`${projectDir}/index.md\` after all changes
- Default to updating existing notes over creating new ones

### 7. Clean up

Remove temporary extraction files.

## Guidelines

- **Filter aggressively.** Most conversations will have low signal — automated tasks, trivial exchanges, already-captured knowledge. Only surface what's genuinely new and impactful.
- **Prefer reduction.** If a finding is a special case of an existing memory vault principle, update the existing note rather than creating a new one.
- **Quote the user.** When a finding stems from a direct user correction, include the user's words — they carry the most signal about what matters.
- **Shut down agents** when analysis is complete. Don't leave them idle.
`;
}
