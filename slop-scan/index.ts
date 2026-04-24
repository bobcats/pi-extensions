import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AnalysisResult } from "slop-scan";

export interface SlopScanDeps {
  scanRepository?: (rootDir: string) => Promise<AnalysisResult>;
  writeReport?: (report: AnalysisResult) => Promise<string | undefined>;
}

interface RunSlopScanOptions {
  cwd: string;
  path?: string;
  maxFindings?: number;
}

const DEFAULT_MAX_FINDINGS = 10;

function normalizePathArg(input: string | undefined): string {
  const trimmed = input?.trim();
  const value = trimmed ? trimmed : ".";
  return value.startsWith("@") ? value.slice(1) : value;
}

async function realpathOrThrow(target: string, original: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    throw new Error(`slop_scan target does not exist: ${original}`);
  }
}

function isInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveScanTarget(cwd: string, input: string | undefined): Promise<string> {
  const normalized = normalizePathArg(input);
  const resolved = path.resolve(cwd, normalized);
  const realCwd = await realpath(cwd);
  const realTarget = await realpathOrThrow(resolved, normalized);

  if (!isInside(realCwd, realTarget)) {
    throw new Error(`slop_scan target is outside the current working directory: ${normalized}`);
  }

  const targetStat = await stat(realTarget);
  if (!targetStat.isDirectory()) {
    throw new Error("slop_scan scans directories, not files.");
  }

  return realTarget;
}

async function runSlopScan(options: RunSlopScanOptions, deps: Required<SlopScanDeps>) {
  const rootDir = await resolveScanTarget(options.cwd, options.path);
  const report = await deps.scanRepository(rootDir);
  const reportPath = await deps.writeReport(report).catch(() => undefined);

  return formatScanResult(report, {
    maxFindings: options.maxFindings,
    reportPath,
  });
}

function formatScanResult(report: AnalysisResult, options: { maxFindings?: number; reportPath?: string }) {
  return {
    text: `Slop scan: ${report.summary.findingCount} finding(s) in ${report.summary.fileCount} file(s).${options.reportPath ? `\nFull report: ${options.reportPath}` : ""}`,
    details: {
      rootDir: report.rootDir,
      summary: report.summary,
      reportPath: options.reportPath,
    },
  };
}

export function createSlopScanExtension(deps: SlopScanDeps = {}) {
  const resolvedDeps: Required<SlopScanDeps> = {
    scanRepository: deps.scanRepository ?? defaultScanRepository,
    writeReport: deps.writeReport ?? writeReportToTempFile,
  };

  return function slopScanExtension(pi: ExtensionAPI) {
    pi.registerTool({
      name: "slop_scan",
      label: "Slop Scan",
      description: "Scan a JavaScript/TypeScript project or subtree for AI-associated slop patterns using slop-scan.",
      promptSnippet: "Scan JS/TS project paths for AI-associated slop patterns and hotspots.",
      promptGuidelines: [
        "Use slop_scan during JavaScript/TypeScript code-review and refactor tasks.",
        "Use slop_scan after meaningful JavaScript/TypeScript edits before claiming completion.",
        "Do not run slop_scan after every edit; use it as a checkpoint tool.",
        "Treat slop_scan findings as leads, not proof of authorship or mandatory changes.",
        "Prefer passing a relevant package or subtree scan root for large repositories; the passed path becomes the slop-scan config root.",
      ],
      parameters: Type.Object({
        path: Type.Optional(Type.String({ description: "Directory to scan. Defaults to current working directory. Leading @ is stripped." })),
        maxFindings: Type.Optional(Type.Integer({ minimum: 0, maximum: 50, description: "Maximum findings to include. Default 10, max 50." })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const result = await runSlopScan(
          { cwd: ctx.cwd, path: params.path, maxFindings: params.maxFindings },
          resolvedDeps,
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: result.details,
        };
      },
    });

    pi.registerCommand("slop-scan", {
      description: "Scan current project or subtree with slop-scan",
      handler: async (_args, ctx) => {
        ctx.ui.notify("slop-scan placeholder", "info");
      },
    });
  };
}

async function defaultScanRepository(_rootDir: string): Promise<AnalysisResult> {
  throw new Error("default slop-scan integration is not implemented yet");
}

async function writeReportToTempFile(_report: AnalysisResult): Promise<string | undefined> {
  return undefined;
}

export default createSlopScanExtension();
