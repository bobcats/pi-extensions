import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCostTotal, formatUsd } from "./lib.ts";

describe("formatUsd", () => {
	it("formats zero as $0.00", () => {
		assert.equal(formatUsd(0), "$0.00");
	});

	it("formats sub-cent value with 4 decimal places", () => {
		assert.equal(formatUsd(0.00012), "$0.0001");
	});

	it("formats sub-dollar value with 3 decimal places", () => {
		assert.equal(formatUsd(0.123), "$0.123");
	});

	it("formats dollar+ value with 2 decimal places", () => {
		assert.equal(formatUsd(1.5), "$1.50");
	});

	it("formats non-finite (NaN) as $0.00", () => {
		assert.equal(formatUsd(NaN), "$0.00");
	});

	it("formats non-finite (Infinity) as $0.00", () => {
		assert.equal(formatUsd(Infinity), "$0.00");
	});

	it("formats negative as $0.00", () => {
		assert.equal(formatUsd(-1), "$0.00");
	});
});

describe("extractCostTotal", () => {
	it("returns .total from cost object", () => {
		assert.equal(extractCostTotal({ cost: { total: 0.5 } }), 0.5);
	});

	it("returns direct number from cost field", () => {
		assert.equal(extractCostTotal({ cost: 1.23 }), 1.23);
	});

	it("coerces string cost to number", () => {
		assert.equal(extractCostTotal({ cost: "0.75" }), 0.75);
	});

	it("coerces string cost.total to number", () => {
		assert.equal(extractCostTotal({ cost: { total: "0.25" } }), 0.25);
	});

	it("returns 0 for missing cost field", () => {
		assert.equal(extractCostTotal({}), 0);
	});

	it("returns 0 for null", () => {
		assert.equal(extractCostTotal(null), 0);
	});

	it("returns 0 for undefined", () => {
		assert.equal(extractCostTotal(undefined), 0);
	});
});
