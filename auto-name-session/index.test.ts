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
  assert.deepEqual(completeCall?.options, { apiKey: "test-key", headers: { "x-test": "1" }, maxTokens: 120 });
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

  assert.match(promptText, /<clean_user_goal>debug the auto-name extension<\/clean_user_goal>/);
  assert.doesNotMatch(promptText, /first turn user message/);
  assert.doesNotMatch(promptText, /meta follow-up message/);
  assert.doesNotMatch(promptText.match(/<clean_user_goal>[\s\S]*?<\/clean_user_goal>/)?.[0] ?? "", /tail the log and paste it/);
  assert.doesNotMatch(promptText.match(/<clean_user_goal>[\s\S]*?<\/clean_user_goal>/)?.[0] ?? "", /I found the provider error and added logging\./);
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

  assert.match(promptText, /<clean_user_goal>event turn first user<\/clean_user_goal>/);
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

test("waits for a final assistant response before naming", async () => {
  const harness = createHarness();
  let called = false;

  createAutoNameExtension({
    completeFn: async () => {
      called = true;
      return {
        role: "assistant",
        content: [{ type: "text", text: "Premature title" }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "inspect the repository" }] },
        { role: "assistant", content: [{ type: "text", text: "I'll read the files." }], stopReason: "toolUse" },
      ],
    },
    harness.ctx,
  );

  assert.equal(called, false);
  assert.equal(harness.sessionName, undefined);
});

test("does not use an earlier stopped assistant when the latest assistant is still using tools", async () => {
  const harness = createHarness();
  let called = false;

  createAutoNameExtension({
    completeFn: async () => {
      called = true;
      return {
        role: "assistant",
        content: [{ type: "text", text: "Stale title" }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "inspect the repository" }] },
        { role: "assistant", content: [{ type: "text", text: "Earlier completed answer." }], stopReason: "stop" },
        { role: "user", content: [{ type: "text", text: "continue" }] },
        { role: "assistant", content: [{ type: "text", text: "I'll read more files." }], stopReason: "toolUse" },
      ],
    },
    harness.ctx,
  );

  assert.equal(called, false);
  assert.equal(harness.sessionName, undefined);
});

test("summarizes tool results by matching toolCallId to assistant tool calls", async () => {
  const harness = createHarness();
  let promptText = "";

  createAutoNameExtension({
    completeFn: async (_model, context) => {
      promptText = context.messages[0].content[0].text;
      return {
        role: "assistant",
        content: [{ type: "text", text: "Read package file" }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "check the package metadata" }] },
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "call_read", name: "read", arguments: { path: "package.json" } },
            { type: "toolCall", id: "call_bash", name: "bash", arguments: { command: "git status --short" } },
          ],
          stopReason: "toolUse",
        },
        {
          role: "toolResult",
          toolCallId: "call_bash",
          content: [{ type: "text", text: " M auto-name-session/index.ts" }],
          isError: false,
        },
        {
          role: "toolResult",
          toolCallId: "call_read",
          toolName: "stale_tool_name",
          content: [{ type: "text", text: '{ "name": "auto-name-session-extension" }' }],
          isError: false,
        },
        { role: "assistant", content: [{ type: "text", text: "The package is auto-name-session-extension." }], stopReason: "stop" },
      ],
    },
    harness.ctx,
  );

  assert.match(promptText, /call read/);
  assert.match(promptText, /package\.json/);
  assert.match(promptText, /result bash/);
  assert.match(promptText, /git status/);
  assert.match(promptText, /result read/);
  assert.match(promptText, /auto-name-session-extension/);
  assert.doesNotMatch(promptText, /stale_tool_name/);
});

test("builds rich context from cleaned user text, skill metadata, assistant result, and retries generic titles", async () => {
  const harness = createHarness();
  const prompts: string[] = [];
  const responses = ["Memory ingest workflow", "PostgreSQL anti patterns"];

  harness.ctx.sessionManager.getBranch = () => [
    {
      type: "message",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text:
              '<skill name="memory-ingest" location="/tmp/SKILL.md">\nThis is a long skill manual that should not be sent as the task subject.\n</skill>\n\nhttps://wiki.postgresql.org/wiki/Don\'t_Do_This',
          },
        ],
      },
    },
  ];

  createAutoNameExtension({
    completeFn: async (_model, context) => {
      prompts.push(context.messages[0].content[0].text);
      return {
        role: "assistant",
        content: [{ type: "text", text: responses[prompts.length - 1] }],
      };
    },
  })(harness.pi);

  const handler = harness.handlers.get("agent_end");
  assert.ok(handler);

  await handler(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "fallback user text" }] },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Ingest complete. Updated the PostgreSQL practices note with anti-pattern guidance.",
            },
          ],
          stopReason: "stop",
        },
      ],
    },
    harness.ctx,
  );

  assert.equal(harness.sessionName, "PostgreSQL anti patterns");
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /<skill_names>memory-ingest<\/skill_names>/);
  assert.match(prompts[0], /<clean_user_goal>https:\/\/wiki\.postgresql\.org\/wiki\/Don't_Do_This<\/clean_user_goal>/);
  assert.match(prompts[0], /<url_clues>/);
  assert.match(prompts[0], /PostgreSQL practices note/);
  assert.doesNotMatch(prompts[0], /long skill manual/);
  assert.match(prompts[1], /too generic/i);
});
