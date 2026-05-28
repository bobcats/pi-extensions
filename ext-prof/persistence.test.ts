import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import {
  appendProfileRows,
  createProfilePath,
  profileDirectory,
  type AggregateDeltaRow,
} from "./persistence.ts";

test("appends v2 recording rows as JSONL and creates parent directories", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ext-prof-"));
  const output = path.join(dir, "nested", "run.jsonl");
  const delta: AggregateDeltaRow = {
    schemaVersion: 2,
    type: "aggregate_delta",
    runId: "run-1",
    seq: 1,
    windowStart: "2026-02-17T00:00:00.000Z",
    windowEnd: "2026-02-17T00:00:10.000Z",
    cwd: "/repo",
    extensionPath: "a.ts",
    surface: "event",
    name: "turn_start",
    calls: 2,
    totalMs: 20,
    maxMs: 11,
    errorCount: 0,
  };

  await appendProfileRows(output, [
    { schemaVersion: 2, type: "recording_start", runId: "run-1", startedAt: "2026-02-17T00:00:00.000Z" },
    delta,
  ]);
  await appendProfileRows(output, [
    { schemaVersion: 2, type: "recording_end", runId: "run-1", endedAt: "2026-02-17T00:00:12.000Z", reason: "off" },
  ]);

  const lines = (await readFile(output, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.deepEqual(lines, [
    { schemaVersion: 2, type: "recording_start", runId: "run-1", startedAt: "2026-02-17T00:00:00.000Z" },
    delta,
    { schemaVersion: 2, type: "recording_end", runId: "run-1", endedAt: "2026-02-17T00:00:12.000Z", reason: "off" },
  ]);
});

test("builds global v2 profile paths under ~/.pi/profiles/ext-prof/v2", () => {
  assert.equal(profileDirectory("/home/tester"), path.join("/home/tester", ".pi", "profiles", "ext-prof", "v2"));
  assert.match(createProfilePath({ homeDir: "/home/tester", startedAt: "2026-02-17T00:00:00.000Z", runId: "abc123" }), /\/home\/tester\/\.pi\/profiles\/ext-prof\/v2\/2026-02-17T00-00-00-000Z-abc123\.jsonl$/);
});
