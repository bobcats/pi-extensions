import * as fs from "node:fs";
import * as path from "node:path";

export const MEMORY_INDEX_LIMIT = 200;
export const MEMORY_TOPIC_LIMIT = 500;
export const MEMORY_INDEX_FILE = "index.md";

export function readVaultIndex(dir: string): string | null {
  const filePath = path.join(dir, "index.md");
  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content || null;
  } catch {
    return null;
  }
}

// Backward-compatible alias while v2 migration lands in index.ts
export const readMemoryIndex = readVaultIndex;

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

export function listVaultFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string, prefix: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md") {
        const slug = entry.name.replace(/\.md$/, "");
        results.push(prefix ? `${prefix}/${slug}` : slug);
      }
    }
  }

  walk(dir, "");
  return results.sort();
}

export function parseWikilinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  const targets = new Set<string>();
  for (const match of matches) {
    targets.add(match[1]);
  }
  return [...targets].sort();
}

export function detectIndexDrift(dir: string): boolean {
  const diskFiles = listVaultFiles(dir);
  const indexPath = path.join(dir, "index.md");
  let indexContent: string;
  try {
    indexContent = fs.readFileSync(indexPath, "utf-8");
  } catch {
    return diskFiles.length > 0;
  }
  const indexed = parseWikilinks(indexContent);
  if (diskFiles.length !== indexed.length) return true;
  for (let i = 0; i < diskFiles.length; i++) {
    if (diskFiles[i] !== indexed[i]) return true;
  }
  return false;
}

export function buildVaultIndex(dir: string): string {
  const files = listVaultFiles(dir);
  if (files.length === 0) return "# Memory\n";

  const groups = new Map<string, string[]>();
  const standalone: string[] = [];

  for (const file of files) {
    const slashIdx = file.indexOf("/");
    if (slashIdx === -1) {
      standalone.push(file);
    } else {
      const group = file.substring(0, slashIdx);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(file);
    }
  }

  const lines: string[] = ["# Memory"];

  const sortedGroups = [...groups.keys()].sort();
  for (const group of sortedGroups) {
    const label = group.charAt(0).toUpperCase() + group.slice(1);
    lines.push("");
    lines.push(`## ${label}`);
    for (const file of groups.get(group)!) {
      lines.push(`- [[${file}]]`);
    }
  }

  if (standalone.length > 0) {
    lines.push("");
    lines.push("## Other");
    for (const file of standalone) {
      lines.push(`- [[${file}]]`);
    }
  }

  return lines.join("\n") + "\n";
}

export type MemoryScope = {
  dir: string;
  indexContent: string | null;
  fileCount: number;
};

export function buildMemoryPrompt(
  global: MemoryScope | null,
  project: MemoryScope | null,
): string {
  const sections: string[] = [];

  if (global?.indexContent) {
    sections.push(`### Global Memory (${global.dir}/)\n\n${global.indexContent}`);
  }
  if (project?.indexContent) {
    sections.push(`### Project Memory (${project.dir}/)\n\n${project.indexContent}`);
  }

  if (sections.length === 0) return "";

  return "\n\n## Agent Memory\n\nMemory vault index — read relevant files with the read tool before acting:\n\n" + sections.join("\n\n");
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

  const noGlobalVault = !global.content && global.topicFiles.length === 0;
  const noProjectVault = !project.content && project.topicFiles.length === 0;

  for (const [label, scope] of [["Global", global], ["Project", project]] as const) {
    lines.push(`${label} (${scope.dir}):`);
    if (!scope.content && scope.topicFiles.length === 0) {
      lines.push("  No vault — run /memory init");
    } else {
      lines.push(`  Vault files: ${scope.topicFiles.length}`);
      lines.push(`  Index: ${scope.content ? "present" : "missing"}`);
    }
    lines.push("");
  }

  if (noGlobalVault && noProjectVault) {
    lines.push("Tip: run /memory init to create a vault.");
  }

  return lines.join("\n");
}

export function formatMemoryStatus(
  enabled: boolean,
  globalHasVaultOrScopeCount: boolean | number,
  projectHasVaultOrTopicCount: boolean | number,
  fileCount = 0,
): string {
  if (!enabled) return "memory: off";

  // Backward-compat mode for old callers: (enabled, scopeCount, topicCount)
  if (typeof globalHasVaultOrScopeCount === "number" || typeof projectHasVaultOrTopicCount === "number") {
    const scopeCount = Number(globalHasVaultOrScopeCount);
    const topicCount = Number(projectHasVaultOrTopicCount);
    if (scopeCount === 0) return "memory: on · no vault";
    const parts = ["memory: on", `${scopeCount} ${scopeCount === 1 ? "scope" : "scopes"}`];
    if (topicCount > 0) parts.push(`${topicCount} ${topicCount === 1 ? "file" : "files"}`);
    return parts.join(" · ");
  }

  const globalHasVault = globalHasVaultOrScopeCount;
  const projectHasVault = projectHasVaultOrTopicCount;

  if (!globalHasVault && !projectHasVault) return "memory: on · no vault";

  const scopeCount = (globalHasVault ? 1 : 0) + (projectHasVault ? 1 : 0);
  const parts = ["memory: on", `${scopeCount} ${scopeCount === 1 ? "scope" : "scopes"}`];
  if (fileCount > 0) {
    parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  }
  return parts.join(" · ");
}

export function buildWriteInstructions(
  globalDir: string,
  projectDir: string,
): string {
  return `### Updating Memories

**Memory locations:**
- Global: ${globalDir}/ (applies to all projects)
- Project: ${projectDir}/ (specific to this project)

**How to save:**
- Use write/edit tools to create or update .md files in the vault
- One topic per file. Lowercase, hyphenated filenames (e.g., deploy-gotchas.md)
- Link related notes with [[wikilinks]] — index.md is auto-maintained
- Keep files under ${MEMORY_TOPIC_LIMIT} lines. Keep index.md under ${MEMORY_INDEX_LIMIT} lines
- Update existing notes over creating new ones
- Prefer project memory for project-specific things, global for universal preferences

**Quality gate:** Only save durable knowledge that generalizes beyond the current session. Check existing vault before writing to avoid duplicates.

**Explicit user requests:** When the user asks you to remember or forget something, do so immediately.`;
}
