import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { createController } from "./commands.ts";
import { formatProfileReport } from "./formatter.ts";
import { patchRunnerPrototype, type PatchStatus } from "./patcher.ts";
import { profileDirectory } from "./persistence.ts";
import { readProfileReport } from "./report.ts";
import { getGlobalRecorderRuntime } from "./runtime.ts";

const require = createRequire(import.meta.url);

const GLOBAL_PATCHED_KEY = Symbol.for("ext-prof.v2.runner-patched");
const GLOBAL_PATCH_STATE_KEY = Symbol.for("ext-prof.v2.patch-state");
const ENABLE_SHORTCUT = "ctrl+alt+p";

type GlobalProfiler = typeof globalThis & {
  [GLOBAL_PATCHED_KEY]?: boolean;
  [GLOBAL_PATCH_STATE_KEY]?: PatchStatus;
};

function globals(): GlobalProfiler {
  return globalThis as GlobalProfiler;
}

function* walkUpDirectories(startDir: string): Generator<string> {
  let current = path.resolve(startDir);
  while (true) {
    yield current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function toPath(value: string): string {
  if (value.startsWith("file://")) {
    return fileURLToPath(value);
  }
  return value;
}

function resolveRunnerModuleUrl(): string {
  const candidates: string[] = [];

  const addCandidate = (candidatePath: string): string | undefined => {
    const normalized = path.resolve(candidatePath);
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
    if (existsSync(normalized)) {
      return normalized;
    }
    return undefined;
  };

  // Prefer ESM resolve: package exports are import-only, so require.resolve often fails.
  try {
    if (typeof import.meta.resolve === "function") {
      const resolved = import.meta.resolve("@earendil-works/pi-coding-agent");
      const pkgPath = toPath(resolved);
      // import.meta.resolve returns .../dist/index.js → runner is sibling under dist/core/...
      const found = addCandidate(path.join(path.dirname(pkgPath), "core", "extensions", "runner.js"));
      if (found) return pathToFileURL(found).href;
    }
  } catch (error) {
    void error;
    // Fall through to filesystem probes when ESM resolution is unavailable.
  }

  try {
    const pkgEntry = require.resolve("@earendil-works/pi-coding-agent");
    const found = addCandidate(path.join(path.dirname(pkgEntry), "core", "extensions", "runner.js"));
    if (found) return pathToFileURL(found).href;
  } catch (error) {
    void error;
    // Fall through: CJS resolve fails when package exports omit a require condition.
  }

  const seedDirs = [
    process.cwd(),
    process.argv[1] ? path.dirname(process.argv[1]) : undefined,
    path.dirname(process.execPath),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const scopes = ["@earendil-works", "@mariozechner"] as const;

  for (const seed of seedDirs) {
    for (const dir of walkUpDirectories(seed)) {
      let found: string | undefined;
      for (const scope of scopes) {
        found =
          addCandidate(
            path.join(dir, "node_modules", scope, "pi-coding-agent", "dist", "core", "extensions", "runner.js"),
          ) ??
          addCandidate(
            path.join(dir, "lib", "node_modules", scope, "pi-coding-agent", "dist", "core", "extensions", "runner.js"),
          );
        if (found) break;
      }
      found = found ?? addCandidate(path.join(dir, "dist", "core", "extensions", "runner.js"));

      if (found) {
        return pathToFileURL(found).href;
      }
    }
  }

  const scanned = candidates.length > 0 ? ` Scanned: ${candidates.join(", ")}` : "";
  throw new Error(`unable to locate core/extensions/runner.js.${scanned}`);
}

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

function renderStatusIndicator(args: {
  runtime: ReturnType<typeof getGlobalRecorderRuntime>;
  patchState: PatchStatus;
  theme: { fg: (color: string, text: string) => string };
}): string {
  const status = args.runtime.status();
  if (!status.active) {
    return args.theme.fg("dim", "prof:off");
  }

  if (!patchUsable(args.patchState)) {
    return args.theme.fg("warning", "prof:on!patch");
  }

  if (status.lastWriteError || status.consecutiveWriteFailures > 0) {
    return args.theme.fg("warning", "prof:on!write");
  }

  return args.theme.fg("accent", "prof:on");
}

function shutdownReason(event: unknown): string | undefined {
  if (event && typeof event === "object" && "reason" in event) {
    const reason = (event as { reason?: unknown }).reason;
    if (typeof reason === "string") return reason;
  }
  return undefined;
}

function contextCwd(ctx: unknown): string | undefined {
  if (ctx && typeof ctx === "object" && "cwd" in ctx) {
    const cwd = (ctx as { cwd?: unknown }).cwd;
    if (typeof cwd === "string" && cwd.trim()) return cwd;
  }
  return undefined;
}

export default async function extProfiler(pi: ExtensionAPI) {
  const runtime = getGlobalRecorderRuntime();
  let patchState: PatchStatus = defaultPatchState();
  let patchAttempted = false;

  const ensurePatched = async (options: { retry?: boolean } = {}): Promise<PatchStatus> => {
    const g = globals();
    const cachedPatchState = g[GLOBAL_PATCH_STATE_KEY];
    if (cachedPatchState && (!options.retry || patchUsable(cachedPatchState))) {
      patchState = cachedPatchState;
      return patchState;
    }

    if (patchAttempted && (!options.retry || patchUsable(patchState))) {
      return patchState;
    }

    patchAttempted = true;

    if (g[GLOBAL_PATCHED_KEY]) {
      patchState = {
        patched: false,
        reason: "already patched",
        coverage: {
          events: "missing",
          commands: "missing",
          tools: "missing",
        },
      };
      g[GLOBAL_PATCH_STATE_KEY] = patchState;
      return patchState;
    }

    let runnerModule: unknown;

    try {
      runnerModule = await import(resolveRunnerModuleUrl());
    } catch (error) {
      patchState = {
        patched: false,
        reason: `runner import failed: ${error instanceof Error ? error.message : String(error)}`,
        coverage: {
          events: "missing",
          commands: "missing",
          tools: "missing",
        },
      };
      g[GLOBAL_PATCH_STATE_KEY] = patchState;
      return patchState;
    }

    const ExtensionRunner = (runnerModule as { ExtensionRunner?: { prototype?: { bindCore?: unknown } } })
      .ExtensionRunner;

    if (!ExtensionRunner?.prototype || typeof ExtensionRunner.prototype.bindCore !== "function") {
      patchState = {
        patched: false,
        reason: "ExtensionRunner.bindCore not found",
        coverage: {
          events: "missing",
          commands: "missing",
          tools: "missing",
        },
      };
      g[GLOBAL_PATCH_STATE_KEY] = patchState;
      return patchState;
    }

    patchState = patchRunnerPrototype({
      RunnerCtor: ExtensionRunner,
      getRuntime: () => getGlobalRecorderRuntime(),
    });

    g[GLOBAL_PATCHED_KEY] = true;
    g[GLOBAL_PATCH_STATE_KEY] = patchState;
    return patchState;
  };

  await ensurePatched();

  const controller = createController({
    patch: () => ensurePatched({ retry: true }),
    initialPatchState: patchState,
    runtime,
    renderReport: async ({ currentCwd }) => {
      const report = await readProfileReport({ profileDir: profileDirectory(homedir()) });
      return formatProfileReport({
        report,
        currentCwd: currentCwd ?? runtime.status().lastCwd ?? process.cwd(),
      });
    },
  });

  const updateStatusBar = (ctx: { hasUI: boolean; ui: { setStatus: (key: string, text?: string) => void; theme: { fg: (color: string, text: string) => string } } }) => {
    if (!ctx.hasUI) return;

    ctx.ui.setStatus(
      "ext-prof",
      renderStatusIndicator({
        runtime,
        patchState,
        theme: ctx.ui.theme,
      }),
    );
  };

  const EXT_PROF_SUBCOMMANDS: AutocompleteItem[] = [
    { value: "on",     label: "on",     description: "Start recording" },
    { value: "off",    label: "off",    description: "Stop recording" },
    { value: "status", label: "status", description: "Show recording status" },
  ];

  pi.registerCommand("ext-prof", {
    description: "Extension profiler controls and report",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const filtered = EXT_PROF_SUBCOMMANDS.filter((c) => c.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const response = await controller.handle(args, { cwd: contextCwd(ctx) });
      patchState = controller.patchState();
      updateStatusBar(ctx);

      if (ctx.hasUI) {
        ctx.ui.notify(response, "info");
        return;
      }

      process.stdout.write(`${response}\n`);
    },
  });

  pi.registerShortcut(ENABLE_SHORTCUT, {
    description: "Toggle extension profiler recording",
    handler: async (ctx) => {
      const response = await controller.handle(runtime.status().active ? "off" : "on", { cwd: contextCwd(ctx) });
      patchState = controller.patchState();
      updateStatusBar(ctx);

      if (ctx.hasUI) {
        ctx.ui.notify(response, "info");
        return;
      }

      process.stdout.write(`${response}\n`);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    updateStatusBar(ctx);
    if (!patchUsable(patchState)) {
      const warning = `ext-prof inactive: ${patchState.reason}`;
      if (ctx.hasUI) {
        ctx.ui.notify(warning, "warning");
      } else {
        process.stdout.write(`${warning}\n`);
      }
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    const reason = shutdownReason(event);
    if (reason === "quit") {
      await runtime.stop("quit");
    } else if (runtime.status().active) {
      await runtime.flush();
    }
    updateStatusBar(ctx);
  });
}
