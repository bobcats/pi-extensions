export type ModelKey = string; // `${provider}/${model}`

export function formatCount(n: number): string {
	if (!Number.isFinite(n) || n === 0) return "0";
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString("en-US");
}

export function toLocalDayKey(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

export function mondayIndex(date: Date): number {
	// Mon=0 .. Sun=6
	return (date.getDay() + 6) % 7;
}

export function modelKeyFromParts(provider?: unknown, model?: unknown): ModelKey | null {
	const p = typeof provider === "string" ? provider.trim() : "";
	const m = typeof model === "string" ? model.trim() : "";
	if (!p && !m) return null;
	if (!p) return m;
	if (!m) return p;
	return `${p}/${m}`;
}

export function parseSessionStartFromFilename(name: string): Date | null {
	// Example: 2026-02-02T21-52-28-774Z_<uuid>.jsonl
	const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
	if (!m) return null;
	const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
	const d = new Date(iso);
	return Number.isFinite(d.getTime()) ? d : null;
}

export function extractTokensTotal(usage: unknown): number {
	if (!usage) return 0;

	const readNum = (v: unknown): number => {
		if (typeof v === "number") return Number.isFinite(v) ? v : 0;
		if (typeof v === "string") {
			const n = Number(v);
			return Number.isFinite(n) ? n : 0;
		}
		return 0;
	};

	const u = usage as Record<string, unknown>;

	let total = 0;
	// direct totals
	total =
		readNum(u.totalTokens) ||
		readNum(u.total_tokens) ||
		readNum(u.tokens) ||
		readNum(u.tokenCount) ||
		readNum(u.token_count);
	if (total > 0) return total;

	// nested tokens object
	const tokens = u.tokens as Record<string, unknown> | undefined;
	if (tokens && typeof tokens === "object") {
		total = readNum(tokens.total) || readNum(tokens.totalTokens) || readNum(tokens.total_tokens);
		if (total > 0) return total;
	}

	// sum of parts
	const a =
		readNum(u.promptTokens) ||
		readNum(u.prompt_tokens) ||
		readNum(u.inputTokens) ||
		readNum(u.input_tokens);
	const b =
		readNum(u.completionTokens) ||
		readNum(u.completion_tokens) ||
		readNum(u.outputTokens) ||
		readNum(u.output_tokens);
	const sum = a + b;
	return sum > 0 ? sum : 0;
}
