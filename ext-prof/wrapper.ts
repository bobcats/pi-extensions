import { recordInvocation, type Collector, type Surface } from "./collector.ts";

const WRAPPED = Symbol.for("ext-prof.v1.wrapped");

type Fn = (...args: unknown[]) => Promise<unknown> | unknown;
type WrappedFn = Fn & { [WRAPPED]?: true };

function isWrapped(fn: Fn): fn is WrappedFn {
  return Boolean((fn as WrappedFn)[WRAPPED]);
}

async function callTimed(args: {
  extensionPath: string;
  surface: Surface;
  name: string;
  collector: Collector;
  now?: () => number;
  shouldRecord?: () => boolean;
  fn: Fn;
  thisArg: unknown;
  callArgs: unknown[];
}) {
  const now = args.now ?? (() => performance.now());
  const start = now();
  let ok = false;

  try {
    const result = await args.fn.apply(args.thisArg, args.callArgs);
    ok = true;
    return result;
  } finally {
    const skipRecording = args.shouldRecord && !args.shouldRecord();
    if (!skipRecording) {
      const ms = Math.max(0, now() - start);
      recordInvocation(args.collector, {
        extensionPath: args.extensionPath,
        surface: args.surface,
        name: args.name,
        ms,
        ok,
      });
    }
  }
}

function wrapWithTiming(args: {
  extensionPath: string;
  surface: Surface;
  name: string;
  collector: Collector;
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
  collector: Collector;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  return wrapWithTiming({
    extensionPath: args.extensionPath,
    surface: "event",
    name: args.eventType,
    collector: args.collector,
    handler: args.handler,
    now: args.now,
    shouldRecord: args.shouldRecord,
  });
}

export function wrapCommandHandler(args: {
  extensionPath: string;
  commandName: string;
  collector: Collector;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  return wrapWithTiming({
    extensionPath: args.extensionPath,
    surface: "command",
    name: args.commandName,
    collector: args.collector,
    handler: args.handler,
    now: args.now,
    shouldRecord: args.shouldRecord,
  });
}

export function wrapToolExecute(args: {
  extensionPath: string;
  toolName: string;
  collector: Collector;
  handler: Fn;
  now?: () => number;
  shouldRecord?: () => boolean;
}): Fn {
  return wrapWithTiming({
    extensionPath: args.extensionPath,
    surface: "tool",
    name: args.toolName,
    collector: args.collector,
    handler: args.handler,
    now: args.now,
    shouldRecord: args.shouldRecord,
  });
}
