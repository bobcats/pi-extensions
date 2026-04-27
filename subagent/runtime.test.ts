import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { Effect } from "effect";
import type { AgentConfig } from "./agents.ts";
import { emptyUsageStats, type AsyncBatch, type AsyncRun, type SingleResult, type SubagentRequest } from "./types.ts";
import { createAsyncRunWatcher, createAsyncRuntimeDeps, runSubagentRequest } from "./runtime.ts";
import type { TmuxOps } from "./tmux-effect.ts";

function extractSubagentTempPaths(command: string): string[] {
	return Array.from(command.matchAll(/'([^']*pi-subagent[^']*)'/g), (match) => match[1]);
}

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

	it("starts async single with fake tmux runtime dependencies", async () => {
		const asyncRuns = new Map<string, AsyncRun>();
		const asyncBatches = new Map<string, AsyncBatch>();
		let startedRun: AsyncRun | null = null;
		const tmuxOps: TmuxOps = {
			isAvailable: () => true,
			createPaneWithCommand: () => "%1",
			createWindow: () => "@1",
			getWindowPanes: () => [],
			runCommandInPane: () => undefined,
			createPaneInWindow: () => "%2",
			tileWindow: () => undefined,
			closePane: () => undefined,
			closeWindow: () => undefined,
			readScreen: async () => "__SUBAGENT_DONE_0__",
			makeBatchWindowName: () => "subagents-1",
			shellEscape: (value) => value,
		};
		const asyncDeps = createAsyncRuntimeDeps({
			asyncRuns,
			asyncBatches,
			asyncOwner: {
				start(run) {
					startedRun = run;
				},
			},
			latestCtx: () => null,
			pi: { sendMessage: () => undefined, events: { emit: () => undefined } } as Parameters<typeof createAsyncRuntimeDeps>[0]["pi"],
			updateWidget: () => undefined,
			startWidgetRefresh: () => undefined,
			readLastAssistantMessage: () => "(no output)",
			resolveSkillPath: () => null,
			tmuxOps,
		});
		const request: SubagentRequest = {
			type: "asyncSingle",
			agent,
			task: "Async",
			options: { defaultCwd: "/repo" },
		};

		const output = await Effect.runPromise(
			runSubagentRequest(request, {
				runSingle: () => Effect.die("not used"),
				...asyncDeps,
			}),
		);

		assert.match(output.contentText, /Started async subagent/);
		assert.equal(startedRun?.agent, "worker");
	});

	it("cleans async single temp files when tmux setup fails", async () => {
		const asyncRuns = new Map<string, AsyncRun>();
		const asyncBatches = new Map<string, AsyncBatch>();
		let tempPaths: string[] = [];
		const tmuxOps: TmuxOps = {
			isAvailable: () => true,
			createPaneWithCommand: (_name, command) => {
				tempPaths = extractSubagentTempPaths(command);
				throw new Error("split failed");
			},
			createWindow: () => "@1",
			getWindowPanes: () => [],
			runCommandInPane: () => undefined,
			createPaneInWindow: () => "%2",
			tileWindow: () => undefined,
			closePane: () => undefined,
			closeWindow: () => undefined,
			readScreen: async () => "__SUBAGENT_DONE_0__",
			makeBatchWindowName: () => "subagents-1",
			shellEscape: (value) => `'${value}'`,
		};
		const asyncDeps = createAsyncRuntimeDeps({
			asyncRuns,
			asyncBatches,
			asyncOwner: { start: () => undefined },
			latestCtx: () => null,
			pi: { sendMessage: () => undefined, events: { emit: () => undefined } } as Parameters<typeof createAsyncRuntimeDeps>[0]["pi"],
			updateWidget: () => undefined,
			startWidgetRefresh: () => undefined,
			readLastAssistantMessage: () => "(no output)",
			resolveSkillPath: () => null,
			tmuxOps,
		});

		await assert.rejects(() => Effect.runPromise(
			runSubagentRequest(
				{ type: "asyncSingle", agent, task: "Async", options: { defaultCwd: "/repo" } },
				{ runSingle: () => Effect.die("not used"), ...asyncDeps },
			),
		));

		assert.ok(tempPaths.length >= 2);
		for (const tempPath of tempPaths) {
			assert.equal(fs.existsSync(tempPath), false, tempPath);
			if (path.basename(tempPath).startsWith("prompt-")) {
				assert.equal(fs.existsSync(path.dirname(tempPath)), false, path.dirname(tempPath));
			}
		}
		assert.equal(asyncRuns.size, 0);
	});

	it("cleans async parallel temp files and window when tmux setup fails", async () => {
		const asyncRuns = new Map<string, AsyncRun>();
		const asyncBatches = new Map<string, AsyncBatch>();
		const tempPaths: string[] = [];
		let closedWindow = false;
		const tmuxOps: TmuxOps = {
			isAvailable: () => true,
			createPaneWithCommand: () => "%1",
			createWindow: () => "@1",
			getWindowPanes: () => ["%1"],
			runCommandInPane: (_pane, _name, command) => {
				tempPaths.push(...extractSubagentTempPaths(command));
			},
			createPaneInWindow: (_windowId, _name, command) => {
				tempPaths.push(...extractSubagentTempPaths(command));
				throw new Error("split failed");
			},
			tileWindow: () => undefined,
			closePane: () => undefined,
			closeWindow: () => {
				closedWindow = true;
			},
			readScreen: async () => "__SUBAGENT_DONE_0__",
			makeBatchWindowName: () => "subagents-1",
			shellEscape: (value) => `'${value}'`,
		};
		const asyncDeps = createAsyncRuntimeDeps({
			asyncRuns,
			asyncBatches,
			asyncOwner: { start: () => undefined },
			latestCtx: () => null,
			pi: { sendMessage: () => undefined, events: { emit: () => undefined } } as Parameters<typeof createAsyncRuntimeDeps>[0]["pi"],
			updateWidget: () => undefined,
			startWidgetRefresh: () => undefined,
			readLastAssistantMessage: () => "(no output)",
			resolveSkillPath: () => null,
			tmuxOps,
		});

		await assert.rejects(() => Effect.runPromise(
			runSubagentRequest(
				{
					type: "asyncParallel",
					tasks: [
						{ agent, task: "A" },
						{ agent, task: "B" },
					],
					rejectedTasks: [],
					options: { defaultCwd: "/repo" },
				},
				{ runSingle: () => Effect.die("not used"), ...asyncDeps },
			),
		));

		assert.equal(closedWindow, true);
		assert.equal(asyncRuns.size, 0);
		assert.ok(tempPaths.length >= 4);
		for (const tempPath of tempPaths) {
			assert.equal(fs.existsSync(tempPath), false, tempPath);
		}
	});

	it("cleans async parallel prompt temp files when command construction fails", async () => {
		const asyncRuns = new Map<string, AsyncRun>();
		const asyncBatches = new Map<string, AsyncBatch>();
		let promptPath = "";
		let closedWindow = false;
		const tmuxOps: TmuxOps = {
			isAvailable: () => true,
			createPaneWithCommand: () => "%1",
			createWindow: () => "@1",
			getWindowPanes: () => ["%1"],
			runCommandInPane: () => undefined,
			createPaneInWindow: () => "%2",
			tileWindow: () => undefined,
			closePane: () => undefined,
			closeWindow: () => {
				closedWindow = true;
			},
			readScreen: async () => "__SUBAGENT_DONE_0__",
			makeBatchWindowName: () => "subagents-1",
			shellEscape: (value) => {
				if (value.includes("prompt-worker")) {
					promptPath = value;
					throw new Error("escape failed");
				}
				return `'${value}'`;
			},
		};
		const asyncDeps = createAsyncRuntimeDeps({
			asyncRuns,
			asyncBatches,
			asyncOwner: { start: () => undefined },
			latestCtx: () => null,
			pi: { sendMessage: () => undefined, events: { emit: () => undefined } } as Parameters<typeof createAsyncRuntimeDeps>[0]["pi"],
			updateWidget: () => undefined,
			startWidgetRefresh: () => undefined,
			readLastAssistantMessage: () => "(no output)",
			resolveSkillPath: () => null,
			tmuxOps,
		});

		await assert.rejects(() => Effect.runPromise(
			runSubagentRequest(
				{
					type: "asyncParallel",
					tasks: [{ agent, task: "A" }],
					rejectedTasks: [],
					options: { defaultCwd: "/repo" },
				},
				{ runSingle: () => Effect.die("not used"), ...asyncDeps },
			),
		));

		assert.equal(closedWindow, true);
		assert.notEqual(promptPath, "");
		assert.equal(fs.existsSync(promptPath), false, promptPath);
		assert.equal(fs.existsSync(path.dirname(promptPath)), false, path.dirname(promptPath));
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

	it("cleans up async runs when reading final output fails", async () => {
		const asyncRuns = new Map<string, AsyncRun>();
		const asyncBatches = new Map<string, AsyncBatch>();
		const sentMessages: string[] = [];
		let closedPane = false;
		const run: AsyncRun = {
			id: "run1",
			agent: "worker",
			task: "Async task",
			startedAt: Date.now(),
			pane: "%1",
			sessionFile: "/tmp/malformed-session.jsonl",
			tempFiles: [],
		};
		asyncRuns.set(run.id, run);
		const tmuxOps: TmuxOps = {
			isAvailable: () => true,
			createPaneWithCommand: () => "%1",
			createWindow: () => "@1",
			getWindowPanes: () => [],
			runCommandInPane: () => undefined,
			createPaneInWindow: () => "%2",
			tileWindow: () => undefined,
			closePane: () => {
				closedPane = true;
			},
			closeWindow: () => undefined,
			readScreen: async () => "__SUBAGENT_DONE_0__",
			makeBatchWindowName: () => "subagents-1",
			shellEscape: (value) => value,
		};

		const watcher = createAsyncRunWatcher({
			asyncRuns,
			asyncBatches,
			latestCtx: () => null,
			pi: {
				sendMessage: (message: { content?: string }) => {
					sentMessages.push(message.content ?? "");
				},
				events: { emit: () => undefined },
			} as Parameters<typeof createAsyncRunWatcher>[0]["pi"],
			updateWidget: () => undefined,
			readLastAssistantMessage: () => {
				throw new Error("malformed session line");
			},
			tmuxOps,
		});

		await Effect.runPromise(watcher(run));

		assert.equal(closedPane, true);
		assert.equal(asyncRuns.size, 0);
		assert.match(sentMessages[0], /\(no output\)/);
	});
});
