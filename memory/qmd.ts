// memory/qmd.ts
//
// Thin wrapper around the `qmd` CLI. All QMD interaction goes through here.
// If qmd is not installed, all functions degrade gracefully (return empty/false).

import { execFile, execFileSync } from "node:child_process";

const QMD_BIN = "qmd";
const COLLECTION_NAME = "memory";
const VIRTUAL_PATH_PREFIX = `qmd://${COLLECTION_NAME}/`;

/** Convert a QMD virtual path (qmd://memory/...) to a filesystem path under the vault. */
export function toVaultPath(vaultDir: string, qmdPath: string): string {
  if (qmdPath.startsWith(VIRTUAL_PATH_PREFIX)) {
    return vaultDir + "/" + qmdPath.slice(VIRTUAL_PATH_PREFIX.length);
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

/** Build the QMD CLI arguments for semantic vault search. */
export function buildSearchArgs(
  query: string,
  options?: { limit?: number; minScore?: number },
): string[] {
  const limit = options?.limit ?? 5;
  const minScore = options?.minScore ?? 0;
  const args = ["vsearch", query, "--json", "-n", String(limit)];
  if (minScore > 0) args.push("--min-score", String(minScore));
  args.push("-c", COLLECTION_NAME);
  return args;
}

/**
 * Run semantic QMD search (`qmd vsearch --json`) and parse results.
 * Returns [] if qmd is not available or the query fails.
 */
export function search(
  query: string,
  options?: { limit?: number; minScore?: number },
): Promise<QmdSearchResult[]> {
  const args = buildSearchArgs(query, options);

  return new Promise((resolve) => {
    execFile(QMD_BIN, args, { timeout: 120_000 }, (err, stdout, stderr) => {
      if (stderr?.trim()) {
        console.warn(`qmd vsearch stderr: ${stderr.trim()}`);
      }
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(stdout);
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
export function update(): Promise<void> {
  return new Promise((resolve) => {
    execFile(QMD_BIN, ["update", "-c", COLLECTION_NAME], { timeout: 30_000 }, () => {
      resolve();
    });
  });
}

/**
 * Ensure the memory vault is registered as a QMD collection.
 * Idempotent — just tries `collection add` and treats "already exists" as success.
 */
export function ensureCollection(vaultDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      QMD_BIN,
      ["collection", "add", vaultDir, "--name", COLLECTION_NAME],
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(true);
          return;
        }
        // "already exists" is success
        if (stderr?.includes("already exists") || stdout?.includes("already exists")) {
          resolve(true);
          return;
        }
        resolve(false);
      },
    );
  });
}
