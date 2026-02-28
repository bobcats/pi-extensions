import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  readMemoryIndex,
  listTopicFiles,
  listVaultFiles,
  parseWikilinks,
  detectIndexDrift,
  buildVaultIndex,
  buildMemorySection,
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

// --- readMemoryIndex ---

test("readMemoryIndex returns content when file exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# My Memory\n- prefer tabs");
  assert.equal(readMemoryIndex(dir), "# My Memory\n- prefer tabs");
});

test("readMemoryIndex returns null when dir missing", () => {
  assert.equal(readMemoryIndex("/nonexistent/path/abc123"), null);
});

test("readMemoryIndex returns null when file missing", () => {
  const dir = tmpDir();
  assert.equal(readMemoryIndex(dir), null);
});

test("readMemoryIndex returns null when file is empty", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "");
  assert.equal(readMemoryIndex(dir), null);
});

test("readMemoryIndex returns null when file is whitespace only", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "  \n\n  ");
  assert.equal(readMemoryIndex(dir), null);
});

// --- listTopicFiles ---

test("listTopicFiles returns md files excluding MEMORY.md", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "index");
  fs.writeFileSync(path.join(dir, "api.md"), "line1\nline2\nline3");
  fs.writeFileSync(path.join(dir, "testing.md"), "line1\nline2");
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a markdown file");

  const files = listTopicFiles(dir);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, "api.md");
  assert.equal(files[0].lines, 3);
  assert.equal(files[1].name, "testing.md");
  assert.equal(files[1].lines, 2);
});

test("listTopicFiles returns empty array when dir missing", () => {
  assert.deepEqual(listTopicFiles("/nonexistent/path/abc123"), []);
});

test("listTopicFiles returns empty array when no topic files exist", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "index");
  assert.deepEqual(listTopicFiles(dir), []);
});

test("listTopicFiles sorted alphabetically", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "zebra.md"), "z");
  fs.writeFileSync(path.join(dir, "alpha.md"), "a");
  const files = listTopicFiles(dir);
  assert.equal(files[0].name, "alpha.md");
  assert.equal(files[1].name, "zebra.md");
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

test("listVaultFiles returns empty array for missing dir", () => {
  assert.deepEqual(listVaultFiles("/nonexistent/xyz"), []);
});

test("listVaultFiles returns empty array when only index.md exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Index");
  assert.deepEqual(listVaultFiles(dir), []);
});

test("listVaultFiles ignores non-md files", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "notes.txt"), "text");
  fs.writeFileSync(path.join(dir, "topic.md"), "content");
  assert.deepEqual(listVaultFiles(dir), ["topic"]);
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

test("parseWikilinks returns empty array for no links", () => {
  assert.deepEqual(parseWikilinks("no links here"), []);
});

test("parseWikilinks deduplicates", () => {
  const content = "- [[a]]\n- [[a]]\n- [[b]]";
  assert.deepEqual(parseWikilinks(content), ["a", "b"]);
});

test("parseWikilinks handles inline links", () => {
  const content = "See [[topic-a]] and also [[topic-b]] for details.";
  assert.deepEqual(parseWikilinks(content), ["topic-a", "topic-b"]);
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

test("detectIndexDrift returns true when file added", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "- [[preferences]]");
  fs.writeFileSync(path.join(dir, "preferences.md"), "prefs");
  fs.writeFileSync(path.join(dir, "new-topic.md"), "new");
  assert.equal(detectIndexDrift(dir), true);
});

test("detectIndexDrift returns true when file removed", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "- [[preferences]]\n- [[old-topic]]");
  fs.writeFileSync(path.join(dir, "preferences.md"), "prefs");
  assert.equal(detectIndexDrift(dir), true);
});

test("detectIndexDrift returns true when no index.md exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "topic.md"), "content");
  assert.equal(detectIndexDrift(dir), true);
});

test("detectIndexDrift returns false for empty vault", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory");
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

test("buildVaultIndex handles empty vault", () => {
  const dir = tmpDir();
  assert.equal(buildVaultIndex(dir), "# Memory\n");
});

test("buildVaultIndex puts standalone files under Other", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "prefs.md"), "prefs");
  fs.writeFileSync(path.join(dir, "workflow.md"), "flow");
  const index = buildVaultIndex(dir);
  assert.match(index, /## Other\n- \[\[prefs\]\]\n- \[\[workflow\]\]/);
  assert.ok(!index.includes("## Prefs"));
});

// --- buildMemorySection ---

test("buildMemorySection formats scope with content and topic list", () => {
  const section = buildMemorySection("project", "# Prefs\n- tabs", [
    { name: "api.md", lines: 42 },
    { name: "testing.md", lines: 15 },
  ]);
  assert.match(section, /project/i);
  assert.match(section, /# Prefs/);
  assert.match(section, /- tabs/);
  assert.match(section, /api\.md/);
  assert.match(section, /42/);
  assert.match(section, /testing\.md/);
});

test("buildMemorySection with content and no topic files", () => {
  const section = buildMemorySection("global", "# Global prefs", []);
  assert.match(section, /global/i);
  assert.match(section, /# Global prefs/);
});

test("buildMemorySection with null content shows empty nudge", () => {
  const section = buildMemorySection("project", null, []);
  assert.match(section, /empty/i);
  assert.match(section, /pattern/i);
});

test("buildMemorySection with over-limit content truncates and warns", () => {
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
  const content = lines.join("\n");
  const section = buildMemorySection("project", content, []);
  assert.match(section, /WARNING/);
  assert.match(section, /250/);
  assert.match(section, /200/);
  // Should contain line 1 but not line 250
  assert.match(section, /line 1/);
  assert.ok(!section.includes("line 250"));
});

test("buildMemorySection with exactly 200 lines shows full content", () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
  const content = lines.join("\n");
  const section = buildMemorySection("project", content, []);
  assert.ok(!section.includes("WARNING"));
  assert.match(section, /line 200/);
});

// --- buildMemoryPrompt ---

test("buildMemoryPrompt with both scopes shows global first then project", () => {
  const prompt = buildMemoryPrompt(
    { content: "global stuff", topicFiles: [] },
    { content: "project stuff", topicFiles: [] },
  );
  const globalIdx = prompt.indexOf("Global Memory");
  const projectIdx = prompt.indexOf("Project Memory");
  assert.ok(globalIdx >= 0);
  assert.ok(projectIdx >= 0);
  assert.ok(globalIdx < projectIdx);
  assert.match(prompt, /global stuff/);
  assert.match(prompt, /project stuff/);
});

test("buildMemoryPrompt with only global scope", () => {
  const prompt = buildMemoryPrompt(
    { content: "global stuff", topicFiles: [] },
    null,
  );
  assert.match(prompt, /Global Memory/);
  assert.match(prompt, /global stuff/);
  assert.ok(!prompt.includes("Project Memory"));
});

test("buildMemoryPrompt with only project scope", () => {
  const prompt = buildMemoryPrompt(
    null,
    { content: "project stuff", topicFiles: [] },
  );
  assert.match(prompt, /Project Memory/);
  assert.match(prompt, /project stuff/);
  assert.ok(!prompt.includes("Global Memory"));
});

test("buildMemoryPrompt with neither scope returns empty string", () => {
  assert.equal(buildMemoryPrompt(null, null), "");
});

test("buildMemoryPrompt includes topic file listings", () => {
  const prompt = buildMemoryPrompt(
    { content: "idx", topicFiles: [{ name: "testing.md", lines: 20 }] },
    { content: "idx", topicFiles: [{ name: "api.md", lines: 50 }] },
  );
  assert.match(prompt, /testing\.md/);
  assert.match(prompt, /api\.md/);
});

test("buildMemoryPrompt with empty content shows nudge per scope", () => {
  const prompt = buildMemoryPrompt(
    { content: null, topicFiles: [] },
    { content: null, topicFiles: [] },
  );
  // Both scopes get the empty nudge
  const nudgeCount = (prompt.match(/currently empty/g) || []).length;
  assert.equal(nudgeCount, 2);
});

// --- buildWriteInstructions ---

test("buildWriteInstructions includes both directory paths", () => {
  const text = buildWriteInstructions("/home/user/.pi/memories", "/project/.pi/memories");
  assert.match(text, /\/home\/user\/\.pi\/memories/);
  assert.match(text, /\/project\/\.pi\/memories/);
});

test("buildWriteInstructions includes active read nudge", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /consult your memory/i);
});

test("buildWriteInstructions includes what to save section", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /what to save/i);
  assert.match(text, /pattern/i);
  assert.match(text, /architectural decisions/i);
  assert.match(text, /preferences/i);
  assert.match(text, /debugging/i);
});

test("buildWriteInstructions includes what NOT to save section", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /what not to save/i);
  assert.match(text, /session-specific/i);
  assert.match(text, /incomplete/i);
  assert.match(text, /speculative/i);
});

test("buildWriteInstructions includes explicit user request handling", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /remember/i);
  assert.match(text, /forget/i);
});

test("buildWriteInstructions includes semantic organization guidance", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /semantic/i);
  assert.match(text, /topic/i);
});

test("buildWriteInstructions includes MEMORY.md index and topic file guidance", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /MEMORY\.md/);
  assert.match(text, /200/);
  assert.match(text, /topic/i);
});

test("buildWriteInstructions includes when to save timing hints", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /completing a feature/i);
  assert.match(text, /fixing a.*bug/i);
});

test("buildWriteInstructions includes generalizability filter", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /generalize/i);
});

test("buildWriteInstructions includes self-check gate before writing", () => {
  const text = buildWriteInstructions("/g", "/p");
  // Must tell the model to evaluate entries against criteria before saving
  assert.match(text, /before (saving|writing).*check/i);
});

test("buildWriteInstructions mentions write and edit tools", () => {
  const text = buildWriteInstructions("/g", "/p");
  assert.match(text, /write/i);
  assert.match(text, /edit/i);
});

// --- isMemoryPath ---

test("isMemoryPath identifies MEMORY.md in global dir", () => {
  const result = isMemoryPath("/home/.pi/memories/MEMORY.md", "/home/.pi/memories", "/proj/.pi/memories");
  assert.deepEqual(result, { isMemory: true, isIndex: true });
});

test("isMemoryPath identifies topic file in project dir", () => {
  const result = isMemoryPath("/proj/.pi/memories/api.md", "/home/.pi/memories", "/proj/.pi/memories");
  assert.deepEqual(result, { isMemory: true, isIndex: false });
});

test("isMemoryPath returns false for non-memory path", () => {
  const result = isMemoryPath("/proj/src/main.ts", "/home/.pi/memories", "/proj/.pi/memories");
  assert.deepEqual(result, { isMemory: false, isIndex: false });
});

test("isMemoryPath returns false for file outside memory dirs", () => {
  const result = isMemoryPath("/other/MEMORY.md", "/home/.pi/memories", "/proj/.pi/memories");
  assert.deepEqual(result, { isMemory: false, isIndex: false });
});

// --- checkLineLimit ---

test("checkLineLimit reports under limit", () => {
  const result = checkLineLimit("line1\nline2\nline3", 200);
  assert.deepEqual(result, { lines: 3, limit: 200, exceeds: false });
});

test("checkLineLimit reports at exact limit", () => {
  const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const result = checkLineLimit(content, 200);
  assert.deepEqual(result, { lines: 200, limit: 200, exceeds: false });
});

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

test("formatMemoryDisplay shows both scopes with content", () => {
  const display = formatMemoryDisplay(
    { dir: "/home/.pi/memories", content: "global prefs", topicFiles: [{ name: "git.md", lines: 10 }] },
    { dir: "/proj/.pi/memories", content: "project prefs", topicFiles: [] },
    true,
  );
  assert.match(display, /Global/);
  assert.match(display, /global prefs/);
  assert.match(display, /git\.md/);
  assert.match(display, /Project/);
  assert.match(display, /project prefs/);
  assert.match(display, /enabled/i);
});

test("formatMemoryDisplay shows disabled status", () => {
  const display = formatMemoryDisplay(
    { dir: "/g", content: null, topicFiles: [] },
    { dir: "/p", content: null, topicFiles: [] },
    false,
  );
  assert.match(display, /disabled/i);
});

test("formatMemoryDisplay shows empty state for both scopes", () => {
  const display = formatMemoryDisplay(
    { dir: "/g", content: null, topicFiles: [] },
    { dir: "/p", content: null, topicFiles: [] },
    true,
  );
  assert.match(display, /empty/i);
});

test("formatMemoryDisplay shows line counts for topic files", () => {
  const display = formatMemoryDisplay(
    { dir: "/g", content: "idx", topicFiles: [{ name: "api.md", lines: 42 }, { name: "test.md", lines: 15 }] },
    { dir: "/p", content: null, topicFiles: [] },
    true,
  );
  assert.match(display, /api\.md.*42/);
  assert.match(display, /test\.md.*15/);
});

// --- formatMemoryStatus ---

test("formatMemoryStatus shows on with 2 scopes and topics", () => {
  assert.equal(formatMemoryStatus(true, 2, 3), "memory: on · 2 scopes · 3 topics");
});

test("formatMemoryStatus shows on with 1 scope and no topics", () => {
  assert.equal(formatMemoryStatus(true, 1, 0), "memory: on · 1 scope");
});

test("formatMemoryStatus shows on with 0 scopes as empty", () => {
  assert.equal(formatMemoryStatus(true, 0, 0), "memory: on · empty");
});

test("formatMemoryStatus shows off when disabled", () => {
  assert.equal(formatMemoryStatus(false, 2, 5), "memory: off");
});

test("formatMemoryStatus shows 1 topic singular", () => {
  assert.equal(formatMemoryStatus(true, 1, 1), "memory: on · 1 scope · 1 topic");
});

