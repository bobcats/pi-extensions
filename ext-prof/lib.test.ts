import test from "node:test";
import assert from "node:assert/strict";
import {
  createCollector,
  recordInvocation,
  summarizeByExtension,
} from "./collector.ts";
import { wrapEventHandler } from "./wrapper.ts";

test("compat exports provide extension aggregation", () => {
  const collector = createCollector({ maxHandlers: 10_000 });

  recordInvocation(collector, {
    extensionPath: "a.ts",
    surface: "event",
    name: "turn_start",
    ms: 10,
    ok: true,
  });
  recordInvocation(collector, {
    extensionPath: "a.ts",
    surface: "event",
    name: "turn_end",
    ms: 15,
    ok: true,
  });

  assert.deepEqual(summarizeByExtension(collector), [
    { extensionPath: "a.ts", totalMs: 25, calls: 2, maxMs: 15, errorCount: 0 },
  ]);
});

test("wrapEventHandler records durations", async () => {
  const collector = createCollector({ maxHandlers: 10_000 });
  const ticks = [100, 140];
  const now = () => ticks.shift() ?? 140;

  const wrapped = wrapEventHandler({
    extensionPath: "slow-a.ts",
    eventType: "turn_start",
    collector,
    handler: async () => {
      // noop
    },
    now,
  });

  await wrapped({ type: "turn_start" }, {});

  const rows = summarizeByExtension(collector);
  assert.equal(rows[0]?.extensionPath, "slow-a.ts");
  assert.equal(rows[0]?.calls, 1);
  assert.equal(rows[0]?.totalMs, 40);
});
