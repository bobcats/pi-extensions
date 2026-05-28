import path from "node:path";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import type { Surface } from "./collector.ts";

export type RecordingStartRow = {
  schemaVersion: 2;
  type: "recording_start";
  runId: string;
  startedAt: string;
};

export type AggregateDeltaRow = {
  schemaVersion: 2;
  type: "aggregate_delta";
  runId: string;
  seq: number;
  windowStart: string;
  windowEnd: string;
  cwd: string;
  extensionPath: string;
  surface: Surface;
  name: string;
  calls: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
};

export type RecordingEndRow = {
  schemaVersion: 2;
  type: "recording_end";
  runId: string;
  endedAt: string;
  reason: string;
};

export type ProfileRow = RecordingStartRow | AggregateDeltaRow | RecordingEndRow;

export function profileDirectory(homeDir: string): string {
  return path.join(homeDir, ".pi", "profiles", "ext-prof", "v2");
}

export function createProfilePath(args: { homeDir: string; startedAt: string; runId: string }): string {
  const stamp = args.startedAt.replace(/[:.]/g, "-");
  return path.join(profileDirectory(args.homeDir), `${stamp}-${args.runId}.jsonl`);
}

export async function appendProfileRows(outputPath: string, rows: ProfileRow[]): Promise<void> {
  if (rows.length === 0) return;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

export async function saveSnapshot(args: {
  outputPath: string;
  sessionMeta: Record<string, unknown> & { schemaVersion: 1 };
  aggregates: Array<Record<string, unknown>>;
}): Promise<void> {
  await mkdir(path.dirname(args.outputPath), { recursive: true });

  const tmp = `${args.outputPath}.tmp-${process.pid}`;
  const lines = [
    JSON.stringify({ type: "session_meta", ...args.sessionMeta }),
    ...args.aggregates.map((row) => JSON.stringify({ type: "aggregate", ...row })),
  ];

  await writeFile(tmp, `${lines.join("\n")}\n`, "utf8");
  await rename(tmp, args.outputPath);
}
