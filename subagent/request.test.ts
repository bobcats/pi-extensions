import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Exit } from "effect";
import type { AgentConfig } from "./agents.ts";
import { parseSubagentRequest, projectAgentsForConfirmation } from "./request.ts";
import { MAX_PARALLEL_TASKS } from "./types.ts";

const userAgent: AgentConfig = {
	name: "worker",
	description: "Worker",
	source: "user",
	filePath: "/agents/worker.md",
	systemPrompt: "You work.",
	model: "anthropic/claude-sonnet-4-6",
};

const projectAgent: AgentConfig = {
	...userAgent,
	name: "project-worker",
	source: "project",
	filePath: "/repo/.pi/agents/project-worker.md",
};

const agents = [userAgent, projectAgent];

async function parse(params: Parameters<typeof parseSubagentRequest>[0]["params"]) {
	return Effect.runPromise(
		parseSubagentRequest({
			params,
			agents,
			defaultCwd: "/repo",
			agentScope: "user",
			projectAgentsDir: null,
			selectedModel: undefined,
		}),
	);
}

describe("parseSubagentRequest", () => {
	it("parses single sync request", async () => {
		const request = await parse({ agent: "worker", task: "Review code" });
		assert.equal(request.type, "single");
		assert.equal(request.agent.name, "worker");
		assert.equal(request.task, "Review code");
		assert.equal(request.model, "anthropic/claude-sonnet-4-6");
	});

	it("parses async single request", async () => {
		const request = await parse({ agent: "worker", task: "Review code", async: true });
		assert.equal(request.type, "asyncSingle");
		assert.equal(request.agent.name, "worker");
	});

	it("parses chain request", async () => {
		const request = await parse({ chain: [{ agent: "worker", task: "Step {previous}" }] });
		assert.equal(request.type, "chain");
		assert.equal(request.steps[0].task, "Step {previous}");
	});

	it("rejects async chain", async () => {
		const exit = await Effect.runPromiseExit(
			parseSubagentRequest({
				params: { async: true, chain: [{ agent: "worker", task: "Step" }] },
				agents,
				defaultCwd: "/repo",
				agentScope: "user",
				projectAgentsDir: null,
				selectedModel: undefined,
			}),
		);
		assert.equal(Exit.isFailure(exit), true);
		if (Exit.isFailure(exit)) {
			assert.match(String(exit.cause), /async: true is not supported for chains/);
		}
	});

	it("rejects invalid mode count", async () => {
		const exit = await Effect.runPromiseExit(
			parseSubagentRequest({
				params: { agent: "worker", task: "A", tasks: [{ agent: "worker", task: "B" }] },
				agents,
				defaultCwd: "/repo",
				agentScope: "user",
				projectAgentsDir: null,
				selectedModel: undefined,
			}),
		);
		assert.equal(Exit.isFailure(exit), true);
		if (Exit.isFailure(exit)) assert.match(String(exit.cause), /Provide exactly one mode/);
	});

	it("rejects too many sync parallel tasks", async () => {
		const tasks = Array.from({ length: MAX_PARALLEL_TASKS + 1 }, (_, i) => ({ agent: "worker", task: `Task ${i}` }));
		const exit = await Effect.runPromiseExit(
			parseSubagentRequest({
				params: { tasks },
				agents,
				defaultCwd: "/repo",
				agentScope: "user",
				projectAgentsDir: null,
				selectedModel: undefined,
			}),
		);
		assert.equal(Exit.isFailure(exit), true);
		if (Exit.isFailure(exit)) assert.match(String(exit.cause), /Too many parallel tasks/);
	});

	it("preserves current async parallel behavior by not adding a new task cap", async () => {
		const tasks = Array.from({ length: MAX_PARALLEL_TASKS + 1 }, (_, i) => ({ agent: "worker", task: `Task ${i}` }));
		const request = await parse({ async: true, tasks });
		assert.equal(request.type, "asyncParallel");
		assert.equal(request.tasks.length, MAX_PARALLEL_TASKS + 1);
	});

	it("preserves mixed async parallel behavior for valid and unknown agents", async () => {
		const request = await parse({
			async: true,
			tasks: [
				{ agent: "worker", task: "Run valid" },
				{ agent: "missing", task: "Report invalid" },
			],
		});
		assert.equal(request.type, "asyncParallel");
		assert.deepEqual(
			request.tasks.map((task) => task.agent.name),
			["worker"],
		);
		assert.deepEqual(
			request.rejectedTasks.map((task) => task.agent),
			["missing"],
		);
	});

	it("tracks project agents that need confirmation", async () => {
		const request = await Effect.runPromise(
			parseSubagentRequest({
				params: {
					tasks: [
						{ agent: "worker", task: "A" },
						{ agent: "project-worker", task: "B" },
					],
				},
				agents,
				defaultCwd: "/repo",
				agentScope: "both",
				projectAgentsDir: "/repo/.pi/agents",
				selectedModel: undefined,
			}),
		);
		assert.deepEqual(
			projectAgentsForConfirmation(request).map((agent) => agent.name),
			["project-worker"],
		);
	});
});
