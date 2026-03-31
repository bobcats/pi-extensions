import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	SUBAGENT_RUN_START_EVENT,
	SUBAGENT_RUN_END_EVENT,
	buildSubagentRunStartEvent,
	buildSubagentRunEndEvent,
} from "./events.ts";

describe("subagent async lifecycle events", () => {
	it("builds a run_start payload with execution metadata", () => {
		const event = buildSubagentRunStartEvent({
			id: "run-123",
			agent: "scout",
			agentSource: "user",
			task: "Inspect the repo",
			execution: "async",
			startedAt: 123,
			batchId: "batch-1",
		});

		assert.equal(SUBAGENT_RUN_START_EVENT, "subagent:run_start");
		assert.deepEqual(event, {
			id: "run-123",
			agent: "scout",
			agentSource: "user",
			task: "Inspect the repo",
			execution: "async",
			startedAt: 123,
			batchId: "batch-1",
		});
	});

	it("builds a run_start payload for bundled agents", () => {
		const event = buildSubagentRunStartEvent({
			id: "run-456",
			agent: "worker",
			agentSource: "bundled",
			task: "Do the built-in thing",
			execution: "sync",
			startedAt: 789,
		});

		assert.deepEqual(event, {
			id: "run-456",
			agent: "worker",
			agentSource: "bundled",
			task: "Do the built-in thing",
			execution: "sync",
			startedAt: 789,
		});
	});

	it("builds a run_end payload with completion status", () => {
		const event = buildSubagentRunEndEvent({
			id: "run-123",
			agent: "scout",
			agentSource: "user",
			task: "Inspect the repo",
			execution: "async",
			startedAt: 123,
			finishedAt: 456,
			status: "failed",
			exitCode: 1,
			stopReason: "error",
			errorMessage: "boom",
			batchId: "batch-1",
		});

		assert.equal(SUBAGENT_RUN_END_EVENT, "subagent:run_end");
		assert.deepEqual(event, {
			id: "run-123",
			agent: "scout",
			agentSource: "user",
			task: "Inspect the repo",
			execution: "async",
			startedAt: 123,
			finishedAt: 456,
			status: "failed",
			exitCode: 1,
			stopReason: "error",
			errorMessage: "boom",
			batchId: "batch-1",
		});
	});
});
