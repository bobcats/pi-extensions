import test from "node:test";
import assert from "node:assert/strict";
import { formatProfileReport, formatStatus } from "./formatter.ts";

test("status prints runtime state and write failures", () => {
  const text = formatStatus({
    runtime: {
      active: true,
      runId: "run-1",
      outputPath: "/profiles/run.jsonl",
      seq: 3,
      lastCwd: "/repo",
      lastWriteError: "disk full",
      consecutiveWriteFailures: 2,
      disabledReason: "write_failures",
    },
    patch: { patched: true, reason: "patched" },
  });

  assert.match(text, /recording: on/);
  assert.match(text, /run: run-1/);
  assert.match(text, /seq: 3/);
  assert.match(text, /last cwd: \/repo/);
  assert.match(text, /write failures: 2/);
  assert.match(text, /last write error: disk full/);
  assert.match(text, /disabled: write_failures/);
});

test("status omits disabled line for normal inactive state", () => {
  const text = formatStatus({
    runtime: {
      active: false,
      seq: 3,
      consecutiveWriteFailures: 0,
    },
    patch: { patched: true, reason: "patched" },
  });

  assert.doesNotMatch(text, /disabled:/);
});

test("profile report shows global extension and handler leaders plus current cwd handlers", () => {
  const text = formatProfileReport({
    report: {
      extensions: [
        { extensionPath: "a.ts", calls: 3, totalMs: 50, maxMs: 30, errorCount: 1 },
        { extensionPath: "b.ts", calls: 1, totalMs: 5, maxMs: 5, errorCount: 0 },
      ],
      handlers: [
        { cwd: "/repo-b", extensionPath: "a.ts", surface: "command", name: "foo", calls: 1, totalMs: 30, maxMs: 30, errorCount: 0 },
        { cwd: "/repo-a", extensionPath: "a.ts", surface: "command", name: "foo", calls: 2, totalMs: 20, maxMs: 12, errorCount: 1 },
      ],
    },
    currentCwd: "/repo-a",
  });

  assert.match(text, /Top extensions \(global\)/);
  assert.match(text, /a\.ts total=50\.0ms calls=3/);
  assert.match(text, /Top handlers \(global\)/);
  assert.match(text, /\/repo-b command:foo a\.ts total=30\.0ms/);
  assert.match(text, /Top handlers \(\/repo-a\)/);
  assert.match(text, /\/repo-a command:foo a\.ts total=20\.0ms/);
});
