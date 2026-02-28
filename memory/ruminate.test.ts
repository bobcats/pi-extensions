import test from "node:test";
import assert from "node:assert/strict";
import { extractBulletFindings, synthesizeFindings, formatSynthesisTable } from "./ruminate.ts";

test("synthesizeFindings dedupes identical findings across batches and counts frequency", () => {
  const minerOutputs = [
    `# Findings

## User Corrections
- Always run full suite before claiming success: user said tests were skipped
- Keep commits scoped to one task: user requested split commits`,
    `# Findings

## Workflow Patterns
- Keep commits scoped to one task: repeated handoff preference
- Always run full suite before claiming success: repeated correction`,
    `# Findings

## Technical Learnings
- Import shared types from beads/lib.ts: recurring correction`,
  ];

  const rows = synthesizeFindings(minerOutputs);

  assert.equal(rows[0].finding, "Always run full suite before claiming success");
  assert.equal(rows[0].frequency, 2);
  assert.equal(rows[1].finding, "Keep commits scoped to one task");
  assert.equal(rows[1].frequency, 2);
  assert.equal(rows[2].finding, "Import shared types from beads/lib.ts");
  assert.equal(rows[2].frequency, 1);
});

test("extractBulletFindings reads only bullet findings", () => {
  const output = `# Findings

## Frustrations
- First finding: evidence one
- Second finding: evidence two

Other text
not a bullet`;

  assert.deepEqual(extractBulletFindings(output), ["First finding", "Second finding"]);
});

test("formatSynthesisTable renders finding, frequency/evidence, proposed action columns", () => {
  const table = formatSynthesisTable([
    { finding: "Keep commits scoped to one task", frequency: 3, evidence: ["batch 1", "batch 2", "batch 3"] },
    { finding: "Run full suite before completion", frequency: 1, evidence: ["batch 1"] },
  ]);

  assert.match(table, /\| finding \| frequency\/evidence \| proposed action \|/i);
  assert.match(table, /Keep commits scoped to one task/);
  assert.match(table, /3 \(batch 1; batch 2; batch 3\)/);
  assert.match(table, /Review and, if approved, persist this as a memory vault update\./);
});
