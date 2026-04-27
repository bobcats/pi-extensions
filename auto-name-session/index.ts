/**
 * Auto-name sessions after the first completed exchange.
 *
 * Builds a compact naming packet from the actual task/result, then uses a
 * hardcoded cheap model to generate a short title. Skips incomplete turns.
 */

import path from "path";
import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const AUTO_NAME_PROVIDER = "openai-codex";
const AUTO_NAME_MODEL = "gpt-5.4-mini";
const MAX_CLEAN_USER_CHARS = 2200;
const MAX_ASSISTANT_RESULT_CHARS = 1000;
const MAX_TOOL_RESULT_CHARS = 400;
const MAX_TITLE_ATTEMPTS = 2;
const AUTO_NAME_SYSTEM_PROMPT = `Generate a high-quality session title for an agentic coding session.
Return strict JSON: {"title":"...","confidence":0-1,"why":"..."}.
Title rules:
- 2-5 words, sentence case, no quotes.
- Concrete object beats generic action.
- Use skill only as an action/mode hint; never title the skill/workflow itself.
- If a title would be vague, add source/domain/topic context.
- For URL tasks, combine domain/path/title clues into the actual article/topic.
- For handoffs or execute-plan prompts, title the concrete plan/module/bug subject.
- For debugging, title the failing behavior or domain object.
- Avoid generic titles such as Memory ingest workflow, Semantic commit, Brainstorming workflow, Execute plan, Task, Request, or Session.`;

const GENERIC_TITLE_WORDS = new Set(["request", "task", "session", "workflow", "question"]);
const GENERIC_TITLES = new Set([
	"memory ingest workflow",
	"memory ingest",
	"semantic commit",
	"semantic commit cleanup",
	"brainstorming workflow design",
	"brainstorming design process",
	"playwright cli skill",
	"execute plan",
	"execute the plan",
	"run tool",
	"use tool",
]);

type MinimalContent = {
	type?: string;
	id?: string;
	text?: string;
	name?: string;
	arguments?: unknown;
};

type MinimalMessage = {
	role?: string;
	content?: string | MinimalContent[];
	stopReason?: string;
	toolCallId?: string;
	toolName?: string;
};

type BranchEntry = {
	type?: string;
	message?: MinimalMessage;
};

type NamingContext = {
	skillNames: string[];
	cleanUserGoal: string;
	urlClues: UrlClue[];
	pathClues: PathClue[];
	codeIdentifiers: string[];
	assistantResult: string;
	toolSummaries: ToolSummary[];
};

type UrlClue = {
	host: string;
	path: string;
	pathWords: string[];
};

type PathClue = {
	path: string;
	words: string;
};

type ToolSummary = {
	kind: "call" | "result";
	name: string;
	arguments?: unknown;
	text?: string;
};

type ParsedTitle = {
	title: string;
	confidence?: number;
};

function textOf(msg: unknown): string {
	if (!msg || typeof msg !== "object") return "";
	const content = (msg as MinimalMessage).content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	return content
		.filter((c): c is MinimalContent & { text: string } => c?.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

function truncateMiddle(text: string, max: number): string {
	if (text.length <= max) return text;
	const side = Math.floor((max - 24) / 2);
	return `${text.slice(0, side)}\n...[omitted]...\n${text.slice(-side)}`;
}

function firstUserMessageFromBranch(ctx: unknown): MinimalMessage | null {
	const branch = (ctx as { sessionManager?: { getBranch?: () => unknown } } | undefined)?.sessionManager?.getBranch?.();
	if (!Array.isArray(branch)) return null;

	for (const entry of branch as BranchEntry[]) {
		if (entry?.type !== "message") continue;
		const message = entry.message;
		if (message?.role === "user") return message;
	}

	return null;
}

function getContentArray(message: MinimalMessage): MinimalContent[] {
	return Array.isArray(message.content) ? message.content : [];
}

function extractSkillNames(text: string): string[] {
	return [...text.matchAll(/<skill\s+name="([^"]+)"[^>]*>/g)].map((match) => match[1]);
}

function cleanUserText(text: string): { skillNames: string[]; cleanText: string } {
	const skillNames = extractSkillNames(text);
	const cleanText = text
		.replace(/<skill\b[\s\S]*?<\/skill>\s*/g, "")
		.replace(/^\/skill:[^\n]+\n?/gm, "")
		.replace(/^\*\*Parent session:\*\*\s*`[^`]+`\s*/gm, "")
		.replace(/In the handoff note below, "I" refers to the previous assistant\.?/gi, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return { skillNames, cleanText };
}

function humanizeSlug(value: string): string {
	return value
		.replace(/%20/gi, " ")
		.replace(/%27/gi, "'")
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/^\d{4}-\d{2}-\d{2}-/, "")
		.replace(/[-_]+/g, " ")
		.trim();
}

function extractUrlClues(text: string): UrlClue[] {
	const urls = [...text.matchAll(/https?:\/\/[^\s)>"`]+/g)].map((match) => match[0]);
	return urls.flatMap((url) => {
		if (!URL.canParse(url)) return [];

		const parsed = new URL(url);
		return [
			{
				host: parsed.hostname.replace(/^www\./, ""),
				path: parsed.pathname,
				pathWords: parsed.pathname.split("/").filter(Boolean).map(humanizeSlug).filter(Boolean),
			},
		];
	});
}

function extractPathClues(text: string): PathClue[] {
	const paths = [...text.matchAll(/(?:docs\/(?:design|plans)\/[^\s`]+\.md|[\w./-]+\.(?:ts|tsx|rb|py|md))/g)].map(
		(match) => match[0],
	);
	return [...new Set(paths)].slice(0, 20).map((filePath) => ({
		path: filePath,
		words: humanizeSlug(path.basename(filePath)),
	}));
}

function extractCodeIdentifiers(text: string): string[] {
	const identifiers = [...text.matchAll(/\b[A-Za-z][A-Za-z0-9_]*(?:(?:::|\.|_)[A-Za-z][A-Za-z0-9_]*)+\b/g)].map(
		(match) => match[0],
	);
	return [...new Set(identifiers)].slice(0, 25);
}

function summarizeTools(messages: MinimalMessage[]): ToolSummary[] {
	const summaries: ToolSummary[] = [];
	const toolCallNames = new Map<string, string>();

	for (const message of messages) {
		if (message.role === "assistant") {
			for (const content of getContentArray(message)) {
				if (content.type !== "toolCall" || typeof content.name !== "string") continue;
				if (typeof content.id === "string") toolCallNames.set(content.id, content.name);
				summaries.push({ kind: "call", name: content.name, arguments: content.arguments });
			}
		}

		if (message.role === "toolResult") {
			const nameFromCallId = typeof message.toolCallId === "string" ? toolCallNames.get(message.toolCallId) : undefined;
			const name = nameFromCallId ?? message.toolName ?? "tool";
			summaries.push({ kind: "result", name, text: truncateMiddle(textOf(message), MAX_TOOL_RESULT_CHARS) });
		}
	}

	return summaries.slice(0, 12);
}

function buildNamingContext(userMessage: MinimalMessage, messages: MinimalMessage[], assistantResult: string): NamingContext {
	const { skillNames, cleanText } = cleanUserText(textOf(userMessage));
	const cleanUserGoal = truncateMiddle(cleanText, MAX_CLEAN_USER_CHARS);
	const combinedText = `${cleanText}\n${assistantResult}`;

	return {
		skillNames,
		cleanUserGoal,
		urlClues: extractUrlClues(cleanText),
		pathClues: extractPathClues(combinedText),
		codeIdentifiers: extractCodeIdentifiers(cleanText),
		assistantResult: truncateMiddle(assistantResult, MAX_ASSISTANT_RESULT_CHARS),
		toolSummaries: summarizeTools(messages),
	};
}

function renderNamingContext(context: NamingContext, rejectedTitle?: string): string {
	const rejected = rejectedTitle
		? `\n<rejected_title reason="too generic">${escapeXml(rejectedTitle)}</rejected_title>\n<retry_instruction>The previous title was too generic. Use the concrete subject from the context instead.</retry_instruction>`
		: "";

	return `<skill_names>${escapeXml(context.skillNames.join(", ") || "none")}</skill_names>
<clean_user_goal>${escapeXml(context.cleanUserGoal)}</clean_user_goal>
<url_clues>
${context.urlClues.map((clue) => `- host: ${escapeXml(clue.host)}; path: ${escapeXml(clue.path)}; words: ${escapeXml(clue.pathWords.join(" > "))}`).join("\n")}
</url_clues>
<path_clues>
${context.pathClues.map((clue) => `- ${escapeXml(clue.path)} (${escapeXml(clue.words)})`).join("\n")}
</path_clues>
<code_identifiers>${escapeXml(context.codeIdentifiers.join(", "))}</code_identifiers>
<assistant_result>${escapeXml(context.assistantResult)}</assistant_result>
<tool_summaries>
${context.toolSummaries.map(renderToolSummary).join("\n")}
</tool_summaries>${rejected}`;
}

function renderToolSummary(summary: ToolSummary): string {
	if (summary.kind === "call") {
		return `- call ${escapeXml(summary.name)} ${escapeXml(JSON.stringify(summary.arguments ?? {}))}`;
	}
	return `- result ${escapeXml(summary.name)} ${escapeXml(summary.text ?? "")}`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function normalizeTitle(title: string): string {
	return title
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```$/i, "")
		.replace(/^['"]|['"]$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function parseTitleResponse(responseText: string): ParsedTitle | null {
	const cleaned = normalizeTitle(responseText);
	if (!cleaned) return null;

	if (cleaned.startsWith("{")) return parseStructuredTitle(cleaned);

	return { title: cleaned.split("\n")[0].trim() };
}

function parseStructuredTitle(cleaned: string): ParsedTitle | null {
	const titleMatch = cleaned.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
	if (!titleMatch) return null;

	const title = normalizeTitle(titleMatch[1].replace(/\\"/g, '"'));
	if (!title) return null;

	const confidenceMatch = cleaned.match(/"confidence"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+)/);
	return {
		title,
		confidence: confidenceMatch ? Number(confidenceMatch[1]) : undefined,
	};
}

function titleKey(title: string): string {
	return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function skillLabel(skillName: string): string {
	return skillName.toLowerCase().replace(/[-_]+/g, " ").trim();
}

function isGenericTitle(title: string, skillNames: string[]): boolean {
	const key = titleKey(title);
	if (!key) return true;
	if (GENERIC_TITLES.has(key)) return true;
	if (GENERIC_TITLE_WORDS.has(key)) return true;

	const words = key.split(/\s+/);
	if (words.length <= 2 && words.some((word) => GENERIC_TITLE_WORDS.has(word))) return true;

	for (const skillName of skillNames) {
		const skill = skillLabel(skillName);
		if (!skill) continue;
		if (key === skill || key === `${skill} workflow` || key === `${skill} skill`) return true;
		if (key.startsWith(`${skill} `) && words.some((word) => word === "workflow" || word === "skill")) return true;
	}

	return false;
}

function shouldRetryTitle(parsed: ParsedTitle, skillNames: string[]): boolean {
	return isGenericTitle(parsed.title, skillNames) || (parsed.confidence !== undefined && parsed.confidence < 0.6);
}

async function generateTitle(params: {
	completeFn: typeof complete;
	model: Parameters<typeof complete>[0];
	auth: { apiKey: string; headers?: Record<string, string> };
	context: NamingContext;
}): Promise<string | null> {
	let rejectedTitle: string | undefined;

	for (let attempt = 0; attempt < MAX_TITLE_ATTEMPTS; attempt++) {
		const prompt: Message = {
			role: "user",
			content: [{ type: "text", text: renderNamingContext(params.context, rejectedTitle) }],
			timestamp: Date.now(),
		};

		const response = await params.completeFn(
			params.model,
			{ systemPrompt: AUTO_NAME_SYSTEM_PROMPT, messages: [prompt] },
			{ apiKey: params.auth.apiKey, headers: params.auth.headers, maxTokens: 120 },
		);
		if (response.stopReason === "error" || response.errorMessage) return null;

		const parsed = parseTitleResponse(textOf(response));
		if (!parsed) return null;
		if (!shouldRetryTitle(parsed, params.context.skillNames)) return parsed.title;

		rejectedTitle = parsed.title;
	}

	return null;
}

export function createAutoNameExtension(deps: {
	completeFn?: typeof complete;
} = {}) {
	const completeFn = deps.completeFn ?? complete;

	return function autoNameSession(pi: ExtensionAPI) {
		pi.on("agent_end", async (event, ctx) => {
			const existingName = pi.getSessionName();
			if (existingName || !ctx.model) return;

			const messages = event.messages as MinimalMessage[];
			const finalAssistant = [...messages].reverse().find((m) => m.role === "assistant");
			if (finalAssistant?.stopReason !== "stop") return;

			const firstSessionUser = firstUserMessageFromBranch(ctx);
			const firstTurnUser = messages.find((m) => m.role === "user");
			const userMessage = firstSessionUser ?? firstTurnUser;
			if (!userMessage || !textOf(userMessage)) return;

			const model = ctx.modelRegistry.find(AUTO_NAME_PROVIDER, AUTO_NAME_MODEL);
			if (!model) return;

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey) return;

			try {
				const namingContext = buildNamingContext(userMessage, messages, textOf(finalAssistant));
				if (!namingContext.cleanUserGoal && !namingContext.assistantResult) return;

				const name = await generateTitle({
					completeFn,
					model,
					auth: { apiKey: auth.apiKey, headers: auth.headers },
					context: namingContext,
				});
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
