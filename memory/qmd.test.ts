import { test } from "node:test";
import * as assert from "node:assert";
import { toVaultPath } from "./qmd.ts";

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
