import { Markdown, type MarkdownTheme } from "@mariozechner/pi-tui";

const SHELL_PROMPT_PATTERN = /\s\$\s+[A-Za-z0-9_./-]+/u;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/gu;

export const plainMarkdownTheme: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: () => "",
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: () => "",
	quote: (text) => text,
	quoteBorder: () => "",
	hr: () => "",
	listBullet: () => "",
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};

export const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
	Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part);

export const extractLastAssistantText = (messages: Array<{ role?: string; content?: unknown }>): string | null => {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") {
			continue;
		}

		const content = message.content;
		if (typeof content === "string") {
			return content.trim() || null;
		}

		if (Array.isArray(content)) {
			const text = content.filter(isTextPart).map((part) => part.text).join("\n").trim();
			return text || null;
		}

		return null;
	}

	return null;
};

export const simpleMarkdown = (text: string, width = 80): string => {
	const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
	return markdown.render(width).join("\n");
};

const stripTrailingShellCommand = (text: string): string => {
	const match = text.match(SHELL_PROMPT_PATTERN);
	if (!match || match.index === undefined) {
		return text;
	}

	return text.slice(0, match.index).trim();
};

export const formatNotification = (text: string | null): { title: string; body: string } => {
	const simplified = text ? simpleMarkdown(text) : "";
	const normalized = simplified.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return { title: "Ready for input", body: "" };
	}

	const withoutCommand = stripTrailingShellCommand(normalized);
	const summary = withoutCommand || normalized;
	const maxBody = 200;
	const body = summary.length > maxBody ? `${summary.slice(0, maxBody - 1)}…` : summary;
	return { title: "π", body };
};

export const sanitizeOscField = (text: string): string =>
	text
		.replace(/;/g, ",")
		.replace(CONTROL_CHARS_PATTERN, " ")
		.replace(/\s+/g, " ")
		.trim();

export const toOsc777Sequence = (title: string, body: string): string =>
	`\x1b]777;notify;${sanitizeOscField(title)};${sanitizeOscField(body)}\x07`;

export const toTerminalNotificationSequence = (
	title: string,
	body: string,
	environment: NodeJS.ProcessEnv = process.env,
): string => {
	const sequence = toOsc777Sequence(title, body);
	if (!environment.TMUX) {
		return sequence;
	}

	const escaped = sequence.replaceAll("\x1b", "\x1b\x1b");
	return `\x1bPtmux;\x1b${escaped}\x1b\\`;
};
