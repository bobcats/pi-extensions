import { test } from "node:test";
import * as assert from "node:assert";
import {
  writeConventions,
  buildReflectPrompt,
  buildDreamPrompt,
  MEMORY_TOPIC_LIMIT,
  MEMORY_INDEX_LIMIT,
} from "./prompts.ts";
import { buildRuminatePrompt } from "./session.ts";
import {
  formatElapsed,
  formatRelativeTime,
  renderDashboardLines,
  parseOperationsJSONL,
} from "./dashboard.ts";
import type { MemoryState, ExtractionResult } from "./types.ts";
import type { Theme } from "@mariozechner/pi-coding-agent";

// Mock theme that just returns plain text (no ANSI)
const plainTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

// --- formatElapsed ---

test("formatElapsed formats seconds", () => {
  assert.strictEqual(formatElapsed(5000), "5s");
  assert.strictEqual(formatElapsed(0), "0s");
  assert.strictEqual(formatElapsed(59000), "59s");
});

test("formatElapsed formats minutes and seconds", () => {
  assert.strictEqual(formatElapsed(60000), "1m0s");
  assert.strictEqual(formatElapsed(90000), "1m30s");
});

test("formatElapsed formats hours and minutes", () => {
  assert.strictEqual(formatElapsed(3600000), "1h0m");
  assert.strictEqual(formatElapsed(5400000), "1h30m");
});

// --- formatRelativeTime ---

test("formatRelativeTime shows seconds ago", () => {
  const result = formatRelativeTime(Date.now() - 30000);
  assert.ok(result.endsWith("s ago"));
});

test("formatRelativeTime shows minutes ago", () => {
  const result = formatRelativeTime(Date.now() - 120000);
  assert.ok(result.endsWith("m ago"));
});

test("formatRelativeTime shows hours ago", () => {
  const result = formatRelativeTime(Date.now() - 7200000);
  assert.ok(result.endsWith("h ago"));
});

test("formatRelativeTime shows days ago", () => {
  const result = formatRelativeTime(Date.now() - 172800000);
  assert.ok(result.endsWith("d ago"));
});

// --- writeConventions ---

test("writeConventions includes vault path", () => {
  const conv = writeConventions("/test/vault");
  assert.ok(conv.includes("/test/vault/"));
});

test("writeConventions includes line limits", () => {
  const conv = writeConventions("/test/vault");
  assert.ok(conv.includes(String(MEMORY_TOPIC_LIMIT)));
  assert.ok(conv.includes(String(MEMORY_INDEX_LIMIT)));
});

test("writeConventions includes key conventions", () => {
  const conv = writeConventions("/test/vault");
  assert.ok(conv.includes("wikilinks"));
  assert.ok(conv.includes("index.md"));
  assert.ok(conv.includes("projects/<project-name>/"));
  assert.ok(conv.includes("Quality gate"));
});

// --- buildReflectPrompt ---

test("buildReflectPrompt includes process steps", () => {
  const prompt = buildReflectPrompt("/test/vault");
  assert.ok(prompt.includes("# Reflect"));
  assert.ok(prompt.includes("Read `/test/vault/index.md`"));
  assert.ok(prompt.includes("log_operation"));
  assert.ok(prompt.includes("type='reflect'"));
});

test("buildReflectPrompt includes routing section", () => {
  const prompt = buildReflectPrompt("/test/vault");
  assert.ok(prompt.includes("## Routing"));
  assert.ok(prompt.includes("Structural enforcement"));
  assert.ok(prompt.includes("Memory vault files"));
  assert.ok(prompt.includes("Skill improvements"));
});

test("buildReflectPrompt includes write conventions", () => {
  const prompt = buildReflectPrompt("/test/vault");
  assert.ok(prompt.includes("## Writing Conventions"));
  assert.ok(prompt.includes(String(MEMORY_TOPIC_LIMIT)));
});

// --- buildDreamPrompt ---

test("buildDreamPrompt includes dream mode structure", () => {
  const prompt = buildDreamPrompt("/test/vault");
  assert.ok(prompt.includes("## Dream Mode (ACTIVE)"));
  assert.ok(prompt.includes("NEVER STOP"));
  assert.ok(prompt.includes("log_operation"));
  assert.ok(prompt.includes("dream-journal.md"));
});

test("buildDreamPrompt makes raw files a hard no-edit rule", () => {
  const prompt = buildDreamPrompt("/test/vault");
  assert.ok(prompt.includes("HARD BOUNDARY: `/test/vault/raw/` is read-only source material"));
  assert.ok(prompt.includes("Do not create plans to split, summarize, index, delete, move, or rewrite raw files"));
});

test("buildDreamPrompt includes strategy phases", () => {
  const prompt = buildDreamPrompt("/test/vault");
  assert.ok(prompt.includes("Explore"));
  assert.ok(prompt.includes("Reorganize"));
  assert.ok(prompt.includes("Synthesize"));
  assert.ok(prompt.includes("Simplify"));
  assert.ok(prompt.includes("Disrupt"));
});

test("buildDreamPrompt at escalation 0 has no escalation block", () => {
  const prompt = buildDreamPrompt("/test/vault", 0);
  assert.ok(!prompt.includes("⚠️ Escalation"));
});

test("buildDreamPrompt at escalation 1 has no escalation block", () => {
  const prompt = buildDreamPrompt("/test/vault", 1);
  assert.ok(!prompt.includes("⚠️ Escalation"));
});

test("buildDreamPrompt at escalation 2+ includes escalation warning", () => {
  const prompt = buildDreamPrompt("/test/vault", 2);
  assert.ok(prompt.includes("⚠️ Escalation: 2 consecutive cycles"));
  assert.ok(prompt.includes("Switch to high-leverage work NOW"));
});

test("buildDreamPrompt at escalation 5 shows correct count", () => {
  const prompt = buildDreamPrompt("/test/vault", 5);
  assert.ok(prompt.includes("⚠️ Escalation: 5 consecutive cycles"));
});

test("buildDreamPrompt includes scriptsDir in audit command", () => {
  const prompt = buildDreamPrompt("/test/vault", 0, "/custom/scripts");
  assert.ok(prompt.includes("/custom/scripts/brain-audit.sh"));
});

test("buildDreamPrompt includes write conventions", () => {
  const prompt = buildDreamPrompt("/test/vault");
  assert.ok(prompt.includes("## Writing Conventions"));
});

// --- buildRuminatePrompt ---

test("buildRuminatePrompt includes batch paths and counts", () => {
  const extraction: ExtractionResult = {
    conversationCount: 42,
    batches: ["/tmp/batch_0.txt", "/tmp/batch_1.txt"],
    outputDir: "/tmp/ruminate-123",
    snapshotPath: "/tmp/ruminate-123/vault-snapshot.md",
  };

  const prompt = buildRuminatePrompt(extraction, "/test/vault");
  assert.ok(prompt.includes("42 past sessions"));
  assert.ok(prompt.includes("memory-miner"));
  assert.ok(prompt.includes("/tmp/batch_0.txt"));
  assert.ok(prompt.includes("/tmp/batch_1.txt"));
  assert.ok(prompt.includes("vault-snapshot.md"));
  assert.ok(prompt.includes("log_operation"));
  assert.ok(prompt.includes("type='ruminate'"));
});

// --- renderDashboardLines ---

test("renderDashboardLines shows empty state", () => {
  const st: MemoryState = { operations: [], dreamCycle: 0 };
  const lines = renderDashboardLines(st, 120, plainTheme, 0);
  assert.ok(lines.some((l) => l.includes("No operations yet")));
});

test("renderDashboardLines shows operations summary", () => {
  const st: MemoryState = {
    operations: [
      { type: "reflect", status: "keep", description: "Added gotchas", findingsCount: 3, filesChanged: ["gotchas.md"], durationMs: 5000, timestamp: Date.now() - 60000 },
      { type: "dream", status: "noop", description: "Looks good", findingsCount: 0, filesChanged: [], durationMs: 2000, timestamp: Date.now() - 30000 },
    ],
    dreamCycle: 0,
  };

  const lines = renderDashboardLines(st, 120, plainTheme, 5);
  const text = lines.join("\n");
  assert.ok(text.includes("1 kept"));
  assert.ok(text.includes("1 noop"));
  assert.ok(text.includes("reflect"));
  assert.ok(text.includes("dream"));
  assert.ok(text.includes("Added gotchas"));
});

test("renderDashboardLines respects maxRows", () => {
  const ops = Array.from({ length: 10 }, (_, i) => ({
    type: "reflect" as const,
    status: "keep" as const,
    description: `op ${i}`,
    findingsCount: 1,
    filesChanged: [],
    durationMs: 1000,
    timestamp: Date.now(),
  }));
  const st: MemoryState = { operations: ops, dreamCycle: 0 };

  const lines = renderDashboardLines(st, 120, plainTheme, 5, 3);
  const text = lines.join("\n");
  // Should show "earlier ops" indicator
  assert.ok(text.includes("earlier op"));
});

// --- parseOperationsJSONL ---

test("parseOperationsJSONL parses valid entries", () => {
  const content = [
    JSON.stringify({ operationType: "reflect", status: "keep", description: "Added notes", findingsCount: 2, timestamp: 1000 }),
    JSON.stringify({ operationType: "dream", status: "noop", description: "Looks good", findingsCount: 0, timestamp: 2000 }),
  ].join("\n");

  const ops = parseOperationsJSONL(content);
  assert.strictEqual(ops.length, 2);
  assert.strictEqual(ops[0].type, "reflect");
  assert.strictEqual(ops[0].status, "keep");
  assert.strictEqual(ops[0].findingsCount, 2);
  assert.strictEqual(ops[1].type, "dream");
});

test("parseOperationsJSONL skips config lines", () => {
  const content = [
    JSON.stringify({ type: "config", version: 1 }),
    JSON.stringify({ operationType: "reflect", status: "keep", description: "test", timestamp: 1000 }),
  ].join("\n");

  const ops = parseOperationsJSONL(content);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].type, "reflect");
});

test("parseOperationsJSONL skips malformed lines", () => {
  const content = "not json\n" + JSON.stringify({ operationType: "reflect", status: "keep", description: "valid", timestamp: 1000 });

  const ops = parseOperationsJSONL(content);
  assert.strictEqual(ops.length, 1);
});

test("parseOperationsJSONL parses ingest operations", () => {
  const ops = parseOperationsJSONL(JSON.stringify({ operationType: "ingest", status: "keep", description: "ingested", timestamp: 1 }));
  assert.strictEqual(ops[0].type, "ingest");
});

test("parseOperationsJSONL defaults missing fields", () => {
  const content = JSON.stringify({ status: "keep" });

  const ops = parseOperationsJSONL(content);
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].type, "reflect"); // default
  assert.strictEqual(ops[0].description, "");
  assert.strictEqual(ops[0].findingsCount, 0);
  assert.strictEqual(ops[0].durationMs, 0);
});

test("parseOperationsJSONL handles empty string", () => {
  assert.deepStrictEqual(parseOperationsJSONL(""), []);
});

test("limits remain unchanged", () => {
  assert.strictEqual(MEMORY_TOPIC_LIMIT, 500);
  assert.strictEqual(MEMORY_INDEX_LIMIT, 200);
});
