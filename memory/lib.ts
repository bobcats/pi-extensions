import * as fs from "node:fs";
import * as path from "node:path";

export const OPERATIONS_FILE = "memory-operations.jsonl";

const CONTENT_DIR = path.join(import.meta.dirname, "content");

export function readVaultIndex(dir: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, "index.md"), "utf-8").trim() || null;
  } catch {
    return null;
  }
}

export function listVaultFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(currentDir: string, prefix: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "dream-journal.md" || entry.name === OPERATIONS_FILE) continue;
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

export function countVaultFiles(dir: string): number {
  return listVaultFiles(dir).length;
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

export function initVault(vaultDir: string, includePrinciples: boolean): { created: boolean; principlesInstalled: number } {
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(path.join(vaultDir, "projects"), { recursive: true });

  let principlesInstalled = 0;

  if (includePrinciples) {
    const srcPrinciples = path.join(CONTENT_DIR, "principles");
    const destPrinciples = path.join(vaultDir, "principles");
    fs.mkdirSync(destPrinciples, { recursive: true });

    const files = fs.readdirSync(srcPrinciples).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const dest = path.join(destPrinciples, file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(path.join(srcPrinciples, file), dest);
        principlesInstalled++;
      }
    }

    const subIndexSrc = path.join(CONTENT_DIR, "principles.md");
    const subIndexDest = path.join(vaultDir, "principles.md");
    if (fs.existsSync(subIndexSrc) && !fs.existsSync(subIndexDest)) {
      fs.copyFileSync(subIndexSrc, subIndexDest);
    }
  }

  const index = buildVaultIndex(vaultDir);
  fs.writeFileSync(path.join(vaultDir, "index.md"), index);

  return { created: true, principlesInstalled };
}

export function buildVaultSnapshot(dir: string): string {
  const sections: string[] = [];
  function walk(currentDir: string, prefix: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.name.startsWith(".")) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), relativePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = fs.readFileSync(path.join(currentDir, entry.name), "utf-8");
        sections.push(`=== ${relativePath} ===\n${content}`);
      }
    }
  }
  walk(dir, "");
  return sections.join("\n\n");
}
