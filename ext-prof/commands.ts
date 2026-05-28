import { formatStatus } from "./formatter.ts";
import type { PatchStatus } from "./patcher.ts";
import type { RecorderRuntime } from "./runtime.ts";

type RuntimeController = Pick<RecorderRuntime, "start" | "stop" | "flush" | "status">;

function defaultPatchState(): PatchStatus {
  return {
    patched: false,
    reason: "not patched",
    coverage: {
      events: "missing",
      commands: "missing",
      tools: "missing",
    },
  };
}

function patchUsable(patch: PatchStatus): boolean {
  return patch.patched || patch.reason === "already patched";
}

export function createController(args: {
  patch: () => Promise<PatchStatus>;
  runtime: RuntimeController;
  renderReport: () => Promise<string>;
  initialPatchState?: PatchStatus;
}): {
  handle: (rawArgs: string) => Promise<string>;
  isEnabled: () => boolean;
  patchState: () => PatchStatus;
} {
  let patchState: PatchStatus = args.initialPatchState ?? defaultPatchState();

  const renderStatus = () =>
    formatStatus({
      runtime: args.runtime.status(),
      patch: patchState,
    });

  return {
    async handle(rawArgs: string): Promise<string> {
      const trimmed = rawArgs.trim();
      const [subcommand] = trimmed.split(/\s+/, 1);

      if (!subcommand) {
        if (args.runtime.status().active) {
          await args.runtime.flush();
        }
        return args.renderReport();
      }

      if (subcommand === "status") {
        return renderStatus();
      }

      if (subcommand === "on") {
        patchState = await args.patch();
        if (!patchUsable(patchState)) {
          return renderStatus();
        }
        await args.runtime.start();
        return renderStatus();
      }

      if (subcommand === "off") {
        await args.runtime.stop("off");
        return renderStatus();
      }

      return `unknown subcommand: ${subcommand}`;
    },

    isEnabled: () => args.runtime.status().active,

    patchState: () => patchState,
  };
}
