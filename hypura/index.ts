/**
 * Hypura Provider Extension
 *
 * Bridges pi to a local Hypura instance via its Ollama-compatible API.
 * Hypura runs GGUF models on Apple Silicon with GPU/RAM/NVMe tiered scheduling.
 *
 * Start hypura:  hypura serve ./model.gguf --port 8080 --context 262144
 * Select model:  /model → hypura/<model-name>
 *
 * Env: HYPURA_BASE_URL (default: http://127.0.0.1:8080)
 */

import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";

interface OllamaChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

interface OllamaChatResponse {
	model: string;
	message: { role: string; content: string };
	done: boolean;
	done_reason?: string;
	prompt_eval_count?: number;
	eval_count?: number;
}

function buildOllamaMessages(context: Context): OllamaChatMessage[] {
	const messages: OllamaChatMessage[] = [];

	if (context.systemPrompt) {
		messages.push({ role: "system", content: context.systemPrompt });
	}

	for (const msg of context.messages) {
		if (msg.role === "user") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.filter((c) => c.type === "text")
							.map((c) => (c as { type: "text"; text: string }).text)
							.join("\n");
			if (text.trim()) messages.push({ role: "user", content: text });
		} else if (msg.role === "assistant") {
			const text = msg.content
				.filter((c) => c.type === "text")
				.map((c) => (c as { type: "text"; text: string }).text)
				.join("\n");
			if (text.trim()) messages.push({ role: "assistant", content: text });
		} else if (msg.role === "toolResult") {
			const text =
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.filter((c) => c.type === "text")
							.map((c) => (c as { type: "text"; text: string }).text)
							.join("\n");
			if (text.trim()) messages.push({ role: "user", content: text });
		}
	}

	return messages;
}

function streamHypura(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const baseUrl = model.baseUrl || DEFAULT_BASE_URL;
			const ollamaMessages = buildOllamaMessages(context);

			const response = await fetch(`${baseUrl}/api/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: model.id,
					messages: ollamaMessages,
					stream: true,
				}),
				signal: options?.signal,
			});

			if (!response.ok) {
				throw new Error(`Hypura API error ${response.status}: ${await response.text()}`);
			}

			output.content.push({ type: "text", text: "" });
			stream.push({ type: "start", partial: output });
			stream.push({ type: "text_start", contentIndex: 0, partial: output });

			const body = response.body;
			let fullText = "";

			if (body && typeof body[Symbol.asyncIterator] === "function") {
				const decoder = new TextDecoder();
				let buffer = "";
				for await (const chunk of body as any) {
					const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
					buffer += text;
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";
					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const parsed: OllamaChatResponse = JSON.parse(line.trim());
							if (parsed.message?.content) {
								fullText += parsed.message.content;
								const block = output.content[0];
								if (block.type === "text") block.text = fullText;
								stream.push({ type: "text_delta", contentIndex: 0, delta: parsed.message.content, partial: output });
							}
							if (parsed.done) {
								if (parsed.prompt_eval_count) output.usage.input = parsed.prompt_eval_count;
								if (parsed.eval_count) output.usage.output = parsed.eval_count;
								output.usage.totalTokens = output.usage.input + output.usage.output;
								if (parsed.done_reason === "length") output.stopReason = "length";
							}
						} catch {}
					}
				}
				if (buffer.trim()) {
					try {
						const parsed: OllamaChatResponse = JSON.parse(buffer.trim());
						if (parsed.message?.content) {
							fullText += parsed.message.content;
							const block = output.content[0];
							if (block.type === "text") block.text = fullText;
							stream.push({ type: "text_delta", contentIndex: 0, delta: parsed.message.content, partial: output });
						}
						if (parsed.done) {
							if (parsed.prompt_eval_count) output.usage.input = parsed.prompt_eval_count;
							if (parsed.eval_count) output.usage.output = parsed.eval_count;
							output.usage.totalTokens = output.usage.input + output.usage.output;
							if (parsed.done_reason === "length") output.stopReason = "length";
						}
					} catch {}
				}
			} else {
				const text = await response.text();
				for (const line of text.split("\n")) {
					if (!line.trim()) continue;
					try {
						const parsed: OllamaChatResponse = JSON.parse(line.trim());
						if (parsed.message?.content) {
							fullText += parsed.message.content;
							stream.push({ type: "text_delta", contentIndex: 0, delta: parsed.message.content, partial: output });
						}
						if (parsed.done) {
							if (parsed.prompt_eval_count) output.usage.input = parsed.prompt_eval_count;
							if (parsed.eval_count) output.usage.output = parsed.eval_count;
							output.usage.totalTokens = output.usage.input + output.usage.output;
							if (parsed.done_reason === "length") output.stopReason = "length";
						}
					} catch {}
				}
				const block = output.content[0];
				if (block.type === "text") block.text = fullText;
			}

			const textBlock = output.content[0];
			if (textBlock.type === "text") {
				stream.push({ type: "text_end", contentIndex: 0, content: textBlock.text, partial: output });
			}

			stream.push({
				type: "done",
				reason: output.stopReason as "stop" | "length" | "toolUse",
				message: output,
			});
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

export default async function (pi: ExtensionAPI) {
	const baseUrl = process.env.HYPURA_BASE_URL || DEFAULT_BASE_URL;

	// Auto-discover what model hypura is serving
	let models;
	try {
		const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
		if (response.ok) {
			const tags = await response.json() as { models: Array<{ name: string; details?: { parameter_size?: string } }> };
			models = tags.models.map((m) => ({
				id: m.name,
				name: m.name,
				reasoning: false as const,
				input: ["text"] as "text"[],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				// Qwen3.5 supports 262K native context; default high for any model
				contextWindow: 262144,
				maxTokens: 32768,
			}));
		}
	} catch {}

	if (!models?.length) {
		models = [{
			id: "default",
			name: "Hypura Local Model",
			reasoning: false as const,
			input: ["text"] as "text"[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 262144,
			maxTokens: 32768,
		}];
	}

	pi.registerProvider("hypura", {
		baseUrl,
		apiKey: "local",
		api: "hypura-ollama",
		models,
		streamSimple: streamHypura,
	});
}
