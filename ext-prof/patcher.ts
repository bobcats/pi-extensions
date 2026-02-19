import type { Collector } from "./collector.ts";
import { wrapCommandHandler, wrapEventHandler, wrapToolExecute } from "./wrapper.ts";
import type { Coverage } from "./formatter.ts";

const PATCHED = Symbol.for("ext-prof.v1.patched");

export type CoverageState = {
  events: Coverage;
  commands: Coverage;
  tools: Coverage;
};

export type PatchStatus = {
  patched: boolean;
  reason: string;
  coverage: CoverageState;
};

export type RunnerLike = {
  extensions?: ExtensionLike[];
};

type ExtensionLike = {
  path?: string;
  handlers?: Map<string, Array<(...args: unknown[]) => unknown>>;
  commands?: Map<string, { handler: (...args: unknown[]) => unknown }>;
  tools?: Map<string, { definition: { execute: (...args: unknown[]) => unknown } }>;
};

export function patchRunnerPrototype(args: {
  RunnerCtor: { prototype: { bindCore: (...input: unknown[]) => unknown } };
  collector: Collector;
  shouldRecord?: () => boolean;
}): PatchStatus {
  const proto = args.RunnerCtor.prototype as Record<string | symbol, unknown>;

  if (proto[PATCHED]) {
    return {
      patched: false,
      reason: "already patched",
      coverage: {
        events: "missing",
        commands: "missing",
        tools: "missing",
      },
    };
  }

  const original = proto.bindCore as (...input: unknown[]) => unknown;
  const coverage: CoverageState = {
    events: "missing",
    commands: "missing",
    tools: "missing",
  };

  proto.bindCore = function patchedBindCore(...input: unknown[]) {
    const result = original.apply(this, input);

    const nextCoverage: CoverageState = {
      events: "missing",
      commands: "missing",
      tools: "missing",
    };

    for (const ext of ((this as RunnerLike).extensions ?? []) as ExtensionLike[]) {
      const extensionPath = ext.path ?? "<unknown-extension>";

      if (ext.handlers instanceof Map) {
        for (const [eventType, handlers] of ext.handlers.entries()) {
          ext.handlers.set(
            eventType,
            handlers.map((handler) =>
              wrapEventHandler({
                extensionPath,
                eventType,
                collector: args.collector,
                handler,
                shouldRecord: args.shouldRecord,
              }),
            ),
          );
        }
        nextCoverage.events = "instrumented";
      }

      if (ext.commands instanceof Map) {
        for (const [commandName, command] of ext.commands.entries()) {
          command.handler = wrapCommandHandler({
            extensionPath,
            commandName,
            collector: args.collector,
            handler: command.handler,
            shouldRecord: args.shouldRecord,
          });
        }
        nextCoverage.commands = "instrumented";
      }

      if (ext.tools instanceof Map) {
        for (const [toolName, tool] of ext.tools.entries()) {
          tool.definition.execute = wrapToolExecute({
            extensionPath,
            toolName,
            collector: args.collector,
            handler: tool.definition.execute,
            shouldRecord: args.shouldRecord,
          });
        }
        nextCoverage.tools = "instrumented";
      }
    }

    coverage.events = nextCoverage.events;
    coverage.commands = nextCoverage.commands;
    coverage.tools = nextCoverage.tools;

    return result;
  };

  proto[PATCHED] = true;

  return {
    patched: true,
    reason: "patched",
    coverage,
  };
}
