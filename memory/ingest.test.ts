import { test } from "node:test";
import * as assert from "node:assert";
import {
  buildOutputBaseName,
  buildProvenanceFrontmatter,
  classifyIngestInput,
  classifyLocalPath,
  resolveSafeRawPath,
} from "./ingest.ts";

test("classifyIngestInput: url", () => {
  const r = classifyIngestInput("https://example.com/x");
  assert.deepStrictEqual({ kind: r.kind, ambiguous: r.ambiguous }, { kind: "url", ambiguous: false });
});

test("classifyIngestInput: pasted blob", () => {
  const r = classifyIngestInput("Line 1\nLine 2\nLine 3");
  assert.strictEqual(r.kind, "pasted-blob");
});

test("classifyLocalPath: local document", () => {
  assert.strictEqual(classifyLocalPath("/tmp/paper.pdf", false, true), "local-document");
});

test("classifyLocalPath: local directory", () => {
  assert.strictEqual(classifyLocalPath("/tmp/corpus", true, false), "local-directory");
});

test("ambiguous token requires clarification", () => {
  const r = classifyIngestInput("project-alpha");
  assert.strictEqual(r.ambiguous, true);
  assert.ok(r.reason?.includes("clarify"));
});

test("collision suffix increments", () => {
  const out = buildOutputBaseName(
    "2026-04-08",
    "paper",
    new Set(["2026-04-08-paper.md", "2026-04-08-paper-2.md"]),
  );
  assert.strictEqual(out, "2026-04-08-paper-3");
});

test("rejects traversal", () => {
  assert.throws(() => resolveSafeRawPath("/home/u/.pi/memories/raw", "../oops.md"), /outside raw root/);
});

test("provenance uses fixed yaml frontmatter", () => {
  const fm = buildProvenanceFrontmatter("https://x", "2026-04-08T00:00:00.000Z", "url-adapter");
  assert.ok(fm.startsWith("---\nsource:"));
  assert.ok(fm.includes("ingested_at:"));
  assert.ok(fm.includes("method:"));
  assert.ok(fm.endsWith("---\n\n"));
});
