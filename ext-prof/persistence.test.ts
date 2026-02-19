import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { saveSnapshot } from "./persistence.ts";

test("writes JSONL with session_meta schemaVersion=1 and aggregate rows", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ext-prof-"));
  const output = path.join(dir, "snapshot.jsonl");

  await saveSnapshot({
    outputPath: output,
    sessionMeta: {
      schemaVersion: 1,
      project: "dotagents",
      patch: "patched",
      savedAt: "2026-02-17T00:00:00.000Z",
      overheadGoalPct: 1,
    },
    aggregates: [
      {
        extensionPath: "a.ts",
        surface: "event",
        name: "turn_start",
        calls: 2,
        totalMs: 20,
        maxMs: 11,
        errorCount: 0,
      },
    ],
  });

  const lines = (await readFile(output, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  assert.equal(lines[0].type, "session_meta");
  assert.equal(lines[0].schemaVersion, 1);
  assert.equal(lines[1].type, "aggregate");
});
