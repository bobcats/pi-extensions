import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentContent } from "./parse-agent.ts";

describe("parseAgentContent", () => {
	it("parses thinking field", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\nthinking: high\n---\nPrompt",
			"user",
			"/tmp/scout.md",
		);
		assert.equal(agent?.thinking, "high");
	});

	it("parses spawning: false", () => {
		const agent = parseAgentContent(
			"---\nname: worker\ndescription: test\nspawning: false\n---\nPrompt",
			"user",
			"/tmp/worker.md",
		);
		assert.equal(agent?.spawning, false);
	});

	it("spawning defaults to undefined (truthy)", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\n---\nPrompt",
			"user",
			"/tmp/scout.md",
		);
		assert.equal(agent?.spawning, undefined);
	});

	it("parses spawning: true", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\nspawning: true\n---\nPrompt",
			"user",
			"/tmp/scout.md",
		);
		assert.equal(agent?.spawning, true);
	});

	it("parses skills as comma-separated list", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\nskills: brave-search, tmux\n---\nPrompt",
			"user",
			"/tmp/scout.md",
		);
		assert.deepEqual(agent?.skills, ["brave-search", "tmux"]);
	});

	it("parses single skill", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\nskills: brave-search\n---\nPrompt",
			"user",
			"/tmp/scout.md",
		);
		assert.deepEqual(agent?.skills, ["brave-search"]);
	});

	it("skills defaults to undefined", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\n---\nPrompt",
			"user",
			"/tmp/scout.md",
		);
		assert.equal(agent?.skills, undefined);
	});

	it("parses cwd field", () => {
		const agent = parseAgentContent(
			"---\nname: worker\ndescription: test\ncwd: ./src\n---\nPrompt",
			"user",
			"/tmp/worker.md",
		);
		assert.equal(agent?.cwd, "./src");
	});

	it("returns null for missing name", () => {
		const agent = parseAgentContent(
			"---\ndescription: test\n---\nPrompt",
			"user",
			"/tmp/bad.md",
		);
		assert.equal(agent, null);
	});

	it("returns null for missing description", () => {
		const agent = parseAgentContent(
			"---\nname: test\n---\nPrompt",
			"user",
			"/tmp/bad.md",
		);
		assert.equal(agent, null);
	});

	it("preserves existing fields (tools, model, systemPrompt)", () => {
		const agent = parseAgentContent(
			"---\nname: scout\ndescription: test\ntools: read, bash\nmodel: claude-haiku-4-5\n---\nYou are a scout.",
			"bundled",
			"/tmp/scout.md",
		);
		assert.deepEqual(agent?.tools, ["read", "bash"]);
		assert.equal(agent?.model, "claude-haiku-4-5");
		assert.equal(agent?.systemPrompt, "You are a scout.");
		assert.equal(agent?.source, "bundled");
	});
});
