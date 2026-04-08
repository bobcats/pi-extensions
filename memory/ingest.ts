import * as fs from "node:fs";
import * as path from "node:path";

export type IngestKind =
  | "url"
  | "local-document"
  | "local-directory"
  | "repo"
  | "dataset"
  | "pasted-blob"
  | "unknown";

export interface ClassificationResult {
  kind: IngestKind;
  ambiguous: boolean;
  reason?: string;
}

const DATASET_FILE_RE = /\.(csv|parquet|jsonl?|tsv|zip)$/i;
const DOCUMENT_FILE_RE = /\.(pdf|docx?|html?|txt|md|markdown)$/i;

export function classifyIngestInput(
  input: string,
  inspectLocalPath?: (value: string) => { exists: boolean; isFile: boolean; isDirectory: boolean },
): ClassificationResult {
  const value = input.trim();
  if (!value) {
    return { kind: "unknown", ambiguous: true, reason: "Empty input; clarify source." };
  }

  if (/^https?:\/\//i.test(value)) {
    if (/(?:^|[?#&])(format|type)=dataset\b/i.test(value) || DATASET_FILE_RE.test(value)) {
      return { kind: "dataset", ambiguous: false };
    }
    if (/github\.com\//i.test(value) || /\.git(?:[?#]|$)/i.test(value)) {
      return { kind: "repo", ambiguous: false };
    }
    return { kind: "url", ambiguous: false };
  }

  if (/^(git@|ssh:\/\/git@)/i.test(value) || /\.git$/i.test(value)) {
    return { kind: "repo", ambiguous: false };
  }

  if (value.includes("\n") || value.length > 280) {
    return { kind: "pasted-blob", ambiguous: false };
  }

  if (inspectLocalPath) {
    const p = inspectLocalPath(value);
    if (p.exists) {
      return { kind: classifyLocalPath(value, p.isDirectory, p.isFile), ambiguous: false };
    }
  }

  return { kind: "unknown", ambiguous: true, reason: "Unable to classify safely; clarify source type." };
}

export function classifyLocalPath(pathLike: string, isDirectory: boolean, isFile: boolean): IngestKind {
  if (isFile) {
    if (DATASET_FILE_RE.test(pathLike)) return "dataset";
    if (DOCUMENT_FILE_RE.test(pathLike)) return "local-document";
    return "local-document";
  }

  if (isDirectory) {
    if (fs.existsSync(path.join(pathLike, ".git"))) return "repo";
    if (fs.existsSync(path.join(pathLike, "dataset.yaml")) || fs.existsSync(path.join(pathLike, "dataset.json"))) {
      return "dataset";
    }
    return "local-directory";
  }

  return "unknown";
}

export function buildOutputBaseName(date: string, sourceSlug: string, existing: Set<string>): string {
  let i = 1;
  let candidate = `${date}-${sourceSlug}`;
  while (existing.has(`${candidate}.md`)) {
    i += 1;
    candidate = `${date}-${sourceSlug}-${i}`;
  }
  return candidate;
}

export function resolveSafeRawPath(rawRoot: string, relativeTarget: string): string {
  const root = path.resolve(rawRoot);
  const resolved = path.resolve(root, relativeTarget);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Target path is outside raw root");
  }
  return resolved;
}

export function buildProvenanceFrontmatter(source: string, ingestedAtIso: string, method: string): string {
  return `---\nsource: ${source}\ningested_at: ${ingestedAtIso}\nmethod: ${method}\n---\n\n`;
}

export function buildMarkdownOutput(source: string, method: string, ingestedAtIso: string, body: string): string {
  const normalizedBody = body.trim();
  return buildProvenanceFrontmatter(source, ingestedAtIso, method) + normalizedBody + (normalizedBody.endsWith("\n") ? "" : "\n");
}

export function buildWriteTargets(rawRoot: string, baseName: string) {
  return {
    markdownPath: resolveSafeRawPath(rawRoot, `${baseName}.md`),
    assetsDir: resolveSafeRawPath(rawRoot, `${baseName}.assets`),
  };
}

export function slugifySource(source: string): string {
  return source
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64) || "source";
}

export function listExistingRawNames(rawRoot: string): Set<string> {
  try {
    return new Set(fs.readdirSync(rawRoot));
  } catch {
    return new Set();
  }
}
