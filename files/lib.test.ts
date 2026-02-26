import assert from "node:assert/strict";
import os from "node:os";
import { describe, it } from "node:test";
import {
	extractFileReferencesFromText,
	extractPathsFromToolArgs,
	formatDisplayPath,
	isCommentLikeReference,
	normalizeReferencePath,
	sanitizeReference,
	stripLineSuffix,
} from "./lib.ts";

describe("extractFileReferencesFromText", () => {
	it("includes file tag name", () => {
		const result = extractFileReferencesFromText('<file name="src/foo.ts">');
		assert.ok(result.includes("src/foo.ts"));
	});

	it("includes file URL", () => {
		const result = extractFileReferencesFromText("file:///tmp/test.txt");
		assert.ok(result.includes("file:///tmp/test.txt"));
	});

	it("includes absolute path from text", () => {
		const result = extractFileReferencesFromText("see /usr/local/bin/foo for details");
		assert.ok(result.includes("/usr/local/bin/foo"));
	});

	it("returns empty array when no files", () => {
		const result = extractFileReferencesFromText("no files here");
		assert.deepEqual(result, []);
	});
});

describe("sanitizeReference", () => {
	it("strips surrounding double quotes", () => {
		assert.equal(sanitizeReference('"src/foo.ts"'), "src/foo.ts");
	});

	it("strips surrounding parentheses", () => {
		assert.equal(sanitizeReference("(src/foo.ts)"), "src/foo.ts");
	});

	it("strips trailing comma", () => {
		assert.equal(sanitizeReference("src/foo.ts,"), "src/foo.ts");
	});
});

describe("isCommentLikeReference", () => {
	it("returns true for double-slash prefix", () => {
		assert.equal(isCommentLikeReference("//comment"), true);
	});

	it("returns false for real path", () => {
		assert.equal(isCommentLikeReference("/usr/bin"), false);
	});
});

describe("stripLineSuffix", () => {
	it("strips colon line number", () => {
		assert.equal(stripLineSuffix("src/foo.ts:42"), "src/foo.ts");
	});

	it("strips #L anchor", () => {
		assert.equal(stripLineSuffix("src/foo.ts#L10"), "src/foo.ts");
	});

	it("strips #L with column", () => {
		assert.equal(stripLineSuffix("src/foo.ts#L10C5"), "src/foo.ts");
	});

	it("returns unchanged when no suffix", () => {
		assert.equal(stripLineSuffix("src/foo.ts"), "src/foo.ts");
	});
});

describe("normalizeReferencePath", () => {
	it("resolves relative path against cwd", () => {
		const result = normalizeReferencePath("src/foo.ts", "/home/user/project");
		assert.equal(result, "/home/user/project/src/foo.ts");
	});

	it("expands ~ to homedir", () => {
		const result = normalizeReferencePath("~/test.txt", "/anywhere");
		assert.ok(result?.startsWith(os.homedir()));
	});

	it("returns null for comment-like reference", () => {
		const result = normalizeReferencePath("//comment", "/anywhere");
		assert.equal(result, null);
	});

	it("converts file URL to path", () => {
		const result = normalizeReferencePath("file:///tmp/test.txt", "/anywhere");
		assert.equal(result, "/tmp/test.txt");
	});
});

describe("formatDisplayPath", () => {
	it("returns relative path when inside cwd", () => {
		const result = formatDisplayPath("/home/user/project/src/foo.ts", "/home/user/project");
		assert.equal(result, "src/foo.ts");
	});

	it("returns absolute path when outside cwd", () => {
		const result = formatDisplayPath("/other/path/foo.ts", "/home/user/project");
		assert.equal(result, "/other/path/foo.ts");
	});
});

describe("extractPathsFromToolArgs", () => {
	it("returns path from { path } key", () => {
		const result = extractPathsFromToolArgs({ path: "src/foo.ts" });
		assert.deepEqual(result, ["src/foo.ts"]);
	});

	it("returns all entries from paths array", () => {
		const result = extractPathsFromToolArgs({ paths: ["a.ts", "b.ts"] });
		assert.deepEqual(result, ["a.ts", "b.ts"]);
	});

	it("returns empty array for null", () => {
		const result = extractPathsFromToolArgs(null);
		assert.deepEqual(result, []);
	});

	it("returns empty array for empty object", () => {
		const result = extractPathsFromToolArgs({});
		assert.deepEqual(result, []);
	});
});
