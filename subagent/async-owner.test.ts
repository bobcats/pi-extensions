import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { createAsyncOwner } from "./async-owner.ts";
import type { AsyncRun } from "./types.ts";

function run(id: string): AsyncRun {
	return {
		id,
		agent: "worker",
		task: "Task",
		startedAt: Date.now(),
		pane: `%${id}`,
		sessionFile: `/tmp/session-${id}.jsonl`,
		tempFiles: [],
	};
}

describe("createAsyncOwner", () => {
	it("tracks a watcher until it completes", async () => {
		const completed: string[] = [];
		const owner = createAsyncOwner({
			runWatcher: (item) => Effect.sync(() => completed.push(item.id)),
		});

		owner.start(run("1"));
		assert.deepEqual(owner.runIds(), ["1"]);
		await owner.drainForTests();
		assert.deepEqual(completed, ["1"]);
		assert.deepEqual(owner.runIds(), []);
	});

	it("interrupts running watchers on shutdown", async () => {
		const interrupted: string[] = [];
		const owner = createAsyncOwner({
			runWatcher: (item) =>
				Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => interrupted.push(item.id)))),
		});

		owner.start(run("2"));
		assert.deepEqual(owner.runIds(), ["2"]);
		await owner.shutdown();
		assert.deepEqual(interrupted, ["2"]);
		assert.deepEqual(owner.runIds(), []);
	});
});
