# Git-Backed Brain Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:executing-plans skill to implement this plan task-by-task.

**Goal:** Auto-commit the memory vault after reflect/meditate/ruminate, with undo and log commands.

**Architecture:** Extract git operations into `git.ts`. The extension sets a `pendingCommitMessage` flag when a command fires; the `agent_end` hook commits if there are changes. `session_start` lazily initializes the git repo. Two new subcommands: `undo` (reset --hard HEAD~1) and `log` (git log --oneline).

**Tech Stack:** Node.js `child_process.execFileSync` for git commands, `node:test` for testing.

**Note on `vaultDir` dep injection:** Task 2 adds `vaultDir` to the deps object so new tests can use a temp directory instead of `~/.pi/memories/`. Existing tests don't pass `vaultDir` and still hit the real vault — that's intentional. Only the new tests use `vaultDir`. Don't refactor old tests to use it — that's scope creep.

**Design doc:** `docs/design/2026-03-02-git-backed-brain.md`

---

### Task 1: Create `git.ts` with git helper functions

**Files:**
- Create: `memory/git.ts`
- Create: `memory/git.test.ts`

**Step 1: Write the failing tests**

In `memory/git.test.ts`:

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initGitRepo, commitVaultChanges, undoLastCommit, getLog, isGitRepo, hasChanges } from "./git.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "git-brain-test-"));
}

test("isGitRepo returns false for non-repo directory", () => {
  const dir = tmpDir();
  assert.equal(isGitRepo(dir), false);
});

test("isGitRepo returns true after initGitRepo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  assert.equal(isGitRepo(dir), true);
});

test("initGitRepo creates initial commit with all files", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  fs.mkdirSync(path.join(dir, "principles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "principles", "test.md"), "content");
  initGitRepo(dir);

  const log = getLog(dir, 5);
  assert.equal(log.length, 1);
  assert.match(log[0], /init: memory vault/);
});

test("initGitRepo is idempotent — skips if already a repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  initGitRepo(dir); // should not throw or create a second commit

  const log = getLog(dir, 5);
  assert.equal(log.length, 1);
});

test("hasChanges returns false on clean repo", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  assert.equal(hasChanges(dir), false);
});

test("hasChanges returns true after file modification", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, "new.md"), "new content");
  assert.equal(hasChanges(dir), true);
});

test("hasChanges returns true after file deletion", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);
  fs.unlinkSync(path.join(dir, "index.md"));
  assert.equal(hasChanges(dir), true);
});

test("commitVaultChanges commits all changes with message", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "topic.md"), "new topic");
  const committed = commitVaultChanges(dir, "reflect: test commit");
  assert.equal(committed, true);

  const log = getLog(dir, 5);
  assert.equal(log.length, 2);
  assert.match(log[0], /reflect: test commit/);
});

test("commitVaultChanges returns false when no changes", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  const committed = commitVaultChanges(dir, "empty commit");
  assert.equal(committed, false);
});

test("undoLastCommit reverts files to previous state", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  fs.writeFileSync(path.join(dir, "bad.md"), "bad content");
  commitVaultChanges(dir, "meditate: bad changes");
  assert.ok(fs.existsSync(path.join(dir, "bad.md")));

  const result = undoLastCommit(dir);
  assert.ok(result.success);
  assert.match(result.undoneMessage, /meditate: bad changes/);
  assert.ok(!fs.existsSync(path.join(dir, "bad.md")));
});

test("undoLastCommit fails when only initial commit exists", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  const result = undoLastCommit(dir);
  assert.equal(result.success, false);
  assert.match(result.error!, /initial commit/i);
});

test("getLog returns empty array for non-repo", () => {
  const dir = tmpDir();
  const log = getLog(dir, 5);
  assert.deepEqual(log, []);
});

test("getLog returns correct number of entries", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "index.md"), "# Memory\n");
  initGitRepo(dir);

  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(dir, `topic-${i}.md`), `content ${i}`);
    commitVaultChanges(dir, `reflect: commit ${i}`);
  }

  const log = getLog(dir, 3);
  assert.equal(log.length, 3);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd memory && npx tsx --test git.test.ts`
Expected: FAIL — `git.ts` doesn't exist yet.

**Step 3: Implement `git.ts`**

In `memory/git.ts`:

```typescript
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function isGitRepo(dir: string): boolean {
  try {
    git(dir, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

function gitCommit(dir: string, message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=memory", "-c", "user.email=memory@local", "commit", "-m", message]);
}

export function initGitRepo(dir: string): void {
  if (isGitRepo(dir)) return;
  if (!fs.existsSync(dir)) return;

  git(dir, ["init"]);
  gitCommit(dir, "init: memory vault");
}

export function hasChanges(dir: string): boolean {
  if (!isGitRepo(dir)) return false;
  const status = git(dir, ["status", "--porcelain"]);
  return status.length > 0;
}

export function commitVaultChanges(dir: string, message: string): boolean {
  if (!hasChanges(dir)) return false;
  gitCommit(dir, message);
  return true;
}

export function undoLastCommit(dir: string): { success: true; undoneMessage: string } | { success: false; error: string } {
  if (!isGitRepo(dir)) return { success: false, error: "Not a git repository" };

  let commitCount: number;
  try {
    const output = git(dir, ["rev-list", "--count", "HEAD"]);
    commitCount = parseInt(output, 10);
  } catch {
    return { success: false, error: "No commits in repository" };
  }

  if (commitCount <= 1) {
    return { success: false, error: "Cannot undo initial commit" };
  }

  const lastMessage = git(dir, ["log", "-1", "--format=%s"]);
  git(dir, ["reset", "--hard", "HEAD~1"]);
  return { success: true, undoneMessage: lastMessage };
}

export function getLog(dir: string, count: number): string[] {
  if (!isGitRepo(dir)) return [];
  try {
    const output = git(dir, ["log", `--oneline`, `-${count}`]);
    return output ? output.split("\n") : [];
  } catch {
    return [];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd memory && npx tsx --test git.test.ts`
Expected: All 13 tests PASS.

**Step 5: Add `git.test.ts` to package.json test script**

In `memory/package.json`, add `git.test.ts` to the test script:

```json
"test": "tsx --test lib.test.ts index.test.ts init.test.ts subagent.test.ts prompt-parity.test.ts ruminate.test.ts widget.test.ts activity-overlay.test.ts git.test.ts"
```

**Step 6: Run full test suite**

Run: `cd memory && npm test`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add memory/git.ts memory/git.test.ts memory/package.json
git commit -m "feat(memory): add git helper functions for vault versioning"
```

---

### Task 2: Initialize git repo on session_start

**Files:**
- Modify: `memory/index.ts`

**Step 1: Write the failing test**

Add to `memory/index.test.ts`:

```typescript
test("session_start initializes git repo in vault directory", async () => {
  const handlers = new Map<string, Function>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Verify git repo was initialized
  const { isGitRepo } = await import("./git.ts");
  assert.equal(isGitRepo(vaultDir), true);
});
```

**Step 2: Run test to verify it fails**

Run: `cd memory && npx tsx --test index.test.ts -f "session_start initializes git"`
Expected: FAIL — `vaultDir` is not an accepted dep, and `initGitRepo` is not called in session_start.

**Step 3: Implement**

In `memory/index.ts`, add the import and modify the deps type and `session_start` handler:

Add import at top:
```typescript
import { initGitRepo } from "./git.ts";
```

Change the deps parameter and `globalDir` initialization:
```typescript
export default function memoryExtension(
  pi: ExtensionAPI,
  deps: { runSubagent: typeof runSubagent; staggerMs?: number; vaultDir?: string } = { runSubagent },
) {
  const staggerMs = deps.staggerMs ?? 2000;
  let globalDir = deps.vaultDir ?? path.join(os.homedir(), ".pi", "memories");
```

Add `initGitRepo` call inside the `session_start` handler, after loading scope:
```typescript
  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    globalScope = loadScope(globalDir);
    if (globalScope) initGitRepo(globalDir);
    updateStatus(ctx);
  });
```

**Step 4: Run test to verify it passes**

Run: `cd memory && npx tsx --test index.test.ts -f "session_start initializes git"`
Expected: PASS.

**Step 5: Run full test suite**

Run: `cd memory && npm test`
Expected: All tests PASS. Existing tests still use the real `globalMemDir` default; those that touch the real vault will now also init git there (idempotent).

**Step 6: Commit**

```bash
git add memory/index.ts memory/index.test.ts
git commit -m "feat(memory): initialize git repo on session_start"
```

---

### Task 3: Auto-commit after reflect/meditate/ruminate via `agent_end`

**Files:**
- Modify: `memory/index.ts`

**Step 1: Write the failing tests**

Add to `memory/index.test.ts`:

```typescript
import { isGitRepo, getLog } from "./git.ts";

test("reflect sets pendingCommitMessage, agent_end commits", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  let sentUserMessage = "";
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage(msg: string) { sentUserMessage = msg; },
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("reflect", {
    cwd: root,
    ui: { notify() {}, setStatus() {} },
  });

  // Simulate agent writing a file during the reflect turn
  fs.writeFileSync(path.join(vaultDir, "new-learning.md"), "# Learned something");

  // Fire agent_end
  await handlers.get("agent_end")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const log = getLog(vaultDir, 5);
  assert.ok(log.some(l => l.includes("reflect:")));
});

test("agent_end does not commit when no pendingCommitMessage", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Write a file but don't trigger any memory command
  fs.writeFileSync(path.join(vaultDir, "ad-hoc.md"), "ad hoc edit");

  // Fire agent_end — should not commit
  await handlers.get("agent_end")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const log = getLog(vaultDir, 5);
  assert.equal(log.length, 1); // only the init commit
});

test("agent_end clears pendingCommitMessage after commit", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Trigger reflect
  await commands.get("memory").handler("reflect", {
    cwd: root,
    ui: { notify() {}, setStatus() {} },
  });
  fs.writeFileSync(path.join(vaultDir, "learning.md"), "learned");
  await handlers.get("agent_end")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Second agent_end with new changes should NOT commit (flag was cleared)
  fs.writeFileSync(path.join(vaultDir, "unrelated.md"), "unrelated");
  await handlers.get("agent_end")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const log = getLog(vaultDir, 10);
  const reflectCommits = log.filter(l => l.includes("reflect:"));
  assert.equal(reflectCommits.length, 1);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd memory && npx tsx --test index.test.ts -f "pendingCommitMessage|agent_end does not|clears pending"`
Expected: FAIL — no `agent_end` handler registered, no `pendingCommitMessage` state.

**Step 3: Implement**

In `memory/index.ts`:

Add import:
```typescript
import { initGitRepo, commitVaultChanges } from "./git.ts";
```

Add state variable after `let lastCtx`:
```typescript
  let pendingCommitMessage: string | null = null;
```

Set the flag in each command handler. In the `reflect` block, after `pi.sendUserMessage(prompt)`:
```typescript
        pendingCommitMessage = "reflect: capture session learnings";
```

In the `meditate` block, after `pi.sendMessage(...)`:
```typescript
        pendingCommitMessage = "meditate: apply audit findings";
```

In the `ruminate` block, after `pi.sendMessage(...)`:
```typescript
        pendingCommitMessage = "ruminate: apply mined findings";
```

Register the `agent_end` handler after the existing `tool_call` handler:
```typescript
  pi.on("agent_end", async () => {
    if (!pendingCommitMessage) return;
    const message = pendingCommitMessage;
    pendingCommitMessage = null;
    commitVaultChanges(globalDir, message);
  });
```

**Step 4: Run tests to verify they pass**

Run: `cd memory && npx tsx --test index.test.ts -f "pendingCommitMessage|agent_end does not|clears pending"`
Expected: All 3 PASS.

**Step 5: Run full test suite**

Run: `cd memory && npm test`
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add memory/index.ts memory/index.test.ts
git commit -m "feat(memory): auto-commit vault after reflect/meditate/ruminate"
```

---

### Task 4: Add `/memory undo` and `/memory log` subcommands

**Files:**
- Modify: `memory/index.ts`

**Step 1: Write the failing tests**

Add to `memory/index.test.ts`:

```typescript
test("/memory undo reverts the last commit", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  let notified = "";
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Create a commit to undo
  fs.writeFileSync(path.join(vaultDir, "bad.md"), "bad");
  const { commitVaultChanges: commit } = await import("./git.ts");
  commit(vaultDir, "meditate: bad changes");
  assert.ok(fs.existsSync(path.join(vaultDir, "bad.md")));

  await commands.get("memory").handler("undo", {
    cwd: root,
    ui: { notify(msg: string) { notified = msg; }, setStatus() {} },
  });

  assert.ok(!fs.existsSync(path.join(vaultDir, "bad.md")));
  assert.match(notified, /meditate: bad changes/);
});

test("/memory undo fails gracefully on initial commit", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  let notified = "";
  let notifyLevel = "";
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("undo", {
    cwd: root,
    ui: { notify(msg: string, level: string) { notified = msg; notifyLevel = level; }, setStatus() {} },
  });

  assert.match(notified, /cannot undo/i);
  assert.equal(notifyLevel, "warning");
});

test("/memory log shows recent history", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  let notified = "";
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, { runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }), vaultDir });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("log", {
    cwd: root,
    ui: { notify(msg: string) { notified = msg; }, setStatus() {} },
  });

  assert.match(notified, /init: memory vault/);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd memory && npx tsx --test index.test.ts -f "memory undo|memory log"`
Expected: FAIL — `undo` and `log` subcommands not handled.

**Step 3: Implement**

In `memory/index.ts`:

Add imports:
```typescript
import { initGitRepo, commitVaultChanges, undoLastCommit, getLog } from "./git.ts";
```

Add two entries to `MEMORY_SUBCOMMANDS` array:
```typescript
    { value: "undo",      label: "undo",      description: "Revert the last memory commit" },
    { value: "log",       label: "log",       description: "Show recent memory vault history" },
```

Add command handlers inside the `handler` function, before the `init` block:

```typescript
      if (trimmed === "undo") {
        const result = undoLastCommit(globalDir);
        if (result.success) {
          refreshScope();
          updateStatus(ctx);
          ctx.ui.notify(`Undone: ${result.undoneMessage}`, "info");
        } else {
          ctx.ui.notify(`Cannot undo: ${result.error}`, "warning");
        }
        return;
      }

      if (trimmed === "log") {
        const entries = getLog(globalDir, 20);
        if (entries.length === 0) {
          ctx.ui.notify("No vault history found.", "info");
        } else {
          ctx.ui.notify(entries.join("\n"), "info");
        }
        return;
      }
```

Update the command description:
```typescript
    description: "View and manage agent memory (init/reflect/meditate/ruminate/undo/log/on/off/edit)",
```

Update the `formatMemoryDisplay` commands line in `lib.ts`:
```typescript
  lines.push("Commands: init, reflect, meditate, ruminate, undo, log, on, off, edit");
```

**Step 4: Run tests to verify they pass**

Run: `cd memory && npx tsx --test index.test.ts -f "memory undo|memory log"`
Expected: All 3 PASS.

**Step 5: Update autocomplete count in existing test**

The existing test `"/memory getArgumentCompletions returns all subcommands for empty prefix"` asserts `completions.length === 7`. Update to `9` (added `undo` + `log`).

**Step 6: Run full test suite**

Run: `cd memory && npm test`
Expected: All tests PASS.

**Step 7: Commit**

```bash
git add memory/index.ts memory/index.test.ts memory/lib.ts
git commit -m "feat(memory): add /memory undo and /memory log commands"
```

---

### Task 5: Final verification

**Step 1: Run full test suite one more time**

Run: `cd memory && npm test`
Expected: All tests PASS.

**Step 2: Verify no dead code or type issues**

Run: `cd memory && npx tsc --noEmit` (if tsconfig exists) or manually check for unused imports.

**Step 3: Verify git.ts has no debug statements**

Run: `rg "console\." memory/git.ts`
Expected: No matches.
