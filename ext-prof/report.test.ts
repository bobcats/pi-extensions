import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { appendProfileRows } from "./persistence.ts";
import { readProfileReport } from "./report.ts";

test("reads all v2 JSONL files and aggregates deltas by extension and handler", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ext-prof-report-"));
  await appendProfileRows(path.join(dir, "one.jsonl"), [
    {
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-1",
      seq: 1,
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:10.000Z",
      cwd: "/repo-a",
      extensionPath: "a.ts",
      surface: "command",
      name: "foo",
      calls: 2,
      totalMs: 20,
      maxMs: 12,
      errorCount: 1,
    },
    {
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-1",
      seq: 1,
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:10.000Z",
      cwd: "/repo-b",
      extensionPath: "a.ts",
      surface: "command",
      name: "foo",
      calls: 1,
      totalMs: 30,
      maxMs: 30,
      errorCount: 0,
    },
  ]);
  await appendProfileRows(path.join(dir, "two.jsonl"), [
    {
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-2",
      seq: 1,
      windowStart: "2026-02-17T00:01:00.000Z",
      windowEnd: "2026-02-17T00:01:10.000Z",
      cwd: "/repo-a",
      extensionPath: "b.ts",
      surface: "event",
      name: "turn_start",
      calls: 4,
      totalMs: 10,
      maxMs: 5,
      errorCount: 0,
    },
  ]);

  const report = await readProfileReport({ profileDir: dir });

  assert.deepEqual(report.extensions, [
    { extensionPath: "a.ts", calls: 3, totalMs: 50, maxMs: 30, errorCount: 1 },
    { extensionPath: "b.ts", calls: 4, totalMs: 10, maxMs: 5, errorCount: 0 },
  ]);
  assert.deepEqual(report.handlers, [
    { cwd: "/repo-b", extensionPath: "a.ts", surface: "command", name: "foo", calls: 1, totalMs: 30, maxMs: 30, errorCount: 0 },
    { cwd: "/repo-a", extensionPath: "a.ts", surface: "command", name: "foo", calls: 2, totalMs: 20, maxMs: 12, errorCount: 1 },
    { cwd: "/repo-a", extensionPath: "b.ts", surface: "event", name: "turn_start", calls: 4, totalMs: 10, maxMs: 5, errorCount: 0 },
  ]);
});

test("silently ignores legacy rows, unknown rows, and malformed partial lines", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ext-prof-report-"));
  await writeFile(
    path.join(dir, "legacy.jsonl"),
    JSON.stringify({ schemaVersion: 1, type: "aggregate", extensionPath: "legacy.ts", totalMs: 999 }) + "\n" +
      JSON.stringify({ schemaVersion: 2, type: "recording_start", runId: "run-1" }) + "\n" +
      JSON.stringify({ schemaVersion: 2, type: "unknown", runId: "run-1" }) + "\n" +
      "{\"schemaVersion\":2,\"type\":\"aggregate_delta\"",
    "utf8",
  );
  await appendFile(
    path.join(dir, "valid.jsonl"),
    JSON.stringify({
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-1",
      seq: 1,
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:10.000Z",
      cwd: "/repo",
      extensionPath: "valid.ts",
      surface: "tool",
      name: "run",
      calls: 1,
      totalMs: 7,
      maxMs: 7,
      errorCount: 0,
    }) + "\n",
    "utf8",
  );

  const report = await readProfileReport({ profileDir: dir });

  assert.deepEqual(report.extensions, [
    { extensionPath: "valid.ts", calls: 1, totalMs: 7, maxMs: 7, errorCount: 0 },
  ]);
});
