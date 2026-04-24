import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TempResourceFailed } from "./errors.ts";

export interface TempFileResource {
	dir: string;
	filePath: string;
}

function safeName(value: string): string {
	return value.replace(/[^\w.-]+/g, "_");
}

function removeTempResource(resource: TempFileResource): Effect.Effect<void> {
	return Effect.sync(() => {
		try {
			fs.unlinkSync(resource.filePath);
		} catch {}
		try {
			fs.rmSync(resource.dir, { recursive: true, force: true });
		} catch {}
	});
}

export function makeTempPromptFile(
	agentName: string,
	content: string,
): Effect.Effect<TempFileResource, TempResourceFailed> {
	return Effect.acquireRelease(
		Effect.try({
			try: () => {
				const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
				const filePath = path.join(dir, `prompt-${safeName(agentName)}.md`);
				fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
				return { dir, filePath };
			},
			catch: (cause) => new TempResourceFailed({ operation: "create prompt file", cause }),
		}),
		removeTempResource,
	);
}

export function makeTempSessionFile(runId: string): Effect.Effect<TempFileResource, TempResourceFailed> {
	return Effect.acquireRelease(
		Effect.try({
			try: () => {
				const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-session-"));
				const filePath = path.join(dir, `pi-subagent-${safeName(runId)}.jsonl`);
				fs.writeFileSync(filePath, "", { encoding: "utf-8", mode: 0o600 });
				return { dir, filePath };
			},
			catch: (cause) => new TempResourceFailed({ operation: "create session file", cause }),
		}),
		removeTempResource,
	);
}

export function adoptTempFiles(paths: readonly string[]): Effect.Effect<void> {
	return Effect.addFinalizer(() =>
		Effect.sync(() => {
			for (const filePath of paths) {
				try {
					fs.rmSync(filePath, { recursive: true, force: true });
				} catch {}
			}
		}),
	);
}
