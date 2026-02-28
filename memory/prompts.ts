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
