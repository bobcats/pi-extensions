import type { ProfileReport } from "./report.ts";
import type { RecorderStatus } from "./runtime.ts";

export function formatStatus(args: {
  runtime: RecorderStatus;
  patch?: { reason: string };
}): string {
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
