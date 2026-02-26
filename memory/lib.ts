import * as fs from "node:fs";
import * as path from "node:path";

export const MEMORY_INDEX_LIMIT = 200;
export const MEMORY_TOPIC_LIMIT = 500;
export const MEMORY_INDEX_FILE = "MEMORY.md";

export function readMemoryIndex(dir: string): string | null {
  const filePath = path.join(dir, MEMORY_INDEX_FILE);
  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content || null;
  } catch {
    return null;
  }
}

export function listTopicFiles(dir: string): { name: string; lines: number }[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX_FILE)
      .sort()
      .map((f) => ({
        name: f,
        lines: fs.readFileSync(path.join(dir, f), "utf-8").split("\n").length,
      }));
  } catch {
    return [];
  }
}

const EMPTY_NUDGE =
  "Your MEMORY.md is currently empty. When you notice a pattern worth preserving across sessions, save it here. Anything in MEMORY.md will be included in your system prompt next time.";

export function buildMemorySection(
  scope: string,
  content: string | null,
  topicFiles: { name: string; lines: number }[],
): string {
  const header = `### ${scope.charAt(0).toUpperCase() + scope.slice(1)} Memory`;
  let body: string;

  if (!content) {
    body = EMPTY_NUDGE;
  } else {
    const lines = content.split("\n");
    if (lines.length > MEMORY_INDEX_LIMIT) {
      body =
        lines.slice(0, MEMORY_INDEX_LIMIT).join("\n") +
        `\n\nWARNING: MEMORY.md is ${lines.length} lines (limit: ${MEMORY_INDEX_LIMIT}). Only the first ${MEMORY_INDEX_LIMIT} lines were loaded. Move detailed content into separate topic files and keep MEMORY.md as a concise index.`;
    } else {
      body = content;
    }
  }

  let section = `${header}\n\n${body}`;

  if (topicFiles.length > 0) {
    section += "\n\nTopic files (use read tool to load):";
    for (const f of topicFiles) {
      section += `\n- ${f.name} (${f.lines} lines)`;
    }
  }

  return section;
}

export type MemoryScope = {
  content: string | null;
  topicFiles: { name: string; lines: number }[];
};

export function buildMemoryPrompt(
  global: MemoryScope | null,
  project: MemoryScope | null,
): string {
  const sections: string[] = [];

  if (global) {
    sections.push(buildMemorySection("global", global.content, global.topicFiles));
  }
  if (project) {
    sections.push(buildMemorySection("project", project.content, project.topicFiles));
  }

  if (sections.length === 0) return "";

  return "\n\n## Agent Memory\n\n" + sections.join("\n\n");
}

export function isMemoryPath(
  filePath: string,
  globalDir: string,
  projectDir: string,
): { isMemory: boolean; isIndex: boolean } {
  const resolved = path.resolve(filePath);
  const inGlobal = resolved.startsWith(path.resolve(globalDir) + path.sep);
  const inProject = resolved.startsWith(path.resolve(projectDir) + path.sep);

  if (!inGlobal && !inProject) return { isMemory: false, isIndex: false };

  const basename = path.basename(resolved);
  return { isMemory: true, isIndex: basename === MEMORY_INDEX_FILE };
}

export function checkLineLimit(
  content: string,
  limit: number,
): { lines: number; limit: number; exceeds: boolean } {
  const lines = content.split("\n").length;
  return { lines, limit, exceeds: lines > limit };
}

export type MemoryDisplayScope = {
  dir: string;
  content: string | null;
  topicFiles: { name: string; lines: number }[];
};

export function formatMemoryDisplay(
  global: MemoryDisplayScope,
  project: MemoryDisplayScope,
  enabled: boolean,
): string {
  const lines: string[] = [];
  lines.push(`Memory: ${enabled ? "enabled" : "disabled"}`);
  lines.push("");

  for (const [label, scope] of [["Global", global], ["Project", project]] as const) {
    lines.push(`${label} (${scope.dir}):`);
    if (scope.content) {
      const lineCount = scope.content.split("\n").length;
      lines.push(`  MEMORY.md: ${lineCount} lines`);
      lines.push(`  ${scope.content.split("\n").slice(0, 5).join("\n  ")}`);
      if (lineCount > 5) lines.push(`  ... (${lineCount - 5} more lines)`);
    } else {
      lines.push("  MEMORY.md: empty");
    }
    if (scope.topicFiles.length > 0) {
      lines.push("  Topic files:");
      for (const f of scope.topicFiles) {
        lines.push(`    ${f.name} (${f.lines} lines)`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatMemoryStatus(
  enabled: boolean,
  scopeCount: number,
  topicCount: number,
): string {
  if (!enabled) return "memory: off";

  const parts = ["memory: on"];

  if (scopeCount === 0) {
    parts.push("empty");
  } else {
    parts.push(`${scopeCount} ${scopeCount === 1 ? "scope" : "scopes"}`);
    if (topicCount > 0) {
      parts.push(`${topicCount} ${topicCount === 1 ? "topic" : "topics"}`);
    }
  }

  return parts.join(" · ");
}

// --- Session summary I/O ---

export function getSessionsDir(projectDir: string): string {
  return path.join(projectDir, "sessions");
}

export function writeSessionSummary(sessionsDir: string, sessionId: string, content: string): void {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, `${sessionId}.md`), content);
}

export function readSessionSummary(sessionsDir: string, sessionId: string): string | null {
  try {
    return fs.readFileSync(path.join(sessionsDir, `${sessionId}.md`), "utf-8");
  } catch {
    return null;
  }
}

export function listSessionSummaries(sessionsDir: string): { sessionId: string; mtime: number; path: string }[] {
  try {
    return fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith(".md"))
      .map(f => {
        const fullPath = path.join(sessionsDir, f);
        const stat = fs.statSync(fullPath);
        return { sessionId: f.replace(/\.md$/, ""), mtime: stat.mtimeMs, path: fullPath };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

export function buildExtractionPrompt(sessionsDir: string, sessionId: string): string {
  const targetPath = path.join(sessionsDir, `${sessionId}.md`);
  return `Write a structured session summary to ${targetPath}. Include:

# Session Title
A one-line description of what was worked on this session.

## Current Status
What's done, what's in progress, what's blocked.

## Key Decisions
Important choices made during this session and their rationale.

## Work Log
Chronological record of significant actions taken.

Keep it concise — this summary will be loaded as background context in future sessions. Focus on decisions and outcomes, not conversation details.`;
}

// --- Session tracking ---

export const FIRST_EXTRACTION_THRESHOLD = 10_000;
export const SUBSEQUENT_TOKEN_THRESHOLD = 5_000;
export const TOOL_CALL_THRESHOLD = 3;

export interface SessionTracker {
  updateTokens(currentTokens: number): void;
  recordToolCall(): void;
  shouldExtract(): boolean;
  recordExtraction(): void;
}

export function createSessionTracker(): SessionTracker {
  let hasExtractedOnce = false;
  let tokensAtLastExtraction = 0;
  let currentTokens = 0;
  let toolCallsSinceExtraction = 0;

  return {
    updateTokens(tokens: number) {
      currentTokens = tokens;
    },
    recordToolCall() {
      toolCallsSinceExtraction++;
    },
    shouldExtract(): boolean {
      if (!hasExtractedOnce) {
        return currentTokens >= FIRST_EXTRACTION_THRESHOLD;
      }
      const tokenDelta = currentTokens - tokensAtLastExtraction;
      return tokenDelta >= SUBSEQUENT_TOKEN_THRESHOLD || toolCallsSinceExtraction >= TOOL_CALL_THRESHOLD;
    },
    recordExtraction() {
      hasExtractedOnce = true;
      tokensAtLastExtraction = currentTokens;
      toolCallsSinceExtraction = 0;
    },
  };
}

export function buildWriteInstructions(
  globalDir: string,
  projectDir: string,
): string {
  return `### Updating Memories

As you work, consult your memory files to build on previous experience.

**Memory locations:**
- Global: ${globalDir}/MEMORY.md (applies to all projects)
- Project: ${projectDir}/MEMORY.md (specific to this project)

**How to save memories:**
- Organize memory semantically by topic, not chronologically
- Use the write and edit tools to update your memory files
- MEMORY.md is always loaded into your context — keep it under ${MEMORY_INDEX_LIMIT} lines as a concise index
- Create separate topic files (e.g., debugging.md, api-design.md) for detailed notes and link to them from MEMORY.md
- Update or remove memories that turn out to be wrong or outdated
- Do not write duplicate memories — check existing memory before writing new entries
- Prefer project memory for project-specific things, global for universal preferences

**When to save:**
- After completing a feature, fixing a tricky bug, or resolving a debugging session
- When you discover a pattern, convention, or gotcha that would generalize beyond the current task
- When the user corrects you or expresses a preference

**What to save:**
- Stable patterns and conventions confirmed across multiple interactions
- Key architectural decisions, important file paths, and project structure
- User preferences for workflow, tools, and communication style
- Solutions to recurring problems and debugging insights
- Only things that generalize — if a lesson only applies to one file or one narrow situation, it's not worth recording

**Quality gate:** Before saving any memory, check each entry against the criteria below. If it doesn't clearly generalize beyond the current session, don't save it.

**What NOT to save:**
- Session-specific context (current task details, in-progress work, temporary state)
- Information that might be incomplete — verify before writing
- Anything that duplicates or contradicts existing project instructions
- Speculative or unverified conclusions from reading a single file

**Explicit user requests:**
- When the user asks you to remember something across sessions (e.g., "always use bun", "never auto-commit"), save it immediately — no need to wait for multiple interactions
- When the user asks to forget or stop remembering something, find and remove the relevant entries from your memory files`;
}
