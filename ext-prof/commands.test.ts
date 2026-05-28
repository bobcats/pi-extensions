import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "./commands.ts";
import type { RecorderStatus } from "./runtime.ts";

function runtimeMock(status: RecorderStatus = { active: false, seq: 0, consecutiveWriteFailures: 0 }) {
  const calls: string[] = [];
  let current = status;
  return {
    calls,
    runtime: {
      start: async () => {
        calls.push("start");
        current = { ...current, active: true, runId: "run-1", outputPath: "/profiles/run.jsonl" };
        return current;
      },
      stop: async (reason = "off") => {
        calls.push(`stop:${reason}`);
        current = { active: false, seq: current.seq, consecutiveWriteFailures: 0, disabledReason: reason };
        return current;
      },
      flush: async () => {
        calls.push("flush");
        return current;
      },
      status: () => current,
    },
  };
}

test("on patches before starting runtime and off stops the active run", async () => {
  let patchCalls = 0;
  const { runtime, calls } = runtimeMock();
  const controller = createController({
    patch: async () => {
      patchCalls += 1;
      return {
        patched: true,
        reason: "patched",
        coverage: { events: "instrumented", commands: "instrumented", tools: "instrumented" },
      };
    },
    runtime,
    renderReport: async () => "report",
  });

  assert.match(await controller.handle("status"), /recording: off/);
  assert.match(await controller.handle("on"), /recording: on/);
  assert.equal(patchCalls, 1);
  assert.deepEqual(calls, ["start"]);
  assert.match(await controller.handle("off"), /recording: off/);
  assert.deepEqual(calls, ["start", "stop:off"]);
});

test("on fails without enabling when patching fails", async () => {
  const { runtime, calls } = runtimeMock();
  const controller = createController({
    patch: async () => ({
      patched: false,
      reason: "runner import failed",
      coverage: { events: "missing", commands: "missing", tools: "missing" },
    }),
    runtime,
    renderReport: async () => "report",
  });

  const response = await controller.handle("on");

  assert.match(response, /recording: off/);
  assert.match(response, /patch: runner import failed/);
  assert.deepEqual(calls, []);
});

test("empty args force-flush active recording before rendering the report for the invocation cwd", async () => {
  const { runtime, calls } = runtimeMock({ active: true, runId: "run-1", outputPath: "/profiles/run.jsonl", seq: 0, consecutiveWriteFailures: 0 });
  const reportCwds: Array<string | undefined> = [];
  const controller = createController({
    patch: async () => ({
      patched: true,
      reason: "patched",
      coverage: { events: "instrumented", commands: "instrumented", tools: "instrumented" },
    }),
    runtime,
    renderReport: async ({ currentCwd }) => {
      reportCwds.push(currentCwd);
      return "global report";
    },
  });

  assert.equal(await controller.handle("", { cwd: "/invocation-repo" }), "global report");
  assert.deepEqual(calls, ["flush"]);
  assert.deepEqual(reportCwds, ["/invocation-repo"]);
});

test("save and reset are no longer public subcommands", async () => {
  const { runtime } = runtimeMock();
  const controller = createController({
    patch: async () => ({
      patched: true,
      reason: "patched",
      coverage: { events: "instrumented", commands: "instrumented", tools: "instrumented" },
    }),
    runtime,
    renderReport: async () => "report",
  });

  assert.equal(await controller.handle("save"), "unknown subcommand: save");
  assert.equal(await controller.handle("reset"), "unknown subcommand: reset");
});
