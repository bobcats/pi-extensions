import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { Effect } from "effect";
import type { Message } from "@earendil-works/pi-ai";
import { emptyUsageStats } from "./types.ts";
import {
	applyProcessJsonEvent,
	buildPiSpawnInvocation,
	createInitialSingleResult,
	resolvePiCliPath,
	runSingleAgentEffect,
	type ChildProcessLike,
} from "./process-effect.ts";

class FakeStream extends EventEmitter {
	emitData(value: string) {
		this.emit("data", Buffer.from(value));
	}
}

class FakeProcess extends EventEmitter implements ChildProcessLike {
	stdout = new FakeStream();
	stderr = new FakeStream();
	killed = false;
	killedWith: string[] = [];

	kill(signal?: NodeJS.Signals) {
		this.killed = true;
		this.killedWith.push(signal ?? "SIGTERM");
		return true;
	}

	close(code: number) {
		this.emit("close", code);
	}
}

function assistantMessage(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as Message;
}

describe("process-effect", () => {
	it("resolves the Pi CLI entrypoint from the running package without PATH", () => {
		assert.equal(resolvePiCliPath("/opt/pi-coding-agent"), "/opt/pi-coding-agent/dist/cli.js");
		assert.equal(resolvePiCliPath("C:\\pi-coding-agent"), "C:\\pi-coding-agent/dist/cli.js");
	});

	it("builds child spawn as process.execPath + package dist/cli.js, not bare pi", () => {
		const invocation = buildPiSpawnInvocation(["--mode", "json", "-p", "--no-session", "Task: hi"], {
			execPath: "/usr/bin/node",
			packageDir: "/opt/pi-coding-agent",
		});
		assert.equal(invocation.command, "/usr/bin/node");
		assert.deepEqual(invocation.args, [
			"/opt/pi-coding-agent/dist/cli.js",
			"--mode",
			"json",
			"-p",
			"--no-session",
			"Task: hi",
		]);
		assert.notEqual(invocation.command, "pi");
		assert.ok(!invocation.args.includes("pi"));

		const live = buildPiSpawnInvocation(["--mode", "json"]);
		assert.equal(live.command, process.execPath);
		assert.equal(live.args[0], resolvePiCliPath());
		assert.match(live.args[0], /dist[/\\]cli\.js$/);
	});

	it("creates a prompt-driven subagent result", () => {
		const result = createInitialSingleResult("Task", undefined);
		assert.equal(result.agent, "subagent");
		assert.equal(result.agentSource, "prompt");
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.usage, emptyUsageStats());
	});

	it("applies message_end events and accumulates usage", () => {
		const result = createInitialSingleResult("Task", undefined);
		const message = assistantMessage("Done") as any;
		message.usage = {
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			cost: { total: 0.01 },
			totalTokens: 20,
		};
		message.model = "anthropic/claude";
		message.stopReason = "end_turn";

		applyProcessJsonEvent(result, { type: "message_end", message });

		assert.equal(result.messages.length, 1);
		assert.equal(result.usage.input, 10);
		assert.equal(result.usage.output, 5);
		assert.equal(result.usage.cacheRead, 2);
		assert.equal(result.usage.cacheWrite, 1);
		assert.equal(result.usage.cost, 0.01);
		assert.equal(result.usage.contextTokens, 20);
		assert.equal(result.usage.turns, 1);
		assert.equal(result.model, "anthropic/claude");
		assert.equal(result.stopReason, "end_turn");
	});

	it("runs a fake child process and parses stdout json lines", async () => {
		const proc = new FakeProcess();
		let spawnedArgs: string[] = [];
		const resultPromise = Effect.runPromise(
			runSingleAgentEffect({
				defaultCwd: "/repo",
				task: "Review this code as a security specialist",
				spawnPi: (args) => {
					spawnedArgs = args;
					return proc;
				},
			}),
		);

		proc.stdout.emitData(JSON.stringify({ type: "message_end", message: assistantMessage("Done") }) + "\n");
		proc.stderr.emitData("warning");
		proc.close(0);

		const result = await resultPromise;
		assert.equal(result.exitCode, 0);
		assert.equal(result.stderr, "warning");
		assert.equal(result.messages.length, 1);
		assert.equal(spawnedArgs.at(-1), "Review this code as a security specialist");
		assert.equal(spawnedArgs.includes("--append-system-prompt"), false);
	});

	it("kills a live child process when the abort signal interrupts runPromise", async () => {
		const proc = new FakeProcess();
		const controller = new AbortController();
		const promise = Effect.runPromise(
			runSingleAgentEffect(
				{
					defaultCwd: "/repo",
					task: "Task",
					spawnPi: () => proc,
					killGraceMs: 10,
				},
			),
			{ signal: controller.signal },
		);

		controller.abort();
		await assert.rejects(() => promise);
		assert.equal(proc.killed, true);
		assert.equal(proc.killedWith[0], "SIGTERM");
	});
});
