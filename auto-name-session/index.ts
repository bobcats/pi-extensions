/**
 * Auto-name sessions after the first completed exchange.
 *
 * Uses the cheapest model from the current provider to generate a short
 * description from the user message + assistant response. Skips aborted turns.
 */

import { complete, type Message, type Model, type Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function cheapestModel(models: Model<Api>[], provider: string): Model<Api> | undefined {
	return models
		.filter((m) => m.provider === provider)
		.sort((a, b) => a.cost.input - b.cost.input)
		.at(0);
}

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

export default function (pi: ExtensionAPI) {
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

		const model = cheapestModel(ctx.modelRegistry.getAll(), ctx.model.provider) ?? ctx.model;
		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) return;

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

			const response = await complete(model, { messages: [prompt] }, { apiKey, maxTokens: 30 });
			const name = textOf(response);
			if (!name) return;

			pi.setSessionName(name);
			const cwdBasename = ctx.cwd.split("/").pop() ?? ctx.cwd;
			ctx.ui.setTitle(`π - ${name} - ${cwdBasename}`);
		} catch {
			// Best-effort
		}
	});
}
