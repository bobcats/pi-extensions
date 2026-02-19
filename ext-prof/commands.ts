import path from "node:path";
import { formatStatus } from "./formatter.ts";
import type { PatchStatus } from "./patcher.ts";

export function createController(args: {
  patch: () => Promise<PatchStatus>;
  save: (outputPath: string) => Promise<string>;
  projectName: string;
  homeDir: string;
  reset: () => void;
  renderDefault?: () => string;
  initialPatchState?: PatchStatus;
}): {
  handle: (rawArgs: string) => Promise<string>;
  isEnabled: () => boolean;
  patchState: () => PatchStatus;
} {
  let enabled = false;
  let patchState: PatchStatus =
    args.initialPatchState ?? {
      patched: false,
      reason: "not patched",
      coverage: {
        events: "missing",
        commands: "missing",
        tools: "missing",
      },
    };

  const defaultSavePath = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(args.homeDir, ".pi", "profiles", args.projectName, `${stamp}.jsonl`);
  };

  return {
    async handle(rawArgs: string): Promise<string> {
      const trimmed = rawArgs.trim();
      const [subcommand, maybePath] = trimmed.split(/\s+/, 2);

      if (!subcommand || subcommand === "status") {
        if (!subcommand && args.renderDefault) {
          return args.renderDefault();
        }
        return formatStatus({
          enabled,
          patch: patchState,
          coverage: patchState.coverage,
        });
      }

      if (subcommand === "on") {
        patchState = await args.patch();
        enabled = true;
        return formatStatus({
          enabled,
          patch: patchState,
          coverage: patchState.coverage,
        });
      }

      if (subcommand === "off") {
        enabled = false;
        return formatStatus({
          enabled,
          patch: patchState,
          coverage: patchState.coverage,
        });
      }

      if (subcommand === "reset") {
        args.reset();
        return "reset: collector state cleared";
      }

      if (subcommand === "save") {
        const outputPath = maybePath || defaultSavePath();
        const saved = await args.save(outputPath);
        return `saved: ${saved}`;
      }

      return `unknown subcommand: ${subcommand}`;
    },

    isEnabled: () => enabled,

    patchState: () => patchState,
  };
}
