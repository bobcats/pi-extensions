import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
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

function createCommandCtx(cwd: string) {
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    notifications,
    ctx: {
      cwd,
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as any,
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

test("default export factory can be constructed with real slop-scan imports", () => {
  assert.doesNotThrow(() => createSlopScanExtension());
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

test("uses the target directory as the scan and config root", async () => {
  const cwd = await tempProject();
  const calls: string[] = [];
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => {
      calls.push(rootDir);
      return sampleReport({ rootDir });
    },
    writeReport: async () => "/tmp/report.json",
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  await tool.execute("1", { path: "src" }, undefined, undefined, { cwd } as any);

  assert.deepEqual(calls, [path.join(cwd, "src")]);
});

test("command reports successful scan", async () => {
  const cwd = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => sampleReport({ rootDir }),
    writeReport: async () => "/tmp/report.json",
  })(harness.pi);

  const { ctx, notifications } = createCommandCtx(cwd);
  const command = harness.commands.get("slop-scan");
  await command.handler("src", ctx);

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "info");
  assert.match(notifications[0].message, /Slop scan/);
  assert.match(notifications[0].message, /Full report: \/tmp\/report\.json/);
});

test("command reports errors", async () => {
  const cwd = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({ scanRepository: async () => sampleReport() })(harness.pi);

  const { ctx, notifications } = createCommandCtx(cwd);
  const command = harness.commands.get("slop-scan");
  await command.handler("@src/file.ts", ctx);

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "error");
  assert.match(notifications[0].message, /scans directories, not files/);
});

test("formats compact summary and caps findings", async () => {
  const cwd = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => sampleReport({ rootDir }),
    writeReport: async () => "/tmp/slop-report.json",
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  const result = await tool.execute("1", { maxFindings: 2 }, undefined, undefined, { cwd } as any);

  assert.match(result.content[0].text, /Slop scan/);
  assert.match(result.content[0].text, /3 finding\(s\)/);
  assert.match(result.content[0].text, /Top file hotspots/);
  assert.match(result.content[0].text, /errors.empty-catch/);
  assert.match(result.content[0].text, /structure.pass-through-wrapper/);
  assert.doesNotMatch(result.content[0].text, /comments.placeholder-comments/);
  assert.equal(result.details.findings.length, 2);
  assert.equal(result.details.fileScores.length, 5);
  assert.equal(result.details.directoryScores.length, 5);
  assert.equal(result.details.reportPath, "/tmp/slop-report.json");
});

test("clamps maxFindings to 50 and does not store full report in details", async () => {
  const cwd = await tempProject();
  const manyFindings = Array.from({ length: 60 }, (_, index) => ({
    ruleId: `rule.${index}`,
    family: "test",
    severity: "weak",
    scope: "file",
    message: `Finding ${index}`,
    evidence: [],
    score: 1,
    locations: [{ path: `src/${index}.ts`, line: 1 }],
    path: `src/${index}.ts`,
  }));
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => sampleReport({ rootDir, findings: manyFindings, summary: { ...sampleReport().summary, findingCount: 60 } }),
    writeReport: async () => "/tmp/slop-report.json",
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  const result = await tool.execute("1", { maxFindings: 500 }, undefined, undefined, { cwd } as any);

  assert.equal(result.details.findings.length, 50);
  assert.equal(result.details.files, undefined);
  assert.equal(result.details.config, undefined);
});

test("continues when report writing fails", async () => {
  const cwd = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => sampleReport({ rootDir }),
    writeReport: async () => {
      throw new Error("disk full");
    },
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  const result = await tool.execute("1", {}, undefined, undefined, { cwd } as any);

  assert.equal(result.details.reportPath, undefined);
  assert.doesNotMatch(result.content[0].text, /Full report:/);
});

test("default report writer writes full JSON to a temp file", async () => {
  const cwd = await tempProject();
  const harness = createHarness();
  createSlopScanExtension({
    scanRepository: async (rootDir) => sampleReport({ rootDir }),
  })(harness.pi);

  const tool = harness.tools.get("slop_scan");
  const result = await tool.execute("1", {}, undefined, undefined, { cwd } as any);

  assert.match(result.details.reportPath, /report\.json$/);
  const raw = await readFile(result.details.reportPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.rootDir, cwd);
  assert.ok(Array.isArray(parsed.findings));
});

function sampleReport(overrides: Partial<any> = {}) {
  const report = {
    rootDir: "/tmp/project",
    config: { ignores: [], plugins: {}, extends: [], rules: {}, overrides: [] },
    summary: {
      fileCount: 3,
      directoryCount: 2,
      findingCount: 3,
      repoScore: 7.5,
      physicalLineCount: 120,
      logicalLineCount: 90,
      functionCount: 12,
      normalized: {
        scorePerFile: 2.5,
        scorePerKloc: 83.33,
        scorePerFunction: 0.625,
        findingsPerFile: 1,
        findingsPerKloc: 33.33,
        findingsPerFunction: 0.25,
      },
    },
    files: [],
    directories: [],
    findings: [
      {
        ruleId: "errors.empty-catch",
        family: "errors",
        severity: "strong",
        scope: "file",
        message: "Empty catch block",
        evidence: ["catch {}"],
        score: 3,
        locations: [{ path: "src/a.ts", line: 10, column: 5 }],
        path: "src/a.ts",
      },
      {
        ruleId: "structure.pass-through-wrapper",
        family: "structure",
        severity: "medium",
        scope: "file",
        message: "Pass-through wrapper",
        evidence: ["return inner(...args)"],
        score: 2,
        locations: [{ path: "src/b.ts", line: 3 }],
        path: "src/b.ts",
      },
      {
        ruleId: "comments.placeholder-comments",
        family: "comments",
        severity: "weak",
        scope: "file",
        message: "Placeholder comment",
        evidence: ["placeholder implementation"],
        score: 1,
        locations: [{ path: "src/c.ts", line: 1 }],
        path: "src/c.ts",
      },
    ],
    fileScores: [
      { path: "src/a.ts", score: 3, findingCount: 1 },
      { path: "src/b.ts", score: 2, findingCount: 1 },
      { path: "src/c.ts", score: 1, findingCount: 1 },
      { path: "src/d.ts", score: 0.5, findingCount: 1 },
      { path: "src/e.ts", score: 0.25, findingCount: 1 },
      { path: "src/f.ts", score: 0.1, findingCount: 1 },
    ],
    directoryScores: [
      { path: "src", score: 6, findingCount: 3 },
      { path: "tests", score: 1, findingCount: 1 },
      { path: "examples", score: 0.5, findingCount: 1 },
      { path: "scripts", score: 0.25, findingCount: 1 },
      { path: "lib", score: 0.2, findingCount: 1 },
      { path: "bin", score: 0.1, findingCount: 1 },
    ],
    repoScore: 7.5,
  };

  return { ...report, ...overrides } as any;
}
