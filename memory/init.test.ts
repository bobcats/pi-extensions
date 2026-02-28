import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { initVault, getInitState } from "./init.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-init-test-"));
}

test("getInitState returns 'empty' when dir does not exist", () => {
  assert.equal(getInitState("/nonexistent/xyz"), "empty");
});

test("getInitState returns 'empty' when dir exists but is empty", () => {
  const dir = tmpDir();
  assert.equal(getInitState(dir), "empty");
});

test("getInitState returns 'v1' when MEMORY.md exists but no index.md", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# Memory");
  assert.equal(getInitState(dir), "v1");
});

test("getInitState returns 'v2' when index.md exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory");
  assert.equal(getInitState(dir), "v2");
});

test("initVault creates vault with principles in empty dir", () => {
  const dir = tmpDir();
  const vaultDir = path.join(dir, "memories");

  const result = initVault(vaultDir, true);

  assert.equal(result.created, true);
  assert.ok(fs.existsSync(path.join(vaultDir, "index.md")));
  assert.ok(fs.existsSync(path.join(vaultDir, "principles.md")));
  assert.ok(fs.existsSync(path.join(vaultDir, "principles", "prove-it-works.md")));
  assert.equal(result.principlesInstalled, 16);
});

test("initVault creates project vault without principles", () => {
  const dir = tmpDir();
  const vaultDir = path.join(dir, "memories");

  const result = initVault(vaultDir, false);

  assert.equal(result.created, true);
  assert.ok(fs.existsSync(path.join(vaultDir, "index.md")));
  assert.ok(!fs.existsSync(path.join(vaultDir, "principles")));
  assert.equal(result.principlesInstalled, 0);
});

test("initVault index.md contains wikilinks to installed principles", () => {
  const dir = tmpDir();
  const vaultDir = path.join(dir, "memories");

  initVault(vaultDir, true);

  const index = fs.readFileSync(path.join(vaultDir, "index.md"), "utf-8");
  assert.match(index, /\[\[principles\/prove-it-works\]\]/);
  assert.match(index, /\[\[principles\/fix-root-causes\]\]/);
});
