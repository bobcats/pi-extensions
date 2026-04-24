import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

async function tempProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-slop-scan-test-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "file.ts"), "export const value = 1;\n", "utf8");
  return realpath(dir);
}

test("defaults missing path to cwd and calls scanner", async () => {
  const cwd = await tempProject();
  const calls: string[] = [];
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => {
      calls.push(rootDir);
      return { ...sampleReport(), rootDir } as any;
    },
    writeReport: async () => "/tmp/report.json",
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  const result = await tool.execute("1", {}, undefined, undefined, { cwd } as any);

  assert.deepEqual(calls, [cwd]);
  assert.match(result.content[0].text, /Slop scan/);
});

test("strips leading at-sign from path", async () => {
  const cwd = await tempProject();
  const calls: string[] = [];
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => {
      calls.push(rootDir);
      return { ...sampleReport(), rootDir } as any;
    },
    writeReport: async () => "/tmp/report.json",
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  await tool.execute("1", { path: "@src" }, undefined, undefined, { cwd } as any);

  assert.deepEqual(calls, [path.join(cwd, "src")]);
});

test("rejects outside-cwd paths", async () => {
  const cwd = await tempProject();
  const outside = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({ scanRepository: async () => sampleReport() as any })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  await assert.rejects(
    () => tool.execute("1", { path: outside }, undefined, undefined, { cwd } as any),
    /outside the current working directory/,
  );
});

test("rejects file targets including pi-style mentions", async () => {
  const cwd = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({ scanRepository: async () => sampleReport() as any })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  await assert.rejects(
    () => tool.execute("1", { path: "@src/file.ts" }, undefined, undefined, { cwd } as any),
    /scans directories, not files/,
  );
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
