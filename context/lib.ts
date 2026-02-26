import os from "node:os";
import path from "node:path";
import { extractCostTotal } from "../shared/lib.ts";

export function estimateTokens(text: string): number {
	// Deliberately fuzzy (good enough for "how big-ish is this").
	return Math.max(0, Math.ceil(text.length / 4));
}

export function normalizeReadPath(inputPath: string, cwd: string): string {
	// Similar to pi's resolveToCwd/resolveReadPath, but simplified.
	let p = inputPath;
	if (p.startsWith("@")) p = p.slice(1);
	if (p === "~") p = os.homedir();
	else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
	if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
	return path.resolve(p);
}

export function getAgentDir(): string {
	// Mirrors pi's behavior reasonably well.
	const envCandidates = ["PI_CODING_AGENT_DIR", "TAU_CODING_AGENT_DIR"];
	let envDir: string | undefined;
	for (const k of envCandidates) {
		if (process.env[k]) {
			envDir = process.env[k];
			break;
		}
	}
	if (!envDir) {
		for (const [k, v] of Object.entries(process.env)) {
			if (k.endsWith("_CODING_AGENT_DIR") && v) {
				envDir = v;
				break;
			}
		}
	}

	if (envDir) {
		if (envDir === "~") return os.homedir();
		if (envDir.startsWith("~/")) return path.join(os.homedir(), envDir.slice(2));
		return envDir;
	}
	return path.join(os.homedir(), ".pi", "agent");
}

export type SessionEntryLike = {
	type?: unknown;
	message?: {
		role?: string;
		usage?: unknown;
	};
};

export type SessionContextLike = {
	sessionManager: {
		getEntries: () => SessionEntryLike[];
	};
};

export function sumSessionUsage(ctx: SessionContextLike): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	totalCost: number;
} {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalCost = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if ((entry as any)?.type !== "message") continue;
		const msg = (entry as any)?.message;
		if (!msg || msg.role !== "assistant") continue;
		const usage = msg.usage;
		if (!usage) continue;
		input += Number(usage.inputTokens ?? 0) || 0;
		output += Number(usage.outputTokens ?? 0) || 0;
		cacheRead += Number(usage.cacheRead ?? 0) || 0;
		cacheWrite += Number(usage.cacheWrite ?? 0) || 0;
		totalCost += extractCostTotal(usage);
	}

	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		totalCost,
	};
}

export function shortenPath(p: string, cwd: string): string {
	const rp = path.resolve(p);
	const rc = path.resolve(cwd);
	if (rp === rc) return ".";
	if (rp.startsWith(rc + path.sep)) return "./" + rp.slice(rc.length + 1);
	return rp;
}
