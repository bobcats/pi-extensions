import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import profilerExtension from "./index.ts";
import { getGlobalRecorderRuntime, resetGlobalRecorderRuntimeForTests } from "./runtime.ts";
import { appendProfileRows, profileDirectory, type ProfileRow } from "./persistence.ts";

const GLOBAL_PATCHED_KEY = Symbol.for("ext-prof.v2.runner-patched");
const GLOBAL_PATCH_STATE_KEY = Symbol.for("ext-prof.v2.patch-state");

function clearGlobals() {
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCHED_KEY];
  delete (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY];
  resetGlobalRecorderRuntimeForTests();
}

function setPatched() {
  (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY] = {
    patched: true,
    reason: "patched",
    coverage: { events: "instrumented", commands: "instrumented", tools: "instrumented" },
  };
}

async function installTestRuntime() {
  const writes: ProfileRow[][] = [];
  const dir = await mkdtemp(path.join(os.tmpdir(), "ext-prof-index-"));
  let tick = 0;
  const runtime = getGlobalRecorderRuntime({
    homeDir: dir,
    now: () => new Date(Date.UTC(2026, 1, 17, 0, 0, 0, tick++ * 10_000)).toISOString(),
    randomId: () => "run-1",
    appendRows: async (_outputPath, rows) => {
      writes.push(rows);
    },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
  });
  return { runtime, writes, dir };
}

test("registers ext-prof command and handles status", async () => {
  clearGlobals();
  setPatched();
  await installTestRuntime();
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

  try {
    await profilerExtension(pi);
    const handler = commands.get("ext-prof");
    assert.ok(handler);
    await handler!("status", { hasUI: false, ui: { notify() {} } });
    assert.match(stdout, /recording: off/);
    assert.doesNotMatch(stdout, /save|reset/);
  } finally {
    process.stdout.write = originalWrite;
    clearGlobals();
  }
});

test("warning message uses ext-prof not ext-prof-spike", async () => {
  clearGlobals();
  await installTestRuntime();
  let stdout = "";
  const events = new Map<string, (event: unknown, ctx: { hasUI: boolean; ui: { notify: (msg: string, level: string) => void; setStatus: (key: string, text?: string) => void; theme: { fg: (_color: string, text: string) => string } } }) => Promise<void>>();

  const pi = {
    registerCommand() { return undefined; },
    registerShortcut() { return undefined; },
    on(name: string, handler: (...args: never[]) => Promise<void>) {
      events.set(name, handler);
    },
  } as never;

  (globalThis as Record<symbol, unknown>)[GLOBAL_PATCH_STATE_KEY] = {
    patched: false,
    reason: "runner import failed: test",
    coverage: { events: "missing", commands: "missing", tools: "missing" },
  };

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
    clearGlobals();
  }
});

test("registers shortcut to toggle recording and updates status bar", async () => {
  clearGlobals();
  setPatched();
  await installTestRuntime();
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
    clearGlobals();
  }
});

test("default report uses command invocation cwd before last recorded cwd", async () => {
  clearGlobals();
  setPatched();
  const { runtime, dir } = await installTestRuntime();
  await appendProfileRows(path.join(profileDirectory(dir), "report.jsonl"), [
    {
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-1",
      seq: 1,
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:10.000Z",
      cwd: "/old-repo",
      extensionPath: "old.ts",
      surface: "command",
      name: "old",
      calls: 1,
      totalMs: 30,
      maxMs: 30,
      errorCount: 0,
    },
    {
      schemaVersion: 2,
      type: "aggregate_delta",
      runId: "run-1",
      seq: 1,
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:10.000Z",
      cwd: "/new-repo",
      extensionPath: "new.ts",
      surface: "command",
      name: "new",
      calls: 1,
      totalMs: 10,
      maxMs: 10,
      errorCount: 0,
    },
  ]);
  await runtime.start();
  runtime.record({ cwd: "/old-repo", extensionPath: "old.ts", surface: "command", name: "old", ms: 1, ok: true });

  const commands = new Map<string, any>();
  let stdout = "";
  const pi = {
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() { return undefined; },
    on() { return undefined; },
  } as never;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalHome = process.env.HOME;
  (process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    stdout += chunk;
    return true;
  }) as never;
  process.env.HOME = dir;

  try {
    await profilerExtension(pi);
    await commands.get("ext-prof").handler("", { hasUI: false, cwd: "/new-repo", ui: { notify() {} } });

    assert.match(stdout, /Top handlers \(\/new-repo\)/);
    assert.doesNotMatch(stdout, /Top handlers \(\/old-repo\)/);
  } finally {
    process.stdout.write = originalWrite;
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    clearGlobals();
  }
});

test("ext-prof getArgumentCompletions returns only recording subcommands", async () => {
  clearGlobals();
  setPatched();
  await installTestRuntime();
  const commands = new Map<string, any>();

  const pi = {
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() { return undefined; },
    on() { return undefined; },
  } as never;

  try {
    await profilerExtension(pi);
    const completions = commands.get("ext-prof").getArgumentCompletions("");
    assert.ok(Array.isArray(completions));
    assert.equal(completions.length, 3);
    assert.deepEqual(completions.map((c: any) => c.value).sort(), ["off", "on", "status"]);
  } finally {
    clearGlobals();
  }
});

test("ext-prof getArgumentCompletions filters by prefix and returns null for no match", async () => {
  clearGlobals();
  setPatched();
  await installTestRuntime();
  const commands = new Map<string, any>();

  const pi = {
    registerCommand(name: string, opts: any) { commands.set(name, opts); },
    registerShortcut() { return undefined; },
    on() { return undefined; },
  } as never;

  try {
    await profilerExtension(pi);
    const fn = commands.get("ext-prof").getArgumentCompletions;

    const sMatches = fn("s");
    assert.ok(Array.isArray(sMatches));
    assert.equal(sMatches.map((c: any) => c.value).sort().join(","), "status");

    const oMatches = fn("o");
    assert.ok(Array.isArray(oMatches));
    assert.equal(oMatches.map((c: any) => c.value).sort().join(","), "off,on");

    assert.equal(fn("xyz"), null);
  } finally {
    clearGlobals();
  }
});

test("session shutdown flushes reload-like reasons and only quit ends the run", async () => {
  clearGlobals();
  setPatched();
  const { runtime, writes } = await installTestRuntime();
  const events = new Map<string, (event: { reason?: string }, ctx: { hasUI: boolean; ui: { setStatus: (key: string, text?: string) => void; theme: { fg: (_color: string, text: string) => string }; notify: (message: string) => void } }) => Promise<void>>();
  const shortcuts = new Map<string, (ctx: { hasUI: boolean; ui: any }) => Promise<void>>();
  const ui = {
    setStatus() {},
    theme: { fg(_color: string, text: string) { return text; } },
    notify() {},
  };
  const pi = {
    registerCommand() { return undefined; },
    registerShortcut(name: string, options: { handler: (ctx: { hasUI: boolean; ui: typeof ui }) => Promise<void> }) { shortcuts.set(name, options.handler); },
    on(name: string, handler: any) { events.set(name, handler); },
  } as never;

  try {
    await profilerExtension(pi);
    await shortcuts.get("ctrl+alt+p")!({ hasUI: true, ui });
    runtime.record({ cwd: "/repo", extensionPath: "a.ts", surface: "event", name: "turn_start", ms: 5, ok: true });

    await events.get("session_shutdown")!({ reason: "reload" }, { hasUI: true, ui });
    assert.deepEqual(writes.map((rows) => rows[0]?.type), ["recording_start", "aggregate_delta"]);
    assert.equal(runtime.status().active, true);

    await events.get("session_shutdown")!({ reason: "quit" }, { hasUI: true, ui });
    assert.deepEqual(writes.map((rows) => rows[0]?.type), ["recording_start", "aggregate_delta", "recording_end"]);
    assert.equal(runtime.status().active, false);
  } finally {
    clearGlobals();
  }
});
