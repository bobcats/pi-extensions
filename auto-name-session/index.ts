/**
 * Auto-name sessions after the first completed exchange.
 *
 * Uses a hardcoded cheap model to generate a short title from the first user
 * message. Skips aborted turns.
 */

import path from "path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const AUTO_NAME_PROVIDER = "openai-codex";
const AUTO_NAME_MODEL = "gpt-5.4-mini";
const AUTO_NAME_SYSTEM_PROMPT = "You are an assistant that generates short, descriptive titles (maximum 5 words, sentence case with the first word capitalized, not title case) based on a user's message to an agentic coding tool. Your titles should be concise (max 5 words) and capture the essence of the query or topic. Do not assume or guess the user's intent beyond what is in their message. Omit generic words like question, request, etc. Be professional and precise. Use common software engineering terms and acronyms if they are helpful. Return only the title text.";

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

			const firstUser = messages.find((m) => m.role === "user");
			const userText = truncate(textOf(firstUser), 1000);
			if (!userText) return;

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
							text: `<message>${userText}</message>`,
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
