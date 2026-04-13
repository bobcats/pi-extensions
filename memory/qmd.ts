// memory/qmd.ts
//
// Thin wrapper around the `qmd` CLI. All QMD interaction goes through here.
// If qmd is not installed, all functions degrade gracefully (return empty/false).

import { execFile, execFileSync } from "node:child_process";

const QMD_BIN = "qmd";
const LEGACY_COLLECTION_NAME = "memory";

function virtualPathPrefix(collection: string): string {
  return `qmd://${collection}/`;
}

export function collectionNameForBrain(brain: string): string {
  return brain === "main" ? LEGACY_COLLECTION_NAME : `memory-${brain}`;
}

/** Convert a QMD virtual path (qmd://collection/...) to a filesystem path under the vault. */
export function toVaultPath(vaultDir: string, qmdPath: string, collection: string): string {
  const prefix = virtualPathPrefix(collection);
  if (qmdPath.startsWith(prefix)) {
    return vaultDir + "/" + qmdPath.slice(prefix.length);
  }
  return qmdPath;
}

/** Check whether `qmd` is on $PATH */
export function isQmdAvailable(): boolean {
  try {
    execFileSync(QMD_BIN, ["--version"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export interface QmdSearchResult {
  file: string;
  title: string;
  score: number;
  snippet: string;
  docid: string;
  context: string | null;
}

/** Raw shape from `qmd search --json` output. */
interface QmdRawResult {
  file?: string;
  displayPath?: string;
  title?: string;
  score?: number;
  snippet?: string;
  docid?: string;
  context?: string | null;
}

function parseResult(r: QmdRawResult): QmdSearchResult {
  return {
    file: r.file ?? r.displayPath ?? "",
    title: r.title ?? "",
    score: r.score ?? 0,
    snippet: r.snippet ?? "",
    docid: r.docid ?? "",
    context: r.context ?? null,
  };
}

/** Build the QMD CLI arguments for hybrid vault search. */
export function buildSearchArgs(
  collection: string,
  query: string,
  options?: { limit?: number; minScore?: number },
): string[] {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0;
  const args = ["query", query, "--json", "-n", String(limit)];
  if (minScore > 0) args.push("--min-score", String(minScore));
  args.push("-c", collection);
  return args;
}

/**
 * Run hybrid QMD search (`qmd query --json`) and parse results.
 * `qmd query` uses auto-expansion + reranking for better relevance.
 * Returns [] if qmd is not available or the query fails.
 */
export function search(
  collection: string,
  query: string,
  options?: { limit?: number; minScore?: number },
): Promise<QmdSearchResult[]> {
  const args = buildSearchArgs(collection, query, options);

  return new Promise((resolve) => {
    execFile(QMD_BIN, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (stderr?.trim()) {
        console.warn(`qmd query stderr: ${stderr.trim()}`);
      }
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const jsonStart = stdout.indexOf("[");
        if (jsonStart < 0) {
          resolve([]);
          return;
        }
        const parsed: unknown = JSON.parse(stdout.slice(jsonStart));
        const items = Array.isArray(parsed) ? (parsed as QmdRawResult[]) : [];
        resolve(items.map(parseResult));
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Run `qmd update` to re-index the memory collection.
 * Fire-and-forget — errors are swallowed.
 */
export function update(collection: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(QMD_BIN, ["update", "-c", collection], { timeout: 30_000 }, () => {
      resolve();
    });
  });
}

/**
 * Run `qmd embed` to generate/refresh vector embeddings.
 * Fire-and-forget — errors are swallowed.
 */
export function embed(collection: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(QMD_BIN, ["embed", "-c", collection], { timeout: 120_000 }, () => {
      resolve();
    });
  });
}

/**
 * Ensure the memory vault is registered as a QMD collection.
 * Idempotent — just tries `collection add` and treats "already exists" as success.
 */
export function ensureCollection(collection: string, vaultDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      QMD_BIN,
      ["collection", "add", vaultDir, "--name", collection],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(true);
          return;
        }
        if (stderr?.includes("already exists") || stdout?.includes("already exists")) {
          resolve(true);
          return;
        }
        resolve(false);
      },
    );
  });
}
