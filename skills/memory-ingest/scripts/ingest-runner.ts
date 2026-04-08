import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildMarkdownOutput,
  buildOutputBaseName,
  buildWriteTargets as buildTargetsCore,
  classifyIngestInput,
  listExistingRawNames,
  slugifySource,
} from "../../../memory/ingest.ts";

export type RunnerStatus = "ok" | "clarify" | "confirm" | "error";

export type RunnerResult = {
  status: RunnerStatus;
  kind?: string;
  filesWritten?: string[];
  question?: string;
  reason?: string;
};

export type IngestPlan = {
  kind: string;
  method: string;
  source: string;
  baseName: string;
  rawRoot: string;
};

type Payload = {
  inputs?: string[];
  confirm?: boolean;
  rawRoot?: string;
  nowIso?: string;
};

type LocalStats = { files: number; bytes: number; depth: number };

const DEFAULT_RAW_ROOT = path.join(process.env.HOME || process.env.USERPROFILE || ".", ".pi", "memories", "raw");
const DATASET_CAPS = { files: 50, bytes: 100 * 1024 * 1024 };
const REPO_CAPS = { files: 200, bytes: 25 * 1024 * 1024, depth: 4 };
const LOCAL_DIR_CAPS = { files: 100, bytes: 25 * 1024 * 1024, depth: 3 };
const BLOB_CAP = 200 * 1024;
const SUMMARIZE_SCRIPT = "/Users/brian/.agents/skills/summarize/to-markdown.mjs";

async function convertWithSummarize(input: string): Promise<string> {
  const testOutput = process.env.PI_MEMORY_INGEST_TEST_SUMMARIZE_OUTPUT;
  if (testOutput) return testOutput;

  const result = spawnSync("node", [SUMMARIZE_SCRIPT, input], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || "summarize conversion failed").trim());
  }
  return result.stdout;
}

export function planIngest(input: string, options: { nowIso?: string; rawRoot?: string } = {}): IngestPlan {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const classification = classifyIngestInput(input, (value) => {
    try {
      const stat = fs.statSync(value);
      return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
    } catch {
      return { exists: false, isFile: false, isDirectory: false };
    }
  });

  const kind = classification.kind;
  const method =
    kind === "url"
      ? "url-adapter"
      : kind === "local-document"
        ? "local-document-adapter"
        : kind === "local-directory"
          ? "local-directory-adapter"
          : kind === "repo"
            ? "repo-adapter"
            : kind === "dataset"
              ? "dataset-adapter"
              : "pasted-blob-adapter";

  const sourceSlug = slugifySource(input);
  const baseName = buildOutputBaseName(nowIso.slice(0, 10), sourceSlug, listExistingRawNames(options.rawRoot ?? DEFAULT_RAW_ROOT));
  return { kind, method, source: input, baseName, rawRoot: options.rawRoot ?? DEFAULT_RAW_ROOT };
}

export function requiresConfirmationForCaps(
  kind: string,
  stats: Partial<LocalStats> & { bytes?: number; files?: number; depth?: number },
): { required: boolean; reason?: string } {
  if (kind === "local-directory") {
    if ((stats.depth ?? 0) > LOCAL_DIR_CAPS.depth) return { required: true, reason: `Directory depth exceeds ${LOCAL_DIR_CAPS.depth}.` };
    if ((stats.files ?? 0) > LOCAL_DIR_CAPS.files) return { required: true, reason: `Directory file count exceeds ${LOCAL_DIR_CAPS.files}.` };
    if ((stats.bytes ?? 0) > LOCAL_DIR_CAPS.bytes) return { required: true, reason: `Directory size exceeds ${Math.round(LOCAL_DIR_CAPS.bytes / 1024 / 1024)}MB.` };
  }
  if (kind === "repo") {
    if ((stats.depth ?? 0) > REPO_CAPS.depth) return { required: true, reason: `Repo depth exceeds ${REPO_CAPS.depth}.` };
    if ((stats.files ?? 0) > REPO_CAPS.files) return { required: true, reason: `Repo file count exceeds ${REPO_CAPS.files}.` };
    if ((stats.bytes ?? 0) > REPO_CAPS.bytes) return { required: true, reason: `Repo size exceeds ${Math.round(REPO_CAPS.bytes / 1024 / 1024)}MB.` };
  }
  if (kind === "dataset") {
    if ((stats.files ?? 0) > DATASET_CAPS.files) return { required: true, reason: `Dataset file count exceeds ${DATASET_CAPS.files}.` };
    if ((stats.bytes ?? 0) > DATASET_CAPS.bytes) return { required: true, reason: `Dataset size exceeds ${Math.round(DATASET_CAPS.bytes / 1024 / 1024)}MB.` };
  }
  if (kind === "pasted-blob" && (stats.bytes ?? 0) > BLOB_CAP) {
    return { required: true, reason: "Pasted text exceeds 200KB." };
  }
  return { required: false };
}

export function buildWriteTargets(rawRoot: string, baseName: string) {
  return buildTargetsCore(rawRoot, baseName);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeWriteMarkdown(rawRoot: string, baseName: string, content: string): string {
  const targets = buildWriteTargets(rawRoot, baseName);
  ensureDir(rawRoot);
  fs.writeFileSync(targets.markdownPath, content, "utf8");
  return targets.markdownPath;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function stripHtml(html: string): string {
  return normalizeText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " "),
  );
}

function isTextLike(filePath: string): boolean {
  return /\.(md|markdown|txt|json|jsonl|csv|tsv|html?)$/i.test(filePath);
}

function isPreservableFile(filePath: string): boolean {
  return /\.(md|markdown|txt|json|jsonl|csv|tsv|html?|pdf|docx?)$/i.test(filePath);
}

function walkFiles(root: string, maxDepth: number): Array<{ path: string; rel: string; depth: number; stat: fs.Stats }> {
  const results: Array<{ path: string; rel: string; depth: number; stat: fs.Stats }> = [];
  const walk = (dir: string, depth: number, relPrefix = "") => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.join(relPrefix, entry.name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        walk(abs, depth + 1, rel);
      } else if (stat.isFile()) {
        results.push({ path: abs, rel, depth, stat });
      }
    }
  };
  walk(root, 1);
  return results;
}

export async function convertLocalDocumentToMarkdown(
  input: string,
  deps: { convertWithSummarize?: (input: string) => Promise<string> } = {},
): Promise<{ body: string; usedFallback: boolean; note?: string }> {
  if (isTextLike(input)) {
    return { body: normalizeText(fs.readFileSync(input, "utf8")), usedFallback: false };
  }

  const summarize = deps.convertWithSummarize ?? convertWithSummarize;

  try {
    const body = normalizeText(await summarize(input));
    return { body, usedFallback: false };
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    return {
      body: `Fallback conversion used for ${path.basename(input)}. Original preserved alongside summary.\n\nNote: ${note}`,
      usedFallback: true,
      note,
    };
  }
}

async function summarizeLocalPath(input: string, kind: string, nowIso: string): Promise<{ body: string; filesWritten: string[]; stats: LocalStats }> {
  const stat = fs.statSync(input);
  if (stat.isFile()) {
    const converted = await convertLocalDocumentToMarkdown(input);
    return { body: converted.body, filesWritten: [], stats: { files: 1, bytes: stat.size, depth: 1 } };
  }

  const maxDepth = kind === "repo" ? REPO_CAPS.depth : LOCAL_DIR_CAPS.depth;
  const files = walkFiles(input, maxDepth);
  const totalBytes = files.reduce((sum, file) => sum + file.stat.size, 0);
  const actualDepth = files.reduce((max, file) => Math.max(max, file.depth), 1);
  const bodyLines = [
    `Source kind: ${kind}`,
    `Path: ${input}`,
    `Ingested: ${nowIso}`,
    `Files indexed: ${files.length}`,
    "",
    "## Files",
  ];
  for (const file of files.slice(0, 200)) {
    bodyLines.push(`- ${file.rel}`);
  }
  if (files.length === 0) bodyLines.push("- (no supported files found)");

  const convertibleFiles = files.filter((file) => /\.(pdf|docx?|html?)$/i.test(file.path)).slice(0, 20);
  if (convertibleFiles.length > 0) {
    bodyLines.push("", "## Converted document excerpts");
    for (const file of convertibleFiles) {
      const converted = await convertLocalDocumentToMarkdown(file.path);
      bodyLines.push(`### ${file.rel}`, "", converted.body.slice(0, 4000), "");
    }
  }

  return { body: bodyLines.join("\n"), filesWritten: [], stats: { files: files.length, bytes: totalBytes, depth: actualDepth } };
}

function collectLocalArtifacts(input: string, kind: string, rawRoot: string, baseName: string): string[] {
  const targets = buildWriteTargets(rawRoot, baseName);
  ensureDir(targets.assetsDir);
  const written: string[] = [];
  if (fs.statSync(input).isFile()) {
    if (!isTextLike(input)) {
      const dest = path.join(targets.assetsDir, path.basename(input));
      fs.copyFileSync(input, dest);
      written.push(dest);
    }
    return written;
  }

  const maxDepth = kind === "repo" ? REPO_CAPS.depth : LOCAL_DIR_CAPS.depth;
  for (const file of walkFiles(input, maxDepth)) {
    if (!isPreservableFile(file.path)) continue;
    const dest = path.join(targets.assetsDir, file.rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(file.path, dest);
    written.push(dest);
  }
  return written;
}

export async function convertUrlToMarkdown(
  input: string,
  deps: { convertWithSummarize?: (input: string) => Promise<string> } = {},
): Promise<{ body: string; usedFallback: boolean; note?: string }> {
  const summarize = deps.convertWithSummarize ?? convertWithSummarize;

  try {
    const body = normalizeText(await summarize(input));
    return { body, usedFallback: false };
  } catch (error) {
    const fetched = await fetchUrlText(input);
    return {
      body: fetched.body,
      usedFallback: true,
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchUrlText(url: string): Promise<{ body: string; note?: string }> {
  try {
    const res = await fetch(url);
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      return { body: stripHtml(text) };
    }
    return { body: normalizeText(text) };
  } catch (error) {
    return { body: `Fallback ingest for ${url}.\n\nNote: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function run(payload: Payload): Promise<RunnerResult> {
  const inputs = payload.inputs ?? [];
  if (inputs.length === 0) {
    return { status: "clarify", question: "What should I ingest? Please provide a URL, local path, repo, dataset, or pasted text." };
  }

  const rawRoot = payload.rawRoot ?? DEFAULT_RAW_ROOT;
  const nowIso = payload.nowIso ?? new Date().toISOString();

  const results: string[] = [];
  const usedNames = listExistingRawNames(rawRoot);
  for (const input of inputs) {
    const plan = planIngest(input, { nowIso, rawRoot });
    const uniqueBaseName = buildOutputBaseName(nowIso.slice(0, 10), slugifySource(input), usedNames);
    usedNames.add(`${uniqueBaseName}.md`);
    const classification = classifyIngestInput(input, (value) => {
      try {
        const stat = fs.statSync(value);
        return { exists: true, isFile: stat.isFile(), isDirectory: stat.isDirectory() };
      } catch {
        return { exists: false, isFile: false, isDirectory: false };
      }
    });

    if (classification.ambiguous) {
      return {
        status: "clarify",
        kind: classification.kind,
        question: classification.reason ?? "Which source type should I use?",
      };
    }

    if (classification.kind === "pasted-blob") {
      const bytes = Buffer.byteLength(input, "utf8");
      const confirmation = requiresConfirmationForCaps("pasted-blob", { bytes });
      if (confirmation.required && !payload.confirm) {
        return { status: "confirm", kind: "pasted-blob", reason: confirmation.reason };
      }
      const markdown = buildMarkdownOutput(input, plan.method, nowIso, normalizeText(input));
      results.push(safeWriteMarkdown(rawRoot, uniqueBaseName, markdown));
      continue;
    }

    if (classification.kind === "url") {
      const confirmation = requiresConfirmationForCaps("url", {});
      if (confirmation.required && !payload.confirm) {
        return { status: "confirm", kind: "url", reason: confirmation.reason };
      }
      const fetched = await convertUrlToMarkdown(input);
      const markdown = buildMarkdownOutput(input, plan.method, nowIso, fetched.body);
      results.push(safeWriteMarkdown(rawRoot, uniqueBaseName, markdown));
      continue;
    }

    if (classification.kind === "local-document" || classification.kind === "local-directory" || classification.kind === "repo" || classification.kind === "dataset") {
      if (!fs.existsSync(input)) {
        return { status: "error", kind: classification.kind, reason: `Path not found: ${input}` };
      }

      const summary = await summarizeLocalPath(input, classification.kind, nowIso);
      const confirmation = requiresConfirmationForCaps(classification.kind, summary.stats);
      if (confirmation.required && !payload.confirm) {
        return { status: "confirm", kind: classification.kind, reason: confirmation.reason };
      }

      const originalArtifacts = collectLocalArtifacts(input, classification.kind, rawRoot, uniqueBaseName);
      const sourceNote = originalArtifacts.length > 0 ? `\n\nPreserved artifacts:\n${originalArtifacts.map((p) => `- ${p}`).join("\n")}` : "";
      const markdown = buildMarkdownOutput(input, plan.method, nowIso, summary.body + sourceNote);
      results.push(safeWriteMarkdown(rawRoot, uniqueBaseName, markdown));
      continue;
    }

    return { status: "error", kind: classification.kind, reason: `Unsupported input: ${input}` };
  }

  return { status: "ok", filesWritten: results, kind: results.length === 1 ? undefined : "batch" };
}

async function main() {
  const arg = process.argv[2];
  let payload: Payload;
  try {
    payload = JSON.parse(arg ?? "{}");
  } catch (error) {
    console.log(JSON.stringify({ status: "error", reason: `Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}` } satisfies RunnerResult));
    process.exit(1);
  }

  const result = await run(payload);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "error") process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
