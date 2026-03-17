import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DateFilter, ExtractionResult, SessionMessage } from "./types.js";
import { buildVaultSnapshot } from "./lib.js";

/** Raw JSONL message entry shape (superset of pi's SessionMessageEntry — includes isMeta). */
interface RawMessageEntry {
  type?: string;
  isMeta?: boolean;
  message?: {
    role?: string;
    content?: string | { type?: string; text?: string }[];
  };
}

/** Raw JSONL compaction/branch_summary entry shape. */
interface RawSummaryEntry {
  type?: string;
  summary?: string;
}

const SESSIONS_ROOT = path.join(os.homedir(), ".pi", "agent", "sessions");
const USER_TEXT_LIMIT = 3000;
const ASSISTANT_TEXT_LIMIT = 800;
const MIN_TEXT_LENGTH = 10;
const MIN_FILE_SIZE = 500;

export const MINER_AGENT_PATH = path.join(import.meta.dirname, "agents", "miner.md");
export const SCRIPTS_DIR = path.join(import.meta.dirname, "scripts");

export function encodeProjectSessionPath(cwd: string): string {
  return "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";
}

export function parseDate(value: string, flag: string): Date | string {
  const d = new Date(value + "T00:00:00");
  return isNaN(d.getTime()) ? `Invalid date format for ${flag}: "${value}". Use YYYY-MM-DD.` : d;
}

export function parseRuminateArgs(args: string): { error?: string } & DateFilter {
  const parts = args.split(/\s+/);
  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  for (let i = 0; i < parts.length; i++) {
    const flag = parts[i];
    if ((flag === "--from" || flag === "--to") && parts[i + 1]) {
      const result = parseDate(parts[i + 1], flag);
      if (typeof result === "string") return { error: result };
      if (flag === "--from") fromDate = result;
      else toDate = result;
      i++;
    }
  }

  return { fromDate, toDate };
}

export function parseSessionMessages(jsonlContent: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  for (const line of jsonlContent.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry: RawMessageEntry = JSON.parse(line);
      if (!entry.message?.role) continue;
      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") continue;
      if (role === "user" && entry.isMeta) continue;

      const textParts: string[] = [];
      const content = entry.message.content;
      if (typeof content === "string") {
        textParts.push(content);
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "text" && typeof part.text === "string") {
            textParts.push(part.text);
          }
        }
      }

      for (const t of textParts) {
        const clean = t.trim();
        if (clean.length <= MIN_TEXT_LENGTH) continue;
        if (clean.startsWith("<system-reminder>") && clean.endsWith("</system-reminder>")) continue;

        const limit = role === "user" ? USER_TEXT_LIMIT : ASSISTANT_TEXT_LIMIT;
        messages.push({ role, text: `[${role.toUpperCase()}]: ${t.slice(0, limit)}` });
      }
    } catch {
      // ignore malformed lines
    }
  }
  return messages;
}

export function extractCompactionSummaries(jsonlContent: string): string[] {
  const summaries: string[] = [];
  for (const line of jsonlContent.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry: RawSummaryEntry = JSON.parse(line);
      if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.summary) {
        summaries.push(entry.summary);
      }
    } catch {
      // ignore
    }
  }
  return summaries;
}

export function extractAndBatch(
  cwd: string,
  options: DateFilter,
  sessionsRoot: string = SESSIONS_ROOT,
  vaultDir: string = path.join(os.homedir(), ".pi", "memories"),
): ExtractionResult | { error: string } {
  const encodedCwd = encodeProjectSessionPath(cwd);
  const projectSessionsDir = path.join(sessionsRoot, encodedCwd);

  if (!fs.existsSync(projectSessionsDir)) {
    return { error: "No sessions found for this project." };
  }

  const jsonlFiles: { path: string; mtime: Date }[] = [];
  for (const entry of fs.readdirSync(projectSessionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const full = path.join(projectSessionsDir, entry.name);
    const stat = fs.statSync(full);
    if (stat.size < MIN_FILE_SIZE) continue;
    if (options.fromDate && stat.mtime < options.fromDate) continue;
    if (options.toDate && stat.mtime > options.toDate) continue;
    jsonlFiles.push({ path: full, mtime: stat.mtime });
  }

  if (jsonlFiles.length === 0) {
    return { error: "No matching sessions found (check date filters)." };
  }

  jsonlFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const ts = Date.now();
  const outputDir = path.join(os.tmpdir(), `memory-ruminate-${ts}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const extracted: string[] = [];
  for (let idx = 0; idx < jsonlFiles.length; idx++) {
    const raw = fs.readFileSync(jsonlFiles[idx].path, "utf-8");

    const summaries = extractCompactionSummaries(raw);
    let content: string;
    if (summaries.length > 0) {
      content = summaries.map((s, i) => `=== Summary ${i + 1} ===\n${s}`).join("\n\n");
    } else {
      const msgs = parseSessionMessages(raw);
      if (msgs.length === 0) continue;
      content = msgs.map((m) => m.text).join("\n\n");
    }

    const basename = path.basename(jsonlFiles[idx].path, ".jsonl");
    const outPath = path.join(outputDir, `${String(idx).padStart(3, "0")}_${basename}.txt`);
    fs.writeFileSync(outPath, content);
    extracted.push(outPath);
  }

  if (extracted.length === 0) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    return { error: "No parseable conversation content found in sessions." };
  }

  const snapshot = buildVaultSnapshot(vaultDir);
  const snapshotPath = path.join(outputDir, "vault-snapshot.md");
  fs.writeFileSync(snapshotPath, snapshot);

  const numBatches = Math.max(2, Math.min(8, Math.ceil(extracted.length / 20)));
  const batchSize = Math.max(1, Math.ceil(extracted.length / numBatches));
  const batchDir = path.join(outputDir, "batches");
  fs.mkdirSync(batchDir, { recursive: true });
  const batchPaths: string[] = [];

  for (let b = 0; b < numBatches; b++) {
    const batchFiles = extracted.slice(b * batchSize, (b + 1) * batchSize);
    if (batchFiles.length === 0) continue;
    const manifestPath = path.join(batchDir, `batch_${b}.txt`);
    fs.writeFileSync(manifestPath, batchFiles.join("\n") + "\n");
    batchPaths.push(manifestPath);
  }

  return {
    conversationCount: extracted.length,
    batches: batchPaths,
    outputDir,
    snapshotPath,
  };
}

export function buildRuminatePrompt(extraction: ExtractionResult, vaultDir: string): string {
  const tasks = extraction.batches.map((manifestPath) =>
    `{ "agent": "memory-miner", "task": "Read the batch manifest at ${manifestPath} — it lists conversation file paths, one per line. Read each conversation file. Also read the vault snapshot at ${extraction.snapshotPath} to see what knowledge is already captured. Return high-signal findings in markdown." }`
  );

  return `# Ruminate

Mine ${extraction.conversationCount} past sessions for uncaptured patterns.

## Step 1: Mine sessions

Call the subagent tool with parallel tasks to mine conversation batches:

\`\`\`json
{
  "tasks": [
    ${tasks.join(",\n    ")}
  ]
}
\`\`\`

## Step 2: Process findings

After all miners complete:

1. Read all findings across batches. Deduplicate semantically — merge findings that describe the same insight in different words.
2. Filter by frequency and impact. Prefer recurring patterns over one-offs. Discard aggressively — 3 high-signal findings beats 9 with noise.
3. Present a consolidated table with columns: finding, frequency/evidence, proposed action.
4. Ask which findings to persist.
5. Route each approved finding:
   - **Memory vault**: Create or update files under \`${vaultDir}/\`. One topic per file, use \`[[wikilinks]]\`, prefer updating existing notes over creating new ones. Project-specific notes go under \`${vaultDir}/projects/<project-name>/\`.
   - **Skill files**: If a finding is about how a specific skill works, update the skill's SKILL.md directly.
6. Update \`${vaultDir}/index.md\` if files were added or removed.
7. Call log_operation with type='ruminate' when done.

## Cleanup

After processing, delete the temp directory: \`${extraction.outputDir}\``;
}
