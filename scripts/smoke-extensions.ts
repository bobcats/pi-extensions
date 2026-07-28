/**
 * Import-smoke every Pi extension declared in package.json pi.extensions.
 * Run with: npx tsx scripts/smoke-extensions.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as {
	pi?: { extensions?: string[] };
};

const EXPECTED_EXTENSIONS = [
	"./ext-prof/index.ts",
	"./confirm-rm/index.ts",
	"./memory/index.ts",
	"./notify/index.ts",
	"./context/index.ts",
	"./files/index.ts",
	"./session-breakdown/index.ts",
	"./subagent/index.ts",
	"./claude-code-tmux/index.ts",
	"./tldraw-desktop/index.ts",
	"./exa/index.ts",
	"./openai-fast/index.ts",
	"./slop-scan/index.ts",
	"./hypura/index.ts",
	"./auto-name-session/index.ts",
	"./handoff/index.ts",
] as const;

const extensions = pkg.pi?.extensions ?? [];
const missingExtensions = EXPECTED_EXTENSIONS.filter((extension) => !extensions.includes(extension));
if (missingExtensions.length > 0) {
	console.error(`Missing expected pi.extensions entries: ${missingExtensions.join(", ")}`);
	process.exit(1);
}

let failed = 0;

for (const rel of extensions) {
	const abs = path.resolve(root, rel);
	const href = pathToFileURL(abs).href;
	try {
		const mod = await import(href);
		if (typeof mod.default !== "function") {
			throw new Error(`default export is ${typeof mod.default}, expected function`);
		}
		console.log(`OK  ${rel}`);
	} catch (error) {
		failed += 1;
		const message = error instanceof Error ? error.message : String(error);
		console.error(`FAIL ${rel}: ${message}`);
	}
}

if (failed > 0) {
	console.error(`\n${failed}/${extensions.length} extension import(s) failed`);
	process.exit(1);
}

console.log(`\nAll ${extensions.length} extensions imported successfully against shared Pi deps.`);
