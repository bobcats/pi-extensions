import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import type { AgentConfig } from "./agents.ts";
import { emptyUsageStats, type SingleResult, type SubagentRequest } from "./types.ts";
import { runSubagentRequest } from "./runtime.ts";

const agent: AgentConfig = {
	name: "worker",
	description: "Worker",
	source: "user",
	filePath: "/agents/worker.md",
	systemPrompt: "Prompt",
};

function result(agentName: string, task: string, output: string, exitCode = 0): SingleResult {
	return {
		agent: agentName,
		agentSource: "user",
		task,
		exitCode,
		stderr: "",
		usage: emptyUsageStats(),
		messages: [{ role: "assistant", content: [{ type: "text", text: output }], timestamp: Date.now() } as any],
	};
}

describe("runSubagentRequest", () => {
	it("runs a single request", async () => {
		const request: SubagentRequest = { type: "single", agent, task: "Task", options: { defaultCwd: "/repo" } };
		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: (input) => Effect.succeed(result(input.agent.name, input.task, "Done")),
				startAsyncSingle: () => Effect.die("not used"),
				startAsyncParallel: () => Effect.die("not used"),
			}),
		);
		assert.equal(output.mode, "single");
		assert.equal(output.results[0].agent, "worker");
	});

	it("passes previous output through chain placeholders", async () => {
		const request: SubagentRequest = {
			type: "chain",
			steps: [
				{ agent, task: "First" },
				{ agent, task: "Second {previous}" },
			],
			options: { defaultCwd: "/repo" },
		};
		const seenTasks: string[] = [];
		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: (input) => {
					seenTasks.push(input.task);
					return Effect.succeed(result(input.agent.name, input.task, `Output for ${input.task}`));
				},
				startAsyncSingle: () => Effect.die("not used"),
				startAsyncParallel: () => Effect.die("not used"),
			}),
		);
		assert.equal(output.mode, "chain");
		assert.match(seenTasks[1], /Output for First/);
	});

	it("stops a chain after the first failed result", async () => {
		const request: SubagentRequest = {
			type: "chain",
			steps: [
				{ agent, task: "Fail" },
				{ agent, task: "Never" },
			],
			options: { defaultCwd: "/repo" },
		};
		await assert.rejects(
			() =>
				Effect.runPromise(
					runSubagentRequest(request, {
						runSingle: (input) => Effect.succeed(result(input.agent.name, input.task, "No", 1)),
						startAsyncSingle: () => Effect.die("not used"),
						startAsyncParallel: () => Effect.die("not used"),
					}),
				),
			/Chain stopped at step 1/,
		);
	});

	it("runs parallel requests with stable result ordering", async () => {
		const request: SubagentRequest = {
			type: "parallel",
			tasks: [
				{ agent, task: "A" },
				{ agent, task: "B" },
				{ agent, task: "C" },
			],
			options: { defaultCwd: "/repo" },
		};
		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: (input) => Effect.succeed(result(input.agent.name, input.task, input.task)),
				startAsyncSingle: () => Effect.die("not used"),
				startAsyncParallel: () => Effect.die("not used"),
				spawnStaggerMs: 0,
			}),
		);
		assert.deepEqual(
			output.results.map((item) => item.task),
			["A", "B", "C"],
		);
	});

	it("starts async single through the async owner dependency", async () => {
		const request: SubagentRequest = {
			type: "asyncSingle",
			agent,
			task: "Async",
			options: { defaultCwd: "/repo" },
		};
		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: () => Effect.die("not used"),
				startAsyncSingle: () => Effect.succeed({ runId: "abc123" }),
				startAsyncParallel: () => Effect.die("not used"),
			}),
		);
		assert.equal(output.contentText, 'Started async subagent "worker" (run: abc123)');
	});

	it("starts async parallel through the async owner dependency", async () => {
		const request: SubagentRequest = {
			type: "asyncParallel",
			tasks: [
				{ agent, task: "A" },
				{ agent, task: "B" },
			],
			rejectedTasks: [],
			options: { defaultCwd: "/repo" },
		};
		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: () => Effect.die("not used"),
				startAsyncSingle: () => Effect.die("not used"),
				startAsyncParallel: () => Effect.succeed({ runIds: ["a", "b"], windowName: "subagents-1" }),
			}),
		);
		assert.equal(output.contentText, 'Started 2 async subagents in tmux window "subagents-1"');
	});

	it("preserves async parallel rejected task reporting while valid tasks start", async () => {
		const request: SubagentRequest = {
			type: "asyncParallel",
			tasks: [{ agent, task: "A" }],
			rejectedTasks: [{ agent: "missing", task: "B", reason: 'Unknown agent: "missing"' }],
			options: { defaultCwd: "/repo" },
		};
		const rejected: string[] = [];
		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: () => Effect.die("not used"),
				startAsyncSingle: () => Effect.die("not used"),
				startAsyncParallel: () => Effect.succeed({ runIds: ["a"], windowName: "subagents-1" }),
				reportRejectedAsyncTask: (task) => Effect.sync(() => rejected.push(task.agent)),
			}),
		);
		assert.deepEqual(rejected, ["missing"]);
		assert.equal(output.contentText, 'Started 1 async subagents in tmux window "subagents-1"');
	});
});
