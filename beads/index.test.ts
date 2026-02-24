import test from "node:test";
import assert from "node:assert/strict";
import beadsExtension from "./index.ts";

type SendCall = { message: Record<string, unknown>; options: Record<string, unknown> };
type HookHandler = (...args: any[]) => Promise<any>;

function buildHarness() {
  const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const hooks = new Map<string, HookHandler[]>();
  const sent: SendCall[] = [];

  const pi = {
    registerTool(def: { name: string; execute: (...args: any[]) => Promise<any> }) {
      tools.set(def.name, def);
    },
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    on(event: string, handler: HookHandler) {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
    getFlag() { return false; },
    exec: async (_cmd: string, args: string[]) => {
      if (args[0] === "info") {
        return { stdout: JSON.stringify({ mode: "file", issue_count: 1 }), stderr: "", code: 0, killed: false };
      }
      // br close, br update, br comments, git status — all succeed
      if (args[0] === "close") return { stdout: "Closed bd-test", stderr: "", code: 0, killed: false };
      if (args[0] === "update") return { stdout: "Updated bd-test", stderr: "", code: 0, killed: false };
      if (args[0] === "status" && args[1] === "--porcelain") return { stdout: "", stderr: "", code: 0, killed: false };
      return { stdout: "[]", stderr: "", code: 0, killed: false };
    },
    sendMessage(message: Record<string, unknown>, options: Record<string, unknown>) {
      sent.push({ message, options });
    },
  } as never;

  beadsExtension(pi);

  const ctx = { hasUI: false, ui: { setStatus() {}, notify() {} } };

  async function fireHook(name: string, ...args: any[]) {
    for (const handler of hooks.get(name) ?? []) {
      await handler(...args);
    }
  }

  async function enableBeads() {
    await fireHook("session_start", {}, ctx);
  }

  async function closeTool(id: string) {
    const tool = tools.get("beads")!;
    return tool.execute("call-id", { action: "close", id, reason: "done" }, undefined, undefined, ctx);
  }

  async function claimTool(id: string) {
    const tool = tools.get("beads")!;
    return tool.execute("call-id", { action: "claim", id }, undefined, undefined, ctx);
  }

  return { tools, hooks, sent, fireHook, enableBeads, closeTool, claimTool, ctx };
}

test("registers beads-mode command", () => {
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();

  const pi = {
    registerTool() {},
    registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
      commands.set(name, options);
    },
    registerShortcut() {},
    registerFlag() {},
    on() {},
    getFlag() {
      return false;
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    sendMessage() {},
  } as never;

  beadsExtension(pi);
  assert.ok(commands.has("beads-mode"));
});

test("beads tool returns mode-off message when disabled", async () => {
  const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();

  const pi = {
    registerTool(def: { name: string; execute: (...args: any[]) => Promise<any> }) {
      tools.set(def.name, def);
    },
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    on() {},
    getFlag() {
      return false;
    },
    exec: async (_cmd: string, args: string[]) => {
      if (args[0] === "info") {
        return { stdout: "", stderr: "not initialized", code: 2, killed: false };
      }
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
    sendMessage() {},
  } as never;

  beadsExtension(pi);
  const tool = tools.get("beads");
  assert.ok(tool);

  const result = await tool!.execute(
    "id",
    { action: "ready" },
    undefined,
    undefined,
    { hasUI: false, ui: { setStatus() {} } },
  );

  assert.equal(result.content[0].text, "Beads mode is off. Enable with /beads-mode on (or Ctrl+B).");
});

test("close sends auto-continue message", async () => {
  const h = buildHarness();
  await h.enableBeads();
  await h.claimTool("bd-aaa");
  await h.closeTool("bd-aaa");

  const continues = h.sent.filter((s) => s.message.customType === "beads-auto-continue");
  assert.equal(continues.length, 1);
  assert.ok((continues[0].message.content as string).includes("bd-aaa"));
  assert.equal(continues[0].options.triggerTurn, true);
});

test("second close coalesces auto-continue (no duplicate message)", async () => {
  const h = buildHarness();
  await h.enableBeads();
  await h.claimTool("bd-aaa");
  await h.closeTool("bd-aaa");
  await h.claimTool("bd-bbb");
  await h.closeTool("bd-bbb");

  const continues = h.sent.filter((s) => s.message.customType === "beads-auto-continue");
  assert.equal(continues.length, 1, "only one auto-continue should be sent");
});

test("before_agent_start resets coalesce flag so next close sends again", async () => {
  const h = buildHarness();
  await h.enableBeads();
  await h.claimTool("bd-aaa");
  await h.closeTool("bd-aaa");

  // Simulate the model starting a new turn
  await h.fireHook("before_agent_start", {}, h.ctx);

  await h.claimTool("bd-bbb");
  await h.closeTool("bd-bbb");

  const continues = h.sent.filter((s) => s.message.customType === "beads-auto-continue");
  assert.equal(continues.length, 2, "second auto-continue should fire after flag reset");
});
