import test from "node:test";
import assert from "node:assert/strict";
import profilerExtension from "./index.ts";

const GLOBAL_PATCHED_KEY = Symbol.for("ext-prof.v1.runner-patched");
const GLOBAL_PATCH_STATE_KEY = Symbol.for("ext-prof.v1.patch-state");

test("registers ext-prof command and handles status", async () => {
  const commands = new Map<
    string,
    (args: string, ctx: { hasUI: boolean; ui: { notify: (...args: unknown[]) => void } }) => Promise<void>
  >();
  let stdout = "";

  const pi = {
    registerCommand(
      name: string,
      options: {
        handler: (args: string, ctx: { hasUI: boolean; ui: { notify: (...args: unknown[]) => void } }) => Promise<void>;
      },
    ) {
      commands.set(name, options.handler);
    },
    registerShortcut() {
      return undefined;
    },
    on() {
      return undefined;
    },
  } as never;

  const originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    stdout += chunk;
    return true;
  }) as never;

  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY];

  try {
    await profilerExtension(pi);
    const handler = commands.get("ext-prof");
    assert.ok(handler);
    await handler!("status", { hasUI: false, ui: { notify() {} } });
    assert.match(stdout, /enabled: off/);
    assert.doesNotMatch(stdout, /patch: not patched/);
  } finally {
    process.stdout.write = originalWrite;
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY];
  }
});

test("warning message uses ext-prof not ext-prof-spike", async () => {
  let stdout = "";
  const events = new Map<string, (event: unknown, ctx: { hasUI: boolean; ui: { notify: (msg: string, level: string) => void; setStatus: (key: string, text?: string) => void; theme: { fg: (_color: string, text: string) => string } } }) => Promise<void>>();

  const pi = {
    registerCommand() { return undefined; },
    registerShortcut() { return undefined; },
    on(name: string, handler: (...args: never[]) => Promise<void>) {
      events.set(name, handler);
    },
  } as never;

  // Pre-set a failed patch state so ensurePatched() picks it up
  // and session_start emits the warning
  (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY] = {
    patched: false,
    reason: "runner import failed: test",
    coverage: { events: "missing", commands: "missing", tools: "missing" },
  };
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];

  const originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    stdout += chunk;
    return true;
  }) as never;

  try {
    await profilerExtension(pi);
    const sessionStart = events.get("session_start");
    assert.ok(sessionStart);
    await sessionStart!({}, {
      hasUI: false,
      ui: {
        notify() {},
        setStatus() {},
        theme: { fg(_color: string, text: string) { return text; } },
      },
    });
    assert.doesNotMatch(stdout, /spike/, "warning should not contain 'spike'");
    assert.match(stdout, /ext-prof inactive/, "warning should say 'ext-prof inactive'");
  } finally {
    process.stdout.write = originalWrite;
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY];
  }
});

test("registers shortcut to enable profiler and updates status bar", async () => {
  const shortcuts = new Map<string, (ctx: { hasUI: boolean; ui: { setStatus: (key: string, text?: string) => void } }) => Promise<void>>();
  const events = new Map<string, (event: unknown, ctx: { hasUI: boolean; ui: { setStatus: (key: string, text?: string) => void; theme: { fg: (_color: string, text: string) => string }; notify: (message: string) => void } }) => Promise<void>>();
  const statuses: Array<{ key: string; text: string | undefined }> = [];

  const ui = {
    setStatus(key: string, text?: string) {
      statuses.push({ key, text });
    },
    theme: {
      fg(_color: string, text: string) {
        return text;
      },
    },
    notify() {
      return undefined;
    },
  };

  const pi = {
    registerCommand() {
      return undefined;
    },
    registerShortcut(name: string, options: { handler: (ctx: { hasUI: boolean; ui: typeof ui }) => Promise<void> }) {
      shortcuts.set(name, options.handler);
    },
    on(name: string, handler: (event: unknown, ctx: { hasUI: boolean; ui: typeof ui }) => Promise<void>) {
      events.set(name, handler);
    },
  } as never;

  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY];

  try {
    await profilerExtension(pi);

    const sessionStart = events.get("session_start");
    assert.ok(sessionStart);
    await sessionStart!({}, { hasUI: true, ui });

    assert.equal(statuses.at(-1)?.key, "ext-prof");
    assert.match(statuses.at(-1)?.text ?? "", /prof:off/);

    const shortcut = shortcuts.get("ctrl+alt+p");
    assert.ok(shortcut);
    await shortcut!({ hasUI: true, ui });

    assert.equal(statuses.at(-1)?.key, "ext-prof");
    assert.match(statuses.at(-1)?.text ?? "", /prof:on/);

    await shortcut!({ hasUI: true, ui });

    assert.equal(statuses.at(-1)?.key, "ext-prof");
    assert.match(statuses.at(-1)?.text ?? "", /prof:off/);
  } finally {
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];
    delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY];
  }
});
