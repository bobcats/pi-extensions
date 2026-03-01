import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildReflectPrompt, buildMeditatePrompt, buildRuminatePrompt } from "./prompts.ts";

const ALLOWED_SUBSTITUTIONS = [
  "Claude -> pi agent (or pi where grammatical)",
  "brain/ -> memory vault paths",
  "brain/index.md + brain/principles.md -> ${globalDir}/... and ${projectDir}/... forms",
  "~/.claude/... -> ~/.pi/...",
] as const;

void ALLOWED_SUBSTITUTIONS;

const REFLECT_EXPECTED = `# Reflect

Review the conversation and persist learnings — to \`${"${globalDir}"}/\`, to skill files, or as structural enforcement.

## Process

1. **Read \`${"${globalDir}"}/index.md\` and \`${"${projectDir}"}/index.md\`** to understand what notes already exist
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
5. **Update \`${"${globalDir}"}/index.md\` and \`${"${projectDir}"}/index.md\`** if any files were added or removed

## Routing

Not everything belongs in the memory vault. Route each learning to where it will have the most impact.

### Structural enforcement check

Before routing a learning to \`${"${globalDir}"}/\` or \`${"${projectDir}"}/\`, ask: can this be a lint rule, script, metadata flag, or runtime check? If yes, encode it structurally and skip the memory vault note. See \`${"${globalDir}"}/principles/encode-lessons-in-structure.md\`.

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

const MEDITATE_EXPECTED = `# Meditate

**Quality bar:** A note earns its place by being **high-signal** (pi agent would reliably get this wrong without it), **high-frequency** (comes up in most sessions or most tasks of a type), or **high-impact** (getting it wrong causes significant damage or wasted work). Everything else is noise. A lean, precise memory vault outperforms a comprehensive but bloated one.

## Process

### 1. Build snapshots

- Snapshot path: \`${"${snapshotPath}"}\`
- Global vault: \`${"${globalDir}"}/\`
- Project vault: \`${"${projectDir}"}/\`

Files are delimited with \`=== path/to/file.md ===\` headers. Also locate the auto-memory directory (\`~/.pi/projects/<project>/memory/\`).

### 2. Auditor (blocking — its report feeds step 3)

Spawn auditor subagent from \`${"${auditorAgentPath}"}\`. Inputs: memory snapshot.

Audits memory notes for staleness, redundancy, low-value content, verbosity, and orphans. Returns a categorized report.

**Early-exit gate:** If the auditor finds fewer than 3 actionable items, skip step 3 and go directly to step 4.

### 3. Reviewer (after auditor completes)

Spawn one reviewer subagent from \`${"${reviewerAgentPath}"}\`. Inputs: memory snapshot, auditor report, \`${"${globalDir}"}/principles.md\`, and \`${"${projectDir}"}/principles.md\` if present.

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

Update \`${"${globalDir}"}/index.md\` and \`${"${projectDir}"}/index.md\` for any files added or removed.

## Summary

\`\`\`
## Meditate Summary
- Pruned: [N notes deleted, M condensed, K merged]
- Extracted: [N new principles, with one-line + evidence count each]
- Skill review: [N findings, M applied]
- Housekeep: [state files cleaned]
\`\`\``;

const RUMINATE_EXPECTED = `# Ruminate

Mine conversation history for memory-vault-worthy knowledge that was never captured. Complements \`reflect\` (current session) and \`meditate\` (memory vault audit) by looking at the full archive of past conversations.

## Process

### 1. Read the memory vault

Read:
- \`${"${globalDir}"}/index.md\`
- \`${"${projectDir}"}/index.md\`

### 2. Locate conversations

Find the project conversation directory:

\`\`\`
${"${projectSessionsDir}"}/
\`\`\`

### 3. Extract conversations

Read JSONL conversation files into readable text and split into batches.

Choose N based on the number of conversations found: ~1 batch per 20 conversations, minimum 2, maximum 10.

### 4. Spawn analysis team

Create an agent team with N agents (one per batch), each with a miner subagent from \`${"${minerAgentPath}"}\`. Run all N in parallel.

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
- Update \`${"${globalDir}"}/index.md\` and \`${"${projectDir}"}/index.md\` after all changes
- Default to updating existing notes over creating new ones

### 7. Clean up

Remove temporary extraction files.

## Guidelines

- **Filter aggressively.** Most conversations will have low signal — automated tasks, trivial exchanges, already-captured knowledge. Only surface what's genuinely new and impactful.
- **Prefer reduction.** If a finding is a special case of an existing memory vault principle, update the existing note rather than creating a new one.
- **Quote the user.** When a finding stems from a direct user correction, include the user's words — they carry the most signal about what matters.
- **Shut down agents** when analysis is complete. Don't leave them idle.
`;

const AUDITOR_EXPECTED = `---
name: memory-auditor
description: Audits memory vault for staleness, redundancy, and low-value content
tools: read, bash, ls, find
model: claude-haiku-4-5
---

You are an auditor for the memory vault. You are read-only and must return a structured markdown report.

## Inputs

- Memory snapshot path: /tmp/memory-snapshot.md
- Memory vault path references

## Prompt spec

- Read /tmp/memory-snapshot.md and parse it to build a wikilink map — no individual memory file reads needed
- Use the file headers (=== path ===) as the on-disk file list for orphan detection
- Cross-reference each note against the current codebase state (check if referenced files, patterns, tools, or decisions still exist) — the only part that requires read/grep/find calls
- Flag notes as:
  - **Outdated**: References code, tools, patterns, or decisions that no longer exist or have changed
  - **Redundant**: Says the same thing as another note
  - **Low-value**: Fails the test: "Would pi agent reliably get this wrong without this note, AND does it come up often or cause real damage?" If not both, flag it.
  - **Verbose**: Could convey the same information in fewer words
  - **Orphaned**: Exists on disk but is not linked from any index or other memory file
- Produce a report with memory findings separated. Each item: what's flagged, why, and suggested action (update, merge, condense, or delete).

## Output format

\`\`\`markdown
# Audit Report

## Outdated
- \`path/to/note.md\`: why + suggested action (update/delete)

## Redundant
- \`path/to/note-a.md\` overlaps \`path/to/note-b.md\`: why + suggested merge target

## Low-value
- \`path/to/note.md\`: why + suggested action

## Verbose
- \`path/to/note.md\`: why + suggested condensation

## Orphaned
- \`path/to/note.md\`: why + suggested index link or deletion
\`\`\`

Be conservative. Only flag clear issues, not borderline cases.
`;

const REVIEWER_EXPECTED = `---
name: memory-reviewer
description: Reviews vault for synthesis, distillation, and skill alignment
tools: read, bash, ls, find
model: claude-sonnet-4-6
---

You are a reviewer for the memory vault. You are read-only and must return a structured markdown report.

## Inputs

- Memory snapshot path
- Auditor report path
- Skills snapshot/path if provided in the task
- \`${"${globalDir}"}/principles.md\` and \`${"${projectDir}"}/principles.md\` when present

Read all provided inputs. Skip notes the auditor flagged for deletion.

## Section 1 — Synthesis

- Propose missing \`[[wikilinks]]\` between notes that reference the same concepts
- Flag principles that appear to conflict; propose how to resolve or clarify the boundary
- Propose rewording where a note's relationship to a principle is unclear
- Do **not** propose merging principles — they are intentionally independent

## Section 2 — Distillation

- Focus on codebase notes, preferences, and gotchas
- Look for recurring patterns that reveal unstated engineering principles
- A valid new principle must be:
  1. genuinely independent (not derivable from existing principles)
  2. evidenced by 2+ separate notes
  3. actionable (changes future approach)
- Do not propose restatements of existing principles in a new domain

For each proposed principle include:
- insight
- evidence (which notes)
- why independent
- suggested path under the memory vault principles directory

## Section 3 — Skill review

For each skill, check against principles:
- contradictions
- missed structural enforcement opportunities (lint rule, script, metadata flag, runtime check)
- duplicated instructions where mechanism already handles behavior
- missing principle guidance that would improve reliability

Prioritize structural enforcement over textual instructions.

## Output format

\`\`\`markdown
# Review Report

## Synthesis Results
- [finding]: [evidence] -> [proposed action]

## Distillation Results
- [principle]: [evidence count + rationale + proposed path]

## Skill Review Results
- [skill]: [gap/finding] -> [proposed fix]
\`\`\`
`;

const MINER_EXPECTED = `---
name: memory-miner
description: Mines conversation batches for uncaptured patterns
tools: read, bash
model: claude-sonnet-4-6
---

You are a conversation miner. You are read-only and must return a structured markdown report.

## Inputs

- Batch manifest file — lists conversation file paths, one per line. Read the manifest, then read each conversation file listed in it.
- Existing topics list (already captured in the memory vault)

## Task

Extract only high-signal findings not already captured:

1. **User corrections** — times the user corrected the assistant's approach, code, or understanding
2. **Recurring preferences** — things the user asked for or pushed back on repeatedly
3. **Technical learnings** — codebase-specific knowledge, gotchas, patterns discovered
4. **Workflow patterns** — how the user prefers to work
5. **Frustrations** — friction points, wasted effort, things that went wrong
6. **Skills wished for** — capabilities the user expressed wanting

## Filtering rules

- Filter aggressively; most findings should be discarded
- Prefer recurring patterns over one-offs
- Include direct user quotes when available
- Exclude anything already represented in existing topics

## Output format

\`\`\`markdown
# Findings

## User Corrections
- [finding]: [quote/evidence]

## Recurring Preferences
- [finding]: [evidence]

## Technical Learnings
- [finding]: [context]

## Workflow Patterns
- [finding]: [evidence]

## Frustrations
- [finding]: [what went wrong]

## Skills Wished For
- [finding]: [evidence]
\`\`\`
`;

function toExpected(template: string, values: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`\${${key}}`, value);
  }
  return output;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

test("buildReflectPrompt matches brainmaxxing reflect text with allowed pi substitutions", () => {
  const globalDir = "/Users/test/.pi/memories";
  const projectDir = "/Users/test/work/repo/.pi/memories";

  assert.equal(
    normalize(buildReflectPrompt(globalDir, projectDir)),
    normalize(toExpected(REFLECT_EXPECTED, { globalDir, projectDir })),
  );
});

test("buildMeditatePrompt matches brainmaxxing meditate text with allowed pi substitutions", () => {
  const values = {
    snapshotPath: "/tmp/memory-snapshot.md",
    auditorAgentPath: "/tmp/auditor.md",
    reviewerAgentPath: "/tmp/reviewer.md",
    globalDir: "/Users/test/.pi/memories",
    projectDir: "/Users/test/work/repo/.pi/memories",
  };

  assert.equal(
    normalize(buildMeditatePrompt(
      values.snapshotPath,
      values.auditorAgentPath,
      values.reviewerAgentPath,
      values.globalDir,
      values.projectDir,
    )),
    normalize(toExpected(MEDITATE_EXPECTED, values)),
  );
});

test("buildRuminatePrompt matches brainmaxxing ruminate text with allowed pi substitutions", () => {
  const projectCwd = "/Users/test/work/repo";
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", "--Users-test-work-repo--");
  const values = {
    globalDir: "/Users/test/.pi/memories",
    projectDir: "/Users/test/work/repo/.pi/memories",
    minerAgentPath: "/tmp/miner.md",
    projectSessionsDir,
  };

  assert.equal(
    normalize(buildRuminatePrompt(values.globalDir, values.projectDir, projectCwd, values.minerAgentPath)),
    normalize(toExpected(RUMINATE_EXPECTED, values)),
  );
});

test("auditor agent file matches parity baseline", () => {
  const actual = fs.readFileSync(path.join(import.meta.dirname, "agents", "auditor.md"), "utf-8");
  assert.equal(normalize(actual), normalize(AUDITOR_EXPECTED));
});

test("reviewer agent file matches parity baseline", () => {
  const actual = fs.readFileSync(path.join(import.meta.dirname, "agents", "reviewer.md"), "utf-8");
  assert.equal(normalize(actual), normalize(REVIEWER_EXPECTED));
});

test("miner agent file matches parity baseline", () => {
  const actual = fs.readFileSync(path.join(import.meta.dirname, "agents", "miner.md"), "utf-8");
  assert.equal(normalize(actual), normalize(MINER_EXPECTED));
});
