import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildWriteTargets,
  convertLocalDocumentToMarkdown,
  convertUrlToMarkdown,
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

  // Act
  const result = await run({
    inputs: ["Line 1\nLine 2", "Another line\nSecond line"],
    confirm: false,
    rawRoot,
    nowIso: "2026-04-08T00:00:00.000Z",
  });

  // Assert
  assert.strictEqual(result.status, "ok");
  assert.ok(result.filesWritten);
  assert.strictEqual(result.filesWritten?.length, 2);
  assert.notStrictEqual(result.filesWritten?.[0], result.filesWritten?.[1]);
});

test("successful ingest returns compile handoff details", async () => {
  const rawRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memory-ingest-handoff-"));

  // Act
  const result = await run({
    inputs: ["Line 1\nLine 2"],
    confirm: false,
    rawRoot,
    nowIso: "2026-04-08T00:00:00.000Z",
  });

  // Assert
  assert.strictEqual(result.status, "ok");
  assert.strictEqual(result.kind, "pasted-blob");
  assert.ok(result.sourceSummaries);
  assert.strictEqual(result.sourceSummaries?.length, 1);
  assert.deepStrictEqual(result.sourceSummaries?.[0], {
    source: "Line 1\nLine 2",
    rawMarkdownPath: result.filesWritten?.[0],
    preservedAssets: [],
    kind: "pasted-blob",
  });
});


test("skill contract requires compile before ingest success logging", () => {
  const skillPath = path.resolve("skills/memory-ingest/SKILL.md");

  // Act
  const skill = fs.readFileSync(skillPath, "utf8");

  // Assert
  assert.match(skill, /read the newly written raw artifact/i);
  assert.match(skill, /update\/create curated notes under `~\/\.pi\/memories\//i);
  assert.match(skill, /backlinks|source references/i);
  assert.match(skill, /only then call `log_operation`/i);
});

test("convertLocalDocumentToMarkdown uses summarize conversion for pdf", async () => {
  const filePath = "/tmp/spec.pdf";
  let calledWith: string | null = null;

  // Act
  const result = await convertLocalDocumentToMarkdown(filePath, {
    convertWithSummarize: async (input) => {
      calledWith = input;
      return "# Converted PDF\n\nBody";
    },
  });

  // Assert
  assert.strictEqual(calledWith, filePath);
  assert.strictEqual(result.body, "# Converted PDF\n\nBody");
  assert.strictEqual(result.usedFallback, false);
});

test("convertLocalDocumentToMarkdown falls back when summarize conversion fails", async () => {
  const filePath = "/tmp/spec.docx";

  // Act
  const result = await convertLocalDocumentToMarkdown(filePath, {
    convertWithSummarize: async () => {
      throw new Error("uvx markitdown failed");
    },
  });

  // Assert
  assert.match(result.body, /Fallback conversion used/);
  assert.match(result.body, /uvx markitdown failed/);
  assert.strictEqual(result.usedFallback, true);
});

test("convertUrlToMarkdown uses summarize conversion first", async () => {
  let calledWith: string | null = null;

  // Act
  const result = await convertUrlToMarkdown("https://example.com/post", {
    convertWithSummarize: async (input) => {
      calledWith = input;
      return "# Converted URL\n\nBody";
    },
  });

  // Assert
  assert.strictEqual(calledWith, "https://example.com/post");
  assert.strictEqual(result.body, "# Converted URL\n\nBody");
  assert.strictEqual(result.usedFallback, false);
});

test("directory ingest converts contained pdf documents", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-ingest-dir-"));
  const sourceDir = path.join(root, "source");
  const rawRoot = path.join(root, "raw");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "guide.pdf"), "fake pdf", "utf8");

  const originalSpawnSync = process.env.PI_MEMORY_INGEST_TEST_SUMMARIZE_OUTPUT;
  process.env.PI_MEMORY_INGEST_TEST_SUMMARIZE_OUTPUT = "# Converted PDF\n\nDirectory body";

  try {
    // Act
    const result = await run({
      inputs: [sourceDir],
      confirm: false,
      rawRoot,
      nowIso: "2026-04-08T00:00:00.000Z",
    });

    // Assert
    assert.strictEqual(result.status, "ok");
    const markdownPath = result.filesWritten?.[0];
    assert.ok(markdownPath);
    const markdown = fs.readFileSync(markdownPath!, "utf8");
    assert.match(markdown, /Converted PDF/);
    assert.match(markdown, /guide\.pdf/);
  } finally {
    if (originalSpawnSync === undefined) {
      delete process.env.PI_MEMORY_INGEST_TEST_SUMMARIZE_OUTPUT;
    } else {
      process.env.PI_MEMORY_INGEST_TEST_SUMMARIZE_OUTPUT = originalSpawnSync;
    }
  }
});
