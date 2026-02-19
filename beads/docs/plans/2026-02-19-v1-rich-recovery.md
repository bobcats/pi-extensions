# V1: Rich Recovery — Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:executing-plans skill to implement this plan task-by-task.

**Goal:** Replace the static beads prime message with a rich recovery context that reconstructs full task state from beads comments, dependencies, and uncommitted files — surviving compaction and restart.

**Architecture:** Add new stores (S2 `editedFiles`, S3 `checkpointState`, S4 `currentIssueId`) to `BeadsState`. Build a `buildRecoveryContext()` function in `lib.ts` that queries in-progress issue details, dependency tree, and uncommitted files, then formats a structured ~2KB recovery block. The `before_agent_start` hook calls this when priming, falling back to the static prime when no issue is in-progress. The `claim` and `close` tool actions set/clear the new stores.

**Tech Stack:** TypeScript, `tsx --test`, pi `ExtensionAPI`, `br` CLI (JSON output), `git status --porcelain`

---

## File Map

| File | Role |
|------|------|
| `beads/commands.ts` | `BeadsState` type — add new fields |
| `beads/lib.ts` | New functions: recovery builder, dep parser, message formatter |
| `beads/lib.test.ts` | Tests for all new `lib.ts` functions |
| `beads/hooks.ts` | Enhance `before_agent_start` to use recovery context |
| `beads/tool.ts` | Enhance `claim`/`close` actions to manage S2/S3/S4 |
| `beads/index.ts` | Wire new state fields + pass `runGit` to tool deps |

## How to Run Tests

```bash
cd beads && npm test
```

This runs `tsx --test lib.test.ts` (see `beads/package.json`).

---

### Task 1: Extend BeadsState with New Stores

**Files:**
- Modify: `beads/commands.ts` (the `BeadsState` interface, ~line 23)

**Step 1: Add new fields to BeadsState**

In `beads/commands.ts`, add three fields to the `BeadsState` interface:

```typescript
export interface BeadsState {
  isBeadsProject: boolean;
  beadsEnabled: boolean;
  shouldPrime: boolean;
  contextReminderShown: boolean;
  cachedModeText: string;
  // V1: Rich recovery stores
  currentIssueId: string | null;
  editedFiles: Map<string, Set<string>>;
  checkpointState: { lastCheckpointTurn: number; turnIndex: number };
}
```

**Step 2: Initialize new fields in index.ts**

In `beads/index.ts`, update the state initialization (~line 79):

```typescript
const state: BeadsState = {
  isBeadsProject: false,
  beadsEnabled: false,
  shouldPrime: false,
  contextReminderShown: false,
  cachedModeText: "",
  currentIssueId: null,
  editedFiles: new Map(),
  checkpointState: { lastCheckpointTurn: 0, turnIndex: 0 },
};
```

**Step 3: Verify it compiles**

Run: `cd beads && npx tsc --noEmit`

If there's no tsconfig: `cd beads && npm test`

Expected: passes (no type errors, existing tests still green)

**Step 4: Commit**

```
feat(beads): add V1 stores to BeadsState

S2 editedFiles, S3 checkpointState, S4 currentIssueId — all
initialized empty, used by rich recovery and later slices.
```

---

### Task 2: Add `parseBrDepListJson()` and `formatCheckpointTrail()`

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

**Step 1: Write failing tests for `parseBrDepListJson`**

Add to `lib.test.ts`:

```typescript
import {
  // ... existing imports ...
  parseBrDepListJson,
  formatCheckpointTrail,
} from "./lib.ts";

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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`

Expected: FAIL — `parseBrDepListJson` is not exported from `./lib.ts`

**Step 3: Implement `parseBrDepListJson`**

Add to `lib.ts`:

```typescript
export function parseBrDepListJson(json: string): BrIssueSummary[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => normalizeIssueRow(row))
      .filter((issue): issue is BrIssueSummary => issue !== null);
  } catch {
    return [];
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`

Expected: All pass including new tests

**Step 5: Write failing tests for `formatCheckpointTrail`**

Add to `lib.test.ts`:

```typescript
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
  assert.ok(trail[0].length <= 220); // 200 chars text + time prefix + "..."
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
```

You'll need to import `BrComment` type — add it to the test imports:

```typescript
import type { BrComment } from "./lib.ts";
```

**Step 6: Run tests to verify they fail**

Run: `cd beads && npm test`

Expected: FAIL — `formatCheckpointTrail` is not exported

**Step 7: Implement `formatCheckpointTrail`**

Add to `lib.ts`:

```typescript
function formatRelativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  if (!Number.isFinite(diffMs)) return "unknown";
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatCheckpointTrail(
  comments: BrComment[] | undefined,
  now: Date,
): string[] {
  if (!comments?.length) return [];

  const MAX_COMMENTS = 5;
  const MAX_TEXT_LENGTH = 200;

  const recent = comments.slice(-MAX_COMMENTS);
  return recent.map((c) => {
    const time = formatRelativeTime(new Date(c.created_at), now);
    const text = c.text.length > MAX_TEXT_LENGTH
      ? c.text.slice(0, MAX_TEXT_LENGTH - 3) + "..."
      : c.text;
    return `- [${time}] ${text}`;
  });
}
```

**Step 8: Run tests to verify they pass**

Run: `cd beads && npm test`

Expected: All pass

**Step 9: Commit**

```
feat(beads): add parseBrDepListJson and formatCheckpointTrail

Parses br dep list JSON output. Formats comment trail with relative
timestamps, limited to last 5 comments, each truncated to 200 chars.
```

---

### Task 3: Add `buildRecoveryContext()` and `formatRecoveryMessage()`

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

These are the core functions. `buildRecoveryContext` is the orchestrator that calls external queries (passed as deps), and `formatRecoveryMessage` is the pure formatter.

**Step 1: Write failing tests for `formatRecoveryMessage`**

Add to `lib.test.ts`:

```typescript
import {
  // ... existing imports ...
  formatRecoveryMessage,
} from "./lib.ts";

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
  // Files are comma-joined on one line; verify last 5 are excluded
  assert.match(msg, /file14\.ts/);  // file14 = 15th file (0-indexed), should be included
  assert.ok(!msg.includes("file15.ts"));  // file15 = 16th, should be truncated
  assert.match(msg, /and 5 more/);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`

Expected: FAIL — `formatRecoveryMessage` not exported

**Step 3: Implement `formatRecoveryMessage`**

Add to `lib.ts`:

```typescript
export type RecoveryContext = {
  issue: BrShowIssue;
  checkpointTrail: string[];
  parent: BrIssueSummary | null;
  blockedBy: BrIssueSummary[];
  uncommittedFiles: string[];
};

export function formatRecoveryMessage(ctx: RecoveryContext): string {
  const { issue, checkpointTrail, parent, blockedBy, uncommittedFiles } = ctx;

  const priority = typeof issue.priority === "number" ? `P${issue.priority}` : "P?";
  const type = issue.type ?? "issue";
  const status = issue.status ?? "unknown";

  const lines: string[] = [
    "# Beads Workflow Context",
    "",
    "## Core Rules",
    "- Use beads for ALL task tracking (`br create`, `br ready`, `br close`)",
    "- Do NOT use TodoWrite, TaskCreate, or markdown task files for tracking",
    "- Create beads issue BEFORE writing code",
    "- Mark issue in_progress when starting work",
    "",
    "## Essential Commands",
    "- br ready",
    "- br list --status in_progress",
    "- br show <id>",
    '- br close <id> --reason "Verified: ..."',
    "",
    `## Resuming: ${issue.id} — ${issue.title}`,
    `**Status:** ${status} | **Type:** ${type} | **Priority:** ${priority}`,
  ];

  if (parent) {
    const parentType = parent.type ? ` (${parent.type})` : "";
    lines.push(`**Parent:** ${parent.id} — ${parent.title}${parentType}`);
  }

  if (blockedBy.length > 0) {
    const items = blockedBy.map((b) => `${b.id} — ${b.title}`).join(", ");
    lines.push(`**Unblocks:** ${items}`);
  }

  if (checkpointTrail.length > 0) {
    lines.push("", "### Checkpoint Trail");
    lines.push(...checkpointTrail);
  }

  if (uncommittedFiles.length > 0) {
    const MAX_FILES = 15;
    lines.push("", "### Uncommitted Changes");
    const shown = uncommittedFiles.slice(0, MAX_FILES);
    lines.push(shown.join(", "));
    if (uncommittedFiles.length > MAX_FILES) {
      lines.push(`...and ${uncommittedFiles.length - MAX_FILES} more`);
    }
  }

  return lines.join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`

Expected: All pass

**Step 5: Commit**

```
feat(beads): add formatRecoveryMessage for rich context injection

Pure formatter: takes issue, checkpoint trail, deps, uncommitted files
→ produces structured ~2KB recovery block. Truncation: 15 files max,
trail already limited to 5 entries by formatCheckpointTrail.
```

---

### Task 4: Add `parseGitStatusPorcelain()`

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

**Step 1: Write failing tests**

Add to `lib.test.ts`:

```typescript
import {
  // ... existing imports ...
  parseGitStatusPorcelain,
} from "./lib.ts";

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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`

Expected: FAIL — `parseGitStatusPorcelain` not exported

**Step 3: Implement `parseGitStatusPorcelain`**

Add to `lib.ts`:

```typescript
export function parseGitStatusPorcelain(output: string): string[] {
  if (!output.trim()) return [];

  return output
    .split("\n")
    .filter((line) => line.length >= 4) // porcelain format: XY <path>
    .map((line) => {
      const xy = line.slice(0, 2);
      let path = line.slice(3);

      // Handle renames: "R  old -> new"
      const arrowIndex = path.indexOf(" -> ");
      if (arrowIndex !== -1) {
        path = path.slice(arrowIndex + 4);
      }

      const code = xy.trim() || "?";
      const label = code === "??" ? "?" : code;
      return `${path} (${label})`;
    });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`

Expected: All pass

**Step 5: Commit**

```
feat(beads): add parseGitStatusPorcelain for uncommitted file list

Parses git status --porcelain output into labeled file entries.
Handles modified, staged, new, deleted, and renamed files.
```

---

### Task 5: Add `buildRecoveryContext()` Orchestrator

This is the async function that calls `br` and `git` and assembles the `RecoveryContext`. It uses dependency injection for testability.

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

**Step 1: Write failing tests**

Add to `lib.test.ts`:

```typescript
import {
  // ... existing imports ...
  buildRecoveryContext,
} from "./lib.ts";

// Helper to create a mock runner
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
      "dep list bd-1 --direction up": { stdout: JSON.stringify([{ id: "bd-parent", title: "Parent" }]), code: 0 },
      "dep list bd-1 --direction down": { stdout: "[]", code: 0 },
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`

Expected: FAIL — `buildRecoveryContext` not exported

**Step 3: Implement `buildRecoveryContext`**

Add to `lib.ts`:

```typescript
type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};

export type RecoveryDeps = {
  runBr(args: string[], timeout?: number): Promise<ExecResult>;
  runGit(args: string[], timeout?: number): Promise<ExecResult>;
};

export async function buildRecoveryContext(deps: RecoveryDeps): Promise<RecoveryContext | null> {
  // N10: query in-progress issue
  const listResult = await deps.runBr(["list", "--status", "in_progress", "--sort", "updated_at", "--json"]);
  if (listResult.code !== 0) return null;

  const issues = parseBrReadyJson(listResult.stdout);
  const first = issues[0];
  if (!first) return null;

  // N11: query issue details (includes comments)
  const showResult = await deps.runBr(["show", first.id, "--json"]);
  const detail = showResult.code === 0 ? parseBrShowJson(showResult.stdout) : null;

  const issue: BrShowIssue = detail ?? { ...first };
  const comments = detail?.comments;

  // N12: query dependency context (parallel)
  const [upResult, downResult] = await Promise.all([
    deps.runBr(["dep", "list", first.id, "--direction", "up", "--json"]).catch(() => ({ stdout: "[]", stderr: "", code: 1, killed: false })),
    deps.runBr(["dep", "list", first.id, "--direction", "down", "--json"]).catch(() => ({ stdout: "[]", stderr: "", code: 1, killed: false })),
  ]);

  const parents = upResult.code === 0 ? parseBrDepListJson(upResult.stdout) : [];
  const blockedBy = downResult.code === 0 ? parseBrDepListJson(downResult.stdout) : [];
  const parent = parents[0] ?? null;

  // N15: query uncommitted files
  const gitResult = await deps.runGit(["status", "--porcelain"]);
  const uncommittedFiles = gitResult.code === 0 ? parseGitStatusPorcelain(gitResult.stdout) : [];

  // Format checkpoint trail from comments
  const checkpointTrail = formatCheckpointTrail(comments, new Date());

  return {
    issue,
    checkpointTrail,
    parent,
    blockedBy,
    uncommittedFiles,
  };
}
```

Note: `ExecResult` is already defined locally in other files. The `lib.ts` version is a local type — add it near the top of the file if it's not already there. Don't import it from another module since each file defines its own copy.

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`

Expected: All pass

**Step 5: Commit**

```
feat(beads): add buildRecoveryContext orchestrator

Queries in-progress issue, details+comments, dep tree (up/down),
and git status --porcelain. Assembles RecoveryContext for formatting.
Falls back gracefully on any individual query failure.
```

---

### Task 6: Wire Recovery into `before_agent_start` Hook

**Files:**
- Modify: `beads/hooks.ts`
- Modify: `beads/index.ts` (pass `runGit` to hooks deps — already done)

**Step 1: Update `before_agent_start` handler**

Replace the existing `before_agent_start` handler in `beads/hooks.ts` with:

```typescript
pi.on("before_agent_start", async () => {
  if (!state.beadsEnabled || !state.shouldPrime) {
    return;
  }

  state.shouldPrime = false;

  // Try rich recovery first
  const recovery = await buildRecoveryContext({ runBr: deps.runBr, runGit: deps.runGit });

  if (recovery) {
    // Cache the issue ID for other features (V2-V7)
    state.currentIssueId = recovery.issue.id;

    return {
      message: {
        customType: "beads-prime",
        content: formatRecoveryMessage(recovery),
        display: false,
      },
    };
  }

  // Fallback: static prime with no resume section
  return {
    message: {
      customType: "beads-prime",
      content: buildBeadsPrimeMessage({ beadsEnabled: state.beadsEnabled }),
      display: false,
    },
  };
});
```

Update the imports at the top of `hooks.ts`:

```typescript
import {
  buildBeadsPrimeMessage,
  buildObservabilitySummary,
  buildRecoveryContext,
  formatRecoveryMessage,
  isBrCloseCommand,
  parseBeadsSessionMode,
  shouldShowContextReminder,
} from "./lib.ts";
```

Remove the now-unused imports: `buildResumeContext`, `parseBrReadyJson`, `parseBrShowJson`.

**Step 2: Verify tests still pass**

Run: `cd beads && npm test`

Expected: All pass (existing tests don't test hooks directly — they test `lib.ts` functions)

**Step 3: Manual smoke test**

In a beads project with an in-progress issue:
1. Start pi
2. Send any prompt
3. Check the injected message contains "Resuming:" with issue details

**Step 4: Commit**

```
feat(beads): wire rich recovery into before_agent_start

Replaces static resume context with full recovery: issue details,
checkpoint trail from comments, dependency tree, uncommitted files.
Falls back to static prime when no in-progress issue.
```

---

### Task 7: Enhance Claim Action — Set S4, Initialize S2/S3

**Files:**
- Modify: `beads/tool.ts`

**Step 1: Update the `claim` case in the beads tool**

In `tool.ts`, replace the `claim` case (~line 376):

```typescript
case "claim": {
  if (!input.id) {
    return fail("beads claim requires id", { action: input.action, missing: "id" });
  }
  const claimResult = await runBrForTool(["update", input.id, "--status", "in_progress"]);

  // V1: Initialize stores on claim
  if (!claimResult.isError) {
    deps.onClaim(input.id);
  }

  return claimResult;
}
```

**Step 2: Add `onClaim` to tool deps**

In `tool.ts`, update the `registerBeadsTool` deps type to include:

```typescript
deps: {
  isEnabled(): boolean;
  runBr(args: string[], timeout?: number): Promise<ExecResult>;
  refreshBeadsStatus(ctx: UiContext): Promise<void>;
  maybeNudgeCommitAfterClose(ctx: NotifyContext): Promise<string | null>;
  onClaim(issueId: string): void;
  onClose(issueId: string): void;
},
```

**Step 3: Wire `onClaim` in `index.ts`**

In `beads/index.ts`, update the `registerBeadsTool` call:

```typescript
registerBeadsTool(pi, {
  isEnabled: () => state.beadsEnabled,
  runBr,
  refreshBeadsStatus,
  maybeNudgeCommitAfterClose,
  onClaim(issueId: string) {
    state.currentIssueId = issueId;
    state.editedFiles.set(issueId, new Set());
    state.checkpointState = { lastCheckpointTurn: 0, turnIndex: 0 };
  },
  onClose(issueId: string) {
    state.currentIssueId = null;
    state.editedFiles.delete(issueId);
    state.checkpointState = { lastCheckpointTurn: 0, turnIndex: 0 };
  },
});
```

**Step 4: Verify tests still pass**

Run: `cd beads && npm test`

Expected: All pass

**Step 5: Commit**

```
feat(beads): initialize V1 stores on claim, clear on close

Claim sets S4 (currentIssueId), creates S2 entry (editedFiles),
resets S3 (checkpointState). Close clears all three.
```

---

### Task 8: Enhance Close Action — Clear S4, Delete S2

**Files:**
- Modify: `beads/tool.ts`

**Step 1: Update the `close` case in the beads tool**

In `tool.ts`, replace the `close` case:

```typescript
case "close": {
  if (!input.id) {
    return fail("beads close requires id", { action: input.action, missing: "id" });
  }
  const reason = input.reason?.trim() || "Verified: completed";
  const closeResult = await runBrForTool(["close", input.id, "--reason", reason]);

  // V1: Clear stores on close
  if (!closeResult.isError) {
    deps.onClose(input.id);
  }

  return closeResult;
}
```

**Step 2: Verify tests still pass**

Run: `cd beads && npm test`

Expected: All pass

**Step 3: Commit**

```
feat(beads): clear V1 stores on close action

Clears S4 (currentIssueId), deletes S2 entry, resets S3.
```

---

### Task 9: Full Integration Verification

**Step 1: Run the full test suite**

Run: `cd beads && npm test`

Expected: All tests pass, including:
- Existing tests (unchanged behavior)
- New `parseBrDepListJson` tests
- New `formatCheckpointTrail` tests
- New `formatRecoveryMessage` tests
- New `parseGitStatusPorcelain` tests
- New `buildRecoveryContext` tests

**Step 2: Verify no type errors**

Run: `cd beads && npx tsc --noEmit` (if tsconfig exists)

Or just confirm `npm test` passes cleanly (tsx catches type errors at runtime).

**Step 3: Manual smoke test in a live pi session**

1. Ensure you have a beads project (`br init` if needed)
2. Create an issue: `br create "Test issue" --type task --priority 2`
3. Claim it: `br update <id> --status in_progress`
4. Add a comment: `br comments add <id> "Started work on test"`
5. Start pi, send any prompt
6. Verify the injected message contains:
   - "Resuming: <id> — Test issue"
   - The checkpoint trail with "Started work on test"
   - Uncommitted changes (if any)
7. Run `/compact`
8. Send another prompt
9. Verify the recovery message appears again with the same content

**Step 4: Final commit (if any fixups needed)**

```
fix(beads): integration fixups for V1 rich recovery
```
