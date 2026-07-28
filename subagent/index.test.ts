import assert from "node:assert/strict";
import { test } from "node:test";
import subagentExtension from "./index.ts";

test("publishes parent-prompt guidance to Pi's system prompt", () => {
	let tool: Record<string, unknown> | undefined;
	const pi = {
		on() {},
		events: { on() {}, emit() {} },
		registerTool(value: Record<string, unknown>) { tool = value; },
		registerMessageRenderer() {},
	};

	subagentExtension(pi as never);

	assert.equal(tool?.promptSnippet, "Delegate complete prompts to isolated subagents.");
	assert.deepEqual(tool?.promptGuidelines, [
		"Subagents have no built-in persona; include all role, context, constraints, and output instructions in each task prompt.",
		"Do not spawn subagents for simple file reads; use direct read tools instead.",
	]);
});
