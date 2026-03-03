import test from "node:test";
import assert from "node:assert/strict";
import { buildRuminateApplyPrompt } from "./prompts.ts";

test("buildRuminateApplyPrompt includes raw miner outputs and apply instructions", () => {
  const minerOutputs = [
    "# Findings\n\n## User Corrections\n- Always run tests: user said so",
    "# Findings\n\n## Workflow Patterns\n- Keep commits scoped: repeated preference",
  ];
  const prompt = buildRuminateApplyPrompt(minerOutputs, "/global");

  assert.match(prompt, /Always run tests/);
  assert.match(prompt, /Keep commits scoped/);
  assert.match(prompt, /Batch 1/i);
  assert.match(prompt, /Batch 2/i);
  assert.match(prompt, /\/global/);
  assert.match(prompt, /approve/i);
  assert.match(prompt, /dedup/i);
});
