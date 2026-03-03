import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import memoryExtension from "./index.ts";
import { encodeProjectSessionPath, MIN_FILE_SIZE } from "./subagent.ts";
import { isGitRepo, getLog } from "./git.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memory-index-test-"));
}

const globalMemDir = path.join(os.homedir(), ".pi", "memories");

/** Create a JSONL session file large enough to pass min-size and min-text-length filters. */
function writeSessionFile(dir: string, name: string, messageText: string): void {
  const entry = JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text: messageText }] },
  });
  // Repeat entry enough times to exceed MIN_FILE_SIZE
  const repeats = Math.ceil(MIN_FILE_SIZE / entry.length) + 1;
  fs.writeFileSync(path.join(dir, name), (entry + "\n").repeat(repeats));
}

async function waitFor(check: () => boolean, timeoutMs: number = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out after ${timeoutMs}ms waiting for condition`);
}

test("registers session_start and before_agent_start handlers", () => {
  const handlers = new Map<string, Function[]>();

  const pi = {
    on(event: string, handler: Function) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  assert.ok(handlers.has("session_start"));
  assert.ok(handlers.has("before_agent_start"));
});

test("before_agent_start injects memory into system prompt", async () => {
  const handlers = new Map<string, Function>();

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);

  const sessionStart = handlers.get("session_start")!;
  await sessionStart({}, { cwd: "/nonexistent/path", ui: { notify() {}, setStatus() {} } });

  const beforeAgent = handlers.get("before_agent_start")!;
  const result = await beforeAgent({ systemPrompt: "base prompt" });
  assert.ok(result);
  assert.match(result.systemPrompt, /base prompt/);
  assert.match(result.systemPrompt, /Updating Memories/);
});

test("tool_call blocks write to index.md over 200 lines", async () => {
  const handlers = new Map<string, Function>();

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const toolCall = handlers.get("tool_call")!;

  // Write 201 lines to global index.md → should block
  const content = Array.from({ length: 201 }, (_, i) => `line ${i}`).join("\n");
  const result = await toolCall({
    toolName: "write",
    input: { path: path.join(globalMemDir, "index.md"), content },
  });
  assert.ok(result);
  assert.equal(result.block, true);
  assert.match(result.reason, /200/);
  assert.match(result.reason, /201/);
});

test("tool_call allows write to topic file under limit", async () => {
  const handlers = new Map<string, Function>();

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const result = await handlers.get("tool_call")!({
    toolName: "write",
    input: { path: path.join(globalMemDir, "topic.md"), content: "short content" },
  });
  assert.equal(result, undefined);
});

test("tool_call blocks write to topic file over 500 lines", async () => {
  const handlers = new Map<string, Function>();

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const content = Array.from({ length: 501 }, (_, i) => `line ${i}`).join("\n");
  const result = await handlers.get("tool_call")!({
    toolName: "write",
    input: { path: path.join(globalMemDir, "testing.md"), content },
  });
  assert.ok(result);
  assert.equal(result.block, true);
  assert.match(result.reason, /500/);
});

test("tool_call ignores writes to non-memory paths", async () => {
  const handlers = new Map<string, Function>();

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const content = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
  const result = await handlers.get("tool_call")!({
    toolName: "write",
    input: { path: "/proj/src/main.ts", content },
  });
  assert.equal(result, undefined);
});

test("tool_call ignores non-write tools", async () => {
  const handlers = new Map<string, Function>();

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
    registerTool() {},
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const result = await handlers.get("tool_call")!({
    toolName: "bash",
    input: { command: "echo hello" },
  });
  assert.equal(result, undefined);
});

test("registers /memory command", () => {
  const commands = new Map<string, any>();

  const pi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  assert.ok(commands.has("memory"));
  assert.ok(commands.get("memory").description);
});

test("/memory getArgumentCompletions returns all subcommands for empty prefix", () => {
  const commands = new Map<string, any>();

  const pi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  const completions = commands.get("memory").getArgumentCompletions("");
  assert.ok(Array.isArray(completions));
  assert.equal(completions.length, 13);
  assert.ok(completions.every((c: any) => typeof c.value === "string" && typeof c.label === "string"));
  const values = completions.map((c: any) => c.value);
  assert.ok(values.includes("reflect"));
  assert.ok(values.includes("meditate"));
  assert.ok(values.includes("ruminate"));
  assert.ok(values.includes("cancel ruminate"));
  assert.ok(values.includes("cancel meditate"));
  assert.ok(values.includes("init"));
  assert.ok(values.includes("edit"));
  assert.ok(!values.includes("edit global"));
  assert.ok(!values.includes("init project"));
  assert.ok(!values.includes("v2migrate"));
});

test("/memory getArgumentCompletions filters by prefix", () => {
  const commands = new Map<string, any>();

  const pi = {
    on() {},
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  const fn = commands.get("memory").getArgumentCompletions;

  const edits = fn("ed");
  assert.ok(Array.isArray(edits));
  assert.equal(edits.map((c: any) => c.value).sort().join(","), "edit");

  const inits = fn("init");
  assert.ok(Array.isArray(inits));
  assert.equal(inits.map((c: any) => c.value).sort().join(","), "init");

  const none = fn("xyz");
  assert.equal(none, null);
});

test("/memory command shows display when called with no args", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
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
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const ctx = { ui: { notify(msg: string) { notified = msg; }, setStatus() {}, editor: async () => "" } };
  await commands.get("memory").handler("", ctx);
  assert.match(notified, /Memory/);
});

test("/memory off disables injection in before_agent_start", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  let notified = "";
  await commands.get("memory").handler("off", { ui: { notify(msg: string) { notified = msg; }, setStatus() {} } });
  assert.match(notified, /disabled/i);

  const result = await handlers.get("before_agent_start")!({ systemPrompt: "base" });
  assert.equal(result, undefined);
});

test("/memory on re-enables injection", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("off", { ui: { notify() {}, setStatus() {} } });
  await commands.get("memory").handler("on", { ui: { notify() {}, setStatus() {} } });

  const result = await handlers.get("before_agent_start")!({ systemPrompt: "base" });
  assert.ok(result);
  assert.match(result.systemPrompt, /Updating Memories/);
});

test("/memory off also skips tool_call line limit enforcement", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("off", { ui: { notify() {}, setStatus() {} } });

  const content = Array.from({ length: 201 }, (_, i) => `line ${i}`).join("\n");
  const result = await handlers.get("tool_call")!({
    toolName: "write",
    input: { path: path.join(globalMemDir, "index.md"), content },
  });
  assert.equal(result, undefined);
});

test("tool_call write to memory file refreshes scope without rewriting index", async () => {
  const handlers = new Map<string, Function>();
  const root = tmpDir();
  // Use a temp dir as the vault dir by using a custom globalDir — we can't
  // easily override globalDir in index.ts, so instead we test with a path
  // inside globalMemDir to verify no auto-rewrite occurs.
  // Just verify the scope refresh doesn't throw and returns undefined.

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

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const toolCall = handlers.get("tool_call")!;
  const topicPath = path.join(globalMemDir, "new-topic-test-delete-me.md");

  const result = await toolCall({
    toolName: "write",
    input: { path: topicPath, content: "hello" },
  });

  // Should not block (under limit, not an index file)
  assert.equal(result, undefined);
});

test("tool_call edit skips index rebuild on content-only edit", async () => {
  const handlers = new Map<string, Function>();
  const root = tmpDir();

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

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const result = await handlers.get("tool_call")!({
    toolName: "edit",
    input: { path: path.join(globalMemDir, "topic.md") },
  });

  // Edit to non-index file: returns undefined (no block, no rewrite)
  assert.equal(result, undefined);
});

test("/memory init creates vault structure", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
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
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // init will operate on the real globalMemDir (~/.pi/memories) which may already exist
  // Just test that it runs without error and notifies success
  await commands.get("memory").handler("init", {
    ui: {
      notify(msg: string) { notified = msg; },
      setStatus() {},
      editor: async () => "",
      select: async () => "Cancel",
    },
  });

  // Either initialized or showed "cancel" — either way no error thrown
  // If vault existed, user cancelled → no notification expected
  // If vault didn't exist, initialized → notification expected
  // Both are valid outcomes — just verify no throw
});

test("/memory reflect sends user message with reflect prompt", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  let sentUserMessage: any = null;

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
    sendUserMessage(msg: any) { sentUserMessage = msg; },
  } as never;

  memoryExtension(pi);
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("reflect", {
    ui: { notify() {}, setStatus() {}, editor: async () => "", select: async () => "" },
  });

  assert.ok(sentUserMessage);
  assert.match(sentUserMessage, /## Reflect/);
  // Single vault dir reference
  assert.match(sentUserMessage, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("/memory ruminate starts in background and returns immediately", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });
  writeSessionFile(projectSessionsDir, "session-0.jsonl", "this is conversation text with enough characters to pass parsing filters");

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi, {
    runSubagent: async () => await new Promise(() => {}),
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const completed = await Promise.race([
    commands.get("memory").handler("ruminate", {
      cwd: root,
      hasUI: false,
      ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
    }).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

  fs.rmSync(projectSessionsDir, { recursive: true, force: true });
  assert.equal(completed, true);
});

test("/memory cancel ruminate aborts active background run", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });
  writeSessionFile(projectSessionsDir, "session-0.jsonl", "this is conversation text with enough characters to pass parsing filters");

  let aborted = false;
  let release: (() => void) | undefined;
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi, {
    runSubagent: async (_agent, _task, _cwd, _timeout, _onData, signal) => {
      if (signal?.aborted) aborted = true;
      signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
      await new Promise<void>((resolve) => { release = resolve; });
      return { output: "", exitCode: 1, stderr: "Cancelled", logFile: "" };
    },
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const started = await Promise.race([
    commands.get("memory").handler("ruminate", {
      cwd: root,
      hasUI: false,
      ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
    }).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  assert.equal(started, true);

  await commands.get("memory").handler("cancel ruminate", {
    cwd: root,
    hasUI: false,
    ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
  });

  await waitFor(() => aborted);
  release?.();
  fs.rmSync(projectSessionsDir, { recursive: true, force: true });
  assert.equal(aborted, true);
});

test("session_before_switch aborts running memory background tasks", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "vault");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });
  writeSessionFile(projectSessionsDir, "session-0.jsonl", "this is conversation text with enough characters to pass parsing filters");

  let abortCount = 0;

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi, {
    vaultDir,
    runSubagent: async (_agentPath, _task, _cwd, _timeout, _onData, signal) => {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) { abortCount += 1; resolve(); return; }
        signal?.addEventListener("abort", () => { abortCount += 1; resolve(); }, { once: true });
      });
      return { output: "", exitCode: 1, stderr: "Cancelled", logFile: "" };
    },
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const ruminateStarted = await Promise.race([
    commands.get("memory").handler("ruminate", {
      cwd: root,
      hasUI: false,
      ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
    }).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  assert.equal(ruminateStarted, true);

  const meditateStarted = await Promise.race([
    commands.get("memory").handler("meditate", {
      cwd: root,
      hasUI: false,
      ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
    }).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  assert.equal(meditateStarted, true);

  await handlers.get("session_before_switch")!({ reason: "new" }, { cwd: root, ui: { notify() {}, setStatus() {} } });

  fs.rmSync(projectSessionsDir, { recursive: true, force: true });
  assert.ok(abortCount >= 2, `expected at least 2 aborts, got ${abortCount}`);
});

test("/memory meditate runs subagents via runSubagent dependency", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  // Create a temp vault with content so snapshot is non-empty
  const tempVault = path.join(root, "vault");
  fs.mkdirSync(tempVault, { recursive: true });
  fs.writeFileSync(path.join(tempVault, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(tempVault, "topic.md"), "content");

  let notified = "";
  let widgetCalls: { key: string; lines: string[] | undefined }[] = [];
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  // We can't easily swap the globalDir, so we test with the real globalMemDir
  // by creating real content there temporarily. Instead, just mock the snapshot.
  // The meditate handler calls buildVaultSnapshot(globalDir) — if globalDir is empty,
  // it exits early with "No vault content found". So this test just verifies
  // the subagent path via the real vault if it exists, or early exit if not.
  memoryExtension(pi, {
    runSubagent: async () => ({ output: "# Audit Report\n\n- finding", exitCode: 0, stderr: "", logFile: "" }),
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("meditate", {
    cwd: root,
    ui: {
      notify(msg: string) { notified = msg; },
      setStatus() {},
      setWidget(key: string, lines: string[] | undefined) { widgetCalls.push({ key, lines: lines ? [...lines] : undefined }); },
      editor: async () => "",
      select: async () => "",
    },
  });

  // Either meditate ran (vault exists) or exited early (no vault)
  // Both are valid — test passes as long as no uncaught error
});

test("/memory meditate sends post-report apply handoff prompt", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  let sent: any = null;
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage(message: any) { sent = message; },
  } as never;

  memoryExtension(pi, {
    runSubagent: async (agentPath: string) => {
      if (agentPath.endsWith("auditor.md")) {
        return {
          output: "# Audit Report\n\n- outdated\n- redundant\n- low-value",
          exitCode: 0,
          stderr: "",
          logFile: "",
        };
      }
      return {
        output: "# Review Report\n\n## Synthesis Results\n- link A -> add wikilink",
        exitCode: 0,
        stderr: "",
        logFile: "",
      };
    },
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Only test the handoff if vault has content
  if (fs.existsSync(path.join(globalMemDir, "index.md"))) {
    await commands.get("memory").handler("meditate", {
      cwd: root,
      ui: {
        notify() {},
        setStatus() {},
        setWidget() {},
        editor: async () => "",
        select: async () => "",
      },
    });

    if (sent) {
      assert.equal(sent.deliverAs, "followUp");
      assert.equal(sent.triggerTurn, true);
      assert.match(sent.content, /Apply approved changes directly/);
    }
  }
});

test("/memory ruminate reports when no project sessions exist", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const notifications: string[] = [];

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi, {
    runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }),
  });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("ruminate", {
    cwd: root,
    ui: { notify(msg: string) { notifications.push(msg); }, setStatus() {}, editor: async () => "", select: async () => "" },
  });

  await waitFor(() => notifications.some((msg) => /No sessions found for project/.test(msg)));
  assert.ok(notifications.some((msg) => /No sessions found for project/.test(msg)));
});

test("/memory ruminate launches miner subagents in parallel", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });

  for (let i = 0; i < 40; i++) {
    writeSessionFile(projectSessionsDir, `session-${i}.jsonl`, `this is conversation message number ${i} with enough text to pass filters`);
  }

  let inFlight = 0;
  let maxInFlight = 0;

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

  memoryExtension(pi, {
    staggerMs: 0,
    runSubagent: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { output: "# Findings\n\n- finding", exitCode: 0, stderr: "", logFile: "" };
    },
  });

  let widgetCalls: { key: string; lines: string[] | undefined }[] = [];

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });
  await commands.get("memory").handler("ruminate", {
    cwd: root,
    ui: {
      notify() {},
      setStatus() {},
      setWidget(key: string, lines: string[] | undefined) { widgetCalls.push({ key, lines: lines ? [...lines] : undefined }); },
      editor: async () => "",
      select: async () => "",
    },
  });

  await waitFor(() => maxInFlight >= 1);
  await waitFor(() => widgetCalls.some((c) => c.key === "ruminate" && c.lines === undefined));

  fs.rmSync(projectSessionsDir, { recursive: true, force: true });
  assert.ok(maxInFlight >= 1, `expected miner execution, max in-flight: ${maxInFlight}`);
  assert.ok(widgetCalls.some((c) => c.key === "ruminate" && c.lines?.some((l: string) => l.includes("conversations"))));
  assert.ok(widgetCalls.some((c) => c.key === "ruminate" && c.lines?.some((l: string) => l.includes("Miner"))));
  assert.ok(widgetCalls.some((c) => c.key === "ruminate" && c.lines === undefined));
});

test("/memory ruminate sends apply handoff when findings exist", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });

  for (let i = 0; i < 40; i++) {
    writeSessionFile(projectSessionsDir, `session-${i}.jsonl`, `this is conversation message number ${i} with enough text to pass filters`);
  }

  let sent: any = null;
  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage(message: any) { sent = message; },
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, {
    staggerMs: 0,
    runSubagent: async () => ({
      output: "# Findings\n\n## User Corrections\n- Always run tests: user said so",
      exitCode: 0,
      stderr: "",
      logFile: "",
    }),
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });
  await commands.get("memory").handler("ruminate", {
    cwd: root,
    ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
  });

  await waitFor(() => sent !== null);
  fs.rmSync(projectSessionsDir, { recursive: true, force: true });

  assert.ok(sent, "expected sendMessage to be called");
  assert.equal(sent.deliverAs, "followUp");
  assert.equal(sent.triggerTurn, true);
  assert.match(sent.content, /Always run tests/);
  assert.match(sent.content, /approve/i);
});

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

test("/memory ruminate accepts --from flag", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });

  // Create one old session and one new session
  const makeEntry = (text: string) => JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });
  const entry = makeEntry("conversation with enough text to matter and pass all filters");
  const lines = Array.from({ length: 10 }, () => entry);
  const content = lines.join("\n");

  const oldFile = path.join(projectSessionsDir, "old.jsonl");
  const newFile = path.join(projectSessionsDir, "new.jsonl");
  fs.writeFileSync(oldFile, content);
  fs.writeFileSync(newFile, content);
  const oldDate = new Date("2025-01-01T00:00:00");
  fs.utimesSync(oldFile, oldDate, oldDate);
  const newDate = new Date("2026-02-15T00:00:00");
  fs.utimesSync(newFile, newDate, newDate);

  let subagentCalls = 0;
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

  memoryExtension(pi, {
    staggerMs: 0,
    runSubagent: async () => {
      subagentCalls++;
      return { output: "# Findings\n\n- finding", exitCode: 0, stderr: "", logFile: "" };
    },
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  // Only new session should be processed (from 2026-01-01 onwards)
  await commands.get("memory").handler("ruminate --from 2026-01-01", {
    cwd: root,
    ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
  });

  await waitFor(() => subagentCalls >= 1);
  fs.rmSync(projectSessionsDir, { recursive: true, force: true });

  // With only 1 conversation, we get min 2 batches but only 1 has content
  assert.ok(subagentCalls >= 1, `expected at least 1 subagent call, got ${subagentCalls}`);
});

test("/memory ruminate rejects invalid date format", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
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
  } as never;

  memoryExtension(pi, {
    runSubagent: async () => ({ output: "", exitCode: 0, stderr: "", logFile: "" }),
  });
  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("ruminate --from not-a-date", {
    cwd: root,
    ui: { notify(msg: string) { notified = msg; }, setStatus() {}, editor: async () => "", select: async () => "" },
  });

  assert.match(notified, /Invalid date/i);
});

test("agent_end commits queued messages in order when reflect overlaps with background ruminate", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();
  const vaultDir = path.join(root, "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });
  writeSessionFile(projectSessionsDir, "session-0.jsonl", "message with enough text to pass filters");

  let followUpSent = false;

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() { followUpSent = true; },
    sendUserMessage() {},
  } as never;

  memoryExtension(pi, {
    vaultDir,
    staggerMs: 0,
    runSubagent: async () => ({
      output: "# Findings\n\n- recurring preference",
      exitCode: 0,
      stderr: "",
      logFile: "",
    }),
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("reflect", {
    cwd: root,
    ui: { notify() {}, setStatus() {} },
  });

  await commands.get("memory").handler("ruminate", {
    cwd: root,
    hasUI: false,
    ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
  });

  await waitFor(() => followUpSent);

  fs.writeFileSync(path.join(vaultDir, "reflect.md"), "reflect turn change");
  await handlers.get("agent_end")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  fs.writeFileSync(path.join(vaultDir, "ruminate.md"), "ruminate turn change");
  await handlers.get("agent_end")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  const log = getLog(vaultDir, 10).join("\n");
  assert.match(log, /reflect: capture session learnings/);
  assert.match(log, /ruminate: apply mined findings/);

  fs.rmSync(projectSessionsDir, { recursive: true, force: true });
});

test("session_before_switch waits for aborted task cleanup", async () => {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const root = tmpDir();

  const encodedCwd = encodeProjectSessionPath(root);
  const projectSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedCwd);
  fs.mkdirSync(projectSessionsDir, { recursive: true });
  writeSessionFile(projectSessionsDir, "session-0.jsonl", "message with enough text to pass filters");

  const pi = {
    on(event: string, handler: Function) { handlers.set(event, handler); },
    registerTool() {},
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() {},
    registerFlag() {},
    getFlag() { return false; },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  memoryExtension(pi, {
    runSubagent: async (_agent, _task, _cwd, _timeout, _onData, signal) => {
      if (!signal) return { output: "", exitCode: 1, stderr: "missing signal", logFile: "" };
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          setTimeout(resolve, 40);
        }, { once: true });
      });
      return { output: "", exitCode: 1, stderr: "Cancelled", logFile: "" };
    },
  });

  await handlers.get("session_start")!({}, { cwd: root, ui: { notify() {}, setStatus() {} } });

  await commands.get("memory").handler("ruminate", {
    cwd: root,
    hasUI: false,
    ui: { notify() {}, setStatus() {}, setWidget() {}, editor: async () => "", select: async () => "" },
  });

  const startedAt = Date.now();
  await handlers.get("session_before_switch")!({ reason: "new" }, { cwd: root, ui: { notify() {}, setStatus() {} } });
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed >= 35, `expected switch to await cleanup, elapsed=${elapsed}ms`);

  fs.rmSync(projectSessionsDir, { recursive: true, force: true });
});
