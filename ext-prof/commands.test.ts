import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "./commands.ts";

test("on/off/status lifecycle", async () => {
  let patchCalls = 0;
  const controller = createController({
    patch: async () => {
      patchCalls += 1;
      return {
        patched: true,
        reason: "patched",
        coverage: { events: "instrumented", commands: "instrumented", tools: "instrumented" },
      };
    },
    save: async () => "/tmp/snapshot.jsonl",
    projectName: "sample-project",
    homeDir: "/home/tester",
    reset: () => {},
  });

  assert.match(await controller.handle("status"), /enabled: off/);
  assert.match(await controller.handle("on"), /enabled: on/);
  assert.equal(patchCalls, 1);
  assert.match(await controller.handle("off"), /enabled: off/);
});

test("save uses default ~/.pi/profiles/<project>/<timestamp>.jsonl", async () => {
  let savedPath = "";
  const controller = createController({
    patch: async () => ({
      patched: true,
      reason: "patched",
      coverage: { events: "instrumented", commands: "instrumented", tools: "instrumented" },
    }),
    save: async (outputPath) => {
      savedPath = outputPath;
      return outputPath;
    },
    projectName: "sample-project",
    homeDir: "/home/tester",
    reset: () => {},
  });

  await controller.handle("save");
  assert.match(savedPath, /\/home\/tester\/\.pi\/profiles\/sample-project\/.+\.jsonl$/);
});
