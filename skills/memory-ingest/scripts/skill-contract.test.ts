import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

test("skill contract requires compile before ingest success logging", () => {
  const skillPath = path.resolve("skills/memory-ingest/SKILL.md");

  // Act
  const skill = fs.readFileSync(skillPath, "utf8");

  // Assert
  assert.match(skill, /read the newly written raw artifact/i);
  assert.match(skill, /update\/create curated notes under `~\/\.pi\/memories\//i);
  assert.match(skill, /backlinks|source references/i);
  assert.match(skill, /only then call `log_operation`/i);
});
