import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Effect } from "effect";
import { makeTempPromptFile } from "./temp-effect.ts";

async function usePromptFile() {
	let captured = "";
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const temp = yield* makeTempPromptFile("worker", "system prompt");
				captured = temp.filePath;
				assert.equal(readFileSync(temp.filePath, "utf8"), "system prompt");
				assert.equal(existsSync(temp.filePath), true);
			}),
		),
	);
	return captured;
}

describe("temp-effect", () => {
	it("deletes prompt files and directories when scope closes", async () => {
		const filePath = await usePromptFile();
		assert.equal(existsSync(filePath), false);
	});

	it("deletes prompt files when scoped program fails", async () => {
		let filePath = "";
		await assert.rejects(() =>
			Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const temp = yield* makeTempPromptFile("worker", "system prompt");
						filePath = temp.filePath;
						return yield* Effect.fail(new Error("boom"));
					}),
				),
			),
		);
		assert.equal(existsSync(filePath), false);
	});

});
