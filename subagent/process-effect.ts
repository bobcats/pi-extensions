import { spawn } from "node:child_process";
import * as path from "node:path";
import { Cause, Effect } from "effect";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "./agents.ts";
import { ChildProcessAborted, ChildProcessFailed } from "./errors.ts";
import { makeTempPromptFile } from "./temp-effect.ts";
import { emptyUsageStats, getFinalOutput, type SingleResult, type SubagentDetails } from "./types.ts";

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

export interface ChildProcessLike extends NodeJS.EventEmitter {
	stdout: NodeJS.EventEmitter | null;
	stderr: NodeJS.EventEmitter | null;
	killed: boolean;
	kill(signal?: NodeJS.Signals): boolean;
}

export interface RunSingleAgentEffectInput {
	defaultCwd: string;
	agent: AgentConfig;
	task: string;
	cwd?: string;
	thinking?: string;
	model?: string;
	step?: number;
	onUpdate?: OnUpdateCallback;
	makeDetails?: (results: SingleResult[]) => SubagentDetails;
	spawnPi?: (args: string[], cwd: string) => ChildProcessLike;
	resolveSkillPath: (skillName: string, cwd: string) => string | null;
	killGraceMs?: number;
}

function emitUpdate(input: RunSingleAgentEffectInput, currentResult: SingleResult): void {
	if (!input.onUpdate || !input.makeDetails) return;

	input.onUpdate({
		content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
		details: input.makeDetails([structuredClone(currentResult)]),
	});
}

export function createInitialSingleResult(
	agent: string,
	task: string,
	agentSource: SingleResult["agentSource"],
	model: string | undefined,
	step?: number,
): SingleResult {
	return {
		agent,
		agentSource,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsageStats(),
		model,
		step,
	};
}

function asMessageUsage(message: Message): {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
	totalTokens?: number;
} | null {
	if (!("usage" in message)) return null;
	const usage = (message as Message & { usage?: unknown }).usage;
	if (!usage || typeof usage !== "object") return null;

	const record = usage as {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: { total?: number };
		totalTokens?: number;
	};
	return record;
}

function asMessageMeta(message: Message): {
	model?: string;
	stopReason?: string;
	errorMessage?: string;
} {
	const typed = message as Message & { model?: unknown; stopReason?: unknown; errorMessage?: unknown };
	return {
		model: typeof typed.model === "string" ? typed.model : undefined,
		stopReason: typeof typed.stopReason === "string" ? typed.stopReason : undefined,
		errorMessage: typeof typed.errorMessage === "string" ? typed.errorMessage : undefined,
	};
}

export function applyProcessJsonEvent(result: SingleResult, event: unknown): void {
	if (!event || typeof event !== "object") return;
	const item = event as { type?: unknown; message?: unknown };

	if (item.type === "message_end" && item.message && typeof item.message === "object") {
		const msg = item.message as Message;
		result.messages.push(msg);

		if (msg.role === "assistant") {
			result.usage.turns++;
			const usage = asMessageUsage(msg);
			if (usage) {
				result.usage.input += usage.input || 0;
				result.usage.output += usage.output || 0;
				result.usage.cacheRead += usage.cacheRead || 0;
				result.usage.cacheWrite += usage.cacheWrite || 0;
				result.usage.cost += usage.cost?.total || 0;
				result.usage.contextTokens = usage.totalTokens || 0;
			}

			const meta = asMessageMeta(msg);
			if (!result.model && meta.model) result.model = meta.model;
			if (meta.stopReason) result.stopReason = meta.stopReason;
			if (meta.errorMessage) result.errorMessage = meta.errorMessage;
		}
	}

	if (item.type === "tool_result_end" && item.message && typeof item.message === "object") {
		result.messages.push(item.message as Message);
	}
}

function killProcess(proc: ChildProcessLike, killGraceMs: number): void {
	if (proc.killed) return;
	proc.kill("SIGTERM");
	setTimeout(() => {
		if (!proc.killed) proc.kill("SIGKILL");
	}, killGraceMs).unref();
}

function buildArgs(input: RunSingleAgentEffectInput, promptPath?: string): string[] {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (input.model) args.push("--model", input.model);
	if (input.agent.tools && input.agent.tools.length > 0) {
		args.push("--tools", input.agent.tools.join(","));
	}

	const effectiveThinking = input.thinking ?? input.agent.thinking;
	if (effectiveThinking) args.push("--thinking", effectiveThinking);

	if (input.agent.skills && input.agent.skills.length > 0) {
		for (const skillName of input.agent.skills) {
			const skillPath = input.resolveSkillPath(skillName, input.defaultCwd);
			if (skillPath) args.push("--skill", skillPath);
		}
	}

	if (input.agent.spawning === false) {
		args.push("--no-extensions");
	}

	if (promptPath) {
		args.push("--append-system-prompt", promptPath);
	}

	args.push(`Task: ${input.task}`);
	return args;
}

function resolveCwd(input: RunSingleAgentEffectInput): string {
	if (input.cwd) return input.cwd;
	if (!input.agent.cwd) return input.defaultCwd;
	return path.isAbsolute(input.agent.cwd)
		? input.agent.cwd
		: path.resolve(input.defaultCwd, input.agent.cwd);
}

function defaultSpawnPi(args: string[], cwd: string): ChildProcessLike {
	return spawn("pi", args, {
		cwd,
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
	}) as unknown as ChildProcessLike;
}

function runSpawnedProcess(
	proc: ChildProcessLike,
	input: RunSingleAgentEffectInput,
	result: SingleResult,
): Effect.Effect<SingleResult, ChildProcessFailed> {
	const killGraceMs = input.killGraceMs ?? 5000;

	return Effect.async<SingleResult, ChildProcessFailed>((resume) => {
		if (!proc.stdout || !proc.stderr) {
			resume(
				Effect.fail(
					new ChildProcessFailed({
						message: "Subagent process did not expose stdout/stderr pipes.",
					}),
				),
			);
			return Effect.void;
		}

		let done = false;
		let buffer = "";
		let closed = false;

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const event = JSON.parse(line) as unknown;
				applyProcessJsonEvent(result, event);
				if (result.messages.length > 0) emitUpdate(input, result);
			} catch {
				// Ignore non-JSON lines to preserve existing behavior.
			}
		};

		const onStdout = (data: Buffer | string) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		};

		const onStderr = (data: Buffer | string) => {
			result.stderr += data.toString();
		};

		const finish = (effect: Effect.Effect<SingleResult, ChildProcessFailed>) => {
			if (done) return;
			done = true;
			cleanup();
			resume(effect);
		};

		const onClose = (code: number | null) => {
			closed = true;
			if (buffer.trim()) processLine(buffer);
			result.exitCode = code ?? 0;
			finish(Effect.succeed(result));
		};

		const onError = () => {
			finish(
				Effect.fail(
					new ChildProcessFailed({
						message: `Failed to run subagent process for ${input.agent.name}.`,
					}),
				),
			);
		};

		const cleanup = () => {
			proc.stdout?.off("data", onStdout);
			proc.stderr?.off("data", onStderr);
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		proc.stdout.on("data", onStdout);
		proc.stderr.on("data", onStderr);
		proc.on("close", onClose);
		proc.on("error", onError);

		return Effect.sync(() => {
			cleanup();
			if (!closed) killProcess(proc, killGraceMs);
		});
	});
}

export function runSingleAgentEffect(
	input: RunSingleAgentEffectInput,
): Effect.Effect<SingleResult, ChildProcessAborted | ChildProcessFailed> {
	return Effect.scoped(
		Effect.gen(function* () {
			const prompt = input.agent.systemPrompt.trim()
				? yield* makeTempPromptFile(input.agent.name, input.agent.systemPrompt)
				: undefined;
			const args = buildArgs(input, prompt?.filePath);
			const cwd = resolveCwd(input);
			const spawnPi = input.spawnPi ?? defaultSpawnPi;
			const proc = spawnPi(args, cwd);
			const result = createInitialSingleResult(
				input.agent.name,
				input.task,
				input.agent.source,
				input.model,
				input.step,
			);
			return yield* runSpawnedProcess(proc, input, result);
		}),
	).pipe(
		Effect.catchAllCause((cause) =>
			Cause.isInterruptedOnly(cause)
				? Effect.fail(new ChildProcessAborted({ message: "Subagent was aborted" }))
				: Effect.failCause(cause),
		),
	);
}
