import test from "node:test";
import assert from "node:assert/strict";
import { wrapEventHandler, wrapToolExecute } from "./wrapper.ts";
import type { RecordSample, RecorderStatus } from "./runtime.ts";

function recorder(records: RecordSample[], status: Partial<RecorderStatus> = {}) {
  return {
    record: (sample: RecordSample) => {
      records.push(sample);
    },
    status: () => ({ active: true, seq: 0, consecutiveWriteFailures: 0, ...status }),
  };
}

test("awaits async handler, captures cwd at invocation start, and records duration", async () => {
  const records: RecordSample[] = [];
  const ticks = [10, 35];
  const now = () => ticks.shift() ?? 35;
  const ctx = { cwd: "/repo-at-start" };

  const wrapped = wrapEventHandler({
    extensionPath: "slow-a.ts",
    eventType: "turn_start",
    getRuntime: () => recorder(records),
    handler: async () => {
      ctx.cwd = "/repo-after-await";
      return Promise.resolve();
    },
    now,
  });

  await wrapped({ type: "turn_start" }, ctx);

  assert.deepEqual(records, [
    { cwd: "/repo-at-start", extensionPath: "slow-a.ts", surface: "event", name: "turn_start", ms: 25, ok: true },
  ]);
});

test("preserves thrown error and records errorCount", async () => {
  const records: RecordSample[] = [];
  const ticks = [1, 1];
  const now = () => ticks.shift() ?? 1;
  const expected = new Error("boom");

  const wrapped = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    getRuntime: () => recorder(records),
    handler: async () => {
      throw expected;
    },
    now,
  });

  await assert.rejects(() => wrapped({ type: "turn_start" }, { cwd: "/repo" }), expected);
  assert.equal(records[0]?.ok, false);
});

test("preserves return value when recording is disabled", async () => {
  const records: RecordSample[] = [];

  const wrapped = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    getRuntime: () => recorder(records),
    shouldRecord: () => false,
    handler: async () => "ok",
  });

  const result = await wrapped({ type: "turn_start" }, { cwd: "/repo" });

  assert.equal(result, "ok");
  assert.equal(records.length, 0);
});

test("preserves thrown error when recording is disabled", async () => {
  const records: RecordSample[] = [];
  const expected = new Error("boom");

  const wrapped = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    getRuntime: () => recorder(records),
    shouldRecord: () => false,
    handler: async () => {
      throw expected;
    },
  });

  await assert.rejects(() => wrapped({ type: "turn_start" }, { cwd: "/repo" }), expected);
  assert.equal(records.length, 0);
});

test("falls back to runtime last cwd and then process cwd", async () => {
  const records: RecordSample[] = [];

  const withLastCwd = wrapEventHandler({
    extensionPath: "a.ts",
    eventType: "turn_start",
    getRuntime: () => recorder(records, { lastCwd: "/last-repo" }),
    handler: async () => undefined,
  });
  await withLastCwd({ type: "turn_start" }, {});

  const withProcessCwd = wrapToolExecute({
    extensionPath: "a.ts",
    toolName: "run",
    getRuntime: () => recorder(records),
    handler: async () => undefined,
  });
  await withProcessCwd("id", {}, undefined, undefined, {});

  assert.equal(records[0]?.cwd, "/last-repo");
  assert.equal(records[1]?.cwd, process.cwd());
});
