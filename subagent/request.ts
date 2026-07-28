import { Effect } from "effect";
import { InvalidSubagentRequest } from "./errors.ts";
import { MAX_PARALLEL_TASKS, type SubagentRequest } from "./types.ts";

export interface RawTaskItem {
	task: string;
	cwd?: string;
}

export interface RawSubagentParams {
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
	defaultCwd: string;
	selectedModel?: string;
}

export function parseSubagentRequest(
	input: ParseSubagentRequestInput,
): Effect.Effect<SubagentRequest, InvalidSubagentRequest> {
	return Effect.gen(function* () {
		const { params, defaultCwd, selectedModel } = input;
		const hasChain = (params.chain?.length ?? 0) > 0;
		const hasTasks = (params.tasks?.length ?? 0) > 0;
		const hasSingle = params.task !== undefined;
		const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
		const options = { defaultCwd, thinking: params.thinking, selectedModel };

		if (modeCount !== 1) {
			return yield* Effect.fail(new InvalidSubagentRequest({ message: "Invalid parameters. Provide exactly one mode." }));
		}
		if (params.async && hasChain) {
			return yield* Effect.fail(new InvalidSubagentRequest({
				message: "async: true is not supported for chains (steps depend on {previous}).",
			}));
		}

		if (hasSingle && params.task !== undefined) {
			return params.async
				? { type: "asyncSingle", task: params.task, cwd: params.cwd, model: selectedModel, options }
				: { type: "single", task: params.task, cwd: params.cwd, model: selectedModel, options };
		}

		if (hasTasks) {
			const tasks = params.tasks ?? [];
			if (!params.async && tasks.length > MAX_PARALLEL_TASKS) {
				return yield* Effect.fail(new InvalidSubagentRequest({
					message: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
				}));
			}
			return params.async ? { type: "asyncParallel", tasks, options } : { type: "parallel", tasks, options };
		}

		return { type: "chain", steps: params.chain ?? [], options };
	});
}
