import test from "node:test";
import assert from "node:assert/strict";
import confirmRm from "./index.ts";

test("non-rm command passes through", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "bash", input: { command: "ls -la" } },
    { hasUI: true, ui: {} },
  );
  assert.equal(result, undefined);
});

test("non-bash tool passes through", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "write", input: { path: "rm-file.txt", content: "hello" } },
    { hasUI: true, ui: {} },
  );
  assert.equal(result, undefined);
});

test("rm command without UI auto-blocks", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "bash", input: { command: "rm -rf /tmp/test" } },
    { hasUI: false, ui: {} },
  );
  assert.deepEqual(result, { block: true, reason: "rm command blocked (no UI for confirmation)" });
});

test("rm command with UI prompts and allows on Yes", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "bash", input: { command: "rm old-file.txt" } },
    {
      hasUI: true,
      ui: {
        select: async () => "Yes",
      },
    },
  );
  assert.equal(result, undefined);
});

test("rm command with UI prompts and blocks on No", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "bash", input: { command: "rm old-file.txt" } },
    {
      hasUI: true,
      ui: {
        select: async () => "No",
      },
    },
  );
  assert.deepEqual(result, { block: true, reason: "rm command blocked by user" });
});

test("rm command with UI blocks when select returns null", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "bash", input: { command: "rm old-file.txt" } },
    {
      hasUI: true,
      ui: {
        select: async () => null,
      },
    },
  );
  assert.deepEqual(result, { block: true, reason: "rm command blocked by user" });
});

test("rm within word does not trigger (e.g. terraform)", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as never;

  confirmRm(pi);
  const toolCall = handlers.get("tool_call");
  assert.ok(toolCall);

  const result = await toolCall(
    { toolName: "bash", input: { command: "terraform apply" } },
    { hasUI: true, ui: {} },
  );
  assert.equal(result, undefined);
});
