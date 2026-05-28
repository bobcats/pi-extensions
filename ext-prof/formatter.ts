import type { ProfileReport } from "./report.ts";
import type { RecorderStatus } from "./runtime.ts";

export type Coverage = "instrumented" | "missing";

export function formatStatus(args: {
  runtime?: RecorderStatus;
  enabled?: boolean;
  patch?: { patched: boolean; reason: string };
  coverage?: { events: Coverage; commands: Coverage; tools: Coverage };
}): string {
  if (args.runtime) {
    const lines = [`recording: ${args.runtime.active ? "on" : "off"}`];
    if (args.patch) lines.push(`patch: ${args.patch.reason}`);
    if (args.runtime.runId) lines.push(`run: ${args.runtime.runId}`);
    if (args.runtime.outputPath) lines.push(`path: ${args.runtime.outputPath}`);
    lines.push(`seq: ${args.runtime.seq}`);
    if (args.runtime.lastCwd) lines.push(`last cwd: ${args.runtime.lastCwd}`);
    lines.push(`write failures: ${args.runtime.consecutiveWriteFailures}`);
    if (args.runtime.lastWriteError) lines.push(`last write error: ${args.runtime.lastWriteError}`);
    if (args.runtime.disabledReason) lines.push(`disabled: ${args.runtime.disabledReason}`);
    return lines.join("\n");
  }

  return [
    `enabled: ${args.enabled ? "on" : "off"}`,
    `patch: ${args.patch?.reason ?? "unknown"}`,
    `events: ${args.coverage?.events ?? "missing"}`,
    `commands: ${args.coverage?.commands ?? "missing"}`,
    `tools: ${args.coverage?.tools ?? "missing"}`,
  ].join("\n");
}

export type VerboseHandlerRow = {
  surface: string;
  name: string;
  calls: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
};

export type VerboseExtensionRow = {
  extensionPath: string;
  calls: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
  handlers: VerboseHandlerRow[];
};

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function avgMs(totalMs: number, calls: number): string {
  return formatMs(totalMs / Math.max(1, calls));
}

export function formatProfileReport(args: { report: ProfileReport; currentCwd?: string; limit?: number }): string {
  const limit = args.limit ?? 10;
  const lines: string[] = [];

  lines.push("Top extensions (global)");
  if (args.report.extensions.length === 0) {
    lines.push("  no recorded extension activity");
  } else {
    for (const row of args.report.extensions.slice(0, limit)) {
      lines.push(
        `  ${row.extensionPath} total=${formatMs(row.totalMs)} calls=${row.calls} avg=${avgMs(row.totalMs, row.calls)} max=${formatMs(row.maxMs)} errors=${row.errorCount}`,
      );
    }
  }

  lines.push("", "Top handlers (global)");
  if (args.report.handlers.length === 0) {
    lines.push("  no recorded handler activity");
  } else {
    for (const row of args.report.handlers.slice(0, limit)) {
      lines.push(
        `  ${row.cwd} ${row.surface}:${row.name} ${row.extensionPath} total=${formatMs(row.totalMs)} calls=${row.calls} avg=${avgMs(row.totalMs, row.calls)} max=${formatMs(row.maxMs)} errors=${row.errorCount}`,
      );
    }
  }

  if (args.currentCwd) {
    const cwdHandlers = args.report.handlers.filter((row) => row.cwd === args.currentCwd).slice(0, limit);
    if (cwdHandlers.length > 0) {
      lines.push("", `Top handlers (${args.currentCwd})`);
      for (const row of cwdHandlers) {
        lines.push(
          `  ${row.cwd} ${row.surface}:${row.name} ${row.extensionPath} total=${formatMs(row.totalMs)} calls=${row.calls} avg=${avgMs(row.totalMs, row.calls)} max=${formatMs(row.maxMs)} errors=${row.errorCount}`,
        );
      }
    }
  }

  return lines.join("\n");
}

export function formatVerboseReport(args: {
  rows: VerboseExtensionRow[];
  patchReason: string;
  overhead: { goalPct: number; observedPct: number | null };
}): string {
  const header = [
    `patch: ${args.patchReason}`,
    args.overhead.observedPct == null
      ? `overhead goal<=${args.overhead.goalPct}% observed=unknown`
      : `overhead goal<=${args.overhead.goalPct}% observed=${args.overhead.observedPct.toFixed(2)}%${
          args.overhead.observedPct > args.overhead.goalPct ? " OVERHEAD WARNING" : ""
        }`,
  ];

  const body = args.rows.flatMap((row) => [
    `${row.extensionPath} total=${row.totalMs.toFixed(1)}ms calls=${row.calls} avg=${(
      row.totalMs / Math.max(1, row.calls)
    ).toFixed(1)}ms max=${row.maxMs.toFixed(1)}ms errors=${row.errorCount}`,
    ...row.handlers.map(
      (h) =>
        `  ${h.surface}:${h.name} total=${h.totalMs.toFixed(1)}ms calls=${h.calls} max=${h.maxMs.toFixed(1)}ms errors=${h.errorCount}`,
    ),
  ]);

  return [...header, ...body].join("\n");
}
