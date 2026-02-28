import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readVaultIndex,
  listTopicFiles,
  listVaultFiles,
  parseWikilinks,
  detectIndexDrift,
  buildVaultIndex,
  buildMemoryPrompt,
  buildWriteInstructions,
  isMemoryPath,
  checkLineLimit,
  formatMemoryDisplay,
  formatMemoryStatus,
  MEMORY_INDEX_LIMIT,
  MEMORY_TOPIC_LIMIT,
} from "./lib.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
}

// --- readVaultIndex ---

test("readVaultIndex returns content when file exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# My Memory\n- [[preferences]]");
  assert.equal(readVaultIndex(dir), "# My Memory\n- [[preferences]]");
});

test("readVaultIndex returns null when dir missing", () => {
  assert.equal(readVaultIndex("/nonexistent/path/abc123"), null);
});

test("readVaultIndex returns null when file missing", () => {
  const dir = tmpDir();
  assert.equal(readVaultIndex(dir), null);
});

// --- listTopicFiles ---

test("listTopicFiles returns md files excluding index.md", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory");
  fs.writeFileSync(path.join(dir, "api.md"), "line1\nline2\nline3");
  fs.writeFileSync(path.join(dir, "testing.md"), "line1\nline2");

  const files = listTopicFiles(dir);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, "api.md");
  assert.equal(files[1].name, "testing.md");
});

// --- listVaultFiles ---

test("listVaultFiles returns all .md files recursively except index.md", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), "# Index");
  fs.writeFileSync(path.join(dir, "preferences.md"), "prefs");
  fs.writeFileSync(path.join(dir, "principles", "prove-it-works.md"), "prove");
  fs.writeFileSync(path.join(dir, "principles", "fix-root-causes.md"), "fix");

  const files = listVaultFiles(dir);
  assert.deepEqual(files, [
    "preferences",
    "principles/fix-root-causes",
    "principles/prove-it-works",
  ]);
});

// --- parseWikilinks ---

test("parseWikilinks extracts wikilink targets", () => {
  const content = "- [[principles/prove-it-works]]\n- [[preferences]]\n- [[principles/fix-root-causes]]";
  assert.deepEqual(parseWikilinks(content), [
    "preferences",
    "principles/fix-root-causes",
    "principles/prove-it-works",
  ]);
});

// --- detectIndexDrift ---

test("detectIndexDrift returns false when index matches files", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), "- [[preferences]]\n- [[principles/prove-it-works]]");
  fs.writeFileSync(path.join(dir, "preferences.md"), "prefs");
  fs.writeFileSync(path.join(dir, "principles", "prove-it-works.md"), "prove");
  assert.equal(detectIndexDrift(dir), false);
});

// --- buildVaultIndex ---

test("buildVaultIndex groups files by top-level directory", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.mkdirSync(path.join(dir, "codebase"), { recursive: true });
  fs.writeFileSync(path.join(dir, "preferences.md"), "prefs");
  fs.writeFileSync(path.join(dir, "principles", "prove-it-works.md"), "prove");
  fs.writeFileSync(path.join(dir, "principles", "fix-root-causes.md"), "fix");
  fs.writeFileSync(path.join(dir, "codebase", "api.md"), "api");

  const index = buildVaultIndex(dir);
  assert.match(index, /^# Memory\n/);
  assert.match(index, /## Codebase\n- \[\[codebase\/api\]\]/);
  assert.match(index, /## Principles\n- \[\[principles\/fix-root-causes\]\]\n- \[\[principles\/prove-it-works\]\]/);
  assert.match(index, /## Other\n- \[\[preferences\]\]/);
});

// --- buildMemoryPrompt ---

test("buildMemoryPrompt injects index-only content with paths", () => {
  const prompt = buildMemoryPrompt(
    { dir: "/g/.pi/memories", indexContent: "# Memory\n- [[global-topic]]", fileCount: 1 },
    { dir: "/p/.pi/memories", indexContent: "# Memory\n- [[project-topic]]", fileCount: 1 },
  );
  assert.match(prompt, /Memory vault index/);
  assert.match(prompt, /### Global Memory \(\/g\/\.pi\/memories\/\)/);
  assert.match(prompt, /### Project Memory \(\/p\/\.pi\/memories\/\)/);
  assert.ok(!prompt.includes("Topic files"));
});

test("buildMemoryPrompt returns empty string when both indexes missing", () => {
  const prompt = buildMemoryPrompt(
    { dir: "/g", indexContent: null, fileCount: 0 },
    { dir: "/p", indexContent: null, fileCount: 0 },
  );
  assert.equal(prompt, "");
});

// --- buildWriteInstructions ---

test("buildWriteInstructions is trimmed and references vault conventions", () => {
  const text = buildWriteInstructions("/home/user/.pi/memories", "/project/.pi/memories");
  assert.match(text, /\/home\/user\/\.pi\/memories\//);
  assert.match(text, /\/project\/\.pi\/memories\//);
  assert.match(text, /\[\[wikilinks\]\]/);
  assert.match(text, /index\.md is auto-maintained/);
  assert.ok(!text.includes("What NOT to save"));
  assert.ok(!text.includes("When to save"));
});

// --- isMemoryPath ---

test("isMemoryPath identifies index.md in global dir", () => {
  const result = isMemoryPath("/home/.pi/memories/index.md", "/home/.pi/memories", "/proj/.pi/memories");
  assert.deepEqual(result, { isMemory: true, isIndex: true, scope: "global" });
});

// --- checkLineLimit ---

test("checkLineLimit reports over limit", () => {
  const content = Array.from({ length: 201 }, (_, i) => `line ${i}`).join("\n");
  const result = checkLineLimit(content, 200);
  assert.deepEqual(result, { lines: 201, limit: 200, exceeds: true });
});

test("checkLineLimit works with topic file limit", () => {
  const content = Array.from({ length: 501 }, (_, i) => `line ${i}`).join("\n");
  const result = checkLineLimit(content, 500);
  assert.deepEqual(result, { lines: 501, limit: 500, exceeds: true });
});

// --- formatMemoryDisplay ---

test("formatMemoryDisplay shows v2/v1/empty states", () => {
  const display = formatMemoryDisplay(
    { dir: "/home/.pi/memories", state: "v2", fileCount: 4 },
    { dir: "/proj/.pi/memories", state: "v1", fileCount: 0 },
    true,
  );
  assert.match(display, /Vault: 4 files/);
  assert.match(display, /Legacy MEMORY\.md detected/);
  assert.match(display, /Commands: init, v2migrate, reflect, meditate, ruminate, on, off, edit/);
});

test("formatMemoryDisplay suggests init when no vault exists", () => {
  const display = formatMemoryDisplay(
    { dir: "/g", state: "empty", fileCount: 0 },
    { dir: "/p", state: "empty", fileCount: 0 },
    true,
  );
  assert.match(display, /No vault — run \/memory init/);
});

// --- formatMemoryStatus ---

test("formatMemoryStatus shows no vault", () => {
  assert.equal(formatMemoryStatus(true, false, false, 0), "memory: on · no vault");
});

test("formatMemoryStatus shows one scope and file count", () => {
  assert.equal(formatMemoryStatus(true, true, false, 16), "memory: on · 1 scope · 16 files");
});

test("formatMemoryStatus shows two scopes and file count", () => {
  assert.equal(formatMemoryStatus(true, true, true, 5), "memory: on · 2 scopes · 5 files");
});

test("formatMemoryStatus shows off when disabled", () => {
  assert.equal(formatMemoryStatus(false, true, true, 5), "memory: off");
});

// --- constants ---

test("limits remain unchanged", () => {
  assert.equal(MEMORY_INDEX_LIMIT, 200);
  assert.equal(MEMORY_TOPIC_LIMIT, 500);
});
