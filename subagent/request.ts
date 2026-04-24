import { Effect } from "effect";
import type { AgentConfig, AgentScope } from "./agents.ts";
import { InvalidSubagentRequest } from "./errors.ts";
import { MAX_PARALLEL_TASKS, type SubagentRequest } from "./types.ts";

export interface RawTaskItem {
	agent: string;
	task: string;
	cwd?: string;
}

export interface RawSubagentParams {
	agent?: string;
	task?: string;
	tasks?: RawTaskItem[];
	chain?: RawTaskItem[];
	cwd?: string;
	thinking?: string;
	model?: string;
	async?: boolean;
}

export interface ParseSubagentRequestInput {
	params: RawSubagentParams;
	agents: AgentConfig[];
	defaultCwd: string;
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	selectedModel?: string;
}

function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
	return agents.find((agent) => agent.name === name);
}

function requireAgent(
	agents: AgentConfig[],
	item: RawTaskItem,
): Effect.Effect<AgentConfig, InvalidSubagentRequest> {
	const agent = findAgent(agents, item.agent);
	if (!agent) {
		return Effect.fail(new InvalidSubagentRequest({ message: `Unknown agent: "${item.agent}"` }));
	}
	return Effect.succeed(agent);
}

export function parseSubagentRequest(
	input: ParseSubagentRequestInput,
): Effect.Effect<SubagentRequest, InvalidSubagentRequest> {
	return Effect.gen(function* () {
		const { params, agents, defaultCwd, selectedModel } = input;
		const hasChain = (params.chain?.length ?? 0) > 0;
		const hasTasks = (params.tasks?.length ?? 0) > 0;
		const hasSingle = params.agent !== undefined && params.task !== undefined;
		const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
		const options = { defaultCwd, thinking: params.thinking, selectedModel };

		if (modeCount !== 1) {
			return yield* Effect.fail(
				new InvalidSubagentRequest({ message: "Invalid parameters. Provide exactly one mode." }),
			);
		}

		if (params.async && hasChain) {
			return yield* Effect.fail(
				new InvalidSubagentRequest({
					message: "async: true is not supported for chains (steps depend on {previous}).",
				}),
			);
		}

		if (hasSingle && params.agent !== undefined && params.task !== undefined) {
			const agent = yield* requireAgent(agents, {
				agent: params.agent,
				task: params.task,
			});
			const model = selectedModel ?? agent.model;
			if (params.async) {
				return {
					type: "asyncSingle",
					agent,
					task: params.task,
					cwd: params.cwd,
					model,
					options,
				};
			}
			return {
				type: "single",
				agent,
				task: params.task,
				cwd: params.cwd,
				model,
				options,
			};
		}

		if (hasTasks) {
			const rawTasks = params.tasks ?? [];
			if (!params.async && rawTasks.length > MAX_PARALLEL_TASKS) {
				return yield* Effect.fail(
					new InvalidSubagentRequest({
						message: `Too many parallel tasks (${rawTasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
					}),
				);
			}

			if (params.async) {
				const tasks: Array<{ agent: AgentConfig; task: string; cwd?: string }> = [];
				const rejectedTasks: Array<{ agent: string; task: string; cwd?: string; reason: string }> = [];
				for (const task of rawTasks) {
					const agent = findAgent(agents, task.agent);
					if (agent) {
						tasks.push({ agent, task: task.task, cwd: task.cwd });
					} else {
						rejectedTasks.push({
							agent: task.agent,
							task: task.task,
							cwd: task.cwd,
							reason: `Unknown agent: "${task.agent}"`,
						});
					}
				}
				return { type: "asyncParallel", tasks, rejectedTasks, options };
			}

			const tasks = yield* Effect.forEach(rawTasks, (task) =>
				Effect.gen(function* () {
					return {
						agent: yield* requireAgent(agents, task),
						task: task.task,
						cwd: task.cwd,
					};
				}),
			);
			return { type: "parallel", tasks, options };
		}

		const rawSteps = params.chain ?? [];
		const steps = yield* Effect.forEach(rawSteps, (step) =>
			Effect.gen(function* () {
				return {
					agent: yield* requireAgent(agents, step),
					task: step.task,
					cwd: step.cwd,
				};
			}),
		);
		return { type: "chain", steps, options };
	});
}

export function projectAgentsForConfirmation(request: SubagentRequest): AgentConfig[] {
	const agents = new Map<string, AgentConfig>();

	switch (request.type) {
		case "single":
		case "asyncSingle":
			if (request.agent.source === "project") {
				agents.set(request.agent.name, request.agent);
			}
			break;
		case "parallel":
		case "asyncParallel":
			for (const task of request.tasks) {
				if (task.agent.source === "project") {
					agents.set(task.agent.name, task.agent);
				}
			}
			break;
		case "chain":
			for (const step of request.steps) {
				if (step.agent.source === "project") {
					agents.set(step.agent.name, step.agent);
				}
			}
			break;
		default: {
			const exhaustive: never = request;
			return exhaustive;
		}
	}

	return Array.from(agents.values());
}
