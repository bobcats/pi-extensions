import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createCollector,
  resetCollector,
  summarizeByExtension,
  summarizeByHandler,
  type Collector,
} from "./collector.ts";
import { createController } from "./commands.ts";
import { formatStatus, formatVerboseReport, type VerboseExtensionRow } from "./formatter.ts";
import { patchRunnerPrototype, type PatchStatus } from "./patcher.ts";
import { saveSnapshot } from "./persistence.ts";

const require = createRequire(import.meta.url);

const GLOBAL_PATCHED_KEY = Symbol.for("ext-prof.v1.runner-patched");
const GLOBAL_PATCH_STATE_KEY = Symbol.for("ext-prof.v1.patch-state");
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

  try {
    const pkgEntry = require.resolve("@mariozechner/pi-coding-agent");
    const found = addCandidate(path.join(path.dirname(pkgEntry), "core", "extensions", "runner.js"));
    if (found) return pathToFileURL(found).href;
  } catch {
    // continue
  }

  try {
    if (typeof import.meta.resolve === "function") {
      const resolved = import.meta.resolve("@mariozechner/pi-coding-agent");
      const pkgPath = toPath(resolved);
      const found = addCandidate(path.join(path.dirname(pkgPath), "core", "extensions", "runner.js"));
      if (found) return pathToFileURL(found).href;
    }
  } catch {
    // continue
  }

  const seedDirs = [
    process.cwd(),
    process.argv[1] ? path.dirname(process.argv[1]) : undefined,
    path.dirname(process.execPath),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const seed of seedDirs) {
    for (const dir of walkUpDirectories(seed)) {
      const found =
        addCandidate(
          path.join(
            dir,
            "node_modules",
            "@mariozechner",
            "pi-coding-agent",
            "dist",
            "core",
            "extensions",
            "runner.js",
          ),
        ) ??
        addCandidate(
          path.join(
            dir,
            "lib",
            "node_modules",
            "@mariozechner",
            "pi-coding-agent",
            "dist",
            "core",
            "extensions",
            "runner.js",
          ),
        ) ??
        addCandidate(path.join(dir, "dist", "core", "extensions", "runner.js"));

      if (found) {
        return pathToFileURL(found).href;
      }
    }
  }

  const scanned = candidates.length > 0 ? ` Scanned: ${candidates.join(", ")}` : "";
  throw new Error(`unable to locate core/extensions/runner.js.${scanned}`);
}

function buildVerboseRows(collector: Collector): VerboseExtensionRow[] {
  const byExtension = summarizeByExtension(collector);
  const handlers = summarizeByHandler(collector);

  const byPath = new Map<string, typeof handlers>();
  for (const handler of handlers) {
    const rows = byPath.get(handler.extensionPath) ?? [];
    rows.push(handler);
    byPath.set(handler.extensionPath, rows);
  }

  return byExtension.map((row) => ({
    extensionPath: row.extensionPath,
    calls: row.calls,
    totalMs: row.totalMs,
    maxMs: row.maxMs,
    errorCount: row.errorCount,
    handlers:
      byPath.get(row.extensionPath)?.map((h) => ({
        surface: h.surface,
        name: h.name,
        calls: h.calls,
        totalMs: h.totalMs,
        maxMs: h.maxMs,
        errorCount: h.errorCount,
      })) ?? [],
  }));
}

function currentProjectName(): string {
  const base = path.basename(process.cwd());
  return base || "project";
}

function renderStatusIndicator(args: { enabled: boolean; patchState: PatchStatus; theme: { fg: (color: string, text: string) => string } }): string {
  if (args.enabled) {
    if (args.patchState.patched) {
      return args.theme.fg("accent", "prof:on");
    }
    return args.theme.fg("warning", "prof:on!patch");
  }

  return args.theme.fg("dim", "prof:off");
}

export default async function extProfiler(pi: ExtensionAPI) {
  const collector = createCollector({ maxHandlers: 10_000 });
  let enabled = false;

  let patchState: PatchStatus = {
    patched: false,
    reason: "not patched",
    coverage: {
      events: "missing",
      commands: "missing",
      tools: "missing",
    },
  };

  let patchAttempted = false;

  const ensurePatched = async (): Promise<PatchStatus> => {
    const g = globals();
    if (g[GLOBAL_PATCH_STATE_KEY]) {
      patchState = g[GLOBAL_PATCH_STATE_KEY] as PatchStatus;
      return patchState;
    }

    if (patchAttempted) {
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
      collector,
      shouldRecord: () => enabled,
    });

    g[GLOBAL_PATCHED_KEY] = true;
    g[GLOBAL_PATCH_STATE_KEY] = patchState;
    return patchState;
  };

  await ensurePatched();

  const controller = createController({
    patch: ensurePatched,
    initialPatchState: patchState,
    save: async (outputPath: string) => {
      const aggregates = summarizeByHandler(collector).map((row) => ({
        extensionPath: row.extensionPath,
        surface: row.surface,
        name: row.name,
        calls: row.calls,
        totalMs: row.totalMs,
        maxMs: row.maxMs,
        errorCount: row.errorCount,
      }));

      const status = patchState;

      await saveSnapshot({
        outputPath,
        sessionMeta: {
          schemaVersion: 1,
          project: currentProjectName(),
          patch: status.reason,
          patched: status.patched,
          coverage: status.coverage,
          savedAt: new Date().toISOString(),
          overheadGoalPct: 1,
          enabled,
        },
        aggregates,
      });

      return outputPath;
    },
    projectName: currentProjectName(),
    homeDir: homedir(),
    reset: () => resetCollector(collector),
    renderDefault: () => {
      if (!enabled) {
        return formatStatus({
          enabled,
          patch: patchState,
          coverage: patchState.coverage,
        });
      }

      return formatVerboseReport({
        rows: buildVerboseRows(collector),
        patchReason: patchState.reason,
        overhead: {
          goalPct: 1,
          observedPct: null,
        },
      });
    },
  });

  const syncRuntimeState = () => {
    enabled = controller.isEnabled();
    patchState = controller.patchState();
  };

  const updateStatusBar = (ctx: { hasUI: boolean; ui: { setStatus: (key: string, text?: string) => void; theme: { fg: (color: string, text: string) => string } } }) => {
    if (!ctx.hasUI) return;

    ctx.ui.setStatus(
      "ext-prof",
      renderStatusIndicator({
        enabled,
        patchState,
        theme: ctx.ui.theme,
      }),
    );
  };

  pi.registerCommand("ext-prof", {
    description: "Extension profiler controls and report",
    handler: async (args, ctx) => {
      const response = await controller.handle(args);
      syncRuntimeState();
      updateStatusBar(ctx);

      if (ctx.hasUI) {
        ctx.ui.notify(response, "info");
        return;
      }

      process.stdout.write(`${response}\n`);
    },
  });

  pi.registerShortcut(ENABLE_SHORTCUT, {
    description: "Toggle extension profiler",
    handler: async (ctx) => {
      const response = await controller.handle(enabled ? "off" : "on");
      syncRuntimeState();
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
    if (!patchState.patched && patchState.reason !== "already patched") {
      const warning = `ext-prof inactive: ${patchState.reason}`;
      if (ctx.hasUI) {
        ctx.ui.notify(warning, "warning");
      } else {
        process.stdout.write(`${warning}\n`);
      }
    }
  });
}
