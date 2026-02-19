import test from "node:test";
import assert from "node:assert/strict";
import memoryExtension from "./index.ts";

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

  // Simulate session_start with a tmp dir that has no memory files
  const sessionStart = handlers.get("session_start")!;
  await sessionStart({}, { cwd: "/nonexistent/path", ui: { notify() {}, setStatus() {} } });

  // Even with no memory files, before_agent_start injects write instructions
  const beforeAgent = handlers.get("before_agent_start")!;
  const result = await beforeAgent({ systemPrompt: "base prompt" });
  assert.ok(result);
  assert.match(result.systemPrompt, /base prompt/);
  assert.match(result.systemPrompt, /Updating Memories/);
});

test("tool_call blocks write to MEMORY.md over 200 lines", async () => {
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

  // Init paths
  await handlers.get("session_start")!({}, { cwd: "/proj", ui: { notify() {}, setStatus() {} } });

  const toolCall = handlers.get("tool_call")!;

  // Write 201 lines to MEMORY.md → should block
  const content = Array.from({ length: 201 }, (_, i) => `line ${i}`).join("\n");
  const result = await toolCall({
    toolName: "write",
    input: { path: "/proj/.pi/memories/MEMORY.md", content },
  });
  assert.ok(result);
  assert.equal(result.block, true);
  assert.match(result.reason, /200/);
  assert.match(result.reason, /201/);
});

test("tool_call allows write to MEMORY.md under limit", async () => {
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
    input: { path: "/proj/.pi/memories/MEMORY.md", content: "short content" },
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
    input: { path: "/proj/.pi/memories/testing.md", content },
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

  // Disable
  let notified = "";
  await commands.get("memory").handler("off", { ui: { notify(msg: string) { notified = msg; }, setStatus() {} } });
  assert.match(notified, /disabled/i);

  // before_agent_start should skip injection
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

  // Disable then re-enable
  await commands.get("memory").handler("off", { ui: { notify() {}, setStatus() {} } });
  await commands.get("memory").handler("on", { ui: { notify() {}, setStatus() {} } });

  // before_agent_start should inject again
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

  // Disable memory
  await commands.get("memory").handler("off", { ui: { notify() {}, setStatus() {} } });

  // Write over-limit to MEMORY.md → should pass through (not blocked)
  const content = Array.from({ length: 201 }, (_, i) => `line ${i}`).join("\n");
  const result = await handlers.get("tool_call")!({
    toolName: "write",
    input: { path: "/proj/.pi/memories/MEMORY.md", content },
  });
  assert.equal(result, undefined);
});
