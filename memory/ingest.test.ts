import { test } from "node:test";
import * as assert from "node:assert";
import {
  buildMarkdownOutput,
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

test("provenance quotes multiline source values", () => {
  const fm = buildProvenanceFrontmatter("Line 1\nLine 2", "2026-04-08T00:00:00.000Z", "pasted-blob-adapter");

  assert.match(fm, /^---\nsource: \|-\n  Line 1\n  Line 2\ningested_at: 2026-04-08T00:00:00.000Z\nmethod: pasted-blob-adapter\n---\n\n$/);
});

test("buildMarkdownOutput strips nested leading frontmatter from body", () => {
  const out = buildMarkdownOutput(
    "https://x",
    "url-adapter",
    "2026-04-08T00:00:00.000Z",
    "---\ntitle: Example\n---\n\n# Heading\n\nBody",
  );

  assert.ok(out.startsWith("---\nsource: https://x\ningested_at: 2026-04-08T00:00:00.000Z\nmethod: url-adapter\n---\n\n# Heading"));
  assert.ok(!out.includes("title: Example"));
});
