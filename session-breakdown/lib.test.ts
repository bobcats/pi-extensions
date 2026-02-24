import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	extractTokensTotal,
	formatCount,
	modelKeyFromParts,
	mondayIndex,
	parseSessionStartFromFilename,
	toLocalDayKey,
} from "./lib.ts";

describe("parseSessionStartFromFilename", () => {
	it("parses valid timestamp filename", () => {
		const d = parseSessionStartFromFilename("2026-02-02T21-52-28-774Z_abc123.jsonl");
		assert.ok(d instanceof Date);
		assert.equal(d.getUTCFullYear(), 2026);
		assert.equal(d.getUTCMonth(), 1); // 0-indexed
		assert.equal(d.getUTCDate(), 2);
		assert.equal(d.getUTCHours(), 21);
	});

	it("returns null for invalid format", () => {
		assert.equal(parseSessionStartFromFilename("not-a-session-file.jsonl"), null);
	});

	it("returns null for empty string", () => {
		assert.equal(parseSessionStartFromFilename(""), null);
	});
});

describe("modelKeyFromParts", () => {
	it("returns provider/model when both provided", () => {
		assert.equal(modelKeyFromParts("anthropic", "claude-3"), "anthropic/claude-3");
	});

	it("returns just provider when model is missing", () => {
		assert.equal(modelKeyFromParts("anthropic", undefined), "anthropic");
	});

	it("returns just model when provider is missing", () => {
		assert.equal(modelKeyFromParts(undefined, "claude-3"), "claude-3");
	});

	it("returns null when both are missing", () => {
		assert.equal(modelKeyFromParts(undefined, undefined), null);
	});

	it("returns null when both are empty strings", () => {
		assert.equal(modelKeyFromParts("", ""), null);
	});
});

describe("extractTokensTotal", () => {
	it("returns totalTokens directly", () => {
		assert.equal(extractTokensTotal({ totalTokens: 1500 }), 1500);
	});

	it("returns sum of inputTokens + outputTokens", () => {
		assert.equal(extractTokensTotal({ inputTokens: 100, outputTokens: 50 }), 150);
	});

	it("returns tokens from nested tokens object", () => {
		assert.equal(extractTokensTotal({ tokens: { total: 200 } }), 200);
	});

	it("returns 0 for null", () => {
		assert.equal(extractTokensTotal(null), 0);
	});

	it("returns 0 for empty object", () => {
		assert.equal(extractTokensTotal({}), 0);
	});
});

describe("formatCount", () => {
	it("formats zero as '0'", () => {
		assert.equal(formatCount(0), "0");
	});

	it("formats thousands with K suffix", () => {
		assert.equal(formatCount(15000), "15.0K");
	});

	it("formats millions with M suffix", () => {
		assert.equal(formatCount(2_500_000), "2.5M");
	});

	it("formats billions with B suffix", () => {
		assert.equal(formatCount(1_500_000_000), "1.5B");
	});
});

describe("toLocalDayKey", () => {
	it("formats date as YYYY-MM-DD", () => {
		const d = new Date(2026, 1, 3); // Feb 3, 2026 local
		assert.equal(toLocalDayKey(d), "2026-02-03");
	});

	it("pads single-digit month and day", () => {
		const d = new Date(2026, 0, 9); // Jan 9, 2026 local
		assert.equal(toLocalDayKey(d), "2026-01-09");
	});
});

describe("mondayIndex", () => {
	it("Monday returns 0", () => {
		const monday = new Date(2026, 1, 23); // Feb 23, 2026 = Monday (local)
		assert.equal(mondayIndex(monday), 0);
	});

	it("Sunday returns 6", () => {
		const sunday = new Date(2026, 1, 22); // Feb 22, 2026 = Sunday (local)
		assert.equal(mondayIndex(sunday), 6);
	});

	it("Wednesday returns 2", () => {
		const wednesday = new Date(2026, 1, 25); // Feb 25, 2026 = Wednesday (local)
		assert.equal(mondayIndex(wednesday), 2);
	});
});
