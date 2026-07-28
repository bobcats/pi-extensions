import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ChildProcessFailed, TmuxCommandFailed } from "./errors.ts";
import { resolvePiCliPath, runSingleAgentEffect, type RunSingleAgentEffectInput } from "./process-effect.ts";
import { liveTmuxOps, pollForExitEffect, requireTmux, type TmuxOps } from "./tmux-effect.ts";
import {
	MAX_CONCURRENCY,
	SPAWN_STAGGER_MS,
	SUBAGENT_LABEL,
	emptyUsageStats,
	getFinalOutput,
	type AsyncBatch,
	type AsyncRun,
	type SingleResult,
	type SubagentDetails,
	type SubagentRequest,
} from "./types.ts";

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface RuntimeDeps {
	runSingle?: (input: RunSingleAgentEffectInput) => Effect.Effect<SingleResult, unknown>;
	startAsyncSingle: (
		request: Extract<SubagentRequest, { type: "asyncSingle" }>,
	) => Effect.Effect<{ runId: string }, unknown>;
	startAsyncParallel: (
		request: Extract<SubagentRequest, { type: "asyncParallel" }>,
	) => Effect.Effect<{ runIds: string[]; windowName: string }, unknown>;
	onUpdate?: (partial: AgentToolResult<SubagentDetails>) => void;
	makeDetails?: (mode: SubagentDetails["mode"]) => (results: SingleResult[]) => SubagentDetails;
	spawnStaggerMs?: number;
}

export interface RuntimeOutput {
	mode: SubagentDetails["mode"];
	results: SingleResult[];
	contentText: string;
	isError?: boolean;
	asyncStarted?: { runId?: string; runIds?: string[]; windowName?: string };
}

export interface AsyncWatcherDeps {
	asyncRuns: Map<string, AsyncRun>;
	asyncBatches: Map<string, AsyncBatch>;
	latestCtx: () => ExtensionContext | null;
	pi: ExtensionAPI;
	updateWidget: (ctx: ExtensionContext | null, runs: Map<string, AsyncRun>) => void;
	readLastAssistantMessage: (sessionFile: string) => string;
	tmuxOps?: TmuxOps;
}

export interface AsyncStartDeps extends AsyncWatcherDeps {
	asyncOwner: { start(run: AsyncRun): void };
	startWidgetRefresh: (ctx: ExtensionContext | null, runs: Map<string, AsyncRun>) => void;
}

function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function failureText(result: SingleResult): string {
	return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
}

function makePlaceholderResult(agent: string, task: string): SingleResult {
	return {
		agent,
		agentSource: "unknown",
		task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: emptyUsageStats(),
	};
}

function emitParallelProgress(
	allResults: SingleResult[],
	deps: RuntimeDeps,
	mode: SubagentDetails["mode"],
): void {
	if (!deps.onUpdate || !deps.makeDetails) return;
	const running = allResults.filter((r) => r.exitCode === -1).length;
	const done = allResults.filter((r) => r.exitCode !== -1).length;
	deps.onUpdate({
		content: [{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` }],
		details: deps.makeDetails(mode)([...allResults]),
	});
}

function buildRunSingleInput(
	request: SubagentRequest,
	deps: RuntimeDeps,
	args: {
		task: string;
		cwd?: string;
		model?: string;
		step?: number;
		onUpdate?: RunSingleAgentEffectInput["onUpdate"];
		makeDetails?: RunSingleAgentEffectInput["makeDetails"];
	},
): RunSingleAgentEffectInput {
	return {
		defaultCwd: request.options.defaultCwd,
		task: args.task,
		cwd: args.cwd,
		thinking: request.options.thinking,
		model: args.model,
		step: args.step,
		onUpdate: args.onUpdate,
		makeDetails: args.makeDetails,
	};
}

function tmuxTry<A>(command: string, fn: () => A): Effect.Effect<A, TmuxCommandFailed> {
	return Effect.try({
		try: fn,
		catch: (cause) => new TmuxCommandFailed({ command, cause }),
	});
}

function ignoreCleanupFailure(fn: () => void): void {
	try {
		fn();
	} catch (error) {
		void error;
	}
}

function cleanupAsyncTempFiles(tempFiles: string[]): void {
	for (const filePath of tempFiles) {
		ignoreCleanupFailure(() => fs.rmSync(filePath, { recursive: true, force: true }));
	}
}

function makeRunId(): string {
	return crypto.randomUUID().slice(0, 8);
}

function asyncPaneTitle(agentName: string, task: string): string {
	return `${agentName}: ${task.slice(0, 30)}`;
}

function trackTempFile(paths: string[], filePath: string): void {
	if (!paths.includes(filePath)) paths.push(filePath);
}

function createAsyncSessionFile(runId: string): Effect.Effect<{ sessionFile: string; tempFiles: string[] }> {
	return Effect.sync(() => {
		const sessionFile = path.join(os.tmpdir(), `pi-subagent-${runId}.jsonl`);
		fs.writeFileSync(sessionFile, "", { encoding: "utf-8", mode: 0o600 });
		return { sessionFile, tempFiles: [sessionFile] };
	});
}

function readAsyncSummary(deps: AsyncWatcherDeps, sessionFile: string): string {
	try {
		return deps.readLastAssistantMessage(sessionFile);
	} catch (error) {
		void error;
		return "(no output)";
	}
}

function finishBatchRun(asyncBatches: Map<string, AsyncBatch>, run: AsyncRun, ops: TmuxOps): void {
	if (!run.batchId) return;
	const batch = asyncBatches.get(run.batchId);
	if (!batch) return;

	batch.pendingRunIds.delete(run.id);
	if (batch.pendingRunIds.size === 0) {
		ignoreCleanupFailure(() => ops.closeWindow(batch.windowId));
		asyncBatches.delete(batch.id);
	}
}

function buildAsyncPiCommand(
	task: string,
	defaultCwd: string,
	cwd: string | undefined,
	thinking: string | undefined,
	model: string | undefined,
	sessionFile: string,
	ops: TmuxOps,
): string {
	const args: string[] = ["--session", sessionFile];
	if (model) args.push("--model", model);
	if (thinking) args.push("--thinking", thinking);
	args.push("-e", path.join(RUNTIME_DIR, "auto-exit.ts"));
	args.push(task);

	const effectiveCwd = cwd ?? defaultCwd;
	const piCmd = `${ops.shellEscape(process.execPath)} ${ops.shellEscape(resolvePiCliPath())}`;
	return `cd ${ops.shellEscape(effectiveCwd)} && ${piCmd} ${args.map(ops.shellEscape).join(" ")}; echo '__SUBAGENT_DONE_'$?'__'`;
}

export function createAsyncRunWatcher(deps: AsyncWatcherDeps): (run: AsyncRun) => Effect.Effect<void, unknown> {
	const ops = deps.tmuxOps ?? liveTmuxOps;

	return (run: AsyncRun) => {
		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			deps.asyncRuns.delete(run.id);
			deps.updateWidget(deps.latestCtx(), deps.asyncRuns);
			if (run.batchId) finishBatchRun(deps.asyncBatches, run, ops);
			else {
				ignoreCleanupFailure(() => ops.closePane(run.pane));
			}
			cleanupAsyncTempFiles(run.tempFiles);
		};

		return pollForExitEffect(run.pane, {
			ops,
			intervalMs: 1000,
			onTick: () => deps.updateWidget(deps.latestCtx(), deps.asyncRuns),
		}).pipe(
			Effect.tap((exitCode) =>
				Effect.sync(() => {
					const summary = readAsyncSummary(deps, run.sessionFile);
					cleanup();

					const status = exitCode === 0 ? "completed" : `failed (exit ${exitCode})`;
					deps.pi.sendMessage(
						{
							customType: "subagent_result",
							content: `Async subagent "${run.agent}" ${status} (run: ${run.id}).\n\n${summary}`,
							display: true,
							details: { runId: run.id, agent: run.agent, task: run.task, exitCode },
						},
						{ triggerTurn: true, deliverAs: "steer" },
					);
					deps.pi.events.emit("notify", {
						title: `Subagent done: ${run.agent}`,
						body: exitCode === 0 ? "Completed" : "Failed",
					});
				}),
			),
			Effect.catchAll(() => Effect.sync(cleanup)),
			Effect.onInterrupt(() => Effect.sync(cleanup)),
		);
	};
}

export function createAsyncRuntimeDeps(
	deps: AsyncStartDeps,
): Pick<RuntimeDeps, "startAsyncSingle" | "startAsyncParallel"> {
	const ops = deps.tmuxOps ?? liveTmuxOps;

	return {
		startAsyncSingle: (request) => {
			const tempFiles: string[] = [];
			let runId = "";
			let pane: string | undefined;
			let ownershipTransferred = false;

			return Effect.gen(function* () {
				yield* requireTmux(ops);

				runId = makeRunId();
				const session = yield* createAsyncSessionFile(runId);
				tempFiles.push(...session.tempFiles);

				const command = buildAsyncPiCommand(
					request.task,
					request.options.defaultCwd,
					request.cwd,
					request.options.thinking,
					request.model,
					session.sessionFile,
					ops,
				);
				pane = yield* tmuxTry("split-window", () =>
					ops.createPaneWithCommand(asyncPaneTitle(SUBAGENT_LABEL, request.task), command)
				);

				const run: AsyncRun = {
					id: runId,
					agent: SUBAGENT_LABEL,
					task: request.task,
					startedAt: Date.now(),
					pane,
					sessionFile: session.sessionFile,
					tempFiles,
				};
				deps.asyncRuns.set(runId, run);
				deps.startWidgetRefresh(deps.latestCtx(), deps.asyncRuns);
				deps.asyncOwner.start(run);
				ownershipTransferred = true;
				return { runId };
			}).pipe(
				Effect.catchAllCause((cause) =>
					Effect.sync(() => {
						if (!ownershipTransferred) {
							if (runId) deps.asyncRuns.delete(runId);
							if (pane) ignoreCleanupFailure(() => ops.closePane(pane));
							cleanupAsyncTempFiles(tempFiles);
						}
					}).pipe(Effect.andThen(Effect.failCause(cause))),
				),
			);
		},

		startAsyncParallel: (request) => {
			const tempFilesForSetup: string[] = [];
			const runIds: string[] = [];
			let batchId = "";
			let windowId: string | undefined;
			let ownershipTransferred = false;

			return Effect.gen(function* () {
				yield* requireTmux(ops);

				batchId = makeRunId();
				const windowName = ops.makeBatchWindowName(batchId);
				windowId = yield* tmuxTry("new-window", () => ops.createWindow(windowName));
				const initialPane = yield* tmuxTry("list-panes", () => ops.getWindowPanes(windowId)[0]);
				const paneIds: string[] = initialPane ? [initialPane] : [];

				for (let i = 0; i < request.tasks.length; i++) {
					const task = request.tasks[i];
					const runId = makeRunId();
					const session = yield* createAsyncSessionFile(runId);
					const tempFiles = [...session.tempFiles];
					for (const filePath of tempFiles) trackTempFile(tempFilesForSetup, filePath);

					const command = buildAsyncPiCommand(
						task.task,
						request.options.defaultCwd,
						task.cwd,
						request.options.thinking,
						request.options.selectedModel,
						session.sessionFile,
						ops,
					);
					for (const filePath of tempFiles) trackTempFile(tempFilesForSetup, filePath);

					const name = asyncPaneTitle(SUBAGENT_LABEL, task.task);
					let pane: string;
					if (i === 0 && initialPane) {
						yield* tmuxTry("send-keys", () => ops.runCommandInPane(initialPane, name, command));
						pane = initialPane;
					} else {
						pane = yield* tmuxTry("split-window", () => ops.createPaneInWindow(windowId, name, command));
						paneIds.push(pane);
					}

					const run: AsyncRun = {
						id: runId,
						agent: SUBAGENT_LABEL,
						task: task.task,
						startedAt: Date.now(),
						pane,
						sessionFile: session.sessionFile,
						tempFiles,
						batchId,
						windowId,
					};
					deps.asyncRuns.set(runId, run);
					runIds.push(runId);
				}

				yield* tmuxTry("select-layout", () => ops.tileWindow(windowId));
				deps.asyncBatches.set(batchId, {
					id: batchId,
					windowId,
					windowName,
					paneIds,
					pendingRunIds: new Set(runIds),
				});

				for (const runId of runIds) {
					const run = deps.asyncRuns.get(runId);
					if (run) deps.asyncOwner.start(run);
				}
				ownershipTransferred = true;
				deps.startWidgetRefresh(deps.latestCtx(), deps.asyncRuns);

				return { runIds, windowName };
			}).pipe(
				Effect.catchAllCause((cause) =>
					Effect.sync(() => {
						if (!ownershipTransferred) {
							for (const runId of runIds) deps.asyncRuns.delete(runId);
							if (batchId) deps.asyncBatches.delete(batchId);
							if (windowId) ignoreCleanupFailure(() => ops.closeWindow(windowId));
							cleanupAsyncTempFiles(tempFilesForSetup);
						}
					}).pipe(Effect.andThen(Effect.failCause(cause))),
				),
			);
		},

	};
}

export function runSubagentRequest(request: SubagentRequest, deps: RuntimeDeps): Effect.Effect<RuntimeOutput, unknown> {
	const runSingle = deps.runSingle ?? runSingleAgentEffect;
	const staggerMs = deps.spawnStaggerMs ?? SPAWN_STAGGER_MS;

	switch (request.type) {
		case "single": {
			return Effect.gen(function* () {
				const result = yield* runSingle(
					buildRunSingleInput(request, deps, {
						task: request.task,
						cwd: request.cwd,
						model: request.model,
						onUpdate: deps.onUpdate,
						makeDetails: deps.makeDetails?.("single"),
					}),
				);
				if (isFailedResult(result)) {
					return yield* Effect.fail(
						new ChildProcessFailed({
							message: `Agent ${result.stopReason || "failed"}: ${failureText(result)}`,
							exitCode: result.exitCode,
						}),
					);
				}
				return {
					mode: "single",
					results: [result],
					contentText: getFinalOutput(result.messages) || "(no output)",
				};
			});
		}

		case "chain": {
			return Effect.gen(function* () {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < request.steps.length; i++) {
					const step = request.steps[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					const chainUpdate = deps.onUpdate && deps.makeDetails
						? (partial: AgentToolResult<SubagentDetails>) => {
								const currentResult = partial.details?.results[0];
								if (!currentResult) return;
								const allResults = [...results, currentResult];
								deps.onUpdate?.({
									content: partial.content,
									details: deps.makeDetails?.("chain")(allResults),
								});
							}
						: undefined;

					const result = yield* runSingle(
						buildRunSingleInput(request, deps, {
							task: taskWithContext,
							cwd: step.cwd,
							model: request.options.selectedModel,
							step: i + 1,
							onUpdate: chainUpdate,
							makeDetails: deps.makeDetails?.("chain"),
						}),
					);

					results.push(result);
					if (isFailedResult(result)) {
						return yield* Effect.fail(
							new ChildProcessFailed({
								message: `Chain stopped at step ${i + 1}: ${failureText(result)}`,
								exitCode: result.exitCode,
							}),
						);
					}
					previousOutput = getFinalOutput(result.messages);
				}

				const last = results[results.length - 1];
				return {
					mode: "chain",
					results,
					contentText: last ? getFinalOutput(last.messages) || "(no output)" : "(no output)",
				};
			});
		}

		case "parallel": {
			return Effect.gen(function* () {
				const allResults = request.tasks.map((task) => makePlaceholderResult(SUBAGENT_LABEL, task.task));
				const mode: SubagentDetails["mode"] = "parallel";

				const results = yield* Effect.forEach(
					request.tasks,
					(task, index) =>
						Effect.gen(function* () {
							const delayMs = index * staggerMs;
							if (delayMs > 0) {
								yield* Effect.sleep(`${delayMs} millis`);
							}

							const result = yield* runSingle(
								buildRunSingleInput(request, deps, {
									task: task.task,
									cwd: task.cwd,
									model: request.options.selectedModel,
									onUpdate: (partial) => {
										const current = partial.details?.results[0];
										if (!current) return;
										allResults[index] = current;
										emitParallelProgress(allResults, deps, mode);
									},
									makeDetails: deps.makeDetails?.(mode),
								}),
							);

							allResults[index] = result;
							emitParallelProgress(allResults, deps, mode);
							return result;
						}),
					{ concurrency: MAX_CONCURRENCY },
				);

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const summaries = results.map((r) => {
					const output = getFinalOutput(r.messages);
					const status = r.exitCode === 0 ? "completed" : "failed";
					return `## [${r.agent}] ${status}\n\n${output || "(no output)"}`;
				});

				return {
					mode,
					results,
					contentText: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
				};
			});
		}

		case "asyncSingle": {
			return Effect.gen(function* () {
				const started = yield* deps.startAsyncSingle(request);
				return {
					mode: "single",
					results: [],
					contentText: `Started async subagent (run: ${started.runId})`,
					asyncStarted: { runId: started.runId },
				};
			});
		}

		case "asyncParallel": {
			return Effect.gen(function* () {
				if (request.tasks.length === 0) {
					return {
						mode: "parallel",
						results: [],
						contentText: "No async subagents started.",
						isError: true,
					};
				}

				const started = yield* deps.startAsyncParallel(request);
				return {
					mode: "parallel",
					results: [],
					contentText: `Started ${started.runIds.length} async subagents in tmux window "${started.windowName}"`,
					asyncStarted: {
						runIds: started.runIds,
						windowName: started.windowName,
					},
				};
			});
		}

		default: {
			const exhaustive: never = request;
			return exhaustive;
		}
	}
}
