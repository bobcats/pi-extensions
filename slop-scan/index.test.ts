import test from "node:test";
import assert from "node:assert/strict";
import { createSlopScanExtension } from "./index.ts";

function createHarness() {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();

  return {
    tools,
    commands,
    pi: {
      registerTool(tool: any) {
        tools.set(tool.name, tool);
      },
      registerCommand(name: string, command: any) {
        commands.set(name, command);
      },
    } as never,
  };
}

test("registers slop_scan tool", () => {
  const harness = createHarness();
  createSlopScanExtension({ scanRepository: async () => sampleReport() })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  assert.ok(tool);
  assert.equal(tool.label, "Slop Scan");
});

test("registers slop-scan command", () => {
  const harness = createHarness();
  createSlopScanExtension({ scanRepository: async () => sampleReport() })(harness.pi);

  assert.ok(harness.commands.get("slop-scan"));
});

function sampleReport() {
  return {
    rootDir: "/tmp/project",
    config: { ignores: [], plugins: {}, extends: [], rules: {}, overrides: [] },
    summary: {
      fileCount: 0,
      directoryCount: 0,
      findingCount: 0,
      repoScore: 0,
      physicalLineCount: 0,
      logicalLineCount: 0,
      functionCount: 0,
      normalized: {
        scorePerFile: null,
        scorePerKloc: null,
        scorePerFunction: null,
        findingsPerFile: null,
        findingsPerKloc: null,
        findingsPerFunction: null,
      },
    },
    files: [],
    directories: [],
    findings: [],
    fileScores: [],
    directoryScores: [],
    repoScore: 0,
  } as any;
}
