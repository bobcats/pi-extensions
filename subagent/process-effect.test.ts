import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { Effect } from "effect";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentConfig } from "./agents.ts";
import { emptyUsageStats } from "./types.ts";
import {
	applyProcessJsonEvent,
	createInitialSingleResult,
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

const agent: AgentConfig = {
	name: "worker",
	description: "Worker",
	source: "user",
	filePath: "/agents/worker.md",
	systemPrompt: "Prompt",
};

function assistantMessage(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	} as Message;
}

describe("process-effect", () => {
	it("creates an unknown-agent shaped result", () => {
		const result = createInitialSingleResult("missing", "Task", "unknown", undefined);
		assert.equal(result.agent, "missing");
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.usage, emptyUsageStats());
	});

	it("applies message_end events and accumulates usage", () => {
		const result = createInitialSingleResult("worker", "Task", "user", undefined);
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
		const resultPromise = Effect.runPromise(
			runSingleAgentEffect({
				defaultCwd: "/repo",
				agent,
				task: "Task",
				cwd: undefined,
				thinking: undefined,
				model: undefined,
				step: undefined,
				onUpdate: undefined,
				spawnPi: () => proc,
				resolveSkillPath: () => null,
			}),
		);

		proc.stdout.emitData(JSON.stringify({ type: "message_end", message: assistantMessage("Done") }) + "\n");
		proc.stderr.emitData("warning");
		proc.close(0);

		const result = await resultPromise;
		assert.equal(result.exitCode, 0);
		assert.equal(result.stderr, "warning");
		assert.equal(result.messages.length, 1);
	});

	it("kills a live child process when the abort signal interrupts runPromise", async () => {
		const proc = new FakeProcess();
		const controller = new AbortController();
		const promise = Effect.runPromise(
			runSingleAgentEffect(
				{
					defaultCwd: "/repo",
					agent,
					task: "Task",
					cwd: undefined,
					thinking: undefined,
					model: undefined,
					step: undefined,
					onUpdate: undefined,
					spawnPi: () => proc,
					resolveSkillPath: () => null,
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
