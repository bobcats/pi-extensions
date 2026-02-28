import * as os from "node:os";
import * as path from "node:path";

export function buildReflectPrompt(globalDir: string, projectDir: string): string {
  return `# Reflect

Review the conversation and persist learnings — to the memory vault, to skill files, or as structural enforcement.

## Process

1. **Read memory indexes** to understand what notes already exist:
   - \`${globalDir}/index.md\`
   - \`${projectDir}/index.md\`
2. **Scan the conversation** for:
   - Mistakes made and corrections received
   - User preferences and workflow patterns
   - Codebase knowledge gained (architecture, gotchas, patterns)
   - Tool/library quirks discovered
   - Decisions made and their rationale
   - Friction in skill execution, orchestration, or delegation
   - Repeated manual steps that could be automated or encoded
3. **Skip** anything trivial or already captured in existing notes
4. **Route each learning** to the right destination (see Routing below)
5. **Update indexes** if any files were added or removed

## Routing

Not everything belongs in the memory vault. Route each learning to where it will have the most impact.

### Structural enforcement check

Before routing a learning to the vault, ask: can this be a lint rule, script, metadata flag, or runtime check? If yes, encode it structurally and skip the vault note.

### Vault files

Codebase knowledge, principles, gotchas — anything that informs future sessions. This is the default destination.

- One topic per file. File name = topic slug.
- Group in directories with index files using \`[[wikilinks]]\`.
- No inlined content in index files.

### Skill improvements

If a learning is about how a specific skill works — its process, prompts, or edge cases — update the skill directly.

### Backlog items

Follow-up work that cannot be done during reflection — bugs, non-trivial rewrites, tooling gaps. File as a todo/backlog item.

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

**Quality bar:** A note earns its place by being **high-signal** (the pi agent would reliably get this wrong without it), **high-frequency** (comes up in most sessions or most tasks of a type), or **high-impact** (getting it wrong causes significant damage or wasted work). Everything else is noise. A lean, precise vault outperforms a comprehensive but bloated one.

## Process

### 1. Build snapshots

- Snapshot path: \`${snapshotPath}\`
- Global vault: \`${globalDir}/\`
- Project vault: \`${projectDir}/\`

Files are delimited with \`=== path/to/file.md ===\` headers.

### 2. Auditor (blocking — its report feeds step 3)

Spawn auditor subagent from \`${auditorAgentPath}\`.

### 3. Reviewer (after auditor completes)

Spawn reviewer subagent from \`${reviewerAgentPath}\` if auditor found enough actionable items.

### 4. Review reports

Present a consolidated summary.

### 5. Route skill-specific learnings

Check reports for findings that belong in skill files, not the vault.

### 6. Apply changes

Apply all approved changes directly.

### 7. Housekeep

Update \`index.md\` files for any files added or removed.

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
  const encodedCwd = "--" + projectCwd.replace(/\//g, "--") + "--";
  const projectSessionsDir = path.join(sessionsDir, encodedCwd);

  return `# Ruminate

Mine conversation history for vault-worthy knowledge that was never captured. Complements reflect (current session) and meditate (vault audit) by looking at the full archive of past conversations.

## Process

### 1. Read the vault

Read:
- \`${globalDir}/index.md\`
- \`${projectDir}/index.md\`

### 2. Locate conversations

Project session directory:
\`${projectSessionsDir}/\`

### 3. Extract conversations

Read JSONL session files and extract user/assistant messages.

### 4. Spawn analysis team

Batch conversations (~1 batch per 20 conversations, minimum 2, maximum 10), and for each batch spawn a miner subagent from \`${minerAgentPath}\`.

Each miner gets:
- Batch input path
- Existing topics already captured in the vault
- Extraction targets:
  - User corrections
  - Recurring preferences
  - Technical learnings
  - Workflow patterns
  - Frustrations

### 5. Synthesize

After all miners complete, read all findings. Deduplicate and cross-reference with existing vault content.

**Filter by frequency and impact.** Most findings should be discarded.

### 6. Present and apply

Present findings with: finding, frequency/evidence, proposed action. Apply only approved changes.

### 7. Clean up

Remove temporary batch/findings files.

## Guidelines

- **Filter aggressively.** Only surface genuinely new and impactful patterns.
- **Prefer reduction.** If a finding is a special case of an existing principle, update the existing note.
- **Quote the user.** Direct user corrections carry high signal.
`;
}
