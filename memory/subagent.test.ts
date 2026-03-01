import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildVaultSnapshot, parseSessionMessages, batchConversations, extractConversations, encodeProjectSessionPath, MIN_FILE_SIZE } from "./subagent.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-subagent-test-"));
}

test("buildVaultSnapshot concatenates files with headers", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n- [[prefs]]");
  fs.writeFileSync(path.join(dir, "prefs.md"), "# Prefs\n- tabs");
  fs.writeFileSync(path.join(dir, "principles", "prove-it-works.md"), "# Prove It Works\nverify");

  const snapshot = buildVaultSnapshot(dir);
  assert.match(snapshot, /=== index\.md ===/);
  assert.match(snapshot, /=== prefs\.md ===/);
  assert.match(snapshot, /=== principles\/prove-it-works\.md ===/);
  assert.match(snapshot, /# Prefs\n- tabs/);
});

test("buildVaultSnapshot returns empty string for missing dir", () => {
  assert.equal(buildVaultSnapshot("/nonexistent/xyz"), "");
});

test("parseSessionMessages extracts user and assistant text from JSONL", () => {
  const jsonl = [
    JSON.stringify({ type: "message", id: "1", message: { role: "user", content: [{ type: "text", text: "hello world!!" }] } }),
    JSON.stringify({ type: "message", id: "2", message: { role: "assistant", content: [{ type: "text", text: "hi there!!!" }] } }),
    JSON.stringify({ type: "message", id: "3", message: { role: "user", content: [{ type: "text", text: "bye for now!" }] } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].text, "[USER]: hello world!!");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].text, "[ASSISTANT]: hi there!!!");
});

test("parseSessionMessages skips non-message entries", () => {
  const jsonl = [
    JSON.stringify({ type: "session_info", id: "0", name: "test" }),
    JSON.stringify({ type: "message", id: "1", message: { role: "user", content: [{ type: "text", text: "hello world!!" }] } }),
    JSON.stringify({ type: "compaction", id: "2" }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 1);
});

test("parseSessionMessages truncates user text to 3000 chars and assistant to 800", () => {
  const longUser = "x".repeat(5000);
  const longAssistant = "y".repeat(2000);
  const jsonl = [
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: longUser }] } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: longAssistant }] } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 2);
  // [USER]: prefix + 3000 chars
  assert.equal(messages[0].text, `[USER]: ${"x".repeat(3000)}`);
  // [ASSISTANT]: prefix + 800 chars
  assert.equal(messages[1].text, `[ASSISTANT]: ${"y".repeat(800)}`);
});

test("parseSessionMessages skips short text (<=10 chars)", () => {
  const jsonl = [
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "short" }] } }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "long enough!" }] } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "[USER]: long enough!");
});

test("parseSessionMessages skips system-reminder-only messages", () => {
  const jsonl = [
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "<system-reminder>do something</system-reminder>" }] } }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "real message!" }] } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "[USER]: real message!");
});

test("parseSessionMessages skips isMeta user messages", () => {
  const jsonl = [
    JSON.stringify({ type: "message", isMeta: true, message: { role: "user", content: [{ type: "text", text: "meta message here" }] } }),
    JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: "real message!" }] } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "[USER]: real message!");
});

test("batchConversations splits into N batches", () => {
  const conversations = Array.from({ length: 40 }, (_, i) => `Conversation ${i}`);
  const batches = batchConversations(conversations, 3);
  assert.equal(batches.length, 3);
  const total = batches.reduce((sum, b) => sum + b.length, 0);
  assert.equal(total, 40);
});

test("extractConversations writes per-conversation files and batch manifests", () => {
  const sessionsDir = tmpDir();
  const outputDir = path.join(tmpDir(), "output");

  const makeEntry = (text: string) => JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });

  // Create 3 JSONL files, one too small to pass min-size filter
  for (let i = 0; i < 3; i++) {
    if (i === 2) {
      fs.writeFileSync(path.join(sessionsDir, `session-${i}.jsonl`), "tiny");
    } else {
      const entry = makeEntry(`conversation ${i} with enough text to matter and pass all filters`);
      const lines = Array.from({ length: Math.ceil(MIN_FILE_SIZE / entry.length) + 1 }, () => entry);
      fs.writeFileSync(path.join(sessionsDir, `session-${i}.jsonl`), lines.join("\n"));
    }
  }

  const result = extractConversations(sessionsDir, outputDir, 2);
  assert.equal(result.conversationCount, 2); // 3rd file too small
  assert.ok(result.batches.length <= 2);

  // Each batch manifest should list conversation file paths
  for (const manifestPath of result.batches) {
    const manifest = fs.readFileSync(manifestPath, "utf-8").trim();
    const files = manifest.split("\n");
    assert.ok(files.length > 0);
    for (const f of files) {
      assert.ok(fs.existsSync(f), `conversation file should exist: ${f}`);
    }
  }
});

test("extractConversations returns 0 conversations for empty dir", () => {
  const sessionsDir = tmpDir();
  const outputDir = path.join(tmpDir(), "output");
  const result = extractConversations(sessionsDir, outputDir, 2);
  assert.equal(result.conversationCount, 0);
  assert.equal(result.batches.length, 0);
});

test("encodeProjectSessionPath encodes cwd to pi session directory format", () => {
  assert.equal(encodeProjectSessionPath("/Users/a/b/project"), "--Users-a-b-project--");
});

test("runSubagent onData callback receives stdout lines as they arrive", async () => {
  const { parseJsonEvent } = await import("./subagent.ts");
  
  const textDelta = JSON.stringify({
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: { type: "text_delta", delta: "hello " },
  });

  const result = parseJsonEvent(textDelta);
  assert.deepEqual(result, { type: "text_delta", text: "hello " });
});

test("parseJsonEvent returns tool_call for tool_execution_start", async () => {
  const { parseJsonEvent } = await import("./subagent.ts");
  
  const toolStart = JSON.stringify({
    type: "tool_execution_start",
    toolName: "read",
    args: { path: "/foo/bar.ts" },
  });

  const result = parseJsonEvent(toolStart);
  assert.deepEqual(result, { type: "tool_call", toolName: "read", args: { path: "/foo/bar.ts" } });
});

test("parseJsonEvent returns null for non-streaming events", async () => {
  const { parseJsonEvent } = await import("./subagent.ts");
  
  assert.equal(parseJsonEvent(JSON.stringify({ type: "agent_start" })), null);
  assert.equal(parseJsonEvent("not json"), null);
});
