import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  encodeProjectSessionPath,
  parseDate,
  parseRuminateArgs,
  parseSessionMessages,
  extractCompactionSummaries,
  extractAndBatch,
} from "./session.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mem-session-test-"));
}

// --- encodeProjectSessionPath ---

test("encodeProjectSessionPath encodes cwd to pi session directory format", () => {
  assert.strictEqual(encodeProjectSessionPath("/Users/dev/code/myapp"), "--Users-dev-code-myapp--");
});

test("encodeProjectSessionPath handles Windows-style paths", () => {
  assert.strictEqual(encodeProjectSessionPath("C:\\Users\\dev\\code"), "--C--Users-dev-code--");
});

// --- parseDate ---

test("parseDate returns Date for valid YYYY-MM-DD", () => {
  const result = parseDate("2025-03-15", "--from");
  assert.ok(result instanceof Date);
  assert.strictEqual((result as Date).getFullYear(), 2025);
  assert.strictEqual((result as Date).getMonth(), 2); // 0-indexed
  assert.strictEqual((result as Date).getDate(), 15);
});

test("parseDate returns error string for invalid date", () => {
  const result = parseDate("not-a-date", "--from");
  assert.strictEqual(typeof result, "string");
  assert.ok((result as string).includes("Invalid date format"));
  assert.ok((result as string).includes("--from"));
});

test("parseDate with endOfDay sets time to 23:59:59.999", () => {
  const result = parseDate("2025-03-15", "--to", true);
  assert.ok(result instanceof Date);
  assert.strictEqual((result as Date).getHours(), 23);
  assert.strictEqual((result as Date).getMinutes(), 59);
  assert.strictEqual((result as Date).getSeconds(), 59);
  assert.strictEqual((result as Date).getMilliseconds(), 999);
});

test("parseDate without endOfDay sets time to 00:00:00", () => {
  const result = parseDate("2025-03-15", "--from");
  assert.ok(result instanceof Date);
  assert.strictEqual((result as Date).getHours(), 0);
  assert.strictEqual((result as Date).getMinutes(), 0);
});

// --- parseRuminateArgs ---

test("parseRuminateArgs parses --from and --to flags", () => {
  const result = parseRuminateArgs("ruminate --from 2025-01-01 --to 2025-03-15");
  assert.ok(!result.error);
  assert.ok(result.fromDate instanceof Date);
  assert.ok(result.toDate instanceof Date);
});

test("parseRuminateArgs --to date includes entire day", () => {
  const result = parseRuminateArgs("ruminate --to 2025-03-15");
  assert.ok(!result.error);
  assert.ok(result.toDate instanceof Date);
  assert.strictEqual(result.toDate!.getHours(), 23);
  assert.strictEqual(result.toDate!.getMinutes(), 59);
  assert.strictEqual(result.toDate!.getSeconds(), 59);
});

test("parseRuminateArgs returns error for invalid date", () => {
  const result = parseRuminateArgs("ruminate --from bad-date");
  assert.ok(result.error);
  assert.ok(result.error!.includes("Invalid date format"));
});

test("parseRuminateArgs handles no flags", () => {
  const result = parseRuminateArgs("ruminate");
  assert.ok(!result.error);
  assert.strictEqual(result.fromDate, undefined);
  assert.strictEqual(result.toDate, undefined);
});

// --- parseSessionMessages ---

test("parseSessionMessages extracts user and assistant text", () => {
  const jsonl = [
    JSON.stringify({ message: { role: "user", content: "Hello, how do I fix this bug?" } }),
    JSON.stringify({ message: { role: "assistant", content: "You need to check the return value." } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 2);
  assert.ok(messages[0].text.startsWith("[USER]:"));
  assert.ok(messages[1].text.startsWith("[ASSISTANT]:"));
});

test("parseSessionMessages handles array content", () => {
  const jsonl = JSON.stringify({
    message: {
      role: "user",
      content: [{ type: "text", text: "This is array content with enough text." }],
    },
  });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 1);
  assert.ok(messages[0].text.includes("array content"));
});

test("parseSessionMessages skips isMeta user messages", () => {
  const jsonl = JSON.stringify({
    isMeta: true,
    message: { role: "user", content: "This is a meta message with enough characters." },
  });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 0);
});

test("parseSessionMessages skips short text (<=10 chars)", () => {
  const jsonl = JSON.stringify({
    message: { role: "user", content: "short" },
  });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 0);
});

test("parseSessionMessages skips system-reminder-only messages", () => {
  const jsonl = JSON.stringify({
    message: { role: "user", content: "<system-reminder>Some reminder text here</system-reminder>" },
  });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 0);
});

test("parseSessionMessages truncates user text to 3000 chars", () => {
  const longText = "x".repeat(5000);
  const jsonl = JSON.stringify({ message: { role: "user", content: longText } });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 1);
  // [USER]: prefix + truncated content
  assert.ok(messages[0].text.length <= 3000 + "[USER]: ".length);
});

test("parseSessionMessages truncates assistant text to 800 chars", () => {
  const longText = "x".repeat(2000);
  const jsonl = JSON.stringify({ message: { role: "assistant", content: longText } });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 1);
  assert.ok(messages[0].text.length <= 800 + "[ASSISTANT]: ".length);
});

test("parseSessionMessages skips malformed lines", () => {
  const jsonl = "not json\n" + JSON.stringify({ message: { role: "user", content: "Valid message here." } });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 1);
});

test("parseSessionMessages skips non-user/assistant roles", () => {
  const jsonl = JSON.stringify({ message: { role: "system", content: "System prompt text here." } });

  const messages = parseSessionMessages(jsonl);
  assert.strictEqual(messages.length, 0);
});

// --- extractCompactionSummaries ---

test("extractCompactionSummaries extracts compaction entries", () => {
  const jsonl = [
    JSON.stringify({ type: "compaction", summary: "Goal: fix bug\nProgress: done" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
    JSON.stringify({ type: "branch_summary", summary: "Explored approach A" }),
  ].join("\n");

  const summaries = extractCompactionSummaries(jsonl);
  assert.strictEqual(summaries.length, 2);
  assert.ok(summaries[0].includes("fix bug"));
  assert.ok(summaries[1].includes("approach A"));
});

test("extractCompactionSummaries returns empty for no summaries", () => {
  const jsonl = JSON.stringify({ type: "message", message: { role: "user", content: "hello" } });

  assert.deepStrictEqual(extractCompactionSummaries(jsonl), []);
});

test("extractCompactionSummaries skips entries without summary field", () => {
  const jsonl = JSON.stringify({ type: "compaction" });

  assert.deepStrictEqual(extractCompactionSummaries(jsonl), []);
});

// --- extractAndBatch ---

test("extractAndBatch returns error when sessions dir missing", () => {
  const sessionsRoot = tmpDir();
  const vaultDir = tmpDir();

  const result = extractAndBatch("/some/project", {}, sessionsRoot, vaultDir);
  assert.ok("error" in result);
  assert.ok(result.error.includes("No sessions found"));
});

test("extractAndBatch returns error when no JSONL files match", () => {
  const sessionsRoot = tmpDir();
  const vaultDir = tmpDir();
  const encoded = encodeProjectSessionPath("/some/project");
  const projectDir = path.join(sessionsRoot, encoded);
  fs.mkdirSync(projectDir, { recursive: true });
  // Create a tiny file (below MIN_FILE_SIZE of 500)
  fs.writeFileSync(path.join(projectDir, "session.jsonl"), "tiny");

  const result = extractAndBatch("/some/project", {}, sessionsRoot, vaultDir);
  assert.ok("error" in result);
});

test("extractAndBatch extracts and batches valid sessions", () => {
  const sessionsRoot = tmpDir();
  const vaultDir = tmpDir();
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const encoded = encodeProjectSessionPath("/some/project");
  const projectDir = path.join(sessionsRoot, encoded);
  fs.mkdirSync(projectDir, { recursive: true });

  // Create a session file large enough (>500 bytes)
  const lines = Array.from({ length: 20 }, (_, i) =>
    JSON.stringify({ message: { role: "user", content: `Message ${i} with enough content to be meaningful and pass the minimum size check.` } })
  );
  fs.writeFileSync(path.join(projectDir, "session1.jsonl"), lines.join("\n"));

  const result = extractAndBatch("/some/project", {}, sessionsRoot, vaultDir);
  assert.ok(!("error" in result));
  assert.strictEqual(result.conversationCount, 1);
  assert.ok(result.batches.length >= 1);
  assert.ok(fs.existsSync(result.snapshotPath));
});

test("extractAndBatch --to includes sessions modified during that day", () => {
  const sessionsRoot = tmpDir();
  const vaultDir = tmpDir();
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const encoded = encodeProjectSessionPath("/some/project");
  const projectDir = path.join(sessionsRoot, encoded);
  fs.mkdirSync(projectDir, { recursive: true });

  const lines = Array.from({ length: 20 }, (_, i) =>
    JSON.stringify({ message: { role: "user", content: `Message ${i} with enough content to be meaningful and pass the minimum size check.` } })
  );
  const filePath = path.join(projectDir, "session1.jsonl");
  fs.writeFileSync(filePath, lines.join("\n"));

  // Set mtime to midday on 2025-03-15
  const midday = new Date("2025-03-15T12:00:00");
  fs.utimesSync(filePath, midday, midday);

  // --to 2025-03-15 should include this file (modified during that day)
  const result = extractAndBatch("/some/project", { toDate: new Date("2025-03-15T23:59:59.999") }, sessionsRoot, vaultDir);
  assert.ok(!("error" in result), `Expected success but got error: ${"error" in result ? result.error : ""}`);
  assert.strictEqual(result.conversationCount, 1);
});

test("extractAndBatch --to excludes sessions modified after that day", () => {
  const sessionsRoot = tmpDir();
  const vaultDir = tmpDir();
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const encoded = encodeProjectSessionPath("/some/project");
  const projectDir = path.join(sessionsRoot, encoded);
  fs.mkdirSync(projectDir, { recursive: true });

  const lines = Array.from({ length: 20 }, (_, i) =>
    JSON.stringify({ message: { role: "user", content: `Message ${i} with enough content to be meaningful and pass the minimum size check.` } })
  );
  const filePath = path.join(projectDir, "session1.jsonl");
  fs.writeFileSync(filePath, lines.join("\n"));

  // Set mtime to the day after
  const nextDay = new Date("2025-03-16T10:00:00");
  fs.utimesSync(filePath, nextDay, nextDay);

  const result = extractAndBatch("/some/project", { toDate: new Date("2025-03-15T23:59:59.999") }, sessionsRoot, vaultDir);
  assert.ok("error" in result);
});

test("extractAndBatch prefers compaction summaries over raw messages", () => {
  const sessionsRoot = tmpDir();
  const vaultDir = tmpDir();
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const encoded = encodeProjectSessionPath("/some/project");
  const projectDir = path.join(sessionsRoot, encoded);
  fs.mkdirSync(projectDir, { recursive: true });

  // Session with both compaction summaries and regular messages
  const lines = [
    JSON.stringify({ type: "compaction", summary: "Goal: optimize rendering\nProgress: refactored pipeline" }),
    ...Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ message: { role: "user", content: `Regular message ${i} that should be ignored because compaction exists.` } })
    ),
  ];
  fs.writeFileSync(path.join(projectDir, "session1.jsonl"), lines.join("\n"));

  const result = extractAndBatch("/some/project", {}, sessionsRoot, vaultDir);
  assert.ok(!("error" in result));

  // Read the extracted file — should contain summary, not raw messages
  const batchManifest = fs.readFileSync(result.batches[0], "utf-8").trim();
  const extractedFile = batchManifest.split("\n")[0];
  const content = fs.readFileSync(extractedFile, "utf-8");
  assert.ok(content.includes("optimize rendering"));
  assert.ok(!content.includes("[USER]:"));
});
