import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

function createHarness() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const widgets = new Map<string, any>();
  const sendUserMessageCalls: Array<{ content: string; options?: Record<string, unknown> }> = [];
  const notifications: Array<{ message: string; level: string }> = [];
  let idle = true;
  let hasPendingMessages = false;

  return {
    handlers,
    commands,
    tools,
    shortcuts,
    widgets,
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
      registerShortcut(key: string, spec: any) {
        shortcuts.set(key, spec);
      },
      sendUserMessage(content: string, options?: Record<string, unknown>) {
        sendUserMessageCalls.push({ content, options });
      },
      events: {
        emit() {},
        on() {},
      },
    } as never,
    setIdle(value: boolean) {
      idle = value;
    },
    setHasPendingMessages(value: boolean) {
      hasPendingMessages = value;
    },
    ctx: {
      hasUI: true,
      cwd: "/tmp/project",
      isIdle() {
        return idle;
      },
      hasPendingMessages() {
        return hasPendingMessages;
      },
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        setWidget(name: string, widget: unknown) {
          widgets.set(name, widget);
        },
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

async function createMemoryCommandFixture(homeDir: string) {
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);
  const harness = createHarness();
  memoryExtension(harness.pi);

  const memoryCommand = harness.commands.get("memory");
  assert.ok(memoryCommand);

  return { harness, memoryCommand, restore };
}

function createDefaultVault(homeDir: string): string {
  const vaultDir = path.join(homeDir, ".pi", "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");
  return vaultDir;
}

test("registers only current Pi session lifecycle events", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    assert.equal(harness.handlers.has("session_start"), true);
    assert.equal(harness.handlers.has("session_switch"), false);
    assert.equal(harness.handlers.has("session_fork"), false);
  } finally {
    restore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("session_start reconstructs vault state for replacement reasons", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const vaultDir = createDefaultVault(homeDir);
  const operationsPath = path.join(vaultDir, "memory-operations.jsonl");
  const now = Date.now();
  fs.writeFileSync(
    operationsPath,
    JSON.stringify({
      type: "reflect",
      status: "keep",
      description: "Captured session reconstruction fixture",
      findingsCount: 1,
      filesChanged: ["fixture.md"],
      durationMs: 10,
      timestamp: now,
    }) + "\n",
  );
  fs.writeFileSync(path.join(vaultDir, "fixture.md"), "# Fixture\n");

  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);
    const sessionStart = harness.handlers.get("session_start");
    assert.ok(sessionStart);

    // Pi 0.82 folds switch/fork into session_start with reason.
    for (const reason of ["startup", "reload", "new", "resume", "fork"] as const) {
      await sessionStart(
        { type: "session_start", reason, previousSessionFile: reason === "startup" ? undefined : "/tmp/prev.jsonl" },
        harness.ctx,
      );

      const widget = harness.widgets.get("memory");
      assert.equal(typeof widget, "function", `expected widget after session_start reason=${reason}`);
      const theme = {
        fg(_color: string, value: string) { return value; },
      };
      const rendered = widget({}, theme).render(120).join("\n");
      assert.match(rendered, /1 ops/, `ops missing for reason=${reason}`);
      assert.match(rendered, /reflect/);
    }
  } finally {
    restore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("memory dashboard shortcuts and hints avoid the built-in ctrl+b binding", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const vaultDir = createDefaultVault(homeDir);
  fs.writeFileSync(path.join(vaultDir, "dashboard-note.md"), "# Dashboard note\n");
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);
    await harness.handlers.get("session_start")?.({}, harness.ctx);

    assert.equal(harness.shortcuts.has("ctrl+b"), false);
    assert.equal(harness.shortcuts.has("ctrl+shift+m"), true);
    assert.equal(harness.shortcuts.has("ctrl+shift+b"), true);

    const widget = harness.widgets.get("memory");
    assert.equal(typeof widget, "function");
    const theme = {
      fg(_color: string, value: string) { return value; },
    };
    const rendered = widget({}, theme).render(120).join("\n");
    assert.match(rendered, /ctrl\+shift\+m expand/);
    assert.match(rendered, /ctrl\+shift\+b fullscreen/);
  } finally {
    restore();
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test("dream auto-resume waits for settled window and sends a plain user message", async () => {
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

    assert.equal(harness.sendUserMessageCalls.length, 1);

    await delay(900);

    assert.equal(harness.sendUserMessageCalls.length, 2);
    assert.equal(harness.sendUserMessageCalls[1].options, undefined);
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

test("memory autocomplete includes forget", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryCommand, restore } = await createMemoryCommandFixture(homeDir);

  try {
    const completions = memoryCommand.getArgumentCompletions("");
    assert.ok(completions.some((item: { value: string }) => item.value === "forget"));
  } finally {
    restore();
  }
});

test("memory forget requires a topic", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { harness, memoryCommand, restore } = await createMemoryCommandFixture(homeDir);

  try {
    await memoryCommand.handler("forget", harness.ctx);

    const last = harness.notifications[harness.notifications.length - 1];
    assert.match(last.message, /Usage: \/memory forget <topic>/);
    assert.equal(harness.sendUserMessageCalls.length, 0);
  } finally {
    restore();
  }
});

test("memory forget sends agent prompt for active brain topic", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const vaultDir = createDefaultVault(homeDir);
  const { harness, memoryCommand, restore } = await createMemoryCommandFixture(homeDir);

  try {
    await memoryCommand.handler("forget acme client", harness.ctx);

    assert.equal(harness.sendUserMessageCalls.length, 1);
    assert.match(harness.sendUserMessageCalls[0].content, /# Forget Topic/);
    assert.match(harness.sendUserMessageCalls[0].content, /acme client/);
    assert.match(harness.sendUserMessageCalls[0].content, new RegExp(vaultDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(harness.notifications.map((entry) => entry.message).join("\n"), /Forgetting topic/);
  } finally {
    restore();
  }
});

test("memory status lists forget command", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { harness, memoryCommand, restore } = await createMemoryCommandFixture(homeDir);

  try {
    await memoryCommand.handler("", harness.ctx);

    const last = harness.notifications[harness.notifications.length - 1];
    assert.match(last.message, /Commands: .*forget/);
  } finally {
    restore();
  }
});

test("log_operation accepts forget operations", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    const logOperationTool = harness.tools.get("log_operation");
    assert.ok(memoryCommand);
    assert.ok(logOperationTool);

    await memoryCommand.handler("init", harness.ctx);
    fs.writeFileSync(path.join(homeDir, ".pi", "memories", "index.md"), "# Memory\n");

    await logOperationTool.execute(
      "tool-1",
      { type: "forget", status: "keep", description: "Forgot acme", findings_count: 1 },
      new AbortController().signal,
      () => {},
      harness.ctx,
    );

    const operations = fs.readFileSync(path.join(homeDir, ".pi", "memories", "memory-operations.jsonl"), "utf-8");
    assert.match(operations, /"operationType":"forget"/);
    assert.match(operations, /Forgot acme/);
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
