import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initVault, listVaultFiles, readVaultIndex } from "./lib.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mem-init-test-"));
}

test("initVault creates vault with principles and projects dir", () => {
  const dir = tmpDir();

  const result = initVault(dir, true);

  assert.strictEqual(result.created, true);
  assert.ok(result.principlesInstalled > 0);
  assert.ok(fs.existsSync(path.join(dir, "projects")));
  assert.ok(fs.existsSync(path.join(dir, "principles")));
  assert.ok(fs.existsSync(path.join(dir, "index.md")));

  const principleFiles = fs.readdirSync(path.join(dir, "principles")).filter((f) => f.endsWith(".md"));
  assert.strictEqual(principleFiles.length, result.principlesInstalled);
});

test("initVault creates vault without principles", () => {
  const dir = tmpDir();

  const result = initVault(dir, false);

  assert.strictEqual(result.created, true);
  assert.strictEqual(result.principlesInstalled, 0);
  assert.ok(fs.existsSync(path.join(dir, "projects")));
  assert.ok(fs.existsSync(path.join(dir, "index.md")));
  assert.ok(!fs.existsSync(path.join(dir, "principles")));
});

test("initVault is idempotent — skips existing principle files", () => {
  const dir = tmpDir();

  const first = initVault(dir, true);
  const second = initVault(dir, true);

  assert.strictEqual(second.principlesInstalled, 0);
  // File count should be identical
  assert.strictEqual(listVaultFiles(dir).length, listVaultFiles(dir).length);
  // First run installed > 0
  assert.ok(first.principlesInstalled > 0);
});

test("initVault index.md contains wikilinks to installed principles", () => {
  const dir = tmpDir();
  initVault(dir, true);

  const index = readVaultIndex(dir);
  assert.ok(index);
  assert.ok(index.includes("[[principles/"));
  assert.ok(index.includes("[[principles/foundational-thinking]]"));
});

test("initVault installs principles.md sub-index", () => {
  const dir = tmpDir();
  initVault(dir, true);

  const subIndex = path.join(dir, "principles.md");
  assert.ok(fs.existsSync(subIndex));
  const content = fs.readFileSync(subIndex, "utf-8");
  assert.ok(content.includes("# Principles"));
});
