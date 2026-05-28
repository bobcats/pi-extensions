import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Aggregate, HandlerAggregate, Surface } from "./collector.ts";
import type { AggregateDeltaRow } from "./persistence.ts";

export type ExtensionReportRow = Aggregate & {
  extensionPath: string;
};

export type ProfileReport = {
  extensions: ExtensionReportRow[];
  handlers: HandlerAggregate[];
};

const keyOf = (cwd: string, extensionPath: string, surface: string, name: string) =>
  `${cwd}\u001f${extensionPath}\u001f${surface}\u001f${name}`;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isSurface(value: unknown): value is Surface {
  return value === "event" || value === "command" || value === "tool";
}

function isAggregateDeltaRow(value: unknown): value is AggregateDeltaRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.schemaVersion === 2 &&
    row.type === "aggregate_delta" &&
    isNonEmptyString(row.runId) &&
    isPositiveInteger(row.seq) &&
    isNonEmptyString(row.windowStart) &&
    isNonEmptyString(row.windowEnd) &&
    isNonEmptyString(row.cwd) &&
    isNonEmptyString(row.extensionPath) &&
    isSurface(row.surface) &&
    isNonEmptyString(row.name) &&
    isPositiveInteger(row.calls) &&
    isNonNegativeFiniteNumber(row.totalMs) &&
    isNonNegativeFiniteNumber(row.maxMs) &&
    isNonNegativeInteger(row.errorCount) &&
    row.errorCount <= row.calls &&
    row.maxMs <= row.totalMs
  );
}

function addAggregate(target: Aggregate, delta: Aggregate): void {
  target.calls += delta.calls;
  target.totalMs += delta.totalMs;
  target.maxMs = Math.max(target.maxMs, delta.maxMs);
  target.errorCount += delta.errorCount;
}

export function aggregateDeltas(rows: AggregateDeltaRow[]): ProfileReport {
  const extensions = new Map<string, ExtensionReportRow>();
  const handlers = new Map<string, HandlerAggregate>();

  for (const row of rows) {
    const extension = extensions.get(row.extensionPath) ?? {
      extensionPath: row.extensionPath,
      calls: 0,
      totalMs: 0,
      maxMs: 0,
      errorCount: 0,
    };
    addAggregate(extension, row);
    extensions.set(row.extensionPath, extension);

    const handlerKey = keyOf(row.cwd, row.extensionPath, row.surface, row.name);
    const handler = handlers.get(handlerKey) ?? {
      cwd: row.cwd,
      extensionPath: row.extensionPath,
      surface: row.surface,
      name: row.name,
      calls: 0,
      totalMs: 0,
      maxMs: 0,
      errorCount: 0,
    };
    addAggregate(handler, row);
    handlers.set(handlerKey, handler);
  }

  return {
    extensions: [...extensions.values()].sort((a, b) => b.totalMs - a.totalMs),
    handlers: [...handlers.values()].sort((a, b) => b.totalMs - a.totalMs),
  };
}

async function readJsonlDeltas(filePath: string): Promise<AggregateDeltaRow[]> {
  const text = await readFile(filePath, "utf8");
  const rows: AggregateDeltaRow[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isAggregateDeltaRow(parsed)) {
        rows.push(parsed);
      }
    } catch (error) {
      void error;
      // Ignore malformed/partial lines so reports can read actively appended files.
    }
  }

  return rows;
}

export async function readProfileReport(args: { profileDir: string }): Promise<ProfileReport> {
  let entries: string[];
  try {
    entries = await readdir(args.profileDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { extensions: [], handlers: [] };
    }
    throw error;
  }

  const rows: AggregateDeltaRow[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".jsonl")) continue;
    rows.push(...(await readJsonlDeltas(path.join(args.profileDir, entry))));
  }

  return aggregateDeltas(rows);
}
