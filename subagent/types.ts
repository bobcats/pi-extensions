import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig, AgentScope } from "./agents.ts";

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const SPAWN_STAGGER_MS = 2000;
export const COLLAPSED_ITEM_COUNT = 10;

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export function emptyUsageStats(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function getFinalOutput(messages: Message[]): string {
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

export interface SingleResult {
	agent: string;
	agentSource: AgentConfig["source"] | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

export interface AsyncRun {
	id: string;
	agent: string;
	task: string;
	startedAt: number;
	pane: string;
	sessionFile: string;
	tempFiles: string[];
	batchId?: string;
	windowId?: string;
}

export interface AsyncBatch {
	id: string;
	windowId: string;
	windowName: string;
	paneIds: string[];
	pendingRunIds: Set<string>;
}

export interface RunOptions {
	defaultCwd: string;
	thinking?: string;
	selectedModel?: string;
}

export interface ParallelTaskRequest {
	agent: AgentConfig;
	task: string;
	cwd?: string;
}

export interface RejectedAsyncTaskRequest {
	agent: string;
	task: string;
	cwd?: string;
	reason: string;
}

export interface ChainStepRequest {
	agent: AgentConfig;
	task: string;
	cwd?: string;
}

export type SubagentRequest =
	| {
			readonly type: "single";
			readonly agent: AgentConfig;
			readonly task: string;
			readonly cwd?: string;
			readonly model?: string;
			readonly options: RunOptions;
	  }
	| {
			readonly type: "parallel";
			readonly tasks: readonly ParallelTaskRequest[];
			readonly options: RunOptions;
	  }
	| {
			readonly type: "chain";
			readonly steps: readonly ChainStepRequest[];
			readonly options: RunOptions;
	  }
	| {
			readonly type: "asyncSingle";
			readonly agent: AgentConfig;
			readonly task: string;
			readonly cwd?: string;
			readonly model?: string;
			readonly options: RunOptions;
	  }
	| {
			readonly type: "asyncParallel";
			readonly tasks: readonly ParallelTaskRequest[];
			readonly rejectedTasks: readonly RejectedAsyncTaskRequest[];
			readonly options: RunOptions;
	  };
