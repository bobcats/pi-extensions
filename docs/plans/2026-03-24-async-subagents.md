# Async Subagents Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Add async tmux-pane execution, a status widget, and new frontmatter fields (`thinking`, `spawning`, `skills`, `cwd`) to the subagent extension.

**Architecture:** Sync mode stays unchanged. Async mode spawns `pi` into a tmux split pane, returns immediately, and a background watcher delivers results via `sendMessage` steer-back. A persistent widget tracks running async agents. Widget code copied from HazAT's pi-interactive-subagents.

**Tech Stack:** Node.js child_process (execFileSync/spawn), tmux CLI, pi extension API (`setWidget`, `sendMessage`, `on("session_start")`).

**Reference code:** `/tmp/pi-interactive-subagents/pi-extension/subagents/index.ts` (HazAT's widget + launch logic)

---

### Task 1: Parse New Frontmatter Fields

**Files:**
- Modify: `subagent/agents.ts:11-23` (AgentConfig interface)
- Modify: `subagent/agents.ts:26-80` (loadAgentsFromDir)
- Test: `subagent/agents.test.ts` (new)

- [x] **Step 1: Add fields to AgentConfig interface**

In `subagent/agents.ts`, add four fields to `AgentConfig`:

```typescript
export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "bundled" | "user" | "project";
	filePath: string;
	// new
	thinking?: string;
	spawning?: boolean;
	skills?: string[];
	cwd?: string;
}
```

- [x] **Step 2: Write tests for frontmatter parsing** (moved to parse-agent.ts for testability)

Create `subagent/agents.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverAgents } from "./agents.ts";

function createTmpAgentDir(agents: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-test-"));
	for (const [name, content] of Object.entries(agents)) {
		fs.writeFileSync(path.join(dir, `${name}.md`), content);
	}
	return dir;
}

describe("frontmatter parsing", () => {
	it("parses thinking field", () => {
		const dir = createTmpAgentDir({
			scout: "---\nname: scout\ndescription: test\nthinking: high\n---\nPrompt",
		});
		const { agents } = discoverAgents("/tmp", "user", dir);
		assert.equal(agents[0].thinking, "high");
	});

	it("parses spawning: false", () => {
		const dir = createTmpAgentDir({
			worker: "---\nname: worker\ndescription: test\nspawning: false\n---\nPrompt",
		});
		const { agents } = discoverAgents("/tmp", "user", dir);
		assert.equal(agents[0].spawning, false);
	});

	it("spawning defaults to undefined (truthy)", () => {
		const dir = createTmpAgentDir({
			scout: "---\nname: scout\ndescription: test\n---\nPrompt",
		});
		const { agents } = discoverAgents("/tmp", "user", dir);
		assert.equal(agents[0].spawning, undefined);
	});

	it("parses skills as comma-separated list", () => {
		const dir = createTmpAgentDir({
			scout: "---\nname: scout\ndescription: test\nskills: brave-search, tmux\n---\nPrompt",
		});
		const { agents } = discoverAgents("/tmp", "user", dir);
		assert.deepEqual(agents[0].skills, ["brave-search", "tmux"]);
	});

	it("parses cwd field", () => {
		const dir = createTmpAgentDir({
			worker: "---\nname: worker\ndescription: test\ncwd: ./src\n---\nPrompt",
		});
		const { agents } = discoverAgents("/tmp", "user", dir);
		assert.equal(agents[0].cwd, "./src");
	});
});
```

- [x] **Step 3: Run tests to verify they fail** (passed immediately — extracted to parse-agent.ts)

Run: `node --test subagent/agents.test.ts`
Expected: FAIL — AgentConfig doesn't have the new fields being parsed yet.

- [x] **Step 4: Parse new fields in loadAgentsFromDir** (done in parse-agent.ts)

In `subagent/agents.ts`, inside the `for (const entry of entries)` loop in `loadAgentsFromDir`, after `tools` parsing, add:

```typescript
const thinking = frontmatter.thinking?.trim();

const spawningRaw = frontmatter.spawning?.trim();
const spawning = spawningRaw === "false" ? false : spawningRaw === "true" ? true : undefined;

const skills = frontmatter.skills
	?.split(",")
	.map((s: string) => s.trim())
	.filter(Boolean);

const cwd = frontmatter.cwd?.trim();
```

Add them to the `agents.push(...)` call:

```typescript
agents.push({
	name: frontmatter.name,
	description: frontmatter.description,
	tools: tools && tools.length > 0 ? tools : undefined,
	model: frontmatter.model,
	thinking,
	spawning,
	skills: skills && skills.length > 0 ? skills : undefined,
	cwd,
	systemPrompt: body,
	source,
	filePath,
});
```

- [x] **Step 5: Run tests to verify they pass**

Run: `node --test subagent/agents.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

---

### Task 2: Wire New Frontmatter Fields into Spawn Args

**Files:**
- Modify: `subagent/index.ts:248-285` (runSingleAgent, arg building section)
- Modify: `subagent/index.ts:398-420` (SubagentParams, add `thinking` param)

- [x] **Step 1: Add `thinking` and `async` to tool parameters**

In `subagent/index.ts`, add to `SubagentParams`:

```typescript
thinking: Type.Optional(Type.String({
	description: "Override thinking level: off, minimal, low, medium, high, xhigh",
})),
```

- [x] **Step 2: Pass `thinking` parameter through to runSingleAgent**

`runSingleAgent` needs access to the thinking override. Add a `thinking` field to an options bag or pass it directly. Simplest: add `thinking?: string` parameter after `cwd`.

Update the function signature:

```typescript
async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	thinking: string | undefined,
	step: number | undefined,
	// ... rest unchanged
```

Update all call sites (3 places: single, parallel, chain) to pass `params.thinking` or `undefined`.

- [x] **Step 3: Build args from new fields in runSingleAgent**

In `runSingleAgent`, after the existing `args.push("--model", ...)` and `args.push("--tools", ...)` lines (~line 250), add:

```typescript
// Thinking: tool param → agent frontmatter → none
const effectiveThinking = thinking ?? agent.thinking;
if (effectiveThinking) {
	args.push("--thinking", effectiveThinking);
}

// Skills: resolve skill names to paths, pass --skill for each
if (agent.skills && agent.skills.length > 0) {
	for (const skillName of agent.skills) {
		const skillPath = resolveSkillPath(skillName, defaultCwd);
		if (skillPath) args.push("--skill", skillPath);
	}
}

// Spawning: exclude our extension from child process
if (agent.spawning === false) {
	args.push("--no-extensions");
	// Note: other extensions won't load either. This is the simplest
	// correct behavior — the child gets built-in tools only.
}
```

- [x] **Step 4: Add resolveSkillPath helper**

Add near the top of `subagent/index.ts`:

```typescript
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
```

- [x] **Step 5: Update cwd resolution**

In `runSingleAgent`, replace the existing `cwd ?? defaultCwd` in the `spawn()` call with:

```typescript
// Cwd: tool param → agent frontmatter → parent session cwd
const effectiveCwd = cwd ?? agent.cwd ?? defaultCwd;
```

If `agent.cwd` is relative, resolve it against `defaultCwd`:

```typescript
let effectiveCwd = cwd ?? agent.cwd ?? defaultCwd;
if (agent.cwd && !cwd && !path.isAbsolute(agent.cwd)) {
	effectiveCwd = path.resolve(defaultCwd, agent.cwd);
}
```

Use `effectiveCwd` in the `spawn("pi", args, { cwd: effectiveCwd, ... })` call.

- [x] **Step 6: Verify sync mode still works** (syntax check + tests pass, manual verify deferred)

Start pi with the extension loaded. Run a sync subagent call manually to confirm nothing broke. Verify thinking/skills/cwd args appear in the spawned command.

- [x] **Step 7: Commit**

```bash
git add subagent/index.ts
git commit -m "feat(subagent): wire thinking, skills, spawning, cwd into spawn args"
```

---

### Task 3: Tmux Utilities

**Files:**
- Create: `subagent/tmux.ts`

- [x] **Step 1: Create tmux.ts with core functions**

Create `subagent/tmux.ts`. Adapted from HazAT's `cmux.ts` but tmux-only (no cmux/zellij):

```typescript
import { execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export function isTmuxAvailable(): boolean {
	return !!process.env.TMUX;
}

export function shellEscape(s: string): string {
	return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Create a horizontal split pane without stealing focus.
 * Returns the pane ID (e.g. "%12").
 */
export function createPane(name: string): string {
	const pane = execFileSync("tmux", ["split-window", "-h", "-d", "-P", "-F", "#{pane_id}"], {
		encoding: "utf8",
	}).trim();
	try {
		execFileSync("tmux", ["select-pane", "-t", pane, "-T", name]);
	} catch {}
	return pane;
}

/**
 * Send a command to a pane and press Enter.
 */
export function sendCommand(pane: string, command: string): void {
	execFileSync("tmux", ["send-keys", "-t", pane, "-l", command]);
	execFileSync("tmux", ["send-keys", "-t", pane, "Enter"]);
}

/**
 * Close a pane.
 */
export function closePane(pane: string): void {
	try {
		execFileSync("tmux", ["kill-pane", "-t", pane]);
	} catch {}
}

/**
 * Read the last N lines from a pane's screen buffer.
 */
export async function readScreen(pane: string, lines = 5): Promise<string> {
	const { stdout } = await execFileAsync("tmux", [
		"capture-pane", "-p", "-t", pane, "-S", `-${Math.max(1, lines)}`,
	], { encoding: "utf8" });
	return stdout;
}

/**
 * Poll a pane until the sentinel __SUBAGENT_DONE_N__ appears.
 * Returns the exit code embedded in the sentinel.
 */
export async function pollForExit(
	pane: string,
	signal: AbortSignal,
	opts: { interval: number; onTick?: () => void },
): Promise<number> {
	while (true) {
		if (signal.aborted) throw new Error("Aborted");

		const screen = await readScreen(pane, 5);
		const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
		if (match) return parseInt(match[1], 10);

		opts.onTick?.();

		await new Promise<void>((resolve, reject) => {
			if (signal.aborted) return reject(new Error("Aborted"));
			const timer = setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			}, opts.interval);
			function onAbort() {
				clearTimeout(timer);
				reject(new Error("Aborted"));
			}
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}
}
```

- [x] **Step 2: Commit**

```bash
git add subagent/tmux.ts
git commit -m "feat(subagent): add tmux pane utilities"
```

---

### Task 4: Status Widget

**Files:**
- Create: `subagent/widget.ts`

- [x] **Step 1: Create widget.ts**

Copy the widget rendering logic from HazAT's `index.ts` (the `borderTop`, `borderLine`, `borderBottom`, `updateWidget`, `startWidgetRefresh`, `formatElapsedMMSS` functions — lines ~180-260 in `/tmp/pi-interactive-subagents/pi-extension/subagents/index.ts`). Adapt to export functions that accept a runs map and `ExtensionContext`:

```typescript
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export interface AsyncRun {
	id: string;
	agent: string;
	task: string;
	startedAt: number;
	pane: string;
	sessionFile: string;
	tempFiles: string[];
}

// Copy HazAT's ACCENT, RST constants, borderTop, borderLine, borderBottom,
// formatElapsedMMSS from /tmp/pi-interactive-subagents/pi-extension/subagents/index.ts
// lines ~188-230. Adapt variable names to use AsyncRun.

let widgetInterval: ReturnType<typeof setInterval> | null = null;

export function updateWidget(
	ctx: ExtensionContext | null,
	runs: Map<string, AsyncRun>,
): void {
	if (!ctx?.hasUI) return;

	if (runs.size === 0) {
		ctx.ui.setWidget("subagent-status", undefined);
		if (widgetInterval) {
			clearInterval(widgetInterval);
			widgetInterval = null;
		}
		return;
	}

	// Copy HazAT's setWidget factory pattern from lines ~232-260
	// Adapt: use runs map, AsyncRun fields (agent, task, startedAt)
	ctx.ui.setWidget(
		"subagent-status",
		(_tui, _theme) => {
			return {
				invalidate() {},
				render(width: number) {
					// Copy HazAT's render() body, adapted for our AsyncRun shape
					// ...
				},
			};
		},
		{ placement: "aboveEditor" },
	);
}

export function startWidgetRefresh(
	ctx: ExtensionContext | null,
	runs: Map<string, AsyncRun>,
): void {
	if (widgetInterval) return;
	updateWidget(ctx, runs);
	widgetInterval = setInterval(() => {
		if (runs.size > 0) updateWidget(ctx, runs);
	}, 1000);
}

export function stopWidgetRefresh(): void {
	if (widgetInterval) {
		clearInterval(widgetInterval);
		widgetInterval = null;
	}
}
```

The key is: copy HazAT's exact border rendering (`borderTop`, `borderLine`, `borderBottom`) and `setWidget` factory pattern. Don't rewrite — adapt minimally.

- [x] **Step 2: Commit**

```bash
git add subagent/widget.ts
git commit -m "feat(subagent): add status widget for async runs (adapted from HazAT)"
```

---

### Task 5: Async Execution Path

**Files:**
- Modify: `subagent/index.ts` (add `async` param, async launch function, watcher, session_start/shutdown hooks)

- [x] **Step 1: Add `async` to SubagentParams** (done in Task 2)

```typescript
async: Type.Optional(Type.Boolean({
	description: "Run in background. Returns immediately, result steers back on completion.",
	default: false,
})),
```

- [x] **Step 2: Add session lifecycle hooks and watcher state**

At the top of the `export default function (pi: ExtensionAPI)` body, add:

```typescript
import { isTmuxAvailable, createPane, sendCommand, closePane, pollForExit, shellEscape } from "./tmux.ts";
import { type AsyncRun, updateWidget, startWidgetRefresh, stopWidgetRefresh } from "./widget.ts";

// ... inside export default:
const asyncRuns = new Map<string, AsyncRun>();
let latestCtx: ExtensionContext | null = null;

pi.on("session_start", (_event, ctx) => {
	latestCtx = ctx;
});

pi.on("session_shutdown", () => {
	// Kill orphan panes before clearing
	for (const run of asyncRuns.values()) {
		try { closePane(run.pane); } catch {}
	}
	stopWidgetRefresh();
	asyncRuns.clear();
	latestCtx = null;
});
```

- [x] **Step 3: Add readLastAssistantMessage helper**

Add near the top of `index.ts`:

```typescript
function readLastAssistantMessage(sessionFile: string): string {
	try {
		const raw = fs.readFileSync(sessionFile, "utf8");
		const lines = raw.split("\n").filter((l) => l.trim());
		for (let i = lines.length - 1; i >= 0; i--) {
			try {
				const entry = JSON.parse(lines[i]);
				if (entry.type === "message" && entry.message?.role === "assistant") {
					for (const part of entry.message.content) {
						if (part.type === "text") return part.text;
					}
				}
			} catch {}
		}
	} catch {}
	return "(no output)";
}
```

- [x] **Step 4: Add runAsyncAgent function**

Add a new function in `index.ts`. This is the async counterpart to `runSingleAgent`. Key differences from sync: no `--mode json`, no `-p`, uses `--session <file>` for result extraction, spawns into a tmux pane.

```typescript
function runAsyncAgent(
	pi: ExtensionAPI,
	defaultCwd: string,
	agent: AgentConfig,
	task: string,
	cwd: string | undefined,
	thinking: string | undefined,
): { runId: string } {
	const runId = crypto.randomUUID().slice(0, 8);
	const sessionFile = path.join(os.tmpdir(), `pi-subagent-${runId}.jsonl`);

	// Build pi args — interactive mode (no --mode json, no -p)
	const args: string[] = ["--session", sessionFile];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	const effectiveThinking = thinking ?? agent.thinking;
	if (effectiveThinking) args.push("--thinking", effectiveThinking);

	if (agent.skills && agent.skills.length > 0) {
		for (const skillName of agent.skills) {
			const skillPath = resolveSkillPath(skillName, defaultCwd);
			if (skillPath) args.push("--skill", skillPath);
		}
	}

	if (agent.spawning === false) {
		args.push("--no-extensions");
	}

	// Track temp files for cleanup
	const tempFiles: string[] = [sessionFile];

	if (agent.systemPrompt.trim()) {
		const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
		args.push("--append-system-prompt", tmp.filePath);
		tempFiles.push(tmp.filePath);
		if (tmp.dir) tempFiles.push(tmp.dir);
	}

	args.push(`Task: ${task}`);

	let effectiveCwd = cwd ?? agent.cwd ?? defaultCwd;
	if (agent.cwd && !cwd && !path.isAbsolute(agent.cwd)) {
		effectiveCwd = path.resolve(defaultCwd, agent.cwd);
	}

	// Create tmux pane (doesn't steal focus) and send command
	const pane = createPane(`${agent.name}: ${task.slice(0, 30)}`);
	const piCmd = `cd ${shellEscape(effectiveCwd)} && pi ${args.map(shellEscape).join(" ")}; echo '__SUBAGENT_DONE_'$?'__'`;
	sendCommand(pane, piCmd);

	// Register run (include sessionFile and tempFiles for cleanup)
	const run: AsyncRun & { sessionFile: string; tempFiles: string[] } = {
		id: runId,
		agent: agent.name,
		task,
		startedAt: Date.now(),
		pane,
		sessionFile,
		tempFiles,
	};
	asyncRuns.set(runId, run);
	startWidgetRefresh(latestCtx, asyncRuns);

	// Cleanup helper
	const cleanup = () => {
		for (const f of tempFiles) {
			try { fs.unlinkSync(f); } catch {}
		}
	};

	// Fire-and-forget watcher
	const watcherAbort = new AbortController();
	pollForExit(pane, watcherAbort.signal, {
		interval: 1000,
		onTick: () => updateWidget(latestCtx, asyncRuns),
	})
		.then((exitCode) => {
			// Extract result from session file
			const summary = readLastAssistantMessage(sessionFile);

			asyncRuns.delete(runId);
			updateWidget(latestCtx, asyncRuns);
			closePane(pane);
			cleanup();

			const status = exitCode === 0 ? "completed" : `failed (exit ${exitCode})`;
			pi.sendMessage(
				{
					customType: "subagent_result",
					content: `Async subagent "${agent.name}" ${status} (run: ${runId}).\n\n${summary}`,
					display: true,
					details: { runId, agent: agent.name, task, exitCode },
				},
				{ triggerTurn: true, deliverAs: "steer" },
			);

			pi.events.emit("notify", {
				title: `Subagent done: ${agent.name}`,
				body: exitCode === 0 ? "Completed" : "Failed",
			});
		})
		.catch(() => {
			asyncRuns.delete(runId);
			updateWidget(latestCtx, asyncRuns);
			try { closePane(pane); } catch {}
			cleanup();
		});

	return { runId };
}
```

- [x] **Step 5: Branch on `async` in execute()**

In the `execute()` method, after mode validation and before the existing mode handlers, add an async guard:

```typescript
// Async mode
if (params.async) {
	if (!isTmuxAvailable()) {
		return {
			content: [{ type: "text", text: "async: true requires tmux. Start pi inside a tmux session." }],
			details: makeDetails("single")([]),
		};
	}

	if (hasChain) {
		return {
			content: [{ type: "text", text: "async: true is not supported for chains (steps depend on {previous})." }],
			details: makeDetails("chain")([]),
		};
	}

	if (hasSingle && params.agent && params.task) {
		const agent = agents.find((a) => a.name === params.agent);
		if (!agent) {
			return {
				content: [{ type: "text", text: `Unknown agent: "${params.agent}"` }],
				details: makeDetails("single")([]),
			};
		}
		const { runId } = runAsyncAgent(pi, ctx.cwd, agent, params.task, params.cwd, params.thinking);
		return {
			content: [{ type: "text", text: `Started async subagent "${params.agent}" (run: ${runId})` }],
			details: makeDetails("single")([]),
		};
	}

	if (hasTasks && params.tasks) {
		const runIds: string[] = [];
		for (const t of params.tasks) {
			const agent = agents.find((a) => a.name === t.agent);
			if (!agent) continue;
			const { runId } = runAsyncAgent(pi, ctx.cwd, agent, t.task, t.cwd, params.thinking);
			runIds.push(runId);
		}
		return {
			content: [{ type: "text", text: `Started ${runIds.length} async subagents` }],
			details: makeDetails("parallel")([]),
		};
	}
}
```

- [x] **Step 6: Add a message renderer for async results**

After the `registerTool` call, add:

```typescript
pi.registerMessageRenderer?.("subagent_result", (message, options, theme) => {
	const details = message.details as any;
	if (!details) return undefined;
	return {
		render(width: number) {
			const icon = details.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
			const status = details.exitCode === 0 ? "completed" : `failed (exit ${details.exitCode})`;
			const header = `${icon} ${theme.fg("toolTitle", theme.bold(details.agent))} — ${status}`;
			const taskPreview = details.task.length > 60 ? details.task.slice(0, 60) + "..." : details.task;
			return [header, theme.fg("dim", taskPreview)];
		},
	};
});
```

Check if `registerMessageRenderer` exists on the API first — if not, skip this step (the raw text content will still show).

- [x] **Step 7: Verify async mode end-to-end** (tests pass, full e2e deferred to manual)

Start pi inside tmux. Run a sync subagent call — confirm it still works. Then trigger an async call (the LLM needs to pass `async: true`). Verify:
- Tmux pane opens with pi running
- Tool returns immediately
- Widget shows the running agent
- On completion, pane closes, widget updates, steer-back message arrives

- [ ] **Step 8: Commit**

```bash
git add subagent/index.ts
git commit -m "feat(subagent): add async execution with tmux panes, widget, and steer-back"
```

---

### Task 6: Update Tool Description and Prompt Guidelines

**Files:**
- Modify: `subagent/index.ts` (tool description, promptGuidelines)

- [ ] **Step 1: Update the tool description**

Update the `description` array in `registerTool` to mention async mode:

Add after the existing WHEN NOT TO USE line:
```
"ASYNC MODE: Pass async: true to run in a background tmux pane. The tool returns immediately and the result steers back when done. Requires tmux. Not supported for chains."
```

- [x] **Step 2: Commit**

```bash
git add subagent/index.ts
git commit -m "docs(subagent): update tool description for async mode and new params"
```

---

### Task 7: Update Bundled Agent Frontmatter

**Files:**
- Modify: `subagent/agents/scout.md`
- Modify: `subagent/agents/worker.md`
- Modify: `subagent/agents/reviewer.md`
- Modify: `subagent/agents/planner.md`
- Modify: `subagent/agents/librarian.md`
- Modify: `subagent/agents/oracle.md`

- [ ] **Step 1: Add thinking and spawning to bundled agents**

Add appropriate defaults:

| Agent | `thinking` | `spawning` |
|-------|-----------|-----------|
| scout | (none — haiku, keep cheap) | `false` |
| planner | (none — let model decide) | `false` |
| worker | (none) | `false` |
| reviewer | (none) | `false` |
| librarian | (none) | `false` |
| oracle | `medium` | `false` |

All bundled agents get `spawning: false` — none should delegate further.

For example, `scout.md`:
```yaml
---
name: scout
description: Fast codebase recon that returns compressed context for handoff to other agents
tools: read, grep, find, ls, bash
model: claude-haiku-4-5
spawning: false
---
```

And `oracle.md`:
```yaml
---
name: oracle
description: Expert technical advisor for architecture decisions, code analysis, and engineering guidance. Read-only, pragmatic minimalism.
tools: read, grep, find, ls, bash
model: anthropic/claude-opus-4-6
thinking: medium
spawning: false
---
```

- [ ] **Step 2: Add skills to librarian**

The librarian agent currently hardcodes brave-search usage in its system prompt body. Add `skills: brave-search` to its frontmatter so the skill gets injected properly.

- [ ] **Step 3: Commit**

```bash
git add subagent/agents/
git commit -m "feat(subagent): add spawning/thinking defaults to bundled agents"
```
