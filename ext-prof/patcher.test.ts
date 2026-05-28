import test from "node:test";
import assert from "node:assert/strict";
import { patchRunnerPrototype } from "./patcher.ts";
import type { RecordSample } from "./runtime.ts";

function createFakeRunnerCtor() {
  return class FakeRunner {
    extensions = [
      {
        path: "a.ts",
        handlers: new Map([["turn_start", [async () => {}]]]),
        commands: new Map([["hello", { name: "hello", handler: async () => {} }]]),
        tools: new Map([
          [
            "tool-a",
            {
              definition: {
                name: "tool-a",
                label: "Tool A",
                description: "",
                parameters: {} as never,
                execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
              },
              extensionPath: "a.ts",
            },
          ],
        ]),
      },
    ];

    bindCore() {
      return undefined;
    }
  };
}

function recorder(records: RecordSample[]) {
  return {
    record: (sample: RecordSample) => {
      records.push(sample);
    },
    status: () => ({ active: true, seq: 0, consecutiveWriteFailures: 0 }),
  };
}

test("patches all three surfaces and reports coverage", async () => {
  const FakeRunner = createFakeRunnerCtor();
  const records: RecordSample[] = [];
  const status = patchRunnerPrototype({ RunnerCtor: FakeRunner as never, getRuntime: () => recorder(records) });

  const runner = new FakeRunner();
  runner.bindCore();

  await runner.extensions[0].handlers.get("turn_start")?.[0]({ type: "turn_start" }, { cwd: "/repo-event" });
  await runner.extensions[0].commands.get("hello")?.handler("", { cwd: "/repo-command" } as never);
  await runner.extensions[0].tools
    .get("tool-a")
    ?.definition.execute("id", {} as never, undefined, undefined, { cwd: "/repo-tool" } as never);

  assert.equal(status.coverage.events, "instrumented");
  assert.equal(status.coverage.commands, "instrumented");
  assert.equal(status.coverage.tools, "instrumented");
  assert.deepEqual(records.map((record) => [record.surface, record.cwd]), [
    ["event", "/repo-event"],
    ["command", "/repo-command"],
    ["tool", "/repo-tool"],
  ]);
});

test("wrapped handlers look up runtime at invocation time to avoid stale collectors", async () => {
  const FakeRunner = createFakeRunnerCtor();
  const firstRecords: RecordSample[] = [];
  const secondRecords: RecordSample[] = [];
  let currentRuntime = recorder(firstRecords);
  patchRunnerPrototype({ RunnerCtor: FakeRunner as never, getRuntime: () => currentRuntime });

  const runner = new FakeRunner();
  runner.bindCore();
  currentRuntime = recorder(secondRecords);

  await runner.extensions[0].commands.get("hello")?.handler("", { cwd: "/repo" } as never);

  assert.equal(firstRecords.length, 0);
  assert.equal(secondRecords.length, 1);
});
