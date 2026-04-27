import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import * as fs from "node:fs";
import { Effect } from "effect";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "./agents.ts";
import { applyProcessJsonEvent, createInitialSingleResult } from "./process-effect.ts";
import { parseSubagentRequest } from "./request.ts";
import { createAsyncRuntimeDeps, runSubagentRequest, type AsyncStartDeps, type RuntimeDeps } from "./runtime.ts";
import type { TmuxOps } from "./tmux-effect.ts";
import { emptyUsageStats, type AsyncBatch, type AsyncRun, type SingleResult, type SubagentRequest } from "./types.ts";

export type BenchmarkCleanup = () => void | Promise<void>;
export type BenchmarkRunResult = void | BenchmarkCleanup;

export interface BenchmarkCase {
	name: string;
	group: string;
	run: () => BenchmarkRunResult | Promise<BenchmarkRunResult>;
}

export interface BenchmarkOptions {
	iterations: number;
	warmup: number;
}

export interface BenchmarkSummary {
	count: number;
	minUs: number;
	maxUs: number;
	medianUs: number;
	p95Us: number;
	meanUs: number;
}

export interface BenchmarkResult {
	name: string;
	group: string;
	samplesUs: number[];
	summary: BenchmarkSummary;
}

const DEFAULT_OPTIONS: BenchmarkOptions = { iterations: 50, warmup: 5 };

const workerAgent: AgentConfig = {
	name: "worker",
	description: "Worker",
	source: "user",
	filePath: "/agents/worker.md",
	systemPrompt: "You work.",
	model: "anthropic/claude-sonnet-4-6",
};

const reviewerAgent: AgentConfig = {
	...workerAgent,
	name: "reviewer",
	description: "Reviewer",
	filePath: "/agents/reviewer.md",
};

const agents = [workerAgent, reviewerAgent];

function assistantMessage(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: 0,
	} as Message;
}

function successfulResult(agentName: string, task: string): SingleResult {
	return {
		agent: agentName,
		agentSource: "user",
		task,
		exitCode: 0,
		messages: [assistantMessage(`Done ${task}`)],
		stderr: "",
		usage: emptyUsageStats(),
	};
}

function runtimeDeps(): RuntimeDeps {
	return {
		runSingle: (input) => Effect.succeed(successfulResult(input.agent.name, input.task)),
		startAsyncSingle: () => Effect.succeed({ runId: "run1" }),
		startAsyncParallel: () => Effect.succeed({ runIds: ["run1", "run2"], windowName: "subagents-1" }),
		spawnStaggerMs: 0,
	};
}

function parseRequest(params: Parameters<typeof parseSubagentRequest>[0]["params"]): Promise<SubagentRequest> {
	return Effect.runPromise(
		parseSubagentRequest({
			params,
			agents,
			defaultCwd: "/repo",
			agentScope: "user",
			projectAgentsDir: null,
			selectedModel: undefined,
		}),
	);
}

function fakeTmuxOps(): TmuxOps {
	let nextPane = 2;
	return {
		isAvailable: () => true,
		createPaneWithCommand: () => "%1",
		createWindow: () => "@1",
		getWindowPanes: () => ["%1"],
		runCommandInPane: () => undefined,
		createPaneInWindow: () => `%${nextPane++}`,
		tileWindow: () => undefined,
		closePane: () => undefined,
		closeWindow: () => undefined,
		readScreen: async () => "__SUBAGENT_DONE_0__",
		makeBatchWindowName: (batchId) => `subagents-1-${batchId}`,
		shellEscape: (value) => `'${value.replace(/'/g, "'\\''")}'`,
	};
}

function cleanupFiles(paths: readonly string[]): void {
	for (const filePath of paths) {
		fs.rmSync(filePath, { recursive: true, force: true });
	}
}

function makeAsyncRuntimeDeps(cleanupPaths: string[]): Pick<RuntimeDeps, "startAsyncSingle" | "startAsyncParallel" | "reportRejectedAsyncTask"> {
	const asyncRuns = new Map<string, AsyncRun>();
	const asyncBatches = new Map<string, AsyncBatch>();
	const asyncOwner = {
		start(run: AsyncRun) {
			cleanupPaths.push(...run.tempFiles);
			asyncRuns.delete(run.id);
		},
	};
	return createAsyncRuntimeDeps({
		asyncRuns,
		asyncBatches,
		asyncOwner,
		latestCtx: () => null,
		pi: { sendMessage: () => undefined, events: { emit: () => undefined } } as AsyncStartDeps["pi"],
		updateWidget: () => undefined,
		startWidgetRefresh: () => undefined,
		readLastAssistantMessage: () => "(no output)",
		resolveSkillPath: () => null,
		tmuxOps: fakeTmuxOps(),
	});
}

export function createBenchmarkCases(): BenchmarkCase[] {
	const parallelTasks = Array.from({ length: 8 }, (_, index) => ({ agent: "worker", task: `Task ${index}` }));
	const parallelRuntimeTasks = Array.from({ length: 8 }, (_, index) => ({ agent: workerAgent, task: `Task ${index}` }));
	const chainSteps = [
		{ agent: "worker", task: "First" },
		{ agent: "reviewer", task: "Review {previous}" },
		{ agent: "worker", task: "Summarize {previous}" },
	];
	const processEventLines = Array.from({ length: 10 }, (_, index) => JSON.stringify({
		type: "message_end",
		message: assistantMessage(`Message ${index}`),
	}));

	return [
		{
			name: "parse-single",
			group: "request",
			run: () => parseRequest({ agent: "worker", task: "Review code" }),
		},
		{
			name: "parse-parallel",
			group: "request",
			run: () => parseRequest({ tasks: parallelTasks }),
		},
		{
			name: "parse-chain",
			group: "request",
			run: () => parseRequest({ chain: chainSteps }),
		},
		{
			name: "runtime-single",
			group: "runtime",
			run: () => Effect.runPromise(
				runSubagentRequest(
					{ type: "single", agent: workerAgent, task: "Task", options: { defaultCwd: "/repo" } },
					runtimeDeps(),
				),
			),
		},
		{
			name: "runtime-parallel",
			group: "runtime",
			run: () => Effect.runPromise(
				runSubagentRequest(
					{ type: "parallel", tasks: parallelRuntimeTasks, options: { defaultCwd: "/repo" } },
					runtimeDeps(),
				),
			),
		},
		{
			name: "runtime-chain",
			group: "runtime",
			run: () => Effect.runPromise(
				runSubagentRequest(
					{
						type: "chain",
						steps: [
							{ agent: workerAgent, task: "First" },
							{ agent: reviewerAgent, task: "Review {previous}" },
							{ agent: workerAgent, task: "Summarize {previous}" },
						],
						options: { defaultCwd: "/repo" },
					},
					runtimeDeps(),
				),
			),
		},
		{
			name: "async-single-setup",
			group: "async",
			run: async () => {
				const cleanupPaths: string[] = [];
				await Effect.runPromise(
					runSubagentRequest(
						{ type: "asyncSingle", agent: workerAgent, task: "Async", options: { defaultCwd: "/repo" } },
						{ ...runtimeDeps(), ...makeAsyncRuntimeDeps(cleanupPaths) },
					),
				);
				return () => cleanupFiles(cleanupPaths);
			},
		},
		{
			name: "async-parallel-setup",
			group: "async",
			run: async () => {
				const cleanupPaths: string[] = [];
				await Effect.runPromise(
					runSubagentRequest(
						{
							type: "asyncParallel",
							tasks: [
								{ agent: workerAgent, task: "Async A" },
								{ agent: reviewerAgent, task: "Async B" },
							],
							rejectedTasks: [],
							options: { defaultCwd: "/repo" },
						},
						{ ...runtimeDeps(), ...makeAsyncRuntimeDeps(cleanupPaths) },
					),
				);
				return () => cleanupFiles(cleanupPaths);
			},
		},
		{
			name: "process-json-parse",
			group: "process",
			run: () => {
				const result = createInitialSingleResult("worker", "Task", "user", undefined);
				for (const line of processEventLines) {
					applyProcessJsonEvent(result, JSON.parse(line) as unknown);
				}
			},
		},
	];
}

export function summarizeSamples(samplesUs: readonly number[]): BenchmarkSummary {
	if (samplesUs.length === 0) throw new Error("Cannot summarize zero samples.");
	const sorted = [...samplesUs].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const medianUs = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
	const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
	const total = sorted.reduce((sum, value) => sum + value, 0);
	return {
		count: sorted.length,
		minUs: sorted[0],
		maxUs: sorted[sorted.length - 1],
		medianUs,
		p95Us: sorted[p95Index],
		meanUs: total / sorted.length,
	};
}

async function runCleanup(cleanup: BenchmarkRunResult): Promise<void> {
	if (typeof cleanup === "function") await cleanup();
}

export async function runBenchmarkCase(
	benchmarkCase: BenchmarkCase,
	options: BenchmarkOptions,
): Promise<BenchmarkResult> {
	for (let i = 0; i < options.warmup; i++) {
		await runCleanup(await benchmarkCase.run());
	}

	const samplesUs: number[] = [];
	for (let i = 0; i < options.iterations; i++) {
		const start = performance.now();
		const cleanup = await benchmarkCase.run();
		samplesUs.push((performance.now() - start) * 1000);
		await runCleanup(cleanup);
	}

	return {
		name: benchmarkCase.name,
		group: benchmarkCase.group,
		samplesUs,
		summary: summarizeSamples(samplesUs),
	};
}

export async function runBenchmarks(
	cases: readonly BenchmarkCase[],
	options: BenchmarkOptions = DEFAULT_OPTIONS,
): Promise<BenchmarkResult[]> {
	const results: BenchmarkResult[] = [];
	for (const benchmarkCase of cases) {
		results.push(await runBenchmarkCase(benchmarkCase, options));
	}
	return results;
}

function formatNumber(value: number): string {
	return value.toFixed(1);
}

function pad(value: string, width: number): string {
	return value.padEnd(width, " ");
}

export function formatBenchmarkResults(results: readonly BenchmarkResult[]): string {
	const rows = [
		["group", "case", "n", "median µs", "p95 µs", "mean µs", "min µs", "max µs"],
		...results.map((result) => [
			result.group,
			result.name,
			String(result.summary.count),
			formatNumber(result.summary.medianUs),
			formatNumber(result.summary.p95Us),
			formatNumber(result.summary.meanUs),
			formatNumber(result.summary.minUs),
			formatNumber(result.summary.maxUs),
		]),
	];
	const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
	return rows.map((row) => row.map((cell, column) => pad(cell, widths[column])).join("  ")).join("\n");
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCliArgs(args: readonly string[]): { options: BenchmarkOptions; json: boolean } {
	let iterations = DEFAULT_OPTIONS.iterations;
	let warmup = DEFAULT_OPTIONS.warmup;
	let json = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--json") json = true;
		else if (arg === "--iterations") iterations = parsePositiveInteger(args[++i], iterations);
		else if (arg.startsWith("--iterations=")) iterations = parsePositiveInteger(arg.slice("--iterations=".length), iterations);
		else if (arg === "--warmup") warmup = parsePositiveInteger(args[++i], warmup);
		else if (arg.startsWith("--warmup=")) warmup = parsePositiveInteger(arg.slice("--warmup=".length), warmup);
	}

	return { options: { iterations, warmup }, json };
}

async function main(): Promise<void> {
	const { options, json } = parseCliArgs(process.argv.slice(2));
	const results = await runBenchmarks(createBenchmarkCases(), options);
	const output = json ? JSON.stringify({ options, results }, null, 2) : formatBenchmarkResults(results);
	process.stdout.write(`${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	});
}
