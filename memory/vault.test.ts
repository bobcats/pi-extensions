import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readVaultIndex,
  listVaultFiles,
  countVaultFiles,
  buildVaultIndex,
  buildVaultSnapshot,
} from "./lib.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mem-vault-test-"));
}

// --- readVaultIndex ---

test("readVaultIndex returns content when index.md exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n- [[foo]]\n");

  const result = readVaultIndex(dir);
  assert.ok(result);
  assert.ok(result.includes("# Memory"));
});

test("readVaultIndex returns null when directory is missing", () => {
  assert.strictEqual(readVaultIndex("/nonexistent/path"), null);
});

test("readVaultIndex returns null when index.md is missing", () => {
  const dir = tmpDir();
  assert.strictEqual(readVaultIndex(dir), null);
});

test("readVaultIndex returns null for empty file", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "");

  assert.strictEqual(readVaultIndex(dir), null);
});

// --- listVaultFiles ---

test("listVaultFiles returns .md slugs excluding index.md", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(dir, "foo.md"), "# Foo\n");
  fs.writeFileSync(path.join(dir, "bar.md"), "# Bar\n");

  const files = listVaultFiles(dir);
  assert.deepStrictEqual(files, ["bar", "foo"]);
});

test("listVaultFiles includes nested directories", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "projects", "myapp"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(dir, "projects", "myapp", "gotchas.md"), "# Gotchas\n");
  fs.writeFileSync(path.join(dir, "top-level.md"), "# Top\n");

  const files = listVaultFiles(dir);
  assert.ok(files.includes("projects/myapp/gotchas"));
  assert.ok(files.includes("top-level"));
});

test("listVaultFiles skips dotfiles and special files", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "config"), "");
  fs.writeFileSync(path.join(dir, "dream-journal.md"), "journal");
  fs.writeFileSync(path.join(dir, "memory-operations.jsonl"), "{}");
  fs.writeFileSync(path.join(dir, "real-note.md"), "# Note\n");

  const files = listVaultFiles(dir);
  assert.deepStrictEqual(files, ["real-note"]);
});

test("listVaultFiles returns empty array for nonexistent dir", () => {
  assert.deepStrictEqual(listVaultFiles("/nonexistent"), []);
});

test("listVaultFiles returns sorted results", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "zebra.md"), "z");
  fs.writeFileSync(path.join(dir, "alpha.md"), "a");
  fs.writeFileSync(path.join(dir, "middle.md"), "m");

  const files = listVaultFiles(dir);
  assert.deepStrictEqual(files, ["alpha", "middle", "zebra"]);
});

// --- countVaultFiles ---

test("countVaultFiles counts md files excluding specials", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(dir, "a.md"), "a");
  fs.writeFileSync(path.join(dir, "b.md"), "b");

  assert.strictEqual(countVaultFiles(dir), 2);
});

test("countVaultFiles returns 0 for empty vault", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");

  assert.strictEqual(countVaultFiles(dir), 0);
});

// --- buildVaultIndex ---

test("buildVaultIndex returns header only for empty vault", () => {
  const dir = tmpDir();
  assert.strictEqual(buildVaultIndex(dir), "# Memory\n");
});

test("buildVaultIndex groups files by top-level directory", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "principles", "foo.md"), "foo");
  fs.writeFileSync(path.join(dir, "principles", "bar.md"), "bar");
  fs.writeFileSync(path.join(dir, "standalone.md"), "standalone");

  const index = buildVaultIndex(dir);
  assert.ok(index.includes("## Principles"));
  assert.ok(index.includes("- [[principles/bar]]"));
  assert.ok(index.includes("- [[principles/foo]]"));
  assert.ok(index.includes("## Other"));
  assert.ok(index.includes("- [[standalone]]"));
});

test("buildVaultIndex does not include index.md in listing", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(dir, "note.md"), "a note");

  const index = buildVaultIndex(dir);
  assert.ok(!index.includes("[[index]]"));
  assert.ok(index.includes("[[note]]"));
});

// --- buildVaultSnapshot ---

test("buildVaultSnapshot concatenates files with headers", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(dir, "note.md"), "# A Note\nSome content.");

  const snapshot = buildVaultSnapshot(dir);
  assert.ok(snapshot.includes("=== index.md ==="));
  assert.ok(snapshot.includes("# Memory"));
  assert.ok(snapshot.includes("=== note.md ==="));
  assert.ok(snapshot.includes("Some content."));
});

test("buildVaultSnapshot includes nested files", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "projects"), { recursive: true });
  fs.writeFileSync(path.join(dir, "projects", "foo.md"), "# Foo project");

  const snapshot = buildVaultSnapshot(dir);
  assert.ok(snapshot.includes("=== projects/foo.md ==="));
});

test("buildVaultSnapshot returns empty string for missing dir", () => {
  assert.strictEqual(buildVaultSnapshot("/nonexistent"), "");
});

test("buildVaultSnapshot skips non-md files", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "note.md"), "note");
  fs.writeFileSync(path.join(dir, "data.json"), '{"key": "value"}');

  const snapshot = buildVaultSnapshot(dir);
  assert.ok(snapshot.includes("note.md"));
  assert.ok(!snapshot.includes("data.json"));
});
