import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initGitRepo, commitVaultChanges, undoLastCommit, getLog, isGitRepo, hasChanges } from "./git.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "git-brain-test-"));
}

test("isGitRepo returns false for non-repo directory", () => {
  const dir = tmpDir();
  assert.equal(isGitRepo(dir), false);
});

test("isGitRepo returns false for subdirectory of a different repo", () => {
  const parent = tmpDir();
  fs.writeFileSync(path.join(parent, "dummy.txt"), "x");
  initGitRepo(parent);
  const child = path.join(parent, "nested");
  fs.mkdirSync(child);
  assert.equal(isGitRepo(child), false);
});

test("isGitRepo returns true after initGitRepo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  assert.equal(isGitRepo(dir), true);
});

test("initGitRepo creates initial commit with all files", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "principles", "test.md"), "content");
  initGitRepo(dir);

  const log = getLog(dir, 5);
  assert.equal(log.length, 1);
  assert.match(log[0], /init: memory vault/);
});

test("initGitRepo is idempotent — skips if already a repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  initGitRepo(dir); // should not throw or create a second commit

  const log = getLog(dir, 5);
  assert.equal(log.length, 1);
});

test("hasChanges returns false on clean repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  assert.equal(hasChanges(dir), false);
});

test("hasChanges returns true after file modification", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, "new.md"), "new content");
  assert.equal(hasChanges(dir), true);
});

test("hasChanges returns true after file deletion", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  fs.unlinkSync(path.join(dir, "index.md"));
  assert.equal(hasChanges(dir), true);
});

test("commitVaultChanges commits all changes with message", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "topic.md"), "new topic");
  const committed = commitVaultChanges(dir, "reflect: test commit");
  assert.equal(committed, true);

  const log = getLog(dir, 5);
  assert.equal(log.length, 2);
  assert.match(log[0], /reflect: test commit/);
});

test("commitVaultChanges returns false when no changes", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  const committed = commitVaultChanges(dir, "empty commit");
  assert.equal(committed, false);
});

test("undoLastCommit reverts files to previous state", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "bad.md"), "bad content");
  commitVaultChanges(dir, "meditate: bad changes");
  assert.ok(fs.existsSync(path.join(dir, "bad.md")));

  const result = undoLastCommit(dir);
  assert.ok(result.success);
  assert.match(result.undoneMessage, /meditate: bad changes/);
  assert.ok(!fs.existsSync(path.join(dir, "bad.md")));
});

test("undoLastCommit fails when only initial commit exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  const result = undoLastCommit(dir);
  assert.equal(result.success, false);
  assert.match(result.error!, /initial commit/i);
});

test("getLog returns empty array for non-repo", () => {
  const dir = tmpDir();
  const log = getLog(dir, 5);
  assert.deepEqual(log, []);
});

test("getLog returns correct number of entries", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(dir, `topic-${i}.md`), `content ${i}`);
    commitVaultChanges(dir, `reflect: commit ${i}`);
  }

  const log = getLog(dir, 3);
  assert.equal(log.length, 3);
});
