import { Effect } from "effect";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { ChildProcessFailed } from "./errors.ts";
import { runSingleAgentEffect, type RunSingleAgentEffectInput } from "./process-effect.ts";
import {
	MAX_CONCURRENCY,
	SPAWN_STAGGER_MS,
	emptyUsageStats,
	type SingleResult,
	type SubagentDetails,
	type SubagentRequest,
} from "./types.ts";

export interface RuntimeDeps {
	runSingle?: (input: RunSingleAgentEffectInput) => Effect.Effect<SingleResult, unknown>;
	startAsyncSingle: (
		request: Extract<SubagentRequest, { type: "asyncSingle" }>,
	) => Effect.Effect<{ runId: string }, unknown>;
	startAsyncParallel: (
		request: Extract<SubagentRequest, { type: "asyncParallel" }>,
	) => Effect.Effect<{ runIds: string[]; windowName: string }, unknown>;
	reportRejectedAsyncTask?: (
		task: Extract<SubagentRequest, { type: "asyncParallel" }>["rejectedTasks"][number],
	) => Effect.Effect<void, unknown>;
	onUpdate?: (partial: AgentToolResult<SubagentDetails>) => void;
	makeDetails?: (mode: SubagentDetails["mode"]) => (results: SingleResult[]) => SubagentDetails;
	resolveSkillPath?: (skillName: string, cwd: string) => string | null;
	spawnStaggerMs?: number;
}

export interface RuntimeOutput {
	mode: SubagentDetails["mode"];
	results: SingleResult[];
	contentText: string;
	isError?: boolean;
	asyncStarted?: { runId?: string; runIds?: string[]; windowName?: string };
}

export function getFinalOutput(messages: SingleResult["messages"]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
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
		agent: Extract<SubagentRequest, { type: "single" | "asyncSingle" }>["agent"];
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
		agent: args.agent,
		task: args.task,
		cwd: args.cwd,
		thinking: request.options.thinking,
		model: args.model,
		step: args.step,
		onUpdate: args.onUpdate,
		makeDetails: args.makeDetails,
		resolveSkillPath: deps.resolveSkillPath ?? (() => null),
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
						agent: request.agent,
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

					const result = yield* runSingle({
						defaultCwd: request.options.defaultCwd,
						agent: step.agent,
						task: taskWithContext,
						cwd: step.cwd,
						thinking: request.options.thinking,
						model: request.options.selectedModel ?? step.agent.model,
						step: i + 1,
						onUpdate: chainUpdate,
						makeDetails: deps.makeDetails?.("chain"),
						resolveSkillPath: deps.resolveSkillPath ?? (() => null),
					});

					results.push(result);
					if (isFailedResult(result)) {
						return yield* Effect.fail(
							new ChildProcessFailed({
								message: `Chain stopped at step ${i + 1} (${step.agent.name}): ${failureText(result)}`,
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
				const allResults = request.tasks.map((task) => makePlaceholderResult(task.agent.name, task.task));
				const mode: SubagentDetails["mode"] = "parallel";

				const results = yield* Effect.forEach(
					request.tasks,
					(task, index) =>
						Effect.gen(function* () {
							if (index > 0) {
								yield* Effect.sleep(`${index * staggerMs} millis`);
							}

							const result = yield* runSingle({
								defaultCwd: request.options.defaultCwd,
								agent: task.agent,
								task: task.task,
								cwd: task.cwd,
								thinking: request.options.thinking,
								model: request.options.selectedModel ?? task.agent.model,
								onUpdate: (partial) => {
									const current = partial.details?.results[0];
									if (!current) return;
									allResults[index] = current;
									emitParallelProgress(allResults, deps, mode);
								},
								makeDetails: deps.makeDetails?.(mode),
								resolveSkillPath: deps.resolveSkillPath ?? (() => null),
							});

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
					contentText: `Started async subagent "${request.agent.name}" (run: ${started.runId})`,
					asyncStarted: { runId: started.runId },
				};
			});
		}

		case "asyncParallel": {
			return Effect.gen(function* () {
				if (deps.reportRejectedAsyncTask) {
					for (const task of request.rejectedTasks) {
						yield* deps.reportRejectedAsyncTask(task);
					}
				}

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
