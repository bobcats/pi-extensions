import test from "node:test";
import assert from "node:assert/strict";
import { CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT, createHandoffExtension } from "./index.ts";

function createHarness() {
  const commands = new Map<string, any>();
  const notifications: Array<{ message: string; level: string }> = [];
  const confirmations: Array<{ title: string; message: string }> = [];
  const editorTexts: string[] = [];
  let confirmResult = true;
  let editorText = "";
  let customResult: unknown = null;
  let newSessionCalls = 0;
  let setSessionNameCalls = 0;

  return {
    commands,
    notifications,
    confirmations,
    editorTexts,
    setConfirmResult(value: boolean) {
      confirmResult = value;
    },
    setEditorTextValue(value: string) {
      editorText = value;
    },
    // ui.custom() is intentionally a configurable return-value stub so command-handler tests
    // can force the post-loader branch with harness.setCustomResult(...) instead of trying to
    // instantiate a real BorderedLoader inside Node tests.
    setCustomResult(value: unknown) {
      customResult = value;
    },
    get newSessionCalls() {
      return newSessionCalls;
    },
    get setSessionNameCalls() {
      return setSessionNameCalls;
    },
    pi: {
      registerCommand(name: string, spec: any) {
        commands.set(name, spec);
      },
      setSessionName() {
        setSessionNameCalls += 1;
      },
    } as never,
    ctx: {
      hasUI: true,
      model: { provider: "openai", id: "gpt-4o" },
      cwd: "/tmp/project",
      modelRegistry: {
        find(provider: string, modelId: string) {
          return provider === "anthropic" && modelId === "claude-sonnet-4-5"
            ? { provider, id: modelId }
            : null;
        },
        async getApiKeyAndHeaders(model: any) {
          return {
            ok: true as const,
            apiKey: `key-for-${model.provider}/${model.id}`,
            headers: { "x-test": "1" },
          };
        },
      },
      sessionManager: {
        getBranch() {
          return [] as any[];
        },
        getSessionFile() {
          return "/tmp/project/.pi/sessions/current.jsonl";
        },
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        getEditorText() {
          return editorText;
        },
        async confirm(title: string, message: string) {
          confirmations.push({ title, message });
          return confirmResult;
        },
        setEditorText(text: string) {
          editorTexts.push(text);
        },
        async custom<T>(_builder: any): Promise<T> {
          return customResult as T;
        },
      },
    } as never,
  };
}

function nonEmptyBranch() {
  return [
    {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "Please continue the auth cleanup" }] },
    },
    {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "I will inspect auth/service.ts." }] },
    },
  ];
}

test("exports Amp's handoff context prompt verbatim", () => {
  assert.equal(
    CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT,
    `Extract relevant context from the conversation. Write from first person
perspective ("I did...", "I told you...").

Consider what's useful based on the user's request. Questions that might
be relevant:
  - What did I just do or implement?
  - What instructions did I already give you which are still relevant
    (e.g. follow patterns in the codebase)?
  - Did I provide a plan or spec that should be included?
  - What did I already tell you that's important (certain libraries,
    patterns, constraints, preferences)?
  - What important technical details did I discover (APIs, methods,
    patterns)?
  - What caveats, limitations, or open questions did I find?
  - What files did I tell you to edit that I should continue working on?

Extract what matters for the specific request. Don't answer questions
that aren't relevant. Pick an appropriate length based on the complexity
of the request.

Focus on capabilities and behavior, not file-by-file changes. Avoid
excessive implementation details (variable names, storage keys, constants)
unless critical.

Format: Plain text with bullets. No markdown headers, no bold/italic,
no code fences. Use workspace-relative paths for files.`,
  );
});

test("notifies and aborts when not in interactive mode", async () => {
  const harness = createHarness();
  (harness.ctx as any).hasUI = false;
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.deepEqual(harness.notifications, [
    { message: "Handoff requires interactive mode.", level: "error" },
  ]);
  assert.equal(harness.newSessionCalls, 0);
});

test("notifies when No model selected", async () => {
  const harness = createHarness();
  (harness.ctx as any).model = undefined;
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.deepEqual(harness.notifications, [{ message: "No model selected.", level: "error" }]);
  assert.equal(harness.newSessionCalls, 0);
});

test("notifies Usage: /handoff when goal is empty", async () => {
  const harness = createHarness();
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("   ", harness.ctx);
  assert.deepEqual(harness.notifications, [
    { message: "Usage: /handoff <goal for new session>", level: "error" },
  ]);
});

test("notifies No conversation to hand off when branch is empty", async () => {
  const harness = createHarness();
  // Branch contains only system message and tool-only entries — should not count as conversation.
  harness.ctx.sessionManager.getBranch = () => [
    { type: "message", message: { role: "system", content: [{ type: "text", text: "preamble" }] } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "" }] } },
    { type: "tool_result", message: null },
  ];
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.deepEqual(harness.notifications, [
    { message: "No conversation to hand off.", level: "error" },
  ]);
});

test("aborts when user denies overwrite of editor text", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.setEditorTextValue("draft message");
  harness.setConfirmResult(false);
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.equal(harness.confirmations.length, 1);
  assert.equal(harness.newSessionCalls, 0);
  assert.equal(harness.editorTexts.length, 0);
});

test("falls back to ctx.model when Sonnet is missing from registry", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.ctx.modelRegistry.find = () => null;
  harness.setCustomResult("- I made progress.\n- Continue here.");
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.equal(
    harness.notifications.find((n) => n.level === "error"),
    undefined,
    "should not emit an error when ctx.model fallback is usable",
  );
});

test("falls back to ctx.model when Sonnet auth fails", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.ctx.modelRegistry.getApiKeyAndHeaders = async (model: any) => {
    if (model.provider === "anthropic") return { ok: false as const, error: "no key" };
    return { ok: true as const, apiKey: "fallback-key", headers: { "x-test": "1" } };
  };
  harness.setCustomResult("- summary text");
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.equal(
    harness.notifications.find((n) => n.level === "error"),
    undefined,
    "should not emit an error when fallback auth is usable",
  );
});

test("happy path: Sonnet available, generates summary, switches session, prefills editor", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.setCustomResult("- I already fixed auth.\n- Continue in auth/service.ts");
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the auth work", harness.ctx);
  assert.equal(harness.newSessionCalls, 1);
  assert.equal(harness.editorTexts.length, 1);
  assert.ok(
    harness.editorTexts[0].startsWith("continue the auth work\n\n"),
    "editor text should be goal + summary",
  );
  assert.ok(
    harness.editorTexts[0].includes("- I already fixed auth."),
    "editor text should include generated summary",
  );
  assert.deepEqual(
    harness.notifications.find((n) => n.level === "info"),
    { message: "Handoff ready — submit when ready.", level: "info" },
  );
});

test("notifies Handoff cancelled when generation is aborted", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.setCustomResult(null);
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the auth work", harness.ctx);
  assert.equal(harness.newSessionCalls, 0);
  assert.equal(harness.editorTexts.length, 0);
  assert.deepEqual(harness.notifications, [
    { message: "Handoff cancelled.", level: "info" },
  ]);
});

test("notifies New session cancelled when newSession is cancelled", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.setCustomResult("- summary text");
  (harness.ctx as any).newSession = async () => ({ cancelled: true });
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the auth work", harness.ctx);
  assert.equal(harness.editorTexts.length, 0);
  assert.deepEqual(harness.notifications, [
    { message: "New session cancelled.", level: "info" },
  ]);
});

test("does not call setSessionName", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.setCustomResult("- summary");
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the auth work", harness.ctx);
  assert.equal(harness.setSessionNameCalls, 0);
});

test("generateHandoffSummary uses the system prompt and serialized conversation", async () => {
  const { generateHandoffSummary } = await import("./index.ts");
  const completeCalls: any[] = [];
  const result = await generateHandoffSummary({
    completeFn: async (model: any, prompt: any, options: any) => {
      completeCalls.push({ model, prompt, options });
      return {
        role: "assistant",
        content: [{ type: "text", text: "- I already fixed auth.\n- Continue in auth/service.ts" }],
        stopReason: "stop",
      };
    },
    model: { provider: "anthropic", id: "claude-sonnet-4-5" },
    apiKey: "test-key",
    headers: { "x-test": "1" },
    messages: [{ role: "user", content: [{ type: "text", text: "Continue the auth cleanup" }] }],
    goal: "continue the auth cleanup",
  });
  assert.equal(result, "- I already fixed auth.\n- Continue in auth/service.ts");
  assert.equal(completeCalls.length, 1);
  assert.equal(completeCalls[0].prompt.systemPrompt, CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT);
  assert.ok(
    completeCalls[0].prompt.messages[0].content[0].text.includes("## Conversation History"),
    "user message should contain serialized conversation",
  );
  assert.ok(
    completeCalls[0].prompt.messages[0].content[0].text.includes("continue the auth cleanup"),
    "user message should contain the goal",
  );
  assert.deepEqual(completeCalls[0].options, { apiKey: "test-key", headers: { "x-test": "1" }, signal: undefined });
});

test("notifies when no usable model credentials are available", async () => {
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = nonEmptyBranch;
  harness.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false as const, error: "no key" });
  createHandoffExtension()(harness.pi);
  const cmd = harness.commands.get("handoff");
  await cmd.handler("continue the work", harness.ctx);
  assert.deepEqual(harness.notifications, [
    { message: "Handoff: no usable model credentials", level: "error" },
  ]);
  assert.equal(harness.newSessionCalls, 0);
});
