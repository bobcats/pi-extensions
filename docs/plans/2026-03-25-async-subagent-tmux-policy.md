# Async Subagent Tmux Policy Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Change async subagent tmux behavior so single async runs open a temporary split next to the spawning pi pane, while parallel async runs open a dedicated tmux window with one tiled pane per task.

**Architecture:** Keep the existing single-run async flow for single tasks, but replace the current parallel async split behavior with a batch-oriented window flow. Add explicit tmux window helpers, batch tracking in `subagent/index.ts`, and deterministic cleanup when the last child task in a parallel batch finishes.

**Tech Stack:** TypeScript, Node.js child_process (`execFileSync`, `execFile`), tmux CLI, pi extension API, existing async watcher/session-file flow.

---

### Task 1: Add tmux window primitives

**Files:**
- Modify: `subagent/tmux.ts`
- Test: manual tmux smoke checks from a pi session running inside tmux

- [x] **Step 1: Add a helper to derive a source-specific window name**

In `subagent/tmux.ts`, add a helper that derives a readable, source-specific name from the spawning pane.

```ts
export function getSourceWindowToken(): string {
	const parentPane = getParentPane();
	if (!parentPane) return "unknown";
	try {
		return execFileSync(
			"tmux",
			["display-message", "-p", "-t", parentPane, "#{window_index}"],
			{ encoding: "utf8" },
		).trim();
	} catch {
		return "unknown";
	}
}

export function makeBatchWindowName(batchId: string): string {
	return `subagents-${getSourceWindowToken()}-${batchId}`;
}
```

- [x] **Step 2: Add a tmux helper to create a dedicated window in the parent session**

In `subagent/tmux.ts`, add:

```ts
export function createWindow(name: string): string {
	const parentPane = getParentPane();
	const args = ["new-window", "-d", "-P", "-F", "#{window_id}", "-n", name];
	if (parentPane) args.push("-t", parentPane);
	return execFileSync("tmux", args, { encoding: "utf8" }).trim();
}
```

This must create the window in the same tmux session as the spawning pi pane.

- [x] **Step 3: Add a helper to create a pane inside an existing window**

In `subagent/tmux.ts`, add:

```ts
export function createPaneInWindow(windowId: string, name: string, command: string): string {
	const pane = execFileSync(
		"tmux",
		["split-window", "-t", windowId, "-d", "-P", "-F", "#{pane_id}", "bash", "-c", command],
		{ encoding: "utf8" },
	).trim();
	try {
		execFileSync("tmux", ["set-option", "-t", pane, "remain-on-exit", "on"]);
	} catch {}
	try {
		execFileSync("tmux", ["select-pane", "-t", pane, "-T", name]);
	} catch {}
	return pane;
}
```

- [x] **Step 4: Add helpers to tile and close a batch window**

In `subagent/tmux.ts`, add:

```ts
export function tileWindow(windowId: string): void {
	try {
		execFileSync("tmux", ["select-layout", "-t", windowId, "tiled"]);
	} catch {}
}

export function closeWindow(windowId: string): void {
	try {
		execFileSync("tmux", ["kill-window", "-t", windowId]);
	} catch {}
}
```

- [x] **Step 5: Keep `createPaneWithCommand()` for single async only**

Do not remove `createPaneWithCommand()`. It remains the single-task async path.

- [x] **Step 6: Manual smoke test the new tmux helpers**

From a pi session running inside tmux, manually verify:

```bash
# Single helper still works
node --input-type=module -e "import('./subagent/tmux.ts').then(m => console.log(!!m.createPaneWithCommand))"

# New helpers exist
node --input-type=module -e "import('./subagent/tmux.ts').then(m => console.log(Object.keys(m).filter(k => k.includes('Window') || k.includes('Pane'))))"
```

Expected: output includes `createWindow`, `createPaneInWindow`, `tileWindow`, and `closeWindow`.

- [x] **Step 7: Commit**

```bash
git add subagent/tmux.ts
git commit -m "feat(subagent): add tmux window helpers for async batches"
```

---

### Task 2: Introduce async batch state

**Files:**
- Modify: `subagent/widget.ts`
- Modify: `subagent/index.ts`

- [x] **Step 1: Add a batch type for parallel async orchestration**

In `subagent/index.ts`, define a new interface near the existing async structures:

```ts
interface AsyncBatch {
	id: string;
	windowId: string;
	windowName: string;
	runIds: string[];
	completedCount: number;
}
```

- [x] **Step 2: Add batch tracking maps inside the extension factory**

In `export default function (pi: ExtensionAPI)`, add:

```ts
const asyncRuns = new Map<string, AsyncRun>();
const asyncBatches = new Map<string, AsyncBatch>();
```

Keep `asyncRuns` as the source for widget rendering. Batches exist only for window lifecycle.

- [x] **Step 3: Extend AsyncRun with optional batch fields**

In `subagent/widget.ts`, extend `AsyncRun`:

```ts
export interface AsyncRun {
	id: string;
	agent: string;
	task: string;
	startedAt: number;
	pane: string;
	sessionFile: string;
	tempFiles: string[];
	batchId?: string;
	windowId?: string;
}
```

- [x] **Step 4: Update shutdown cleanup to close windows before clearing state**

In `subagent/index.ts`, update `session_shutdown`:

```ts
for (const batch of asyncBatches.values()) {
	try { closeWindow(batch.windowId); } catch {}
}
for (const run of asyncRuns.values()) {
	try { closePane(run.pane); } catch {}
}
stopWidgetRefresh();
asyncRuns.clear();
asyncBatches.clear();
latestCtx = null;
```

This avoids orphaned windows if pi shuts down while a parallel async batch is running.

- [x] **Step 5: Commit**

```bash
git add subagent/index.ts subagent/widget.ts
git commit -m "refactor(subagent): add async batch state for parallel tmux windows"
```

---

### Task 3: Keep single async on the current split path

**Files:**
- Modify: `subagent/index.ts`

- [x] **Step 1: Rename the single-run async helper for clarity**

Rename `runAsyncAgent(...)` to `runSingleAsyncAgent(...)` in `subagent/index.ts`.

Update the function signature and all call sites.

- [x] **Step 2: Keep the implementation behavior unchanged**

Single async should still:
- create a split next to the spawning pi pane
- run interactive pi with `auto-exit.ts`
- poll for sentinel completion
- read the session file
- steer the result back
- close the split pane

No batching logic belongs here.

- [x] **Step 3: Verify the single async path still compiles mentally after rename**

Review the renamed helper and ensure it still calls:
- `createPaneWithCommand(...)`
- `pollForExit(...)`
- `closePane(...)`

- [x] **Step 4: Commit**

```bash
git add subagent/index.ts
git commit -m "refactor(subagent): separate single async helper from batch flow"
```

---

### Task 4: Add parallel async batch orchestration

**Files:**
- Modify: `subagent/index.ts`
- Modify: `subagent/tmux.ts`

- [x] **Step 1: Write a helper to build the interactive pi command for one async child**

In `subagent/index.ts`, extract the shared async command construction into a helper so single and parallel async can reuse it.

```ts
function buildAsyncPiCommand(
	agent: AgentConfig,
	task: string,
	defaultCwd: string,
	cwd: string | undefined,
	thinking: string | undefined,
	model: string | undefined,
	sessionFile: string,
	tempFiles: string[],
): string {
	// build args, append auto-exit extension, append system prompt temp file,
	// resolve cwd, return full `cd ... && pi ...; echo '__SUBAGENT_DONE_'$?'__'` string
}
```

This removes duplication and keeps the single/parallel paths consistent.

- [x] **Step 2: Write a helper to register one async child run watcher**

In `subagent/index.ts`, extract the watcher logic into a reusable function:

```ts
function watchAsyncRun(
	pi: ExtensionAPI,
	asyncRuns: Map<string, AsyncRun>,
	asyncBatches: Map<string, AsyncBatch>,
	latestCtx: ExtensionContext | null,
	run: AsyncRun,
): void {
	// pollForExit
	// read session file
	// sendMessage
	// notify
	// cleanup temp files
	// close pane
	// if run.batchId exists, increment batch.completedCount
	// if batch.completedCount === batch.runIds.length, close the batch window and delete the batch
}
```

- [x] **Step 3: Implement a new `runParallelAsyncBatch(...)` helper**

Add a new helper to `subagent/index.ts`:

```ts
function runParallelAsyncBatch(
	pi: ExtensionAPI,
	asyncRuns: Map<string, AsyncRun>,
	asyncBatches: Map<string, AsyncBatch>,
	latestCtx: ExtensionContext | null,
	defaultCwd: string,
	tasks: Array<{ agent: AgentConfig; task: string; cwd?: string }>,
	thinking: string | undefined,
	modelOverride: string | undefined,
): { batchId: string; runIds: string[]; windowName: string } {
	const batchId = crypto.randomUUID().slice(0, 8);
	const windowName = makeBatchWindowName(batchId);
	const windowId = createWindow(windowName);

	const runIds: string[] = [];
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i];
		const runId = crypto.randomUUID().slice(0, 8);
		const sessionFile = path.join(os.tmpdir(), `pi-subagent-${runId}.jsonl`);
		const tempFiles = [sessionFile];
		const command = buildAsyncPiCommand(...);
		const pane = i === 0
			? createPaneInWindow(windowId, `${t.agent.name}: ${t.task.slice(0, 30)}`, command)
			: createPaneInWindow(windowId, `${t.agent.name}: ${t.task.slice(0, 30)}`, command);

		const run: AsyncRun = { ... , batchId, windowId };
		asyncRuns.set(runId, run);
		runIds.push(runId);
	}

	tileWindow(windowId);
	asyncBatches.set(batchId, {
		id: batchId,
		windowId,
		windowName,
		runIds,
		completedCount: 0,
	});

	for (const runId of runIds) watchAsyncRun(...);
	startWidgetRefresh(latestCtx, asyncRuns);
	return { batchId, runIds, windowName };
}
```

Keep it simple. Build the whole window first, tile it, then start watchers.

- [x] **Step 4: Use the batch helper in the async `tasks` branch**

In the `if (params.async)` block inside `subagent/index.ts`, replace the current loop-based async `tasks` branch with a call to `runParallelAsyncBatch(...)`.

Return content like:

```ts
return {
	content: [{ type: "text", text: `Started ${runIds.length} async subagents in tmux window "${windowName}"` }],
	details: makeDetails("parallel")([]),
};
```

- [x] **Step 5: Remove stagger from async parallel mode**

The new parallel batch logic creates a dedicated window and spawns panes inside it. Remove the current async parallel stagger loop in this path. Keep the existing stagger in sync JSON-mode parallel execution untouched.

- [x] **Step 6: Verify batch cleanup logic by inspection**

Read through `watchAsyncRun(...)` and confirm:
- child completion never closes the window early
- the last child closes the window exactly once
- temp files are cleaned per child
- failed child tasks still count toward batch completion

- [x] **Step 7: Commit**

```bash
git add subagent/index.ts subagent/tmux.ts
git commit -m "feat(subagent): run parallel async tasks in dedicated tmux windows"
```

---

### Task 5: Update user-facing tool text

**Files:**
- Modify: `subagent/index.ts`

- [x] **Step 1: Update the tool description to reflect split vs window behavior**

In the `registerTool` description for `subagent`, replace the current async wording with something more precise:

```ts
"ASYNC MODE: Pass async: true to run in tmux. Single async tasks open a temporary split beside the current pi pane. Parallel async tasks open a dedicated tmux window with one pane per task. Results steer back when done. Requires tmux. Not supported for chains."
```

- [x] **Step 2: Update any async start messages to mention windows for parallel batches**

Ensure the returned tool message for async parallel includes the tmux window name.

- [x] **Step 3: Commit**

```bash
git add subagent/index.ts
git commit -m "docs(subagent): clarify tmux split vs window async behavior"
```

---

### Task 6: Manual verification in a live tmux pi session

**Files:**
- Verify runtime behavior manually

- [x] **Step 1: Reload pi so the extension changes take effect**

Use your normal pi reload flow.

Expected: the updated subagent tool is available in the current session.

- [x] **Step 2: Verify single async still opens a split next to the spawning pi pane**

Trigger a single async scout run, for example:

```text
Use subagent with agent: "scout", task: "Read package.json and summarize the registered extensions.", async: true
```

Expected:
- a split opens next to the current pi pane
- the pane shows interactive pi output
- the pane auto-closes when done
- the result steers back into the conversation

- [x] **Step 3: Verify parallel async opens a dedicated window**

Trigger a parallel async run with at least 3 tasks, for example:

```text
Use subagent with tasks: [
  { agent: "scout", task: "Summarize ext-prof/index.ts" },
  { agent: "scout", task: "Summarize memory/index.ts" },
  { agent: "scout", task: "Summarize files/index.ts" }
], async: true
```

Expected:
- no recursive splits appear beside the current pi pane
- a dedicated tmux window appears for the batch
- the window contains one pane per task
- panes are tiled
- each result steers back independently
- the window closes automatically after the last task finishes

- [x] **Step 4: Verify failure handling in a batch**

Trigger one good task and one intentionally bad one:

```text
Use subagent with tasks: [
  { agent: "scout", task: "Read package.json and summarize it" },
  { agent: "missing-agent", task: "This should fail" }
], async: true
```

Expected:
- the valid task still runs
- the invalid task reports an error
- the batch window closes only after all child runs have resolved
- the conversation receives both outcomes

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "test(subagent): verify tmux split and batch window async behavior"
```
