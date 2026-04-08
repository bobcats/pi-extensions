/**
 * Auto-name sessions after the first completed exchange.
 *
 * Uses a hardcoded cheap model to generate a short description from the user
 * message + assistant response. Skips aborted turns.
 */

import path from "path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const AUTO_NAME_PROVIDER = "openai-codex";
const AUTO_NAME_MODEL = "gpt-5.4-mini";

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
			if (pi.getSessionName() || !ctx.model) return;

			const { messages } = event;

			// Skip aborted turns
			const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
			if ((lastAssistant as any)?.stopReason === "aborted") return;

			const userText = textOf(messages.find((m) => m.role === "user"));
			const assistantText = textOf(lastAssistant);
			if (!userText && !assistantText) return;

			// Build context — truncate user text aggressively (skill invocations are long)
			let context = "";
			if (userText) context += `User's message:\n${truncate(userText, 500)}`;
			if (assistantText) context += `\n\nAssistant's response:\n${truncate(assistantText, 1000)}`;

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
							text: `Summarize this coding session in a short phrase (3-6 words, natural casing, no quotes). Describe the task or topic, not the tool or skill used. Be specific enough to distinguish from other sessions.\n\n${context}`,
						},
					],
					timestamp: Date.now(),
				};

				const response = await completeFn(model, { messages: [prompt] }, { apiKey: auth.apiKey, headers: auth.headers, maxTokens: 30 });
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
