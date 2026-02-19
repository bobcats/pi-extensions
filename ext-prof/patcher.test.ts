import test from "node:test";
import assert from "node:assert/strict";
import { createCollector, summarizeByHandler } from "./collector.ts";
import { patchRunnerPrototype } from "./patcher.ts";

class FakeRunner {
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
}

test("patches all three surfaces and reports coverage", async () => {
  const collector = createCollector({ maxHandlers: 10_000 });
  const status = patchRunnerPrototype({ RunnerCtor: FakeRunner as never, collector });

  const runner = new FakeRunner();
  runner.bindCore();

  await runner.extensions[0].handlers.get("turn_start")?.[0]({ type: "turn_start" }, {});
  await runner.extensions[0].commands.get("hello")?.handler("", {} as never);
  await runner.extensions[0].tools
    .get("tool-a")
    ?.definition.execute("id", {} as never, undefined, undefined, {} as never);

  assert.equal(status.coverage.events, "instrumented");
  assert.equal(status.coverage.commands, "instrumented");
  assert.equal(status.coverage.tools, "instrumented");
  assert.equal(summarizeByHandler(collector).length, 3);
});
