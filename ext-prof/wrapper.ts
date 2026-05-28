import { recordInvocation, type Collector, type Surface } from "./collector.ts";
import type { RecorderRuntime } from "./runtime.ts";

const WRAPPED = Symbol.for("ext-prof.v2.wrapped");

type Fn = (...args: unknown[]) => Promise<unknown> | unknown;
type WrappedFn = Fn & { [WRAPPED]?: true };
type RuntimeLike = Pick<RecorderRuntime, "record" | "status">;

function isWrapped(fn: Fn): fn is WrappedFn {
  return Boolean((fn as WrappedFn)[WRAPPED]);
}

function contextCwd(callArgs: unknown[]): string | undefined {
  for (let i = callArgs.length - 1; i >= 0; i -= 1) {
    const value = callArgs[i];
    if (value && typeof value === "object" && "cwd" in value) {
      const cwd = (value as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && cwd.trim()) return cwd;
    }
  }
  return undefined;
}

async function callTimed(args: {
  extensionPath: string;
  surface: Surface;
  name: string;
  collector?: Collector;
  getRuntime?: () => RuntimeLike;
  now?: () => number;
  shouldRecord?: () => boolean;
  fn: Fn;
  thisArg: unknown;
  callArgs: unknown[];
}) {
  const now = args.now ?? (() => performance.now());
  const start = now();
  const runtime = args.getRuntime?.();
  const cwd = contextCwd(args.callArgs) ?? runtime?.status().lastCwd ?? process.cwd();
  let ok = false;

  try {
    const result = await args.fn.apply(args.thisArg, args.callArgs);
    ok = true;
    return result;
  } finally {
    const skipRecording = args.shouldRecord && !args.shouldRecord();
    if (!skipRecording) {
      const ms = Math.max(0, now() - start);
      try {
        if (runtime) {
          runtime.record({
            cwd,
            extensionPath: args.extensionPath,
            surface: args.surface,
            name: args.name,
            ms,
            ok,
          });
        } else if (args.collector) {
          recordInvocation(args.collector, {
            cwd,
            extensionPath: args.extensionPath,
            surface: args.surface,
            name: args.name,
            ms,
            ok,
          });
        }
      } catch {
        // Profiling must not alter handler return values or thrown errors.
      }
    }
  }
}

function wrapWithTiming(args: {
  extensionPath: string;
  surface: Surface;
  name: string;
  collector?: Collector;
  getRuntime?: () => RuntimeLike;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  if (isWrapped(args.handler)) return args.handler;

  const wrapped: WrappedFn = async function wrappedCall(...callArgs: unknown[]) {
    return callTimed({
      extensionPath: args.extensionPath,
      surface: args.surface,
      name: args.name,
      collector: args.collector,
      getRuntime: args.getRuntime,
      now: args.now,
      shouldRecord: args.shouldRecord,
      fn: args.handler,
      thisArg: this,
      callArgs,
    });
  };

  wrapped[WRAPPED] = true;
  return wrapped;
}

export function wrapEventHandler(args: {
  extensionPath: string;
  eventType: string;
  collector?: Collector;
  getRuntime?: () => RuntimeLike;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  return wrapWithTiming({
    extensionPath: args.extensionPath,
    surface: "event",
    name: args.eventType,
    collector: args.collector,
    getRuntime: args.getRuntime,
    handler: args.handler,
    now: args.now,
    shouldRecord: args.shouldRecord,
  });
}

export function wrapCommandHandler(args: {
  extensionPath: string;
  commandName: string;
  collector?: Collector;
  getRuntime?: () => RuntimeLike;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  return wrapWithTiming({
    extensionPath: args.extensionPath,
    surface: "command",
    name: args.commandName,
    collector: args.collector,
    getRuntime: args.getRuntime,
    handler: args.handler,
    now: args.now,
    shouldRecord: args.shouldRecord,
  });
}

export function wrapToolExecute(args: {
  extensionPath: string;
  toolName: string;
  collector?: Collector;
  getRuntime?: () => RuntimeLike;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  return wrapWithTiming({
    extensionPath: args.extensionPath,
    surface: "tool",
    name: args.toolName,
    collector: args.collector,
    getRuntime: args.getRuntime,
    handler: args.handler,
    now: args.now,
    shouldRecord: args.shouldRecord,
  });
}
