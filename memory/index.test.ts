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

test("memory status and prompt injection use the mapped brain vault", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const poeVaultDir = path.join(homeDir, ".pi", "memory-brains", "poe");
  const configPath = path.join(homeDir, ".pi", "memory-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(poeVaultDir, { recursive: true });
  fs.writeFileSync(path.join(poeVaultDir, "index.md"), "# Memory\n- [[poe-note]]\n");
  fs.writeFileSync(configPath, JSON.stringify({
    defaultBrain: "main",
    brains: {
      main: { path: path.join(homeDir, ".pi", "memories") },
      poe: { path: poeVaultDir },
    },
    projectMappings: [
      { projectPath: "/tmp/project", brain: "poe" },
    ],
  }));

  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    const beforeAgentStart = harness.handlers.get("before_agent_start");

    assert.ok(memoryCommand);
    assert.ok(beforeAgentStart);

    await memoryCommand.handler("", harness.ctx);

    const notification = harness.notifications[harness.notifications.length - 1];
    assert.match(notification.message, /Brain: poe/);
    assert.match(notification.message, /memory-brains\/poe/);
    assert.doesNotMatch(notification.message, /\.pi\/memories/);

    const result = await beforeAgentStart({ systemPrompt: "base" }, harness.ctx);
    assert.ok(result);
    assert.match(result.systemPrompt, /memory-brains\/poe/);
    assert.doesNotMatch(result.systemPrompt, /\.pi\/memories/);
  } finally {
    restore();
  }
});

test("memory brain commands manage brains and mappings", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    assert.ok(memoryCommand);

    await memoryCommand.handler("brain create poe", harness.ctx);
    await memoryCommand.handler("brain map /tmp/project poe", harness.ctx);
    await memoryCommand.handler("brain list", harness.ctx);
    await memoryCommand.handler("brain which", harness.ctx);
    await memoryCommand.handler("brain remove poe", harness.ctx);
    await memoryCommand.handler("brain unmap /tmp/project", harness.ctx);
    await memoryCommand.handler("brain remove poe", harness.ctx);

    const messages = harness.notifications.map((entry) => entry.message).join("\n---\n");
    assert.match(messages, /main/);
    assert.match(messages, /poe/);
    assert.match(messages, /active/);
    assert.match(messages, /Cannot remove/);
  } finally {
    restore();
  }
});

test("log_operation writes history into the mapped brain vault only", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const mainVaultDir = path.join(homeDir, ".pi", "memories");
  const poeVaultDir = path.join(homeDir, ".pi", "memory-brains", "poe");
  const configPath = path.join(homeDir, ".pi", "memory-config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(mainVaultDir, { recursive: true });
  fs.mkdirSync(poeVaultDir, { recursive: true });
  fs.writeFileSync(path.join(mainVaultDir, "index.md"), "# Memory\n");
  fs.writeFileSync(path.join(poeVaultDir, "index.md"), "# Memory\n");
  fs.writeFileSync(configPath, JSON.stringify({
    defaultBrain: "main",
    brains: {
      main: { path: mainVaultDir },
      poe: { path: poeVaultDir },
    },
    projectMappings: [
      { projectPath: "/tmp/project", brain: "poe" },
    ],
  }));

  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const logOperationTool = harness.tools.get("log_operation");
    assert.ok(logOperationTool);

    fs.writeFileSync(path.join(poeVaultDir, "note.md"), "# Note\n");
    await logOperationTool.execute(
      "tool-1",
      { type: "reflect", status: "keep", description: "Store poe note", findings_count: 1 },
      new AbortController().signal,
      () => {},
      harness.ctx,
    );

    const poeOperations = fs.readFileSync(path.join(poeVaultDir, "memory-operations.jsonl"), "utf-8");
    assert.match(poeOperations, /Store poe note/);
    assert.equal(fs.existsSync(path.join(mainVaultDir, "memory-operations.jsonl")), false);
  } finally {
    restore();
  }
});

test("brain commands reject invalid names and duplicate creates with clear messages", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    assert.ok(memoryCommand);

    await memoryCommand.handler("brain create Poe!", harness.ctx);
    await memoryCommand.handler("brain create poe", harness.ctx);
    await memoryCommand.handler("brain create poe", harness.ctx);
    await memoryCommand.handler("brain unmap /tmp/unknown-project", harness.ctx);
    await memoryCommand.handler("brain list", harness.ctx);

    const messages = harness.notifications.map((entry) => entry.message).join("\n---\n");
    assert.match(messages, /Invalid brain name/);
    assert.match(messages, /already exists/);
    assert.match(messages, /No mapping found/);
    assert.match(messages, /default/);
  } finally {
    restore();
  }
});
