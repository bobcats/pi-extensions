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
  scope: MemoryScope | null,
): string {
  if (!scope?.indexContent) return "";

  return "\n\n## Agent Memory\n\nMemory vault index — read relevant files with the read tool before acting:\n\n"
    + `### Memory vault (${scope.dir}/)\n\n${scope.indexContent}`;
}

export function isMemoryPath(
  filePath: string,
  vaultDir: string,
): { isMemory: boolean; isIndex: boolean } {
  const resolved = path.resolve(filePath);
  const resolvedVault = path.resolve(vaultDir);

  if (resolved.startsWith(resolvedVault + path.sep) || resolved === resolvedVault) {
    return { isMemory: true, isIndex: path.basename(resolved) === "index.md" };
  }

  return { isMemory: false, isIndex: false };
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
  state: "empty" | "v2";
  fileCount: number;
};

export function formatMemoryDisplay(
  vault: MemoryDisplayScope,
  enabled: boolean,
): string {
  const lines: string[] = [];
  lines.push(`Memory: ${enabled ? "enabled" : "disabled"}`);
  lines.push("");
  lines.push(`Vault (${vault.dir}):`);
  if (vault.state === "v2") {
    lines.push(`  Vault: ${vault.fileCount} files`);
  } else {
    lines.push("  No vault — run /memory init");
  }
  lines.push("");
  lines.push("Commands: init, reflect, meditate, ruminate, undo, log, on, off, edit");
  return lines.join("\n");
}

export function formatMemoryStatus(
  enabled: boolean,
  hasVault: boolean,
  fileCount: number,
): string {
  if (!enabled) return "memory: off";
  if (!hasVault) return "memory: on · no vault";

  const parts = ["memory: on"];
  if (fileCount > 0) {
    parts.push(`${fileCount} ${fileCount === 1 ? "file" : "files"}`);
  }
  return parts.join(" · ");
}

export function buildWriteInstructions(dir: string): string {
  return `### Updating Memories

**Memory location:** ${dir}/

**How to save:**
- Use write/edit tools to create or update .md files in the vault
- One topic per file. Lowercase, hyphenated filenames (e.g., deploy-gotchas.md)
- Link related notes with [[wikilinks]]
- Update index.md if any files were added or removed
- Keep files under ${MEMORY_TOPIC_LIMIT} lines. Keep index.md under ${MEMORY_INDEX_LIMIT} lines
- Update existing notes over creating new ones
- Project-specific notes go under projects/<project-name>/
- Universal preferences, principles, and cross-project knowledge go at the top level

**Quality gate:** Only save durable knowledge that generalizes beyond the current session. Check existing vault before writing to avoid duplicates.

**Explicit user requests:** When the user asks you to remember or forget something, do so immediately.`;
}
