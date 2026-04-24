import { mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AnalysisResult, DirectoryScore, FileScore, Finding } from "slop-scan";

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
const MAX_FINDINGS = 50;
const HOTSPOT_LIMIT = 5;

function clampFindings(value: number | undefined): number {
  const candidate = value ?? DEFAULT_MAX_FINDINGS;
  if (!Number.isFinite(candidate)) return DEFAULT_MAX_FINDINGS;
  return Math.max(0, Math.min(MAX_FINDINGS, Math.trunc(candidate)));
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

function truncateLine(value: string, max = 160): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function firstLocation(finding: Finding): string {
  const location = finding.locations?.[0];
  if (!location) return finding.path ?? finding.scope ?? "unknown";
  const column = location.column ? `:${location.column}` : "";
  return `${location.path}:${location.line}${column}`;
}

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
  const maxFindings = clampFindings(options.maxFindings);
  const fileScores = [...(report.fileScores ?? [])]
    .sort((a: FileScore, b: FileScore) => b.score - a.score)
    .slice(0, HOTSPOT_LIMIT);
  const directoryScores = [...(report.directoryScores ?? [])]
    .sort((a: DirectoryScore, b: DirectoryScore) => b.score - a.score)
    .slice(0, HOTSPOT_LIMIT);
  const findings = [...(report.findings ?? [])]
    .sort((a: Finding, b: Finding) => b.score - a.score)
    .slice(0, maxFindings);

  const lines = [
    `Slop scan: ${report.summary.findingCount} finding(s), score ${formatNumber(report.summary.repoScore)}`,
    `Root: ${report.rootDir}`,
    `Files: ${report.summary.fileCount}, directories: ${report.summary.directoryCount}, functions: ${report.summary.functionCount}, logical lines: ${report.summary.logicalLineCount}`,
    `Normalized: score/file ${formatNumber(report.summary.normalized.scorePerFile)}, score/KLOC ${formatNumber(report.summary.normalized.scorePerKloc)}, findings/KLOC ${formatNumber(report.summary.normalized.findingsPerKloc)}`,
  ];

  if (fileScores.length > 0) {
    lines.push("", "Top file hotspots:");
    for (const item of fileScores) {
      lines.push(`- ${item.path}: score ${formatNumber(item.score)}, ${item.findingCount} finding(s)`);
    }
  }

  if (directoryScores.length > 0) {
    lines.push("", "Top directory hotspots:");
    for (const item of directoryScores) {
      lines.push(`- ${item.path}: score ${formatNumber(item.score)}, ${item.findingCount} finding(s)`);
    }
  }

  if (findings.length > 0) {
    lines.push("", `Top findings (${findings.length}/${report.findings.length}):`);
    for (const finding of findings) {
      lines.push(`- ${finding.severity} ${finding.ruleId}: ${finding.message}`);
      lines.push(`  at ${firstLocation(finding)}`);
      for (const evidence of (finding.evidence ?? []).slice(0, 2)) {
        lines.push(`  evidence: ${truncateLine(String(evidence))}`);
      }
    }
  } else {
    lines.push("", "No slop-scan findings.");
  }

  if (options.reportPath) {
    lines.push("", `Full report: ${options.reportPath}`);
  }

  return {
    text: lines.join("\n"),
    details: {
      rootDir: report.rootDir,
      summary: report.summary,
      fileScores,
      directoryScores,
      findings,
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

async function writeReportToTempFile(report: AnalysisResult): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-slop-scan-"));
  const reportPath = path.join(dir, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return reportPath;
}

export default createSlopScanExtension();
