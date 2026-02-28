import * as os from "node:os";
import * as path from "node:path";

export function buildReflectPrompt(globalDir: string, projectDir: string): string {
  return `## Reflect

Review this conversation and persist learnings to the memory vault.

### Process

1. **Read memory indexes** — read \`${globalDir}/index.md\` and \`${projectDir}/index.md\` to see what's already captured
2. **Scan the conversation** for:
   - Mistakes made and corrections received
   - User preferences and workflow patterns
   - Codebase knowledge gained (architecture, gotchas, patterns)
   - Tool/library quirks discovered
   - Decisions made and their rationale
3. **Skip** anything trivial or already captured
4. **Route each learning:**
   - **Structural?** Can this be a lint rule, script, or runtime check? If yes, encode it structurally and skip the vault
   - **Skill improvement?** About how a specific skill works? Update the skill directly
   - **Durable knowledge?** Write to vault. One topic per file, update existing notes over creating new ones
   - **Follow-up work?** Note as a todo, don't write to vault
5. **Update indexes** if any files were added or removed

### Output

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
  return `## Meditate

Audit and evolve the memory vault using subagents.

### Process

1. The vault snapshot has been written to: \`${snapshotPath}\`
2. Spawn the auditor subagent (\`${auditorAgentPath}\`) with task: "Read the vault snapshot at ${snapshotPath} and write your audit report to /tmp/memory-audit-report.md"
3. Read the audit report. If fewer than 3 actionable items, skip the reviewer
4. Spawn the reviewer subagent (\`${reviewerAgentPath}\`) with task: "Read the vault snapshot at ${snapshotPath} and the audit report at /tmp/memory-audit-report.md. Write your review to /tmp/memory-review-report.md"
5. Read and present both reports
6. Apply changes — update/delete/merge notes, add wikilinks, update indexes
7. Clean up temp files

### Memory locations
- Global: ${globalDir}/
- Project: ${projectDir}/`;
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

  return `## Ruminate

Mine past conversation history for uncaptured patterns.

### Process

1. **Read the vault** — read \`${globalDir}/index.md\` and \`${projectDir}/index.md\` for existing knowledge
2. **Locate sessions** — session files are in: \`${projectSessionsDir}/\`
3. **Parse sessions** — read .jsonl files, extract user/assistant messages
4. **Batch and analyze** — split conversations into batches (~20 per batch, min 2, max 10). For each batch:
   - Write the batch to a temp file
   - Spawn a miner subagent (\`${minerAgentPath}\`) to analyze it
5. **Synthesize** — read all findings, deduplicate, filter by frequency and impact
6. **Present findings** — table with: finding, frequency/evidence, proposed action
7. **Apply approved changes** — update vault files, update indexes
8. **Clean up** — remove temp files

### Key constraint
Filter aggressively. Better to surface 3 high-signal findings than 9 that include noise. Discard one-offs unless they correct something factually wrong in the vault.

### Memory locations
- Global: ${globalDir}/
- Project: ${projectDir}/`;
}
