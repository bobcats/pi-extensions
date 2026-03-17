import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  initGitRepo,
  hasChanges,
  getChangedFiles,
  commitVault,
  undoLastCommit,
  getGitLog,
  git,
} from "./git.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mem-git-test-"));
}

test("initGitRepo creates initial commit with all files", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");

  initGitRepo(dir);

  const log = git(dir, ["log", "--oneline"]);
  assert.ok(log.includes("init: memory vault"));
});

test("initGitRepo is idempotent — skips if already a repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");

  initGitRepo(dir);
  initGitRepo(dir);

  const log = git(dir, ["log", "--oneline"]).split("\n");
  assert.strictEqual(log.length, 1);
});

test("initGitRepo skips if directory does not exist", () => {
  const dir = path.join(os.tmpdir(), `mem-git-test-nonexistent-${Date.now()}`);

  // Should not throw
  initGitRepo(dir);

  assert.ok(!fs.existsSync(dir));
});

test("hasChanges returns false on clean repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  assert.strictEqual(hasChanges(dir), false);
});

test("hasChanges returns true after file modification", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n\n- new note\n");
  assert.strictEqual(hasChanges(dir), true);
});

test("hasChanges returns true after file deletion", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(dir, "notes.md"), "# Notes\n");
  initGitRepo(dir);

  fs.unlinkSync(path.join(dir, "notes.md"));
  assert.strictEqual(hasChanges(dir), true);
});

test("hasChanges returns false for non-repo directory", () => {
  const dir = tmpDir();
  assert.strictEqual(hasChanges(dir), false);
});

test("getChangedFiles lists modified and new files", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "index.md"), "# Modified\n");
  fs.writeFileSync(path.join(dir, "new.md"), "# New\n");

  const changed = getChangedFiles(dir);
  assert.ok(changed.length >= 2, `Expected at least 2 changed files, got: ${JSON.stringify(changed)}`);
  // new.md is untracked (??), index.md is modified ( M)
  assert.ok(changed.some((f) => f.includes("new.md")));
  // Modified files may show differently in porcelain
  assert.ok(changed.some((f) => f.includes("index.md")), `Expected index.md in: ${JSON.stringify(changed)}`);
});

test("getChangedFiles returns empty array for clean repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  assert.deepStrictEqual(getChangedFiles(dir), []);
});

test("commitVault commits all changes with message", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "new.md"), "# New\n");
  const result = commitVault(dir, "test commit");

  assert.strictEqual(result.committed, true);
  assert.ok(result.commit);
  assert.strictEqual(hasChanges(dir), false);

  const log = git(dir, ["log", "--oneline"]);
  assert.ok(log.includes("test commit"));
});

test("commitVault returns false when no changes", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  const result = commitVault(dir, "nothing to commit");
  assert.strictEqual(result.committed, false);
});

test("undoLastCommit reverts files to previous state", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "oops.md"), "# Oops\n");
  commitVault(dir, "add oops");
  assert.ok(fs.existsSync(path.join(dir, "oops.md")));

  const result = undoLastCommit(dir);
  assert.strictEqual(result.success, true);
  if (result.success) {
    assert.strictEqual(result.undoneMessage, "add oops");
  }
  assert.ok(!fs.existsSync(path.join(dir, "oops.md")));
});

test("undoLastCommit fails when only initial commit exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  const result = undoLastCommit(dir);
  assert.strictEqual(result.success, false);
});

test("undoLastCommit fails for non-repo", () => {
  const dir = tmpDir();
  const result = undoLastCommit(dir);
  assert.strictEqual(result.success, false);
});

test("getGitLog returns correct number of entries", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "a.md"), "a");
  commitVault(dir, "add a");
  fs.writeFileSync(path.join(dir, "b.md"), "b");
  commitVault(dir, "add b");

  const entries = getGitLog(dir, 2);
  assert.strictEqual(entries.length, 2);
  assert.ok(entries[0].includes("add b"));
  assert.ok(entries[1].includes("add a"));
});

test("getGitLog returns empty array for non-repo", () => {
  const dir = tmpDir();
  assert.deepStrictEqual(getGitLog(dir, 10), []);
});
