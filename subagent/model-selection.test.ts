import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	formatAvailableModelId,
	getSavedScopedModelIds,
	resolveModelOverride,
} from "./model-selection.ts";

describe("formatAvailableModelId", () => {
	it("formats model IDs with provider prefix", () => {
		// Arrange
		const model = { provider: "anthropic", id: "claude-sonnet-4-6" };

		// Act
		const result = formatAvailableModelId(model);

		// Assert
		assert.equal(result, "anthropic/claude-sonnet-4-6");
	});
});

describe("getSavedScopedModelIds", () => {
	it("reads enabledModels from the global settings file", () => {
		// Arrange
		const root = mkdtempSync(join(tmpdir(), "pi-subagent-settings-"));
		const homeDir = join(root, "home");
		const cwd = join(root, "repo");
		mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
		mkdirSync(cwd, { recursive: true });
		writeFileSync(
			join(homeDir, ".pi", "agent", "settings.json"),
			JSON.stringify({ enabledModels: ["anthropic/claude-sonnet-4-6", "openai/gpt-5-mini"] }),
		);

		// Act
		const result = getSavedScopedModelIds(cwd, homeDir);

		// Assert
		assert.deepEqual(result, ["anthropic/claude-sonnet-4-6", "openai/gpt-5-mini"]);
	});

	it("prefers the nearest project settings file over global settings", () => {
		// Arrange
		const root = mkdtempSync(join(tmpdir(), "pi-subagent-settings-"));
		const homeDir = join(root, "home");
		const projectRoot = join(root, "repo");
		const cwd = join(projectRoot, "packages", "app");
		mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
		mkdirSync(join(projectRoot, ".pi"), { recursive: true });
		mkdirSync(cwd, { recursive: true });
		writeFileSync(
			join(homeDir, ".pi", "agent", "settings.json"),
			JSON.stringify({ enabledModels: ["anthropic/claude-opus-4-6"] }),
		);
		writeFileSync(
			join(projectRoot, ".pi", "settings.json"),
			JSON.stringify({ enabledModels: ["anthropic/claude-haiku-4-5"] }),
		);

		// Act
		const result = getSavedScopedModelIds(cwd, homeDir);

		// Assert
		assert.deepEqual(result, ["anthropic/claude-haiku-4-5"]);
	});

	it("returns an empty list when no saved enabledModels exist", () => {
		// Arrange
		const root = mkdtempSync(join(tmpdir(), "pi-subagent-settings-"));
		const homeDir = join(root, "home");
		const cwd = join(root, "repo");
		mkdirSync(cwd, { recursive: true });

		// Act
		const result = getSavedScopedModelIds(cwd, homeDir);

		// Assert
		assert.deepEqual(result, []);
	});
});

describe("resolveModelOverride", () => {
	it("prefers the explicit override over the agent frontmatter model", () => {
		// Arrange
		const scopedModelIds = ["anthropic/claude-sonnet-4-6", "openai/gpt-5"];

		// Act
		const result = resolveModelOverride(
			scopedModelIds,
			"anthropic/claude-sonnet-4-6",
			"openai/gpt-5",
		);

		// Assert
		assert.equal(result.model, "anthropic/claude-sonnet-4-6");
		assert.equal(result.error, undefined);
	});

	it("falls back to the agent frontmatter model when no override is provided", () => {
		// Arrange
		const scopedModelIds = ["openai/gpt-5"];

		// Act
		const result = resolveModelOverride(scopedModelIds, undefined, "openai/gpt-5");

		// Assert
		assert.equal(result.model, "openai/gpt-5");
		assert.equal(result.error, undefined);
	});

	it("returns an error when the override is not in saved scoped models", () => {
		// Arrange
		const scopedModelIds = ["anthropic/claude-sonnet-4-6"];

		// Act
		const result = resolveModelOverride(
			scopedModelIds,
			"openai/gpt-5",
			"anthropic/claude-sonnet-4-6",
		);

		// Assert
		assert.equal(result.model, undefined);
		assert.match(result.error ?? "", /Unknown model override: "openai\/gpt-5"/);
		assert.match(result.error ?? "", /Scoped models: anthropic\/claude-sonnet-4-6/);
	});
});
