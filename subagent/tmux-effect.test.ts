import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { adoptPane, adoptWindow, pollForExitEffect, type TmuxOps } from "./tmux-effect.ts";

function fakeOps(screens: string[]): TmuxOps {
	const closedPanes: string[] = [];
	const closedWindows: string[] = [];
	return {
		isAvailable: () => true,
		createPaneWithCommand: () => "%1",
		createWindow: () => "@1",
		getWindowPanes: () => ["%1"],
		runCommandInPane: () => undefined,
		createPaneInWindow: () => "%2",
		tileWindow: () => undefined,
		closePane: (pane) => {
			closedPanes.push(pane);
		},
		closeWindow: (window) => {
			closedWindows.push(window);
		},
		readScreen: async () => screens.shift() ?? "",
		makeBatchWindowName: (id) => `subagents-test-${id}`,
		shellEscape: (value) => `'${value}'`,
		closedPanes,
		closedWindows,
	} as TmuxOps & { closedPanes: string[]; closedWindows: string[] };
}

describe("tmux-effect", () => {
	it("polls until sentinel exit code appears", async () => {
		const ops = fakeOps(["running", "__SUBAGENT_DONE_7__"]);
		const code = await Effect.runPromise(pollForExitEffect("%1", { ops, intervalMs: 1 }));
		assert.equal(code, 7);
	});

	it("closes adopted pane when scope closes", async () => {
		const ops = fakeOps([]) as TmuxOps & { closedPanes: string[] };
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					yield* adoptPane("%9", ops);
				}),
			),
		);
		assert.deepEqual(ops.closedPanes, ["%9"]);
	});

	it("closes adopted window when scope closes", async () => {
		const ops = fakeOps([]) as TmuxOps & { closedWindows: string[] };
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					yield* adoptWindow("@9", ops);
				}),
			),
		);
		assert.deepEqual(ops.closedWindows, ["@9"]);
	});
});
