import test from "node:test";
import assert from "node:assert/strict";
import { computeOverheadPct } from "./overhead.ts";

test("computes overhead percentage from baseline/profiled durations", () => {
  assert.equal(computeOverheadPct({ baselineMs: 100, profiledMs: 101 }), 1);
  assert.equal(computeOverheadPct({ baselineMs: 200, profiledMs: 198 }), -1);
});
