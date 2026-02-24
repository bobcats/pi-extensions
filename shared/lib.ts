export function formatUsd(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
	if (cost >= 1) return `$${cost.toFixed(2)}`;
	if (cost >= 0.1) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(4)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function extractCostTotal(usage: unknown): number {
	if (!isRecord(usage)) return 0;
	const c = usage.cost;
	if (typeof c === "number") return Number.isFinite(c) ? c : 0;
	if (typeof c === "string") {
		const n = Number(c);
		return Number.isFinite(n) ? n : 0;
	}
	if (isRecord(c)) {
		const t = c.total;
		if (typeof t === "number") return Number.isFinite(t) ? t : 0;
		if (typeof t === "string") {
			const n = Number(t);
			return Number.isFinite(n) ? n : 0;
		}
	}
	return 0;
}
