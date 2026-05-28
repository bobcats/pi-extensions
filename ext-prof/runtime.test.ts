import test from "node:test";
import assert from "node:assert/strict";
import { createRecorderRuntime, getGlobalRecorderRuntime, resetGlobalRecorderRuntimeForTests } from "./runtime.ts";
import type { ProfileRow } from "./persistence.ts";

function makeRuntime(overrides: Partial<Parameters<typeof createRecorderRuntime>[0]> = {}) {
  const writes: Array<{ outputPath: string; rows: ProfileRow[] }> = [];
  const timers: Array<{ ms: number; unrefCalled: boolean; callback: () => void }> = [];
  let tick = 0;
  const runtime = createRecorderRuntime({
    homeDir: "/home/tester",
    now: () => new Date(Date.UTC(2026, 1, 17, 0, 0, 0, tick++ * 10_000)).toISOString(),
    randomId: () => "run-1",
    appendRows: async (outputPath, rows) => {
      writes.push({ outputPath, rows });
    },
    setInterval: (callback, ms) => {
      const timer = { ms, unrefCalled: false, callback };
      timers.push(timer);
      return { unref: () => { timer.unrefCalled = true; } };
    },
    clearInterval: () => {},
    ...overrides,
  });
  return { runtime, writes, timers };
}

test("start writes recording_start once and starts one unref'd flush timer", async () => {
  const { runtime, writes, timers } = makeRuntime();

  const first = await runtime.start();
  const second = await runtime.start();

  assert.equal(first.active, true);
  assert.equal(second.active, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.rows[0]?.type, "recording_start");
  assert.match(writes[0]?.outputPath ?? "", /\/home\/tester\/\.pi\/profiles\/ext-prof\/v2\/.*-run-1\.jsonl$/);
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.ms, 10_000);
  assert.equal(timers[0]?.unrefCalled, true);
});

test("record updates memory only and flush writes self-contained aggregate deltas", async () => {
  const { runtime, writes } = makeRuntime();
  await runtime.start();

  runtime.record({ cwd: "/repo", extensionPath: "a.ts", surface: "tool", name: "run", ms: 12, ok: true });
  runtime.record({ cwd: "/repo", extensionPath: "a.ts", surface: "tool", name: "run", ms: 8, ok: false });

  assert.equal(writes.length, 1);
  await runtime.flush();

  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1]?.rows, [
    {
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-1",
      seq: 1,
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:10.000Z",
      cwd: "/repo",
      extensionPath: "a.ts",
      surface: "tool",
      name: "run",
      calls: 2,
      totalMs: 20,
      maxMs: 12,
      errorCount: 1,
    },
  ]);

  await runtime.flush();
  assert.equal(writes.length, 2);
  assert.equal(runtime.status().seq, 1);
});

test("stop drains deltas, waits for writes, records end, clears active collectors, and inactive stop is safe", async () => {
  const { runtime, writes } = makeRuntime();
  await runtime.start();
  runtime.record({ cwd: "/repo", extensionPath: "a.ts", surface: "command", name: "foo", ms: 5, ok: true });

  const stopped = await runtime.stop("off");
  const stoppedAgain = await runtime.stop("off");

  assert.equal(stopped.active, false);
  assert.equal(stoppedAgain.active, false);
  assert.deepEqual(writes.map((write) => write.rows.map((row) => row.type)), [
    ["recording_start"],
    ["aggregate_delta"],
    ["recording_end"],
  ]);
  assert.equal(writes[2]?.rows[0]?.type, "recording_end");
  assert.equal(writes[2]?.rows[0]?.reason, "off");
  runtime.record({ cwd: "/repo", extensionPath: "a.ts", surface: "command", name: "foo", ms: 5, ok: true });
  await runtime.flush();
  assert.equal(writes.length, 3);
});

test("stop disables recording before awaiting the final flush write", async () => {
  let releaseFlush: () => void = () => {};
  const flushBlocked = new Promise<void>((resolve) => {
    releaseFlush = resolve;
  });
  const writes: ProfileRow[][] = [];
  const { runtime } = makeRuntime({
    appendRows: async (_outputPath, rows) => {
      writes.push(rows);
      if (rows[0]?.type === "aggregate_delta") {
        await flushBlocked;
      }
    },
  });
  await runtime.start();
  runtime.record({ cwd: "/repo-before", extensionPath: "a.ts", surface: "event", name: "before-stop", ms: 5, ok: true });

  const stopping = runtime.stop("off");
  await Promise.resolve();
  runtime.record({ cwd: "/repo-during-stop", extensionPath: "a.ts", surface: "event", name: "during-stop", ms: 99, ok: true });
  releaseFlush();
  await stopping;

  assert.deepEqual(
    writes.flatMap((rows) => rows.filter((row) => row.type === "aggregate_delta").map((row) => row.name)),
    ["before-stop"],
  );
  assert.equal(runtime.status().active, false);
  assert.equal(runtime.status().lastCwd, "/repo-before");
});

test("initial write failure leaves recording inactive", async () => {
  const { runtime } = makeRuntime({ appendRows: async () => { throw new Error("disk full"); } });

  const status = await runtime.start();

  assert.equal(status.active, false);
  assert.match(status.lastWriteError ?? "", /disk full/);
});

test("three consecutive flush write failures auto-disable recording and preserve last error", async () => {
  const writes: ProfileRow[][] = [];
  const { runtime } = makeRuntime({
    appendRows: async (_outputPath, rows) => {
      writes.push(rows);
      if (rows[0]?.type === "aggregate_delta") throw new Error("write failed");
    },
  });
  await runtime.start();

  for (let i = 0; i < 3; i += 1) {
    runtime.record({ cwd: "/repo", extensionPath: "a.ts", surface: "event", name: `event-${i}`, ms: 1, ok: true });
    await runtime.flush();
  }

  const status = runtime.status();
  assert.equal(status.active, false);
  assert.equal(status.disabledReason, "write_failures");
  assert.equal(status.consecutiveWriteFailures, 3);
  assert.match(status.lastWriteError ?? "", /write failed/);
  assert.ok(writes.some((rows) => rows[0]?.type === "recording_end" && rows[0].reason === "write_failures"));
});

test("global recorder runtime is a singleton across lookups", () => {
  resetGlobalRecorderRuntimeForTests();
  const first = getGlobalRecorderRuntime({ homeDir: "/home/tester" });
  const second = getGlobalRecorderRuntime({ homeDir: "/home/other" });

  assert.equal(first, second);
  resetGlobalRecorderRuntimeForTests();
});
