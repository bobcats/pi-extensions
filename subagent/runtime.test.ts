import assert from "node:assert/strict";
import * as fs from "node:fs";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { emptyUsageStats, type AsyncBatch, type AsyncRun, type SingleResult, type SubagentRequest } from "./types.ts";
import { createAsyncRunWatcher, createAsyncRuntimeDeps, runSubagentRequest } from "./runtime.ts";
import type { TmuxOps } from "./tmux-effect.ts";

function result(task: string, output: string, exitCode = 0): SingleResult {
	return {
		agent: "subagent",
		agentSource: "prompt",
		task,
		exitCode,
		stderr: "",
		usage: emptyUsageStats(),
		messages: [{ role: "assistant", content: [{ type: "text", text: output }], timestamp: Date.now() } as any],
	};
}

function fakeTmuxOps(overrides: Partial<TmuxOps> = {}): TmuxOps {
	return {
		isAvailable: () => true,
		createPaneWithCommand: () => "%1",
		createWindow: () => "@1",
		getWindowPanes: () => ["%1"],
		runCommandInPane: () => undefined,
		createPaneInWindow: () => "%2",
		tileWindow: () => undefined,
		closePane: () => undefined,
		closeWindow: () => undefined,
		readScreen: async () => "__SUBAGENT_DONE_0__",
		makeBatchWindowName: () => "subagents-1",
		shellEscape: (value) => `'${value}'`,
		...overrides,
	};
}

function asyncDeps(tmuxOps: TmuxOps, asyncRuns = new Map<string, AsyncRun>()) {
	return createAsyncRuntimeDeps({
		asyncRuns,
		asyncBatches: new Map<string, AsyncBatch>(),
		asyncOwner: { start: () => undefined },
		latestCtx: () => null,
		pi: { sendMessage: () => undefined, events: { emit: () => undefined } } as unknown as Parameters<typeof createAsyncRuntimeDeps>[0]["pi"],
		updateWidget: () => undefined,
		startWidgetRefresh: () => undefined,
		readLastAssistantMessage: () => "(no output)",
		tmuxOps,
	});
}

describe("runSubagentRequest", () => {
	it("runs a single parent-authored prompt", async () => {
		const request: SubagentRequest = { type: "single", task: "Act as a reviewer and inspect the diff", options: { defaultCwd: "/repo" } };
		let seenTask = "";
		const output = await Effect.runPromise(runSubagentRequest(request, {
			runSingle: (input) => {
				seenTask = input.task;
				return Effect.succeed(result(input.task, "Done"));
			},
			startAsyncSingle: () => Effect.die("not used"),
			startAsyncParallel: () => Effect.die("not used"),
		}));
		assert.equal(seenTask, request.task);
		assert.equal(output.results[0].agent, "subagent");
	});

	it("passes previous output through chain placeholders", async () => {
		const seenTasks: string[] = [];
		const output = await Effect.runPromise(runSubagentRequest({
			type: "chain",
			steps: [{ task: "First" }, { task: "Critique {previous}" }],
			options: { defaultCwd: "/repo" },
		}, {
			runSingle: (input) => {
				seenTasks.push(input.task);
				return Effect.succeed(result(input.task, `Output for ${input.task}`));
			},
			startAsyncSingle: () => Effect.die("not used"),
			startAsyncParallel: () => Effect.die("not used"),
		}));
		assert.equal(output.mode, "chain");
		assert.match(seenTasks[1], /Output for First/);
	});

	it("stops a chain after the first failed result", async () => {
		await assert.rejects(() => Effect.runPromise(runSubagentRequest({
			type: "chain",
			steps: [{ task: "Fail" }, { task: "Never" }],
			options: { defaultCwd: "/repo" },
		}, {
			runSingle: (input) => Effect.succeed(result(input.task, "No", 1)),
			startAsyncSingle: () => Effect.die("not used"),
			startAsyncParallel: () => Effect.die("not used"),
		})), /Chain stopped at step 1/);
	});

	it("runs parallel prompts with stable result ordering", async () => {
		const output = await Effect.runPromise(runSubagentRequest({
			type: "parallel",
			tasks: [{ task: "A" }, { task: "B" }, { task: "C" }],
			options: { defaultCwd: "/repo" },
		}, {
			runSingle: (input) => Effect.succeed(result(input.task, input.task)),
			startAsyncSingle: () => Effect.die("not used"),
			startAsyncParallel: () => Effect.die("not used"),
			spawnStaggerMs: 0,
		}));
		assert.deepEqual(output.results.map((item) => item.task), ["A", "B", "C"]);
	});

	it("starts async single without a persona or appended system prompt", async () => {
		let command = "";
		const runs = new Map<string, AsyncRun>();
		const deps = asyncDeps(fakeTmuxOps({
			createPaneWithCommand: (_name, value) => {
				command = value;
				return "%1";
			},
		}), runs);
		const output = await Effect.runPromise(runSubagentRequest({
			type: "asyncSingle",
			task: "Act as a researcher and report findings",
			options: { defaultCwd: "/repo" },
		}, { runSingle: () => Effect.die("not used"), ...deps }));
		assert.match(output.contentText, /Started async subagent/);
		assert.equal(command.includes("--append-system-prompt"), false);
		assert.match(command, /Act as a researcher and report findings/);
		assert.equal(Array.from(runs.values())[0].agent, "subagent");
		for (const run of runs.values()) for (const file of run.tempFiles) fs.rmSync(file, { force: true });
	});

	it("starts async parallel prompts", async () => {
		const output = await Effect.runPromise(runSubagentRequest({
			type: "asyncParallel",
			tasks: [{ task: "A" }, { task: "B" }],
			options: { defaultCwd: "/repo" },
		}, {
			runSingle: () => Effect.die("not used"),
			startAsyncSingle: () => Effect.die("not used"),
			startAsyncParallel: () => Effect.succeed({ runIds: ["a", "b"], windowName: "subagents-1" }),
		}));
		assert.equal(output.contentText, 'Started 2 async subagents in tmux window "subagents-1"');
	});

	it("cleans session files when async tmux setup fails", async () => {
		let sessionPath = "";
		const deps = asyncDeps(fakeTmuxOps({
			createPaneWithCommand: (_name, command) => {
				const match = command.match(/'([^']*pi-subagent-[^']*\.jsonl)'/);
				sessionPath = match?.[1] ?? "";
				throw new Error("split failed");
			},
		}));
		await assert.rejects(() => Effect.runPromise(runSubagentRequest({
			type: "asyncSingle",
			task: "Async",
			options: { defaultCwd: "/repo" },
		}, { runSingle: () => Effect.die("not used"), ...deps })));
		assert.notEqual(sessionPath, "");
		assert.equal(fs.existsSync(sessionPath), false);
	});

	it("cleans up async runs when reading final output fails", async () => {
		const asyncRuns = new Map<string, AsyncRun>();
		const run: AsyncRun = {
			id: "run1", agent: "subagent", task: "Async task", startedAt: Date.now(), pane: "%1",
			sessionFile: "/tmp/malformed-session.jsonl", tempFiles: [],
		};
		asyncRuns.set(run.id, run);
		let closedPane = false;
		const sentMessages: string[] = [];
		const watcher = createAsyncRunWatcher({
			asyncRuns,
			asyncBatches: new Map(),
			latestCtx: () => null,
			pi: {
				sendMessage: (message: { content?: string }) => sentMessages.push(message.content ?? ""),
				events: { emit: () => undefined },
			} as unknown as Parameters<typeof createAsyncRunWatcher>[0]["pi"],
			updateWidget: () => undefined,
			readLastAssistantMessage: () => { throw new Error("malformed session line"); },
			tmuxOps: fakeTmuxOps({ closePane: () => { closedPane = true; } }),
		});
		await Effect.runPromise(watcher(run));
		assert.equal(closedPane, true);
		assert.equal(asyncRuns.size, 0);
		assert.match(sentMessages[0], /\(no output\)/);
	});
});
