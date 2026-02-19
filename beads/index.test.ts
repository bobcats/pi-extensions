import test from "node:test";
import assert from "node:assert/strict";
import beadsExtension from "./index.ts";

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
