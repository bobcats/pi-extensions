import test from "node:test";
import assert from "node:assert/strict";
import { createAutoNameExtension } from "./index.ts";

function createHarness() {
  const handlers = new Map<string, Function>();
  let sessionName: string | undefined;
  let title: string | undefined;

  return {
    handlers,
    get sessionName() {
      return sessionName;
    },
    get title() {
      return title;
    },
    pi: {
      on(event: string, handler: Function) {
        handlers.set(event, handler);
      },
      getSessionName() {
        return sessionName;
      },
      setSessionName(name: string) {
        sessionName = name;
      },
    } as never,
    ctx: {
      cwd: "/tmp/project",
      model: { provider: "openai-codex", id: "gpt-5.3-codex" },
      modelRegistry: {
        find(provider: string, modelId: string) {
          return { provider, id: modelId };
        },
        async getApiKeyAndHeaders() {
          return { ok: true as const, apiKey: "test-key", headers: { "x-test": "1" } };
        },
      },
      sessionManager: {
        getBranch() {
          return [];
        },
      },
      ui: {
        setTitle(nextTitle: string) {
          title = nextTitle;
        },
      },
    } as never,
  };
}

test("uses getApiKeyAndHeaders and names the session", async () => {
  const harness = createHarness();
  let completeCall: { options?: Record<string, unknown> } | undefined;

  createAutoNameExtension({
    completeFn: async (_model, _context, options) => {
      completeCall = { options };
      return {
        role: "assistant",
        content: [{ type: "text", text: "Fix auto-name session" }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "please fix this extension error" }] },
        { role: "assistant", content: [{ type: "text", text: "I will inspect the extension." }], stopReason: "stop" },
      ],
    },
    harness.ctx,
  );

  assert.equal(harness.sessionName, "Fix auto-name session");
  assert.equal(harness.title, "π - Fix auto-name session - project");
  assert.deepEqual(completeCall?.options, { apiKey: "test-key", headers: { "x-test": "1" }, maxTokens: 30 });
});

test("prefers first session user message for naming prompt", async () => {
  const harness = createHarness();
  let promptText = "";

  harness.ctx.sessionManager.getBranch = () => [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "debug the auto-name extension" }] } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I found the provider error and added logging." }], stopReason: "stop" } },
  ];

  createAutoNameExtension({
    completeFn: async (_model, context) => {
      promptText = context.messages[0].content[0].text;
      return {
        role: "assistant",
        content: [{ type: "text", text: "Debug auto-name extension" }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "first turn user message" }] },
        { role: "assistant", content: [{ type: "text", text: "tail the log and paste it" }], stopReason: "stop" },
        { role: "user", content: [{ type: "text", text: "meta follow-up message" }] },
      ],
    },
    harness.ctx,
  );

  assert.match(promptText, /<message>debug the auto-name extension<\/message>/);
  assert.doesNotMatch(promptText, /first turn user message/);
  assert.doesNotMatch(promptText, /meta follow-up message/);
  assert.doesNotMatch(promptText, /tail the log and paste it/);
  assert.doesNotMatch(promptText, /I found the provider error and added logging\./);
});

test("falls back to current turn messages when session branch has no user message", async () => {
  const harness = createHarness();
  let promptText = "";

  harness.ctx.sessionManager.getBranch = () => [
    { type: "session_info", name: "Some name" },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "No user messages in branch" }] } },
  ];

  createAutoNameExtension({
    completeFn: async (_model, context) => {
      promptText = context.messages[0].content[0].text;
      return {
        role: "assistant",
        content: [{ type: "text", text: "Fix extension naming" }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "event turn first user" }] },
        { role: "assistant", content: [{ type: "text", text: "I will inspect the extension." }], stopReason: "stop" },
      ],
    },
    harness.ctx,
  );

  assert.match(promptText, /<message>event turn first user<\/message>/);
});

test("skips naming when auth resolution fails", async () => {
  const harness = createHarness();
  harness.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false as const, error: "missing auth" });
  let called = false;

  createAutoNameExtension({
    completeFn: async () => {
      called = true;
      throw new Error("should not run");
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "please fix this extension error" }] },
        { role: "assistant", content: [{ type: "text", text: "I will inspect the extension." }], stopReason: "stop" },
      ],
    },
    harness.ctx,
  );

  assert.equal(called, false);
  assert.equal(harness.sessionName, undefined);
});
