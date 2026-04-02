import { test } from "node:test";
import * as assert from "node:assert";
import { buildSearchArgs, toVaultPath } from "./qmd.ts";

test("toVaultPath converts qmd:// virtual path to filesystem path", () => {
  assert.strictEqual(
    toVaultPath("/home/user/.pi/memories", "qmd://memory/principles/foo.md"),
    "/home/user/.pi/memories/principles/foo.md",
  );
});

test("toVaultPath passes through non-qmd paths unchanged", () => {
  assert.strictEqual(
    toVaultPath("/home/user/.pi/memories", "/some/other/path.md"),
    "/some/other/path.md",
  );
});

test("toVaultPath handles root-level files", () => {
  assert.strictEqual(
    toVaultPath("/vault", "qmd://memory/index.md"),
    "/vault/index.md",
  );
});

test("buildSearchArgs uses hybrid search for natural-language queries", () => {
  assert.deepStrictEqual(buildSearchArgs("advisory lock concurrency race condition", { limit: 3 }), [
    "query",
    "advisory lock concurrency race condition",
    "--json",
    "-n",
    "3",
    "-c",
    "memory",
  ]);
});
