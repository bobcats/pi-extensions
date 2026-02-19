export type Surface = "event" | "command" | "tool";

export type Aggregate = {
  calls: number;
  totalMs: number;
  maxMs: number;
  errorCount: number;
};

export type HandlerAggregate = Aggregate & {
  extensionPath: string;
  surface: Surface;
  name: string;
};

export type Collector = {
  maxHandlers: number;
  unknownExtensionKey: string;
  extensionTotals: Map<string, Aggregate>;
  handlerTotals: Map<string, HandlerAggregate>;
  droppedNewKeys: number;
  warnedCardinality: boolean;
};

export function createCollector(args: { maxHandlers: number; unknownExtensionKey?: string }): Collector {
  return {
    maxHandlers: args.maxHandlers,
    unknownExtensionKey: args.unknownExtensionKey ?? "<unknown-extension>",
    extensionTotals: new Map(),
    handlerTotals: new Map(),
    droppedNewKeys: 0,
    warnedCardinality: false,
  };
}

const keyOf = (extensionPath: string, surface: Surface, name: string) =>
  `${extensionPath}\u001f${surface}\u001f${name}`;

function upsertAggregate(target: Map<string, Aggregate>, key: string, ms: number, ok: boolean): Aggregate {
  const row = target.get(key) ?? { calls: 0, totalMs: 0, maxMs: 0, errorCount: 0 };
  row.calls += 1;
  row.totalMs += ms;
  row.maxMs = Math.max(row.maxMs, ms);
  if (!ok) row.errorCount += 1;
  target.set(key, row);
  return row;
}

export function recordInvocation(
  collector: Collector,
  sample: { extensionPath: string | undefined; surface: Surface; name: string; ms: number; ok: boolean },
): void {
  const extensionPath = sample.extensionPath?.trim() ? sample.extensionPath : collector.unknownExtensionKey;
  const handlerKey = keyOf(extensionPath, sample.surface, sample.name);

  if (!collector.handlerTotals.has(handlerKey) && collector.handlerTotals.size >= collector.maxHandlers) {
    collector.droppedNewKeys += 1;
    return;
  }

  upsertAggregate(collector.extensionTotals, extensionPath, sample.ms, sample.ok);

  const row = collector.handlerTotals.get(handlerKey) ?? {
    extensionPath,
    surface: sample.surface,
    name: sample.name,
    calls: 0,
    totalMs: 0,
    maxMs: 0,
    errorCount: 0,
  };

  row.calls += 1;
  row.totalMs += sample.ms;
  row.maxMs = Math.max(row.maxMs, sample.ms);
  if (!sample.ok) row.errorCount += 1;
  collector.handlerTotals.set(handlerKey, row);
}

export function summarizeByExtension(collector: Collector) {
  return [...collector.extensionTotals.entries()]
    .map(([extensionPath, row]) => ({ extensionPath, ...row }))
    .sort((a, b) => b.totalMs - a.totalMs);
}

export function summarizeByHandler(collector: Collector) {
  return [...collector.handlerTotals.values()].sort((a, b) => b.totalMs - a.totalMs);
}

export function resetCollector(collector: Collector): void {
  collector.extensionTotals.clear();
  collector.handlerTotals.clear();
  collector.droppedNewKeys = 0;
  collector.warnedCardinality = false;
}
