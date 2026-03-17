import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { OperationResult, OperationStatus, MemoryState } from "./types.js";

/** Raw shape of an operation entry in memory-operations.jsonl. */
interface RawOperationEntry {
  type?: string;
  operationType?: string;
  status?: string;
  description?: string;
  findingsCount?: number;
  filesChanged?: string[];
  durationMs?: number;
  timestamp?: number;
  cycle?: number;
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export const STATUS_ICONS: Record<OperationStatus, string> = {
  keep: "✓",
  noop: "·",
  cancelled: "✗",
  error: "✗",
};

export function parseOperationsJSONL(content: string): OperationResult[] {
  const operations: OperationResult[] = [];
  const lines = content.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const entry: RawOperationEntry = JSON.parse(line);
      if (entry.type === "config") continue;
      operations.push({
        type: entry.operationType ?? "reflect",
        status: entry.status ?? "keep",
        description: entry.description ?? "",
        findingsCount: entry.findingsCount ?? 0,
        filesChanged: entry.filesChanged ?? [],
        durationMs: entry.durationMs ?? 0,
        timestamp: entry.timestamp ?? 0,
        cycle: entry.cycle,
      });
    } catch {
      // Skip malformed lines
    }
  }
  return operations;
}

export function renderDashboardLines(
  st: MemoryState,
  width: number,
  th: Theme,
  fileCount: number,
  maxRows: number = 6,
): string[] {
  const lines: string[] = [];

  if (st.operations.length === 0) {
    lines.push(`  ${th.fg("dim", "No operations yet.")}`);
    return lines;
  }

  const kept = st.operations.filter((r) => r.status === "keep").length;
  const noop = st.operations.filter((r) => r.status === "noop").length;
  const errors = st.operations.filter((r) => r.status === "error" || r.status === "cancelled").length;

  lines.push(
    truncateToWidth(
      `  ${th.fg("muted", "Vault:")} ${th.fg("text", `${fileCount} files`)}` +
        `  ${th.fg("muted", "Ops:")} ${th.fg("text", String(st.operations.length))}` +
        `  ${th.fg("success", `${kept} kept`)}` +
        (noop > 0 ? `  ${th.fg("dim", `${noop} noop`)}` : "") +
        (errors > 0 ? `  ${th.fg("error", `${errors} errors`)}` : ""),
      width
    )
  );

  lines.push("");

  const col = { idx: 3, type: 10, status: 10, findings: 9, duration: 8 };
  const descW = Math.max(10, width - col.idx - col.type - col.status - col.findings - col.duration - 6);

  const headerLine =
    `  ${th.fg("muted", "#".padEnd(col.idx))}` +
    `${th.fg("muted", "type".padEnd(col.type))}` +
    `${th.fg("muted", "status".padEnd(col.status))}` +
    `${th.fg("muted", "findings".padEnd(col.findings))}` +
    `${th.fg("muted", "time".padEnd(col.duration))}` +
    `${th.fg("muted", "description")}`;

  lines.push(truncateToWidth(headerLine, width));
  lines.push(truncateToWidth(`  ${th.fg("borderMuted", "─".repeat(width - 4))}`, width));

  const effectiveMax = maxRows <= 0 ? st.operations.length : maxRows;
  const startIdx = Math.max(0, st.operations.length - effectiveMax);

  if (startIdx > 0) {
    lines.push(truncateToWidth(
      `  ${th.fg("dim", `… ${startIdx} earlier op${startIdx === 1 ? "" : "s"}`)}`,
      width,
    ));
  }

  for (let i = startIdx; i < st.operations.length; i++) {
    const r = st.operations[i];
    const color: Parameters<typeof th.fg>[0] =
      r.status === "keep" ? "success"
      : r.status === "error" || r.status === "cancelled" ? "error"
      : "dim";

    const icon = STATUS_ICONS[r.status];
    const rowLine =
      `  ${th.fg("dim", String(i + 1).padEnd(col.idx))}` +
      `${th.fg("accent", r.type.padEnd(col.type))}` +
      `${th.fg(color, `${icon} ${r.status}`.padEnd(col.status))}` +
      `${th.fg(r.findingsCount > 0 ? "text" : "dim", String(r.findingsCount).padEnd(col.findings))}` +
      `${th.fg("dim", formatElapsed(r.durationMs).padEnd(col.duration))}` +
      `${th.fg("muted", r.description.slice(0, descW))}`;

    lines.push(truncateToWidth(rowLine, width));
  }

  return lines;
}
