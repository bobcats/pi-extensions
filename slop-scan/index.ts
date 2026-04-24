import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AnalysisResult } from "slop-scan";

export interface SlopScanDeps {
  scanRepository?: (rootDir: string) => Promise<AnalysisResult>;
}

const DEFAULT_MAX_FINDINGS = 10;

export function createSlopScanExtension(deps: SlopScanDeps = {}) {
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
        return {
          content: [{ type: "text", text: `slop_scan placeholder for ${params.path ?? "."} (${params.maxFindings ?? DEFAULT_MAX_FINDINGS})` }],
          details: {},
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

export default createSlopScanExtension();
