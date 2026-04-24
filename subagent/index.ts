/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type ExtensionAPI, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { createAsyncOwner } from "./async-owner.js";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.js";
import { getSavedScopedModelIds, resolveModelOverride } from "./model-selection.js";
import { parseSubagentRequest, projectAgentsForConfirmation } from "./request.js";
import { createAsyncRunWatcher, createAsyncRuntimeDeps, runSubagentRequest } from "./runtime.js";
import { closePane, closeWindow } from "./tmux.js";
import {
	COLLAPSED_ITEM_COUNT,
	getFinalOutput,
	type AsyncBatch,
	type AsyncRun,
	type SingleResult,
	type SubagentDetails,
} from "./types.js";
import { updateWidget, startWidgetRefresh, stopWidgetRefresh } from "./widget.js";

const BUNDLED_AGENTS_DIR = path.join(import.meta.dirname, "agents");

function readSessionLines(sessionFile: string): string[] {
	try {
		return fs.readFileSync(sessionFile, "utf8").split("\n").filter((line) => line.trim());
	} catch {
		return [];
	}
}

function parseSessionLine(line: string): unknown {
	try {
		return JSON.parse(line) as unknown;
	} catch {
		return null;
	}
}

function assistantTextFromSessionEntry(entry: unknown): string | null {
	if (!entry || typeof entry !== "object") return null;
	const typedEntry = entry as { type?: unknown; message?: unknown };
	if (typedEntry.type !== "message" || !typedEntry.message || typeof typedEntry.message !== "object") return null;

	const message = typedEntry.message as { role?: unknown; content?: unknown };
	if (message.role !== "assistant" || !Array.isArray(message.content)) return null;

	for (const part of message.content) {
		if (part && typeof part === "object") {
			const typedPart = part as { type?: unknown; text?: unknown };
			if (typedPart.type === "text" && typeof typedPart.text === "string") return typedPart.text;
		}
	}
	return null;
}

function readLastAssistantMessage(sessionFile: string): string {
	const lines = readSessionLines(sessionFile);
	for (let i = lines.length - 1; i >= 0; i--) {
		const text = assistantTextFromSessionEntry(parseSessionLine(lines[i]));
		if (text !== null) return text;
	}
	return "(no output)";
}

function resolveSkillPath(skillName: string, cwd: string): string | null {
	const candidates = [
		path.join(cwd, ".pi", "skills", skillName, "SKILL.md"),
		path.join(os.homedir(), ".pi", "agent", "skills", skillName, "SKILL.md"),
	];
	for (const p of candidates) {
		if (fs.existsSync(p)) return p;
	}
	return null;
}
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: string, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	thinking: Type.Optional(Type.String({
		description: "Override thinking level: off, minimal, low, medium, high, xhigh",
	})),
	model: Type.Optional(Type.String({
		description: "Override the agent frontmatter model. Must match one of the saved scoped models (enabledModels) in provider/model-id format, e.g. anthropic/claude-sonnet-4-6.",
	})),
	async: Type.Optional(Type.Boolean({
		description: "Run in background. Returns immediately, result steers back on completion. Requires tmux. Not supported for chains.",
		default: false,
	})),
});

export default function (pi: ExtensionAPI) {
	// Async run tracking
	const asyncRuns = new Map<string, AsyncRun>();
	const asyncBatches = new Map<string, AsyncBatch>();
	let latestCtx: ExtensionContext | null = null;
	const runWatcher = createAsyncRunWatcher({
		asyncRuns,
		asyncBatches,
		latestCtx: () => latestCtx,
		pi,
		updateWidget,
		readLastAssistantMessage,
	});
	const asyncOwner = createAsyncOwner({ runWatcher });

	pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
		latestCtx = ctx;
	});

	pi.on("session_shutdown", async () => {
		await asyncOwner.shutdown();
		for (const batch of asyncBatches.values()) {
			closeWindow(batch.windowId);
		}
		for (const run of asyncRuns.values()) {
			closePane(run.pane);
		}
		stopWidgetRefresh();
		asyncRuns.clear();
		asyncBatches.clear();
		latestCtx = null;
	});

	// Shared agent registry — other extensions push agents here via subagent:register.
	// We also emit subagent:discover at execute time so late-loading extensions can respond.
	const externalAgents: AgentConfig[] = [];

	pi.events.on("subagent:register", (agents: AgentConfig[]) => {
		for (const agent of agents) {
			const idx = externalAgents.findIndex((a) => a.name === agent.name);
			if (idx >= 0) externalAgents[idx] = agent;
			else externalAgents.push(agent);
		}
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			"Optional model parameter overrides the agent frontmatter model and is validated against saved scoped models from settings (enabledModels).",
			'Default agent scope is "user" (from ~/.pi/agent/agents).',
			'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
			"",
			"WHEN TO USE: Subagents are worth the overhead for tasks that require independent reasoning, analysis, or multi-step work (code review, planning, research, implementation).",
			"WHEN NOT TO USE: Do NOT use subagents just to read files in parallel. Reading files is fast and cheap — use the read tool directly. Spawning a subagent process for simple reads wastes time and tokens.",
			"",
			"ASYNC MODE: Pass async: true to run in tmux. Single async tasks open a temporary split beside the current pi pane. Parallel async tasks open a dedicated tmux window with one pane per task. Results steer back when done. Requires tmux. Not supported for chains.",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			// Give late-loading extensions a chance to register agents
			pi.events.emit("subagent:discover", {});
			const discovery = discoverAgents(ctx.cwd, agentScope, BUNDLED_AGENTS_DIR);
			// Merge external agents (lowest priority — discovered agents override)
			const agentMap = new Map<string, AgentConfig>();
			for (const agent of externalAgents) agentMap.set(agent.name, agent);
			for (const agent of discovery.agents) agentMap.set(agent.name, agent);
			const agents = Array.from(agentMap.values());
			const confirmProjectAgents = params.confirmProjectAgents ?? true;
			const scopedModelIds = getSavedScopedModelIds(ctx.cwd);
			const { model: selectedModel, error: modelError } = resolveModelOverride(
				scopedModelIds,
				params.model,
				undefined,
			);

			if (modelError) {
				return {
					content: [{ type: "text", text: modelError }],
					details: {
						mode: "single",
						agentScope,
						projectAgentsDir: discovery.projectAgentsDir,
						results: [],
					},
					isError: true,
				};
			}

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});

			const modeFromRequest = (type: string): "single" | "parallel" | "chain" => {
				if (type === "chain") return "chain";
				if (type === "parallel" || type === "asyncParallel") return "parallel";
				return "single";
			};

			let request: Parameters<typeof projectAgentsForConfirmation>[0];
			try {
				request = await Effect.runPromise(
					parseSubagentRequest({
						params,
						agents,
						defaultCwd: ctx.cwd,
						agentScope,
						projectAgentsDir: discovery.projectAgentsDir,
						selectedModel,
					}),
				);
			} catch (error) {
				const text =
					error &&
					typeof error === "object" &&
					"message" in error &&
					typeof (error as { message?: unknown }).message === "string"
						? (error as { message: string }).message
						: String(error);
				return {
					content: [{ type: "text", text }],
					details: makeDetails("single")([]),
				};
			}

			const requestMode = modeFromRequest(request.type);

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
				const projectAgentsRequested = projectAgentsForConfirmation(request);
				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}
Source: ${dir}

Project agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok) {
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(requestMode)([]),
						};
					}
				}
			}

			const asyncRuntimeDeps = createAsyncRuntimeDeps({
				asyncRuns,
				asyncBatches,
				asyncOwner,
				latestCtx: () => latestCtx,
				pi,
				updateWidget,
				startWidgetRefresh,
				readLastAssistantMessage,
				resolveSkillPath,
			});

			try {
				const output = await Effect.runPromise(
					runSubagentRequest(request, {
						...asyncRuntimeDeps,
						onUpdate,
						makeDetails,
						resolveSkillPath,
					}),
					{ signal },
				);

				return {
					content: [{ type: "text", text: output.contentText }],
					details: makeDetails(output.mode)(output.results),
					isError: output.isError,
				};
			} catch (error) {
				const text =
					error &&
					typeof error === "object" &&
					"message" in error &&
					typeof (error as { message?: unknown }).message === "string"
						? (error as { message: string }).message
						: String(error);
				return {
					content: [{ type: "text", text }],
					details: makeDetails(requestMode)([]),
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const failCount = details.results.filter((r) => r.exitCode > 0).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: r.exitCode === 0
								? theme.fg("success", "✓")
								: theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});

	type AsyncResultMessage = {
		content?: unknown;
		details?: { agent?: unknown; exitCode?: unknown };
	};
	type MessageTheme = {
		fg(color: string, text: string): string;
		bold(text: string): string;
	};

	pi.registerMessageRenderer("subagent_result", (message: AsyncResultMessage, _options: unknown, theme: MessageTheme) => {
		const details = message.details;
		if (!details) return undefined;
		const agent = typeof details.agent === "string" ? details.agent : "subagent";
		const exitCode = typeof details.exitCode === "number" ? details.exitCode : 1;
		const icon = exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const status = exitCode === 0 ? "completed" : `failed (exit ${exitCode})`;
		const header = `${icon} ${theme.fg("toolTitle", theme.bold(agent))} — ${status}`;
		const content = typeof message.content === "string" ? message.content : "";
		const body = content.replace(/^Async subagent "[^"]*" [^\n]*\n\n/, "");
		const preview = body.length > 200 ? body.slice(0, 200) + "…" : body;
		const lines = [header, "", ...preview.split("\n")];
		return new Text(lines.join("\n"), 0, 0);
	});
}
