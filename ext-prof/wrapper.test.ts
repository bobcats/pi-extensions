import test from "node:test";
import assert from "node:assert/strict";
import { createCollector, summarizeByHandler } from "./collector.ts";
import { wrapEventHandler } from "./wrapper.ts";

test("awaits async handler before recording duration", async () => {
  const collector = createCollector({ maxHandlers: 10_000 });
  const ticks = [10, 35];
  const now = () => ticks.shift() ?? 35;

  const wrapped = wrapEventHandler({
    extensionPath: "slow-a.ts",
    eventType: "turn_start",
    collector,
    handler: async () => Promise.resolve(),
    now,
  });

  await wrapped({ type: "turn_start" }, {});

  const row = summarizeByHandler(collector)[0];
  assert.equal(row?.totalMs, 25);
});

test("preserves thrown error and records errorCount", async () => {
  const collector = createCollector({ maxHandlers: 10_000 });
  const ticks = [1, 1];
  const now = () => ticks.shift() ?? 1;
  const expected = new Error("boom");

  const wrapped = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    collector,
    handler: async () => {
      throw expected;
    },
    now,
  });

  await assert.rejects(() => wrapped({ type: "turn_start" }, {}), expected);
  assert.equal(summarizeByHandler(collector)[0]?.errorCount, 1);
});

test("preserves return value when recording is disabled", async () => {
  const collector = createCollector({ maxHandlers: 10_000 });

  const wrapped = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    collector,
    shouldRecord: () => false,
    handler: async () => "ok",
  });

  const result = await wrapped({ type: "turn_start" }, {});

  assert.equal(result, "ok");
  assert.equal(summarizeByHandler(collector).length, 0);
});

test("preserves thrown error when recording is disabled", async () => {
  const collector = createCollector({ maxHandlers: 10_000 });
  const expected = new Error("boom");

  const wrapped = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    collector,
    shouldRecord: () => false,
    handler: async () => {
      throw expected;
    },
  });

  await assert.rejects(() => wrapped({ type: "turn_start" }, {}), expected);
  assert.equal(summarizeByHandler(collector).length, 0);
});
