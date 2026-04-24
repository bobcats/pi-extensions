import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TempResourceFailed } from "./errors.ts";

export interface TempFileResource {
	dir: string;
	filePath: string;
}

export function safeTempName(value: string): string {
	return value.replace(/[^\w.-]+/g, "_");
}

export function createPromptTempFileSync(agentName: string, content: string): TempFileResource {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const filePath = path.join(dir, `prompt-${safeTempName(agentName)}.md`);
	fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
	return { dir, filePath };
}

function removeTempResource(resource: TempFileResource): Effect.Effect<void> {
	return Effect.try({
		try: () => fs.rmSync(resource.dir, { recursive: true, force: true }),
		catch: (cause) => cause,
	}).pipe(Effect.ignore);
}

export function makeTempPromptFile(
	agentName: string,
	content: string,
): Effect.Effect<TempFileResource, TempResourceFailed> {
	return Effect.acquireRelease(
		Effect.try({
			try: () => createPromptTempFileSync(agentName, content),
			catch: (cause) => new TempResourceFailed({ operation: "create prompt file", cause }),
		}),
		removeTempResource,
	);
}
