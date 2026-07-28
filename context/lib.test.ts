import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { commandsFromSource, estimateTokens, normalizeReadPath, shortenPath, sumSessionUsage } from "./lib.ts";

describe("commandsFromSource", () => {
	it("filters by SlashCommandInfo.source, not sourceInfo provenance", () => {
		const commands = [
			{
				name: "ctx",
				source: "extension",
				// Provenance source is package/local/etc — not the command kind.
				sourceInfo: { source: "local", path: "/ext/context.ts" },
			},
			{
				name: "skill:verify",
				source: "skill",
				sourceInfo: { source: "local", path: "/skills/verify/SKILL.md" },
			},
			{
				name: "zoom-out",
				source: "prompt",
				sourceInfo: { source: "@bobcats/pi-extensions", path: "/prompts/zoom-out.md" },
			},
		];

		assert.deepEqual(commandsFromSource(commands, "skill"), [commands[1]]);
		assert.deepEqual(commandsFromSource(commands, "extension"), [commands[0]]);
		assert.deepEqual(commandsFromSource(commands, "prompt"), [commands[2]]);
	});
});

describe("estimateTokens", () => {
	it("returns 0 for empty string", () => {
		assert.equal(estimateTokens(""), 0);
	});

	it("returns ceil(chars/4) for short text", () => {
		assert.equal(estimateTokens("abcd"), 1);
		assert.equal(estimateTokens("hello"), 2); // ceil(5/4) = 2
	});

	it("returns ceil(chars/4) for longer text", () => {
		const text = "a".repeat(100);
		assert.equal(estimateTokens(text), 25);
	});
});

describe("normalizeReadPath", () => {
	it("resolves relative path against cwd", () => {
		const result = normalizeReadPath("src/foo.ts", "/home/user/project");
		assert.equal(result, "/home/user/project/src/foo.ts");
	});

	it("returns absolute path unchanged", () => {
		const result = normalizeReadPath("/usr/local/bin/tool", "/anywhere");
		assert.equal(result, "/usr/local/bin/tool");
	});

	it("expands ~ to homedir", () => {
		const result = normalizeReadPath("~/notes.txt", "/anywhere");
		assert.equal(result, path.join(os.homedir(), "notes.txt"));
	});

	it("strips @ prefix", () => {
		const result = normalizeReadPath("@src/foo.ts", "/home/user/project");
		assert.equal(result, "/home/user/project/src/foo.ts");
	});
});

describe("sumSessionUsage", () => {
	it("sums tokens and cost from multiple assistant entries", () => {
		const ctx = {
			sessionManager: {
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "assistant",
							usage: { inputTokens: 100, outputTokens: 50, cacheRead: 10, cacheWrite: 5, cost: 0.01 },
						},
					},
					{
						type: "message",
						message: {
							role: "assistant",
							usage: { inputTokens: 200, outputTokens: 100, cacheRead: 0, cacheWrite: 0, cost: 0.02 },
						},
					},
				],
			},
		};
		const result = sumSessionUsage(ctx);
		assert.equal(result.input, 300);
		assert.equal(result.output, 150);
		assert.equal(result.cacheRead, 10);
		assert.equal(result.cacheWrite, 5);
		assert.equal(result.totalTokens, 465);
		assert.ok(Math.abs(result.totalCost - 0.03) < 0.0001);
	});

	it("returns zeros for empty entries", () => {
		const ctx = { sessionManager: { getEntries: () => [] } };
		const result = sumSessionUsage(ctx);
		assert.deepEqual(result, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 });
	});

	it("skips entries with missing usage fields", () => {
		const ctx = {
			sessionManager: {
				getEntries: () => [
					{ type: "message", message: { role: "assistant" } },
					{ type: "message", message: { role: "user", usage: { inputTokens: 999 } } },
				],
			},
		};
		const result = sumSessionUsage(ctx);
		assert.deepEqual(result, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0 });
	});
});

describe("shortenPath", () => {
	it("returns relative path when inside cwd", () => {
		const result = shortenPath("/home/user/project/src/foo.ts", "/home/user/project");
		assert.equal(result, "./src/foo.ts");
	});

	it("returns absolute path when outside cwd", () => {
		const result = shortenPath("/other/path/foo.ts", "/home/user/project");
		assert.equal(result, "/other/path/foo.ts");
	});
});
