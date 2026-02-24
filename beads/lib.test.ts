import test from "node:test";
import assert from "node:assert/strict";
import {
  extractErrorSummary,
  parseBrInfoJson,
  parseBeadsSessionMode,
  parseBrReadyJson,
  parseBrShowJson,
  detectTrackingMode,
  isBrCloseCommand,
  shouldShowContextReminder,
  buildBeadsPrimeMessage,
  getBeadsModeOffMessage,
  formatIssueCard,
  formatIssueLabel,
  summarizeInProgressIssue,
  formatBeadsModeStatus,
  summarizeBeadsActionResult,
  parseBrDepListJson,
  formatCheckpointTrail,
  formatRecoveryMessage,
  parseGitStatusPorcelain,
  buildRecoveryContext,
  isGitCommitCommand,
  parseGitCommitOutput,
  extractEditedFilePath,
  formatFileListComment,
  shouldNudgeCheckpoint,
  buildCheckpointNudgeMessage,
  buildCheckpointSummary,
  buildContinueMessage,
  formatEnrichedReadyOutput,
  DIRTY_TREE_CLOSE_WARNING,
} from "./lib.ts";
import type { BrComment } from "./lib.ts";
import * as lib from "./lib.ts";

test("parseBrInfoJson parses mode and issue_count", () => {
  const parsed = parseBrInfoJson('{"mode":"sqlite","issue_count":4}');
  assert.deepEqual(parsed, { mode: "sqlite", issueCount: 4 });
});

test("parseBrInfoJson returns null on invalid json", () => {
  assert.equal(parseBrInfoJson("not-json"), null);
});

test("parseBeadsSessionMode enables beads for initialized projects", () => {
  assert.deepEqual(parseBeadsSessionMode({ brInfoExitCode: 0 }), {
    isBeadsProject: true,
    beadsEnabled: true,
  });
});

test("parseBeadsSessionMode disables beads when project is not initialized", () => {
  assert.deepEqual(parseBeadsSessionMode({ brInfoExitCode: 2 }), {
    isBeadsProject: false,
    beadsEnabled: false,
  });
});

test("parseBrReadyJson handles br list payload", () => {
  const issues = parseBrReadyJson('[{"id":"abc","title":"Do thing","type":"task","priority":1,"status":"open"}]');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.id, "abc");
});

test("parseBrReadyJson handles issue_type payload from br list --json", () => {
  const issues = parseBrReadyJson('[{"id":"bd-123","title":"Do thing","issue_type":"feature","priority":1,"status":"in_progress"}]');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.id, "bd-123");
  assert.equal(issues[0]?.type, "feature");
});

test("detectTrackingMode maps check-ignore codes", () => {
  assert.equal(detectTrackingMode(0), "stealth");
  assert.equal(detectTrackingMode(1), "git-tracked");
});

test("isBrCloseCommand only matches literal br close invocation", () => {
  assert.equal(isBrCloseCommand("br close abc"), true);
  assert.equal(isBrCloseCommand("echo br close"), false);
  assert.equal(isBrCloseCommand("bash -lc 'br close abc'"), false);
});

test("shouldShowContextReminder enforces one-time percentage threshold", () => {
  assert.equal(
    shouldShowContextReminder({ usagePercent: 85, thresholdPercent: 85, alreadyShown: false }),
    true,
  );
  assert.equal(
    shouldShowContextReminder({ usagePercent: 84.9, thresholdPercent: 85, alreadyShown: false }),
    false,
  );
  assert.equal(
    shouldShowContextReminder({ usagePercent: 92, thresholdPercent: 85, alreadyShown: true }),
    false,
  );
});

test("shouldShowContextReminder suppresses reminders when beads mode is disabled", () => {
  assert.equal(
    shouldShowContextReminder({
      usagePercent: 99,
      thresholdPercent: 85,
      alreadyShown: false,
      beadsEnabled: false,
    }),
    false,
  );
});

test("shouldShowContextReminder treats unknown usage as not remindable", () => {
  assert.equal(
    shouldShowContextReminder({
      usagePercent: null as unknown as number,
      thresholdPercent: -1,
      alreadyShown: false,
    }),
    false,
  );
});

test("buildBeadsPrimeMessage contains anti-TodoWrite guardrail", () => {
  const text = buildBeadsPrimeMessage();
  assert.match(text, /Use beads for ALL task tracking/);
  assert.match(text, /Do NOT use TodoWrite/);
});

test("buildBeadsPrimeMessage returns empty text when beads mode is disabled", () => {
  const text = buildBeadsPrimeMessage({ beadsEnabled: false });
  assert.equal(text, "");
});

test("getBeadsModeOffMessage includes command and shortcut guidance", () => {
  assert.equal(
    getBeadsModeOffMessage(),
    "Beads mode is off. Enable with /beads-mode on (or Ctrl+B).",
  );
});

test("formatIssueLabel includes id, priority, and title", () => {
  const label = formatIssueLabel({ id: "abc", title: "Do thing", priority: 1, type: "task", status: "open" });
  assert.match(label, /abc/);
  assert.match(label, /P1/);
  assert.match(label, /Do thing/);
});

test("summarizeInProgressIssue reports first id with title and overflow count", () => {
  assert.equal(summarizeInProgressIssue([]), "none");
  assert.equal(summarizeInProgressIssue([{ id: "bd-1", title: "One" }]), "bd-1 — One");
  assert.equal(
    summarizeInProgressIssue([
      { id: "bd-1", title: "One" },
      { id: "bd-2", title: "Two" },
      { id: "bd-3", title: "Three" },
    ]),
    "bd-1 — One +2",
  );
});

test("formatBeadsModeStatus includes in-progress summary", () => {
  const status = formatBeadsModeStatus({
    modeText: "stealth (sqlite)",
    issueCount: 12,
    inProgressIssues: [{ id: "bd-1", title: "One" }],
  });
  assert.equal(status, "beads: stealth (sqlite) · 12 issue(s) · in-progress: bd-1 — One");
});

test("formatBeadsModeStatus returns off label when beads mode is disabled", () => {
  const status = formatBeadsModeStatus({
    beadsEnabled: false,
    modeText: "stealth (sqlite)",
    issueCount: 12,
    inProgressIssues: [{ id: "bd-1", title: "One" }],
  });
  assert.equal(status, "beads: off");
});

test("formatBeadsModeStatus shows on-without-project label", () => {
  const status = formatBeadsModeStatus({
    beadsEnabled: true,
    isBeadsProject: false,
    modeText: "stealth (sqlite)",
    issueCount: 12,
    inProgressIssues: [{ id: "bd-1", title: "One" }],
  });
  assert.equal(status, "beads: on (no project)");
});

test("summarizeBeadsActionResult handles create output", () => {
  const summary = summarizeBeadsActionResult(
    "create",
    "✓ Created bd-42x: tighten action details typing\n",
  );
  assert.equal(summary, "Created bd-42x — tighten action details typing");
});

test("summarizeBeadsActionResult handles empty ready output", () => {
  const summary = summarizeBeadsActionResult("ready", "");
  assert.equal(summary, "No ready issues");
});

test("summarizeBeadsActionResult handles status stats output", () => {
  const summary = summarizeBeadsActionResult(
    "status",
    [
      "Total Issues: 13",
      "Open: 5",
      "In Progress: 2",
      "Closed: 6",
    ].join("\n"),
  );
  assert.equal(summary, "13 total, 5 open, 2 in-progress, 6 closed");
});

test("parseBrShowJson extracts issue with comments", () => {
  const json = JSON.stringify([{
    id: "bd-1",
    title: "Do thing",
    status: "in_progress",
    issue_type: "task",
    priority: 2,
    comments: [
      { id: 1, issue_id: "bd-1", author: "alice", text: "Started work", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, issue_id: "bd-1", author: "alice", text: "Tests passing", created_at: "2026-01-01T01:00:00Z" },
    ],
  }]);
  const issue = parseBrShowJson(json);
  assert.equal(issue?.id, "bd-1");
  assert.equal(issue?.comments?.length, 2);
  assert.equal(issue?.comments?.[1]?.text, "Tests passing");
});

test("parseBrShowJson drops malformed comment entries", () => {
  const json = JSON.stringify([{
    id: "bd-1",
    title: "Do thing",
    comments: [
      { id: 1, issue_id: "bd-1", author: "alice", text: "Valid", created_at: "2026-01-01T00:00:00Z" },
      { text: "Missing metadata" },
    ],
  }]);
  const issue = parseBrShowJson(json);
  assert.equal(issue?.comments?.length, 1);
  assert.equal(issue?.comments?.[0]?.text, "Valid");
});

test("parseBrShowJson captures description", () => {
  const json = JSON.stringify([{
    id: "bd-1",
    title: "Do thing",
    description: "Detailed explanation here",
    status: "open",
    issue_type: "task",
    priority: 2,
  }]);
  const issue = parseBrShowJson(json);
  assert.equal(issue?.description, "Detailed explanation here");
});

test("parseBrShowJson handles issue with no comments", () => {
  const json = JSON.stringify([{ id: "bd-2", title: "No comments" }]);
  const issue = parseBrShowJson(json);
  assert.equal(issue?.id, "bd-2");
  assert.equal(issue?.comments, undefined);
});

test("parseBrShowJson returns null on bad input", () => {
  assert.equal(parseBrShowJson("nope"), null);
  assert.equal(parseBrShowJson("[]"), null);
});

test("formatIssueCard renders full card with description and last comment", () => {
  const lines = formatIssueCard({
    id: "bd-1",
    title: "Fix parser",
    type: "task",
    priority: 2,
    status: "in_progress",
    description: "Handle unicode filenames",
    comments: [
      { id: 1, issue_id: "bd-1", author: "a", text: "Started", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, issue_id: "bd-1", author: "a", text: "Tests green", created_at: "2026-01-01T01:00:00Z" },
    ],
  });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /bd-1 — Fix parser.*P2.*in_progress.*task/);
  assert.match(lines[1], /Handle unicode filenames/);
  assert.match(lines[2], /Tests green/);
});

test("formatIssueCard renders minimal card without description or comments", () => {
  const lines = formatIssueCard({
    id: "bd-2",
    title: "Quick fix",
    type: "bug",
    priority: 1,
    status: "open",
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /bd-2 — Quick fix.*P1.*open.*bug/);
});

test("formatIssueCard truncates long description", () => {
  const longDesc = "x".repeat(200);
  const lines = formatIssueCard({
    id: "bd-3",
    title: "Long",
    description: longDesc,
  });
  assert.equal(lines.length, 2);
  assert.ok(lines[1].length <= 120);
  assert.ok(lines[1].endsWith("..."));
});

test("buildBeadsPrimeMessage appends resume context when provided", () => {
  const withResume = buildBeadsPrimeMessage({ resumeContext: "## Resuming: bd-1 — Fix parser\nLast checkpoint: Tests green" });
  assert.match(withResume, /Resuming: bd-1/);
  assert.match(withResume, /Tests green/);

  const without = buildBeadsPrimeMessage();
  assert.ok(!without.includes("Resuming"));
});

test("parseBrDepListJson parses array of dependency issues", () => {
  const json = JSON.stringify([
    { id: "bd-parent", title: "Parent feature", issue_type: "feature", priority: 1, status: "open" },
  ]);
  const issues = parseBrDepListJson(json);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "bd-parent");
  assert.equal(issues[0].title, "Parent feature");
});

test("parseBrDepListJson returns empty array on empty JSON array", () => {
  assert.deepEqual(parseBrDepListJson("[]"), []);
});

test("parseBrDepListJson returns empty array on invalid JSON", () => {
  assert.deepEqual(parseBrDepListJson("not json"), []);
});

test("parseBrDepListJson returns empty array on non-array JSON", () => {
  assert.deepEqual(parseBrDepListJson('{"error": "not found"}'), []);
});

test("parseBrDepListJson extracts issue_id from real dep list output", () => {
  const json = JSON.stringify([
    { issue_id: "bd-shd", depends_on_id: "bd-3xi", type: "blocks", title: "Child issue", status: "open", priority: 2 },
  ]);
  const issues = parseBrDepListJson(json, "issue_id");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "bd-shd");
  assert.equal(issues[0].title, "Child issue");
});

test("parseBrDepListJson extracts depends_on_id from real dep list output", () => {
  const json = JSON.stringify([
    { issue_id: "bd-shd", depends_on_id: "bd-3xi", type: "blocks", title: "Parent issue", status: "open", priority: 2 },
  ]);
  const issues = parseBrDepListJson(json, "depends_on_id");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "bd-3xi");
  assert.equal(issues[0].title, "Parent issue");
});

test("formatCheckpointTrail formats last 5 comments with relative time", () => {
  const now = new Date("2026-02-19T12:00:00Z");
  const comments: BrComment[] = [
    { id: 1, issue_id: "bd-1", author: "agent", text: "Started work on parser", created_at: "2026-02-19T10:00:00Z" },
    { id: 2, issue_id: "bd-1", author: "agent", text: "Tests passing for tokenizer", created_at: "2026-02-19T11:00:00Z" },
    { id: 3, issue_id: "bd-1", author: "agent", text: "commit: a1b2c3d feat: add bracket tokenizer", created_at: "2026-02-19T11:30:00Z" },
  ];
  const trail = formatCheckpointTrail(comments, now);
  assert.equal(trail.length, 3);
  assert.match(trail[0], /2h ago/);
  assert.match(trail[0], /Started work on parser/);
  assert.match(trail[1], /1h ago/);
  assert.match(trail[2], /30m ago/);
});

test("formatCheckpointTrail limits to last 5 comments", () => {
  const now = new Date("2026-02-19T12:00:00Z");
  const comments: BrComment[] = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    issue_id: "bd-1",
    author: "agent",
    text: `Comment ${i + 1}`,
    created_at: new Date(now.getTime() - (8 - i) * 3600000).toISOString(),
  }));
  const trail = formatCheckpointTrail(comments, now);
  assert.equal(trail.length, 5);
  assert.match(trail[0], /Comment 4/);
  assert.match(trail[4], /Comment 8/);
});

test("formatCheckpointTrail truncates long comment text to 200 chars", () => {
  const now = new Date("2026-02-19T12:00:00Z");
  const longText = "x".repeat(300);
  const comments: BrComment[] = [
    { id: 1, issue_id: "bd-1", author: "agent", text: longText, created_at: "2026-02-19T11:00:00Z" },
  ];
  const trail = formatCheckpointTrail(comments, now);
  assert.equal(trail.length, 1);
  assert.ok(trail[0].length <= 220);
});

test("formatCheckpointTrail returns empty array when no comments", () => {
  assert.deepEqual(formatCheckpointTrail([], new Date()), []);
  assert.deepEqual(formatCheckpointTrail(undefined, new Date()), []);
});

test("formatCheckpointTrail handles malformed dates gracefully", () => {
  const now = new Date("2026-02-19T12:00:00Z");
  const comments: BrComment[] = [
    { id: 1, issue_id: "bd-1", author: "agent", text: "Bad date comment", created_at: "not-a-date" },
  ];
  const trail = formatCheckpointTrail(comments, now);
  assert.equal(trail.length, 1);
  assert.match(trail[0], /unknown/);
  assert.match(trail[0], /Bad date comment/);
});

test("formatRecoveryMessage produces full recovery block with all sections", () => {
  const msg = formatRecoveryMessage({
    issue: {
      id: "bd-1",
      title: "Implement parser",
      type: "task",
      priority: 2,
      status: "in_progress",
    },
    checkpointTrail: [
      "- [2h ago] Started work on parser",
      "- [1h ago] commit: a1b2c3d feat: add tokenizer",
    ],
    parent: { id: "bd-parent", title: "Parser system" },
    blockedBy: [],
    uncommittedFiles: ["src/parser.ts (M)", "tests/parser.test.ts (M)"],
  });
  assert.match(msg, /# Beads Workflow Context/);
  assert.match(msg, /Use beads for ALL task tracking/);
  assert.match(msg, /Resuming: bd-1 — Implement parser/);
  assert.match(msg, /in_progress.*task.*P2/);
  assert.match(msg, /Parent:.*bd-parent.*Parser system/);
  assert.match(msg, /Started work on parser/);
  assert.match(msg, /src\/parser\.ts/);
});

test("formatRecoveryMessage omits parent section when no parent", () => {
  const msg = formatRecoveryMessage({
    issue: { id: "bd-1", title: "Standalone", type: "task", priority: 2, status: "in_progress" },
    checkpointTrail: [],
    parent: null,
    blockedBy: [],
    uncommittedFiles: [],
  });
  assert.ok(!msg.includes("Parent:"));
  assert.match(msg, /Resuming: bd-1/);
});

test("formatRecoveryMessage omits unblocks section when no blockedBy", () => {
  const msg = formatRecoveryMessage({
    issue: { id: "bd-1", title: "Test", type: "task", priority: 2, status: "in_progress" },
    checkpointTrail: [],
    parent: null,
    blockedBy: [],
    uncommittedFiles: [],
  });
  assert.ok(!msg.includes("Unblocks:"));
});

test("formatRecoveryMessage shows unblocks when blockedBy present", () => {
  const msg = formatRecoveryMessage({
    issue: { id: "bd-1", title: "Test", type: "task", priority: 2, status: "in_progress" },
    checkpointTrail: [],
    parent: null,
    blockedBy: [
      { id: "bd-2", title: "Widget renderer" },
      { id: "bd-3", title: "Widget tests" },
    ],
    uncommittedFiles: [],
  });
  assert.match(msg, /Unblocks:.*bd-2.*Widget renderer/);
  assert.match(msg, /bd-3.*Widget tests/);
});

test("formatRecoveryMessage omits checkpoint trail section when empty", () => {
  const msg = formatRecoveryMessage({
    issue: { id: "bd-1", title: "Fresh", type: "task", priority: 2, status: "in_progress" },
    checkpointTrail: [],
    parent: null,
    blockedBy: [],
    uncommittedFiles: [],
  });
  assert.ok(!msg.includes("Checkpoint Trail"));
});

test("formatRecoveryMessage omits uncommitted section when empty", () => {
  const msg = formatRecoveryMessage({
    issue: { id: "bd-1", title: "Clean", type: "task", priority: 2, status: "in_progress" },
    checkpointTrail: ["- [1h ago] Some work"],
    parent: null,
    blockedBy: [],
    uncommittedFiles: [],
  });
  assert.ok(!msg.includes("Uncommitted"));
});

test("formatRecoveryMessage truncates uncommitted files to 15", () => {
  const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts (M)`);
  const msg = formatRecoveryMessage({
    issue: { id: "bd-1", title: "Many files", type: "task", priority: 2, status: "in_progress" },
    checkpointTrail: [],
    parent: null,
    blockedBy: [],
    uncommittedFiles: files,
  });
  assert.match(msg, /file14\.ts/);
  assert.ok(!msg.includes("file15.ts"));
  assert.match(msg, /and 5 more/);
});

test("parseGitStatusPorcelain parses modified and new files", () => {
  const output = " M src/parser.ts\n M tests/parser.test.ts\n?? src/new-file.ts\n";
  const files = parseGitStatusPorcelain(output);
  assert.deepEqual(files, [
    "src/parser.ts (M)",
    "tests/parser.test.ts (M)",
    "src/new-file.ts (?)",
  ]);
});

test("parseGitStatusPorcelain handles staged and unstaged mix", () => {
  const output = "M  src/staged.ts\nMM src/both.ts\nA  src/added.ts\nD  src/deleted.ts\n";
  const files = parseGitStatusPorcelain(output);
  assert.equal(files.length, 4);
  assert.match(files[0], /staged\.ts/);
  assert.match(files[3], /deleted\.ts/);
});

test("parseGitStatusPorcelain returns empty array for clean repo", () => {
  assert.deepEqual(parseGitStatusPorcelain(""), []);
  assert.deepEqual(parseGitStatusPorcelain("  \n"), []);
});

test("parseGitStatusPorcelain handles renamed files", () => {
  const output = "R  old-name.ts -> new-name.ts\n";
  const files = parseGitStatusPorcelain(output);
  assert.equal(files.length, 1);
  assert.match(files[0], /new-name\.ts/);
});

function mockRunner(responses: Record<string, { stdout: string; code: number }>) {
  return async (args: string[]): Promise<{ stdout: string; stderr: string; code: number; killed: boolean }> => {
    const key = args.join(" ");
    const match = Object.entries(responses).find(([pattern]) => key.includes(pattern));
    if (match) {
      return { stdout: match[1].stdout, stderr: "", code: match[1].code, killed: false };
    }
    return { stdout: "", stderr: "not found", code: 1, killed: false };
  };
}

test("buildRecoveryContext returns null when no in-progress issue", async () => {
  const result = await buildRecoveryContext({
    runBr: mockRunner({
      "list --status in_progress": { stdout: "[]", code: 0 },
    }),
    runGit: mockRunner({}),
  });
  assert.equal(result, null);
});

test("buildRecoveryContext returns null when br list fails", async () => {
  const result = await buildRecoveryContext({
    runBr: mockRunner({
      "list --status in_progress": { stdout: "", code: 1 },
    }),
    runGit: mockRunner({}),
  });
  assert.equal(result, null);
});

test("buildRecoveryContext assembles full context from br show + deps + git status", async () => {
  const issue = {
    id: "bd-1",
    title: "Fix parser",
    status: "in_progress",
    issue_type: "task",
    priority: 2,
    comments: [
      { id: 1, issue_id: "bd-1", author: "agent", text: "Started work", created_at: "2026-02-19T10:00:00Z" },
    ],
  };

  const result = await buildRecoveryContext({
    runBr: mockRunner({
      "list --status in_progress": { stdout: JSON.stringify([issue]), code: 0 },
      "show bd-1 --json": { stdout: JSON.stringify([issue]), code: 0 },
      "dep list bd-1 --direction up": { stdout: "[]", code: 0 },
      "dep list bd-1 --direction down": { stdout: JSON.stringify([{ issue_id: "bd-1", depends_on_id: "bd-parent", type: "blocks", title: "Parent", status: "open", priority: 1 }]), code: 0 },
    }),
    runGit: mockRunner({
      "status --porcelain": { stdout: " M src/parser.ts\n", code: 0 },
    }),
  });

  assert.ok(result !== null);
  assert.equal(result!.issue.id, "bd-1");
  assert.equal(result!.parent?.id, "bd-parent");
  assert.deepEqual(result!.blockedBy, []);
  assert.ok(result!.checkpointTrail.length > 0);
  assert.ok(result!.uncommittedFiles.length > 0);
});

test("buildRecoveryContext handles missing deps gracefully", async () => {
  const issue = { id: "bd-1", title: "Test", status: "in_progress", issue_type: "task", priority: 2 };

  const result = await buildRecoveryContext({
    runBr: mockRunner({
      "list --status in_progress": { stdout: JSON.stringify([issue]), code: 0 },
      "show bd-1 --json": { stdout: JSON.stringify([issue]), code: 0 },
      "dep list bd-1 --direction up": { stdout: "", code: 1 },
      "dep list bd-1 --direction down": { stdout: "", code: 1 },
    }),
    runGit: mockRunner({
      "status --porcelain": { stdout: "", code: 0 },
    }),
  });

  assert.ok(result !== null);
  assert.equal(result!.parent, null);
  assert.deepEqual(result!.blockedBy, []);
  assert.deepEqual(result!.uncommittedFiles, []);
});

test("buildRecoveryContext handles git status failure gracefully", async () => {
  const issue = { id: "bd-1", title: "Test", status: "in_progress", issue_type: "task", priority: 2 };

  const result = await buildRecoveryContext({
    runBr: mockRunner({
      "list --status in_progress": { stdout: JSON.stringify([issue]), code: 0 },
      "show bd-1 --json": { stdout: JSON.stringify([issue]), code: 0 },
      "dep list bd-1 --direction up": { stdout: "[]", code: 0 },
      "dep list bd-1 --direction down": { stdout: "[]", code: 0 },
    }),
    runGit: mockRunner({
      "status --porcelain": { stdout: "", code: 1 },
    }),
  });

  assert.ok(result !== null);
  assert.deepEqual(result!.uncommittedFiles, []);
});

test("isGitCommitCommand matches git commit variants", () => {
  assert.equal(isGitCommitCommand("git commit -m 'feat: add parser'"), true);
  assert.equal(isGitCommitCommand("git commit -am 'fix: typo'"), true);
  assert.equal(isGitCommitCommand("  git commit --amend"), true);
  assert.equal(isGitCommitCommand("git commit"), true);
});

test("isGitCommitCommand rejects non-commit git commands", () => {
  assert.equal(isGitCommitCommand("git add ."), false);
  assert.equal(isGitCommitCommand("git push"), false);
  assert.equal(isGitCommitCommand("git log --oneline"), false);
  assert.equal(isGitCommitCommand("echo git commit"), false);
  assert.equal(isGitCommitCommand("# git commit -m 'nope'"), false);
});

test("isGitCommitCommand rejects piped commands starting with non-commit", () => {
  assert.equal(isGitCommitCommand("git add . && git commit -m 'test'"), false);
});

test("parseGitCommitOutput extracts hash and message from standard output", () => {
  const output = "[main a1b2c3d] feat: add parser\n 2 files changed, 15 insertions(+)\n";
  const result = parseGitCommitOutput(output);
  assert.deepEqual(result, { hash: "a1b2c3d", message: "feat: add parser" });
});

test("parseGitCommitOutput handles branch with slashes", () => {
  const output = "[feat/beads-v1 e4f5a6b] fix: handle edge case\n 1 file changed\n";
  const result = parseGitCommitOutput(output);
  assert.deepEqual(result, { hash: "e4f5a6b", message: "fix: handle edge case" });
});

test("parseGitCommitOutput handles detached HEAD", () => {
  const output = "[detached HEAD abc1234] wip: experiment\n";
  const result = parseGitCommitOutput(output);
  assert.deepEqual(result, { hash: "abc1234", message: "wip: experiment" });
});

test("parseGitCommitOutput returns null on non-commit output", () => {
  assert.equal(parseGitCommitOutput("On branch main\nnothing to commit"), null);
  assert.equal(parseGitCommitOutput(""), null);
});

test("parseGitCommitOutput handles amend output", () => {
  const output = "[main f1e2d3c] feat: updated message\n Date: Thu Feb 19 12:00:00 2026 -0800\n 1 file changed\n";
  const result = parseGitCommitOutput(output);
  assert.deepEqual(result, { hash: "f1e2d3c", message: "feat: updated message" });
});

test("extractEditedFilePath returns path for write tool", () => {
  assert.equal(extractEditedFilePath("write", { path: "src/parser.ts" }), "src/parser.ts");
});

test("extractEditedFilePath returns path for edit tool", () => {
  assert.equal(extractEditedFilePath("edit", { path: "src/lib.ts", oldText: "foo", newText: "bar" }), "src/lib.ts");
});

test("extractEditedFilePath returns null for other tools", () => {
  assert.equal(extractEditedFilePath("bash", { command: "echo hi" }), null);
  assert.equal(extractEditedFilePath("read", { path: "src/lib.ts" }), null);
});

test("extractEditedFilePath returns null when path is not a string", () => {
  assert.equal(extractEditedFilePath("write", {}), null);
  assert.equal(extractEditedFilePath("write", { path: 123 }), null);
});

test("formatFileListComment formats file set into comment", () => {
  const files = new Set(["src/parser.ts", "src/types.ts", "tests/parser.test.ts"]);
  const comment = formatFileListComment(files);
  assert.match(comment!, /Files modified:/);
  assert.match(comment!, /src\/parser\.ts/);
  assert.match(comment!, /src\/types\.ts/);
  assert.match(comment!, /tests\/parser\.test\.ts/);
});

test("formatFileListComment returns null for empty set", () => {
  assert.equal(formatFileListComment(new Set()), null);
  assert.equal(formatFileListComment(undefined), null);
});

test("formatFileListComment truncates to 30 files", () => {
  const files = new Set(Array.from({ length: 40 }, (_, i) => `file${String(i).padStart(2, "0")}.ts`));
  const comment = formatFileListComment(files);
  assert.ok(comment !== null);
  assert.match(comment!, /and 10 more/);
  assert.match(comment!, /file29\.ts/);
  assert.ok(!comment!.includes("file30.ts"));
});

test("shouldNudgeCheckpoint returns true when threshold reached", () => {
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 8, lastCheckpointTurn: 0, threshold: 8 }), true);
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 10, lastCheckpointTurn: 0, threshold: 8 }), true);
});

test("shouldNudgeCheckpoint returns false below threshold", () => {
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 7, lastCheckpointTurn: 0, threshold: 8 }), false);
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 3, lastCheckpointTurn: 0, threshold: 8 }), false);
});

test("shouldNudgeCheckpoint respects lastCheckpointTurn offset", () => {
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 12, lastCheckpointTurn: 5, threshold: 8 }), false);
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 13, lastCheckpointTurn: 5, threshold: 8 }), true);
});

test("shouldNudgeCheckpoint returns false when no issue is active", () => {
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 10, lastCheckpointTurn: 0, threshold: 8, hasActiveIssue: false }), false);
});

test("buildCheckpointNudgeMessage includes issue id and command hint", () => {
  const msg = buildCheckpointNudgeMessage("bd-1", 8);
  assert.match(msg, /bd-1/);
  assert.match(msg, /checkpoint/i);
  assert.match(msg, /br comments add/);
});

test("buildCheckpointSummary formats summary with files and turns", () => {
  const summary = buildCheckpointSummary({
    editedFiles: new Set(["src/parser.ts", "tests/parser.test.ts"]),
    turnsSinceCheckpoint: 5,
  });
  assert.match(summary, /Auto-checkpoint/);
  assert.match(summary, /src\/parser\.ts/);
  assert.match(summary, /5 turns/);
});

test("buildCheckpointSummary handles empty files", () => {
  const summary = buildCheckpointSummary({
    editedFiles: new Set(),
    turnsSinceCheckpoint: 3,
  });
  assert.match(summary, /Auto-checkpoint/);
  assert.match(summary, /3 turns/);
  assert.ok(!summary.includes("Files"));
});

test("buildCheckpointSummary truncates file list to 20", () => {
  const files = new Set(Array.from({ length: 25 }, (_, i) => `file${String(i).padStart(2, "0")}.ts`));
  const summary = buildCheckpointSummary({
    editedFiles: files,
    turnsSinceCheckpoint: 10,
  });
  assert.match(summary, /and 5 more/);
});

test("buildContinueMessage includes closed id and ready command", () => {
  const msg = buildContinueMessage("bd-123");
  assert.match(msg, /bd-123/);
  assert.match(msg, /closed/);
  assert.match(msg, /br ready/);
});

test("buildContinueMessage includes fallback guidance", () => {
  const msg = buildContinueMessage("bd-456");
  assert.match(msg, /no ready issues/i);
});

test("formatEnrichedReadyOutput renders issues with parent and unblocks", () => {
  const output = formatEnrichedReadyOutput([
    {
      issue: { id: "bd-1", title: "Parser", type: "task", priority: 2, status: "open" },
      parent: { id: "bd-p", title: "Widget system", type: "feature", priority: 1, status: "open" },
      unblocks: [
        { id: "bd-2", title: "Renderer", type: "task", priority: 2, status: "open" },
      ],
    },
  ]);
  assert.match(output, /bd-1/);
  assert.match(output, /Parser/);
  assert.match(output, /↳ parent:.*bd-p.*Widget system/);
  assert.match(output, /↳ unblocks:.*bd-2.*Renderer/);
});

test("formatEnrichedReadyOutput omits parent/unblocks when empty", () => {
  const output = formatEnrichedReadyOutput([
    {
      issue: { id: "bd-1", title: "Standalone", type: "task", priority: 2, status: "open" },
      parent: null,
      unblocks: [],
    },
  ]);
  assert.match(output, /bd-1/);
  assert.ok(!output.includes("parent:"));
  assert.ok(!output.includes("unblocks:"));
});

test("formatEnrichedReadyOutput handles multiple issues", () => {
  const output = formatEnrichedReadyOutput([
    {
      issue: { id: "bd-1", title: "First", type: "task", priority: 1, status: "open" },
      parent: null,
      unblocks: [],
    },
    {
      issue: { id: "bd-2", title: "Second", type: "task", priority: 2, status: "open" },
      parent: { id: "bd-p", title: "Parent", type: "feature", priority: 1, status: "open" },
      unblocks: [],
    },
  ]);
  assert.match(output, /bd-1.*First/);
  assert.match(output, /bd-2.*Second/);
});

test("formatEnrichedReadyOutput returns empty message for no issues", () => {
  const output = formatEnrichedReadyOutput([]);
  assert.match(output, /No ready issues/);
});

test("dirty tree close warning text includes semantic-commit guidance", () => {
  assert.match(DIRTY_TREE_CLOSE_WARNING, /semantic-commit/);
});

test("observability helper is exposed for lifecycle diagnostics", () => {
  assert.equal(typeof (lib as Record<string, unknown>).buildObservabilitySummary, "function");
});

test("observability helper can suppress noisy events when disabled", () => {
  const maybeFn = (lib as Record<string, unknown>).buildObservabilitySummary;
  assert.equal(typeof maybeFn, "function");

  const summary = (maybeFn as (input: {
    enabled: boolean;
    eventType: string;
    toolName?: string;
  }) => string | null)({
    enabled: false,
    eventType: "tool_execution_update",
    toolName: "beads",
  });

  assert.equal(summary, null);
});

test("extractErrorSummary extracts message and hint from JSON error", () => {
  const json = JSON.stringify({ error: { message: "Not found", hint: "Check the ID" } });

  const result = extractErrorSummary(json);

  assert.equal(result, "Not found (Check the ID)");
});

test("extractErrorSummary extracts message-only from JSON error", () => {
  const json = JSON.stringify({ error: { message: "Server error" } });

  const result = extractErrorSummary(json);

  assert.equal(result, "Server error");
});

test("extractErrorSummary falls back to first non-empty line", () => {
  const result = extractErrorSummary("\n  something went wrong\n  details here");

  assert.equal(result, "something went wrong");
});

test("extractErrorSummary returns null for non-string input", () => {
  assert.equal(extractErrorSummary(42), null);
  assert.equal(extractErrorSummary(null), null);
  assert.equal(extractErrorSummary(undefined), null);
});

test("extractErrorSummary returns null for empty string", () => {
  assert.equal(extractErrorSummary(""), null);
  assert.equal(extractErrorSummary("   "), null);
});
