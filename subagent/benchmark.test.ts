import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createBenchmarkCases,
	formatBenchmarkResults,
	runBenchmarkCase,
	summarizeSamples,
	type BenchmarkCase,
} from "./benchmark.ts";

describe("benchmark helpers", () => {
	it("summarizes samples without mutating input order", () => {
		const samples = [10, 1, 5, 2];

		const summary = summarizeSamples(samples);

		assert.deepEqual(samples, [10, 1, 5, 2]);
		assert.deepEqual(summary, {
			count: 4,
			minUs: 1,
			maxUs: 10,
			medianUs: 3.5,
			p95Us: 10,
			meanUs: 4.5,
		});
	});

	it("runs warmup iterations before collecting measured samples", async () => {
		const calls: number[] = [];
		const benchmarkCase: BenchmarkCase = {
			name: "counter",
			group: "test",
			run: () => {
				calls.push(calls.length);
			},
		};

		const result = await runBenchmarkCase(benchmarkCase, { iterations: 3, warmup: 2 });

		assert.equal(result.name, "counter");
		assert.equal(result.group, "test");
		assert.deepEqual(calls, [0, 1, 2, 3, 4]);
		assert.equal(result.samplesUs.length, 3);
		assert.equal(result.summary.count, 3);
	});

	it("runs cleanup returned by benchmark cases outside sample collection", async () => {
		let cleanupCount = 0;
		const benchmarkCase: BenchmarkCase = {
			name: "cleanup",
			group: "test",
			run: () => () => {
				cleanupCount++;
			},
		};

		const result = await runBenchmarkCase(benchmarkCase, { iterations: 2, warmup: 1 });

		assert.equal(cleanupCount, 3);
		assert.equal(result.samplesUs.length, 2);
	});

	it("formats benchmark results as a compact table", () => {
		const text = formatBenchmarkResults([
			{
				name: "parse-single",
				group: "request",
				samplesUs: [1, 2, 3],
				summary: { count: 3, minUs: 1, maxUs: 3, medianUs: 2, p95Us: 3, meanUs: 2 },
			},
		]);

		assert.match(text, /case/);
		assert.match(text, /parse-single/);
		assert.match(text, /median/);
		assert.match(text, /p95/);
	});

	it("defines deterministic subagent benchmark cases", () => {
		const cases = createBenchmarkCases();

		assert.deepEqual(
			cases.map((item) => item.name),
			[
				"parse-single",
				"parse-parallel",
				"parse-chain",
				"runtime-single",
				"runtime-parallel",
				"runtime-chain",
				"async-single-setup",
				"async-parallel-setup",
				"process-json-parse",
			],
		);
	});

	it("runs every default benchmark case through the cleanup-aware harness", async () => {
		const cases = createBenchmarkCases();

		for (const benchmarkCase of cases) {
			const result = await runBenchmarkCase(benchmarkCase, { iterations: 1, warmup: 0 });
			assert.equal(result.samplesUs.length, 1);
		}

		assert.equal(cases.length, 9);
	});
});
