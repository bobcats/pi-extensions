export type Coverage = "instrumented" | "missing";

export function formatStatus(args: {
  enabled: boolean;
  patch: { patched: boolean; reason: string };
  coverage: { events: Coverage; commands: Coverage; tools: Coverage };
}): string {
  return [
    `enabled: ${args.enabled ? "on" : "off"}`,
    `patch: ${args.patch.reason}`,
    `events: ${args.coverage.events}`,
    `commands: ${args.coverage.commands}`,
    `tools: ${args.coverage.tools}`,
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
