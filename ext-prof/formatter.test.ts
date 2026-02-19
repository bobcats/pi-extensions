import test from "node:test";
import assert from "node:assert/strict";
import { formatStatus, formatVerboseReport } from "./formatter.ts";

test("status prints per-surface coverage", () => {
  const text = formatStatus({
    enabled: true,
    patch: { patched: true, reason: "patched" },
    coverage: { events: "instrumented", commands: "missing", tools: "instrumented" },
  });

  assert.match(text, /events: instrumented/);
  assert.match(text, /commands: missing/);
  assert.match(text, /tools: instrumented/);
});

test("verbose report includes overhead warning", () => {
  const text = formatVerboseReport({
    rows: [
      {
        extensionPath: "a.ts",
        calls: 2,
        totalMs: 20,
        maxMs: 12,
        errorCount: 1,
        handlers: [
          { surface: "event", name: "turn_start", calls: 2, totalMs: 20, maxMs: 12, errorCount: 1 },
        ],
      },
    ],
    patchReason: "patched",
    overhead: { goalPct: 1, observedPct: 1.8 },
  });

  assert.match(text, /OVERHEAD WARNING/);
  assert.match(text, /a.ts/);
  assert.match(text, /event:turn_start/);
});
