import test from "node:test";
import assert from "node:assert/strict";
import beadsExtension from "./index.ts";
import { DIRTY_TREE_CLOSE_WARNING } from "./lib.ts";

type SendCall = { message: Record<string, unknown>; options: Record<string, unknown> };
type HookHandler = (...args: any[]) => Promise<any>;

function buildHarness({ execOverride }: { execOverride?: (cmd: string, args: string[]) => Promise<any> } = {}) {
  const tools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  const hooks = new Map<string, HookHandler[]>();
  const sent: SendCall[] = [];
  const execCalls: string[] = [];

  const execImpl = execOverride ?? (async (_cmd: string, args: string[]) => {
    if (args[0] === "info") {
      return { stdout: JSON.stringify({ mode: "file", issue_count: 1 }), stderr: "", code: 0, killed: false };
    }
    if (args[0] === "close") return { stdout: "Closed bd-test", stderr: "", code: 0, killed: false };
    if (args[0] === "update") return { stdout: "Updated bd-test", stderr: "", code: 0, killed: false };
    if (args[0] === "status" && args[1] === "--porcelain") return { stdout: "", stderr: "", code: 0, killed: false };
    return { stdout: "[]", stderr: "", code: 0, killed: false };
  });

  const pi = {
    registerTool(def: { name: string; execute: (...args: any[]) => Promise<any> }) {
      tools.set(def.name, def);
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
      commands.set(name, options);
    },
    registerShortcut() {},
    registerFlag() {},
    on(event: string, handler: HookHandler) {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
    getFlag() { return false; },
    exec: async (cmd: string, args: string[]) => {
      execCalls.push(`${cmd} ${args.join(" ")}`.trim());
      return execImpl(cmd, args);
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

  return { tools, hooks, sent, execCalls, fireHook, enableBeads, closeTool, claimTool, ctx, commands };
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

test("tool close with dirty tree warns in output but does not queue duplicate model reminder", async () => {
  const h = buildHarness({
    execOverride: async (_cmd: string, args: string[]) => {
      if (args[0] === "info") {
        return { stdout: JSON.stringify({ mode: "file", issue_count: 1 }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { stdout: " M beads/index.ts", stderr: "", code: 0, killed: false };
      }
      if (args[0] === "close") return { stdout: "Closed bd-test", stderr: "", code: 0, killed: false };
      if (args[0] === "update") return { stdout: "Updated bd-test", stderr: "", code: 0, killed: false };
      return { stdout: "[]", stderr: "", code: 0, killed: false };
    },
  });

  await h.enableBeads();
  await h.claimTool("bd-aaa");
  const result = await h.closeTool("bd-aaa");

  const dirtyWarnings = h.sent.filter((s) => s.message.customType === "beads-dirty-tree-warning");
  assert.equal(dirtyWarnings.length, 0, "tool close should not queue duplicate dirty-tree model warning");

  const text = result.content.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";
  assert.match(text, /Closed bd-test/);
  assert.match(text, new RegExp(DIRTY_TREE_CLOSE_WARNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("command close with dirty tree still queues model reminder", async () => {
  const h = buildHarness({
    execOverride: async (_cmd: string, args: string[]) => {
      if (args[0] === "info") {
        return { stdout: JSON.stringify({ mode: "file", issue_count: 1 }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { stdout: " M beads/index.ts", stderr: "", code: 0, killed: false };
      }
      if (args[0] === "close") return { stdout: "Closed bd-test", stderr: "", code: 0, killed: false };
      return { stdout: "[]", stderr: "", code: 0, killed: false };
    },
  });

  await h.enableBeads();

  const cmd = h.commands.get("beads-close");
  assert.ok(cmd, "beads-close command should be registered");

  await cmd.handler("bd-aaa", h.ctx);

  const dirtyWarnings = h.sent.filter((s) => s.message.customType === "beads-dirty-tree-warning");
  assert.equal(dirtyWarnings.length, 1, "command close should queue dirty-tree model warning");
  assert.equal(dirtyWarnings[0].options.deliverAs, "nextTurn");
});

test("successful raw br bash command refreshes beads status", async () => {
  const h = buildHarness();
  await h.enableBeads();

  h.execCalls.length = 0;

  await h.fireHook("tool_result", {
    toolName: "bash",
    isError: false,
    input: { command: "br update bd-26ub --status in_progress && br show bd-26ub" },
    content: [{ type: "text", text: "ok" }],
  }, h.ctx);

  assert.ok(h.execCalls.some((c) => c === "br info --json"), "should refresh status via br info");
  assert.ok(h.execCalls.some((c) => c === "br list --json"), "should refresh status via br list");
  assert.ok(
    h.execCalls.some((c) => c === "br list --status in_progress --sort updated_at --json"),
    "should refresh in-progress list",
  );
});

test("beads-status runs stats, blocked, and in_progress queries concurrently", async () => {
  const callLog: string[] = [];
  let concurrentPeak = 0;
  let inflight = 0;

  const h = buildHarness({
    execOverride: async (_cmd: string, args: string[]) => {
      const key = args.join(" ");
      callLog.push(key);

      if (args[0] === "info") {
        return { stdout: JSON.stringify({ mode: "file", issue_count: 1 }), stderr: "", code: 0, killed: false };
      }
      if (args[0] === "check-ignore") {
        return { stdout: "", stderr: "", code: 1, killed: false };
      }

      // For stats/blocked/list, track concurrency
      if (args[0] === "stats" || args[0] === "blocked" || (args[0] === "list" && args.includes("--status"))) {
        inflight++;
        concurrentPeak = Math.max(concurrentPeak, inflight);
        await new Promise((r) => setTimeout(r, 10));
        inflight--;
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      }

      return { stdout: "[]", stderr: "", code: 0, killed: false };
    },
  });
  await h.enableBeads();

  const cmd = h.commands.get("beads-status");
  assert.ok(cmd, "beads-status command should be registered");

  const output: string[] = [];
  const ctx = { hasUI: false, ui: { setStatus() {}, notify(msg: string) { output.push(msg); } } };
  await cmd.handler("", ctx);

  assert.ok(callLog.includes("stats"), "should call br stats");
  assert.ok(callLog.includes("blocked"), "should call br blocked");
  assert.ok(callLog.some((c) => c.includes("list") && c.includes("in_progress")), "should call br list --status in_progress");
  assert.ok(concurrentPeak >= 3, `expected 3 concurrent calls, got ${concurrentPeak}`);
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
