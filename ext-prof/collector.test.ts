import test from "node:test";
import assert from "node:assert/strict";
import {
  createCollector,
  recordInvocation,
  summarizeByExtension,
  summarizeByHandler,
} from "./collector.ts";

test("records totals by extension/surface/name", () => {
  const collector = createCollector({ maxHandlers: 10_000 });

  recordInvocation(collector, {
    cwd: "/repo",
    extensionPath: "a.ts",
    surface: "event",
    name: "turn_start",
    ms: 12,
    ok: true,
  });
  recordInvocation(collector, {
    cwd: "/repo",
    extensionPath: "a.ts",
    surface: "command",
    name: "foo",
    ms: 5,
    ok: false,
  });

  assert.deepEqual(summarizeByExtension(collector), [
    { extensionPath: "a.ts", calls: 2, totalMs: 17, maxMs: 12, errorCount: 1 },
  ]);

  assert.equal(summarizeByHandler(collector).length, 2);
});

test("keeps handler totals separate by cwd while extension totals stay global", () => {
  const collector = createCollector({ maxHandlers: 10_000 });

  recordInvocation(collector, {
    cwd: "/repo-a",
    extensionPath: "a.ts",
    surface: "command",
    name: "foo",
    ms: 10,
    ok: true,
  });
  recordInvocation(collector, {
    cwd: "/repo-b",
    extensionPath: "a.ts",
    surface: "command",
    name: "foo",
    ms: 20,
    ok: false,
  });

  assert.deepEqual(summarizeByExtension(collector), [
    { extensionPath: "a.ts", calls: 2, totalMs: 30, maxMs: 20, errorCount: 1 },
  ]);

  assert.deepEqual(summarizeByHandler(collector), [
    {
      cwd: "/repo-b",
      extensionPath: "a.ts",
      surface: "command",
      name: "foo",
      calls: 1,
      totalMs: 20,
      maxMs: 20,
      errorCount: 1,
    },
    {
      cwd: "/repo-a",
      extensionPath: "a.ts",
      surface: "command",
      name: "foo",
      calls: 1,
      totalMs: 10,
      maxMs: 10,
      errorCount: 0,
    },
  ]);
});

test("uses <unknown-extension> fallback and enforces cardinality cap", () => {
  const collector = createCollector({ maxHandlers: 1 });

  recordInvocation(collector, {
    cwd: "/repo",
    extensionPath: "",
    surface: "event",
    name: "turn_start",
    ms: 1,
    ok: true,
  });

  recordInvocation(collector, {
    cwd: "/repo",
    extensionPath: "a.ts",
    surface: "event",
    name: "turn_end",
    ms: 1,
    ok: true,
  });

  const handlers = summarizeByHandler(collector);
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0]?.extensionPath, "<unknown-extension>");
  assert.equal(collector.droppedNewKeys, 1);
});
