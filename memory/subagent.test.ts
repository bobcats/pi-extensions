import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildVaultSnapshot, parseSessionMessages, batchConversations, encodeProjectSessionPath } from "./subagent.ts";

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
    JSON.stringify({ type: "message", id: "1", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
    JSON.stringify({ type: "message", id: "2", message: { role: "assistant", content: [{ type: "text", text: "hi there" }] } }),
    JSON.stringify({ type: "message", id: "3", message: { role: "user", content: [{ type: "text", text: "bye" }] } }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].text, "hello");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].text, "hi there");
});

test("parseSessionMessages skips non-message entries", () => {
  const jsonl = [
    JSON.stringify({ type: "session_info", id: "0", name: "test" }),
    JSON.stringify({ type: "message", id: "1", message: { role: "user", content: [{ type: "text", text: "hello" }] } }),
    JSON.stringify({ type: "compaction", id: "2" }),
  ].join("\n");

  const messages = parseSessionMessages(jsonl);
  assert.equal(messages.length, 1);
});

test("batchConversations splits into N batches", () => {
  const conversations = Array.from({ length: 40 }, (_, i) => `Conversation ${i}`);
  const batches = batchConversations(conversations, 3);
  assert.equal(batches.length, 3);
  const total = batches.reduce((sum, b) => sum + b.length, 0);
  assert.equal(total, 40);
});

test("encodeProjectSessionPath encodes cwd to pi session directory format", () => {
  assert.equal(encodeProjectSessionPath("/Users/a/b/project"), "--Users--a--b--project--");
});
