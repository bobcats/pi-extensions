import { test } from "node:test";
import * as assert from "node:assert";
import { buildSearchArgs, collectionNameForBrain, toVaultPath } from "./qmd.ts";

test("collectionNameForBrain keeps main on the legacy collection name", () => {
  assert.strictEqual(collectionNameForBrain("main"), "memory");
});

test("collectionNameForBrain namespaces non-main brains", () => {
  assert.strictEqual(collectionNameForBrain("poe"), "memory-poe");
});

test("toVaultPath converts qmd:// virtual path to filesystem path", () => {
  assert.strictEqual(
    toVaultPath("/home/user/.pi/memories", "qmd://memory/principles/foo.md", "memory"),
    "/home/user/.pi/memories/principles/foo.md",
  );
});

test("toVaultPath converts brain-specific qmd paths to filesystem path", () => {
  assert.strictEqual(
    toVaultPath("/home/user/.pi/memory-brains/poe", "qmd://memory-poe/projects/foo.md", "memory-poe"),
    "/home/user/.pi/memory-brains/poe/projects/foo.md",
  );
});

test("toVaultPath passes through non-qmd paths unchanged", () => {
  assert.strictEqual(
    toVaultPath("/home/user/.pi/memories", "/some/other/path.md", "memory"),
    "/some/other/path.md",
  );
});

test("toVaultPath handles root-level files", () => {
  assert.strictEqual(
    toVaultPath("/vault", "qmd://memory/index.md", "memory"),
    "/vault/index.md",
  );
});

test("buildSearchArgs uses hybrid search for natural-language queries", () => {
  assert.deepStrictEqual(buildSearchArgs("memory", "advisory lock concurrency race condition", { limit: 3 }), [
    "query",
    "advisory lock concurrency race condition",
    "--json",
    "-n",
    "3",
    "-c",
    "memory",
  ]);
});
