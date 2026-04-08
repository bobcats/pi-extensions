import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildWriteTargets,
  planIngest,
  requiresConfirmationForCaps,
  run,
} from "./ingest-runner.ts";

test("planIngest routes url to url adapter", () => {
  const p = planIngest("https://example.com/post", { nowIso: "2026-04-08T00:00:00.000Z" });
  assert.strictEqual(p.kind, "url");
  assert.strictEqual(p.method, "url-adapter");
});

test("repo over cap requires confirmation", () => {
  const r = requiresConfirmationForCaps("repo", { files: 250, bytes: 10_000_000, depth: 3 });
  assert.strictEqual(r.required, true);
});

test("write targets stay under raw root", () => {
  const t = buildWriteTargets("/home/u/.pi/memories/raw", "2026-04-08-paper");
  assert.ok(t.markdownPath.startsWith("/home/u/.pi/memories/raw/"));
});

test("batch ingest assigns unique filenames", async () => {
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-ingest-"));
  const result = await run({
    inputs: ["Line 1\nLine 2", "Another line\nSecond line"],
    confirm: false,
    rawRoot,
    nowIso: "2026-04-08T00:00:00.000Z",
  });
  assert.strictEqual(result.status, "ok");
  assert.ok(result.filesWritten);
  assert.strictEqual(result.filesWritten?.length, 2);
  assert.notStrictEqual(result.filesWritten?.[0], result.filesWritten?.[1]);
});
