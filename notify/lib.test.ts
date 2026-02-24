import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTextPart, extractLastAssistantText, formatNotification, simpleMarkdown } from "./lib.ts";

describe("isTextPart", () => {
	it("returns true for { type: 'text', text: 'hello' }", () => {
		assert.equal(isTextPart({ type: "text", text: "hello" }), true);
	});

	it("returns false for { type: 'image', url: '...' }", () => {
		assert.equal(isTextPart({ type: "image", url: "..." }), false);
	});

	it("returns false for null", () => {
		assert.equal(isTextPart(null), false);
	});

	it("returns false for a string", () => {
		assert.equal(isTextPart("string"), false);
	});
});

describe("extractLastAssistantText", () => {
	it("returns null for empty array", () => {
		assert.equal(extractLastAssistantText([]), null);
	});

	it("returns null when only user messages", () => {
		assert.equal(extractLastAssistantText([{ role: "user", content: "hi" }]), null);
	});

	it("returns string content from assistant message", () => {
		assert.equal(extractLastAssistantText([{ role: "assistant", content: "hello" }]), "hello");
	});

	it("returns joined text from assistant message with content array", () => {
		assert.equal(
			extractLastAssistantText([{ role: "assistant", content: [{ type: "text", text: "hello" }] }]),
			"hello",
		);
	});

	it("returns null for assistant message with empty string content", () => {
		assert.equal(extractLastAssistantText([{ role: "assistant", content: "" }]), null);
	});

	it("returns last assistant message text when multiple exist", () => {
		assert.equal(
			extractLastAssistantText([
				{ role: "assistant", content: "first" },
				{ role: "assistant", content: "second" },
			]),
			"second",
		);
	});
});

describe("formatNotification", () => {
	it("returns ready for input when null", () => {
		assert.deepEqual(formatNotification(null), { title: "Ready for input", body: "" });
	});

	it("returns π title and body containing text for short string", () => {
		const result = formatNotification("short");
		assert.equal(result.title, "π");
		assert.ok(result.body.includes("short"), `Expected body to contain 'short', got: ${result.body}`);
	});

	it("truncates long text to <= 200 chars and ends with ellipsis", () => {
		const result = formatNotification("x".repeat(300));
		assert.ok(result.body.length <= 200, `Expected body.length <= 200, got ${result.body.length}`);
		assert.ok(result.body.endsWith("…"), `Expected body to end with '…', got: ${result.body}`);
	});

	it("returns ready for input for empty string", () => {
		assert.deepEqual(formatNotification(""), { title: "Ready for input", body: "" });
	});
});

describe("simpleMarkdown", () => {
	it("strips markdown formatting to plain text", () => {
		const result = simpleMarkdown("**bold** and _italic_");
		assert.ok(!result.includes("**"), `Expected no '**' in output, got: ${result}`);
		assert.ok(!result.includes("_"), `Expected no '_' in output, got: ${result}`);
		assert.ok(result.includes("bold"), `Expected 'bold' in output, got: ${result}`);
		assert.ok(result.includes("italic"), `Expected 'italic' in output, got: ${result}`);
	});
});
