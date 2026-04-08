/**
 * Auto-name sessions after the first completed exchange.
 *
 * Uses a hardcoded cheap model to generate a short description from recent
 * conversation context. Skips aborted turns.
 */

import path from "path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const AUTO_NAME_PROVIDER = "openai-codex";
const AUTO_NAME_MODEL = "gpt-5.4-mini";
const AUTO_NAME_SYSTEM_PROMPT = "You generate short session titles for coding work. Return only a 3-6 word natural-casing title with no quotes or extra commentary.";

function textOf(msg: any): string {
	if (!Array.isArray(msg?.content)) return "";
	return msg.content
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text)
		.join("\n")
		.trim();
}

function truncate(text: string, max: number): string {
	return text.length > max ? text.slice(0, max) + "..." : text;
}

function formatMessage(role: string, text: string): string | null {
	if (!text) return null;
	return `${role}:\n${truncate(text, role === "User" ? 500 : 1000)}`;
}

function buildContext(sessionManager: any, messages: any[]): string {
	const branch = typeof sessionManager?.getBranch === "function" ? sessionManager.getBranch() : [];
	const branchMessages = branch
		.filter((entry: any) => entry?.type === "message" && (entry.message?.role === "user" || entry.message?.role === "assistant"))
		.slice(-4)
		.map((entry: any) => formatMessage(entry.message.role === "user" ? "User" : "Assistant", textOf(entry.message)))
		.filter(Boolean);
	const eventMessages = messages
		.filter((message: any) => message?.role === "user" || message?.role === "assistant")
		.slice(-2)
		.map((message: any) => formatMessage(message.role === "user" ? "User" : "Assistant", textOf(message)))
		.filter(Boolean);

	return [...branchMessages, ...eventMessages].join("\n\n");
}

export function createAutoNameExtension(deps: {
	completeFn?: typeof complete;
} = {}) {
	const completeFn = deps.completeFn ?? complete;

	return function autoNameSession(pi: ExtensionAPI) {
		pi.on("agent_end", async (event, ctx) => {
			const existingName = pi.getSessionName();
			if (existingName || !ctx.model) return;

			const { messages } = event;
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
			if ((lastAssistant as any)?.stopReason === "aborted") return;

			const context = buildContext((ctx as any).sessionManager, messages);
			if (!context) return;

			const model = ctx.modelRegistry.find(AUTO_NAME_PROVIDER, AUTO_NAME_MODEL);
			if (!model) return;

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) return;

			try {
				const prompt: Message = {
					role: "user",
					content: [
						{
							type: "text",
							text: `Summarize this coding session in a short phrase (3-6 words, natural casing, no quotes). Describe the task or topic, not the tool or skill used. Be specific enough to distinguish from other sessions. Use the recent conversation context below, not just the last exchange.\n\nRecent conversation:\n${context}`,
						},
					],
					timestamp: Date.now(),
				};

				const response = await completeFn(
					model,
					{ systemPrompt: AUTO_NAME_SYSTEM_PROMPT, messages: [prompt] },
					{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 30 },
				);
				if ((response as any)?.stopReason === "error" || (response as any)?.errorMessage) return;

				const name = textOf(response);
				if (!name) return;

				pi.setSessionName(name);
				const cwdBasename = path.basename(ctx.cwd);
				ctx.ui.setTitle(`π - ${name} - ${cwdBasename}`);
			} catch {
				// Best-effort
			}
		});
	};
}

export default createAutoNameExtension();
