import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect, Exit } from "effect";
import { parseSubagentRequest } from "./request.ts";
import { MAX_PARALLEL_TASKS } from "./types.ts";

async function parse(params: Parameters<typeof parseSubagentRequest>[0]["params"]) {
	return Effect.runPromise(
		parseSubagentRequest({
			params,
			defaultCwd: "/repo",
			selectedModel: undefined,
		}),
	);
}

describe("parseSubagentRequest", () => {
	it("parses a prompt-driven single request without an agent persona", async () => {
		const request = await parse({ task: "Review code as a security specialist" });
		assert.equal(request.type, "single");
		assert.equal(request.task, "Review code as a security specialist");
		assert.equal(request.model, undefined);
		assert.equal("agent" in request, false);
	});

	it("parses async single request", async () => {
		const request = await parse({ task: "Review code", async: true });
		assert.equal(request.type, "asyncSingle");
		assert.equal("agent" in request, false);
	});

	it("parses chain request", async () => {
		const request = await parse({ chain: [{ task: "Step {previous}" }] });
		assert.equal(request.type, "chain");
		assert.equal(request.steps[0].task, "Step {previous}");
		assert.equal("agent" in request.steps[0], false);
	});

	it("rejects async chain", async () => {
		const exit = await Effect.runPromiseExit(
			parseSubagentRequest({
				params: { async: true, chain: [{ task: "Step" }] },
				defaultCwd: "/repo",
				selectedModel: undefined,
			}),
		);
		assert.equal(Exit.isFailure(exit), true);
		if (Exit.isFailure(exit)) assert.match(String(exit.cause), /async: true is not supported for chains/);
	});

	it("rejects invalid mode count", async () => {
		const exit = await Effect.runPromiseExit(
			parseSubagentRequest({
				params: { task: "A", tasks: [{ task: "B" }] },
				defaultCwd: "/repo",
				selectedModel: undefined,
			}),
		);
		assert.equal(Exit.isFailure(exit), true);
		if (Exit.isFailure(exit)) assert.match(String(exit.cause), /Provide exactly one mode/);
	});

	it("rejects too many sync parallel tasks", async () => {
		const tasks = Array.from({ length: MAX_PARALLEL_TASKS + 1 }, (_, i) => ({ task: `Task ${i}` }));
		const exit = await Effect.runPromiseExit(
			parseSubagentRequest({
				params: { tasks },
				defaultCwd: "/repo",
				selectedModel: undefined,
			}),
		);
		assert.equal(Exit.isFailure(exit), true);
		if (Exit.isFailure(exit)) assert.match(String(exit.cause), /Too many parallel tasks/);
	});

	it("preserves current async parallel behavior by not adding a new task cap", async () => {
		const tasks = Array.from({ length: MAX_PARALLEL_TASKS + 1 }, (_, i) => ({ task: `Task ${i}` }));
		const request = await parse({ async: true, tasks });
		assert.equal(request.type, "asyncParallel");
		assert.equal(request.tasks.length, MAX_PARALLEL_TASKS + 1);
	});

	it("preserves per-task working directories", async () => {
		const request = await parse({ tasks: [{ task: "Run", cwd: "/other" }] });
		assert.equal(request.type, "parallel");
		assert.equal(request.tasks[0].cwd, "/other");
	});
});
