import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

function createHarness() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const sendUserMessageCalls: Array<{ content: string; options?: Record<string, unknown> }> = [];
  const notifications: Array<{ message: string; level: string }> = [];

  return {
    handlers,
    commands,
    tools,
    sendUserMessageCalls,
    notifications,
    pi: {
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      registerCommand(name: string, spec: any) {
        commands.set(name, spec);
      },
      registerTool(spec: any) {
        tools.set(spec.name, spec);
      },
      registerShortcut() {},
      sendUserMessage(content: string, options?: Record<string, unknown>) {
        sendUserMessageCalls.push({ content, options });
      },
      events: {
        emit() {},
        on() {},
      },
    } as never,
    ctx: {
      hasUI: true,
      cwd: "/tmp/project",
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        setWidget() {},
      },
    } as never,
  };
}

async function loadExtensionForHome(homeDir: string) {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  const moduleUrl = `${pathToFileURL(path.join(import.meta.dirname, "index.ts")).href}?t=${Date.now()}-${Math.random()}`;
  const mod = await import(moduleUrl);

  return {
    memoryExtension: mod.default as (pi: unknown) => void,
    restore() {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    },
  };
}

test("dream auto-resume queues follow-up message from agent_end", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    const logOperationTool = harness.tools.get("log_operation");
    const agentEnd = harness.handlers.get("agent_end");

    assert.ok(memoryCommand);
    assert.ok(logOperationTool);
    assert.ok(agentEnd);

    await memoryCommand.handler("init", harness.ctx);
    await memoryCommand.handler("dream", harness.ctx);

    await logOperationTool.execute(
      "tool-1",
      { type: "dream", status: "noop", description: "Cycle complete", findings_count: 0 },
      new AbortController().signal,
      () => {},
      harness.ctx,
    );

    await agentEnd({}, harness.ctx);

    assert.equal(harness.sendUserMessageCalls.length, 2);
    assert.deepEqual(harness.sendUserMessageCalls[1].options, { deliverAs: "followUp" });
  } finally {
    restore();
  }
});
