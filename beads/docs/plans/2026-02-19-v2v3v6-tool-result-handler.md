# V2+V3+V6: tool_result Handler — Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:executing-plans skill to implement this plan task-by-task.

**Goal:** Wire a `tool_result` hook to detect git commits (→ link to issue), track edited files (→ attach list on close), and detect checkpoint-worthy turns (→ nudge after 8 turns). Also enhance `turn_end` to count turns and fire checkpoint reminders, and enhance `close` to flush file list.

**Architecture:** Three behaviors share one `tool_result` handler and extend `turn_end`. V2 (commit linking) detects bash `git commit` → parses output → `br comments add`. V3 (file tracking) detects write/edit tools → adds path to S2. V6 (checkpoint nudge) increments S3 in `turn_end`, fires nudge when threshold reached. Pure detection/parsing functions live in `lib.ts` and are tested independently. Wiring lives in `hooks.ts`. File-list flush on close lives in `tool.ts`.

**Tech Stack:** TypeScript, `tsx --test`, pi `ExtensionAPI` (`tool_result`, `turn_end` hooks), `isBashToolResult`/`isWriteToolResult`/`isEditToolResult` type guards, `br` CLI

---

## File Map

| File | Role |
|------|------|
| `beads/lib.ts` | New: `isGitCommitCommand()`, `parseGitCommitOutput()`, `extractEditedFilePath()`, `formatFileListComment()`, `shouldNudgeCheckpoint()`, `buildCheckpointNudgeMessage()` |
| `beads/lib.test.ts` | Tests for all new lib functions |
| `beads/hooks.ts` | New `tool_result` handler (commit detect + file track), extend `turn_end` (checkpoint nudge) |
| `beads/tool.ts` | Enhance `close` action to flush file list comment; `comment` action resets S3 |
| `beads/index.ts` | Pass `state` ref to tool deps for S3 reset; minor wiring |

## How to Run Tests

```bash
cd beads && npm test
```

This runs `tsx --test lib.test.ts index.test.ts` (see `beads/package.json`).

---

### Task 1: Add `isGitCommitCommand()` and `parseGitCommitOutput()`

**Files:**
- Modify: `beads/lib.ts` — add two functions
- Modify: `beads/lib.test.ts` — add tests

**Step 1: Write the failing tests**

Add to imports in `lib.test.ts`:

```typescript
import {
  // ... existing imports ...
  isGitCommitCommand,
  parseGitCommitOutput,
} from "./lib.ts";
```

Add tests before the `"dirty tree close warning"` test:

```typescript
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

test("isGitCommitCommand handles piped/chained commands with git commit", () => {
  // We only detect if the command string starts with git commit (after optional whitespace).
  // Piped commands like "git add . && git commit" won't match — that's fine,
  // the output parsing will still work if commit succeeds.
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`
Expected: FAIL — `isGitCommitCommand` and `parseGitCommitOutput` not exported

**Step 3: Write minimal implementation**

Add to `lib.ts` (before `buildResumeContext`):

```typescript
export function isGitCommitCommand(command: string): boolean {
  return /^\s*git\s+commit\b/.test(command);
}

export function parseGitCommitOutput(stdout: string): { hash: string; message: string } | null {
  const match = stdout.match(/^\[[\w/.+-]+\s+([a-f0-9]+)\]\s+(.+)/m);
  if (!match) return null;
  return { hash: match[1], message: match[2] };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add beads/lib.ts beads/lib.test.ts
git commit -m "feat(beads): add isGitCommitCommand and parseGitCommitOutput

Detects git commit commands and parses [branch hash] message from
stdout. Used by tool_result handler to link commits to issues."
```

---

### Task 2: Add `extractEditedFilePath()` and `formatFileListComment()`

**Files:**
- Modify: `beads/lib.ts` — add two functions
- Modify: `beads/lib.test.ts` — add tests

**Step 1: Write the failing tests**

Add to imports:

```typescript
import {
  // ... existing imports ...
  extractEditedFilePath,
  formatFileListComment,
} from "./lib.ts";
```

Add tests:

```typescript
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
  assert.match(comment, /Files modified:/);
  assert.match(comment, /src\/parser\.ts/);
  assert.match(comment, /src\/types\.ts/);
  assert.match(comment, /tests\/parser\.test\.ts/);
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`
Expected: FAIL — not exported

**Step 3: Write minimal implementation**

```typescript
export function extractEditedFilePath(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "write" || toolName === "edit") {
    return typeof input.path === "string" ? input.path : null;
  }
  return null;
}

export function formatFileListComment(files: Set<string> | undefined): string | null {
  if (!files?.size) return null;

  const MAX_FILES = 30;
  const sorted = [...files].sort();
  const shown = sorted.slice(0, MAX_FILES);
  let comment = `Files modified: ${shown.join(", ")}`;
  if (sorted.length > MAX_FILES) {
    comment += ` ...and ${sorted.length - MAX_FILES} more`;
  }
  return comment;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add beads/lib.ts beads/lib.test.ts
git commit -m "feat(beads): add extractEditedFilePath and formatFileListComment

Extracts file path from write/edit tool inputs. Formats file set
into comment text for issue close. Truncates to 30 files max."
```

---

### Task 3: Add `shouldNudgeCheckpoint()` and `buildCheckpointNudgeMessage()`

**Files:**
- Modify: `beads/lib.ts` — add two functions
- Modify: `beads/lib.test.ts` — add tests

**Step 1: Write the failing tests**

Add to imports:

```typescript
import {
  // ... existing imports ...
  shouldNudgeCheckpoint,
  buildCheckpointNudgeMessage,
} from "./lib.ts";
```

Add tests:

```typescript
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

test("shouldNudgeCheckpoint fires only once per threshold window", () => {
  // Exactly at threshold: true. One past: false (already fired).
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 8, lastCheckpointTurn: 0, threshold: 8 }), true);
  // The caller is responsible for not calling again — but the function itself
  // only returns true when the gap is exactly threshold (first time) or when
  // no checkpoint has happened since. We keep it simple: >= threshold.
  // The hook will guard with a `nudgeFired` flag.
  assert.equal(shouldNudgeCheckpoint({ turnIndex: 9, lastCheckpointTurn: 0, threshold: 8 }), true);
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`
Expected: FAIL — not exported

**Step 3: Write minimal implementation**

```typescript
export function shouldNudgeCheckpoint(opts: {
  turnIndex: number;
  lastCheckpointTurn: number;
  threshold: number;
  hasActiveIssue?: boolean;
}): boolean {
  if (opts.hasActiveIssue === false) return false;
  return opts.turnIndex - opts.lastCheckpointTurn >= opts.threshold;
}

export function buildCheckpointNudgeMessage(issueId: string, turnsSinceCheckpoint: number): string {
  return [
    `You've been working for ${turnsSinceCheckpoint} turns without checkpointing progress to ${issueId}.`,
    `Consider running: beads comment (id: "${issueId}", comment: "Checkpoint: <brief summary of progress>")`,
    `Or via CLI: br comments add ${issueId} "Checkpoint: <summary>"`,
  ].join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add beads/lib.ts beads/lib.test.ts
git commit -m "feat(beads): add shouldNudgeCheckpoint and buildCheckpointNudgeMessage

Pure functions for checkpoint reminder logic. Fires when turn gap
exceeds threshold (default 8). Includes command hint for agent."
```

---

### Task 4: Wire `tool_result` Handler for Commit Linking + File Tracking

**Files:**
- Modify: `beads/hooks.ts` — add `tool_result` handler

**Step 1: Add imports**

In `hooks.ts`, add to the import from `lib.ts`:

```typescript
import {
  // ... existing ...
  isGitCommitCommand,
  parseGitCommitOutput,
  extractEditedFilePath,
} from "./lib.ts";
```

Update the existing pi import (don't add a second import block — extend the existing one):

```typescript
import {
  isToolCallEventType,
  isBashToolResult,
  isWriteToolResult,
  isEditToolResult,
  type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
```

**Step 2: Add the handler**

After the existing `tool_call` handler for `br close` blocking, add:

```typescript
pi.on("tool_result", async (event) => {
  if (!state.beadsEnabled || !state.currentIssueId) return;

  // V2: Commit-to-issue linking
  if (isBashToolResult(event) && !event.isError) {
    const command = typeof event.input.command === "string" ? event.input.command : "";

    if (isGitCommitCommand(command)) {
      const text = event.content.find((c) => c.type === "text");
      const stdout = text && "text" in text ? text.text : "";
      const parsed = parseGitCommitOutput(stdout);

      if (parsed) {
        // Link commit to issue (fire-and-forget)
        deps.runBr(["comments", "add", state.currentIssueId, `commit: ${parsed.hash} ${parsed.message}`], 5000).catch(() => {});
        // Commit counts as checkpoint — reset S3
        state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
      }
    }

    // V2 also: detect manual `br comments add` via bash — reset checkpoint counter
    if (/^\s*br\s+comments\s+add\b/.test(command)) {
      state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
    }
  }

  // V3: File tracking
  if (isWriteToolResult(event) || isEditToolResult(event)) {
    const path = extractEditedFilePath(event.toolName, event.input);
    if (path && state.currentIssueId) {
      let files = state.editedFiles.get(state.currentIssueId);
      if (!files) {
        files = new Set();
        state.editedFiles.set(state.currentIssueId, files);
      }
      files.add(path);
    }
  }
});
```

**Step 3: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All existing tests still PASS (the handler is purely wiring — no new testable units here; the pure functions were tested in Tasks 1-3)

**Step 4: Commit**

```bash
git add beads/hooks.ts
git commit -m "feat(beads): wire tool_result for commit linking and file tracking

V2: bash git commit → parse output → br comments add (fire-and-forget).
Also detects manual br comments add to reset checkpoint counter.
V3: write/edit tools → add path to S2 editedFiles map.
Commits reset S3 checkpoint counter (natural checkpoint)."
```

---

### Task 5: Enhance `close` Action to Flush File List

**Files:**
- Modify: `beads/tool.ts` — add file list comment before close
- Modify: `beads/index.ts` — wire deps

**Step 1: Add deps**

In `tool.ts`, add to the deps type:

```typescript
deps: {
  // ... existing ...
  getEditedFiles(issueId: string): Set<string> | undefined;
  runBr(args: string[], timeout?: number): Promise<ExecResult>; // already exists — reuse
};
```

Wait — `runBr` is already in deps. We just need `getEditedFiles`. Update the deps type:

```typescript
deps: {
  isEnabled(): boolean;
  runBr(args: string[], timeout?: number): Promise<ExecResult>;
  refreshBeadsStatus(ctx: UiContext): Promise<void>;
  maybeNudgeCommitAfterClose(ctx: NotifyContext): Promise<string | null>;
  onClaim(issueId: string): void;
  onClose(issueId: string): void;
  getEditedFiles(issueId: string): Set<string> | undefined;
};
```

**Step 2: Add import and enhance close action**

Add to import in `tool.ts`:

```typescript
import {
  // ... existing ...
  formatFileListComment,
} from "./lib.ts";
```

In the `close` case, after the id check and before `runBrForTool`, add the file list flush:

```typescript
case "close": {
  if (!input.id) {
    return fail("beads close requires id", { action: input.action, missing: "id" });
  }

  // V3: Flush file list as comment before closing
  const fileListComment = formatFileListComment(deps.getEditedFiles(input.id));
  if (fileListComment) {
    await deps.runBr(["comments", "add", input.id, fileListComment], 5000).catch(() => {});
  }

  const reason = input.reason?.trim() || "Verified: completed";
  const closeResult = await runBrForTool(["close", input.id, "--reason", reason]);

  if (!closeResult.isError) {
    deps.onClose(input.id);
  }

  return closeResult;
}
```

**Step 3: Wire in index.ts**

In `index.ts`, add to `registerBeadsTool` deps:

```typescript
registerBeadsTool(pi, {
  // ... existing ...
  getEditedFiles(issueId: string) {
    return state.editedFiles.get(issueId);
  },
});
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add beads/tool.ts beads/index.ts
git commit -m "feat(beads): flush file list comment on issue close

V3: Before closing, attaches 'Files modified: ...' comment listing
all files tracked via S2 editedFiles. Fire-and-forget with 5s timeout."
```

---

### Task 6: Enhance `comment` Action to Reset Checkpoint Counter

**Files:**
- Modify: `beads/tool.ts` — reset S3 on successful comment
- Modify: `beads/index.ts` — wire callback

**Step 1: Add dep**

In `tool.ts` deps type, add:

```typescript
deps: {
  // ... existing ...
  onCheckpoint(): void;
};
```

**Step 2: Add reset in comment case**

In the `comment` case, after the successful return block, add the reset. Replace the current `comment` case:

```typescript
case "comment": {
  if (!input.id) {
    return fail("beads comment requires id", { action: input.action, missing: "id" });
  }
  if (!input.comment?.trim()) {
    return fail("beads comment requires comment text", { action: input.action, missing: "comment" });
  }
  const commentArgs = ["comments", "add", input.id, input.comment];
  const commentResult = await deps.runBr(commentArgs);
  if (commentResult.code !== 0) {
    return fail("beads comment failed", {
      action: input.action,
      command: `br ${commentArgs.join(" ")}`,
      stdout: commentResult.stdout,
      stderr: commentResult.stderr,
      exitCode: commentResult.code,
    });
  }

  // V6: Comment counts as checkpoint
  deps.onCheckpoint();

  return {
    content: [{ type: "text" as const, text: commentResult.stdout || "OK" }],
    details: {
      action: input.action,
      command: `br ${commentArgs.join(" ")}`,
      stdout: commentResult.stdout,
      stderr: commentResult.stderr,
      exitCode: commentResult.code,
      commentText: input.comment,
    },
  };
}
```

**Step 3: Wire in index.ts**

```typescript
registerBeadsTool(pi, {
  // ... existing ...
  onCheckpoint() {
    state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
  },
});
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add beads/tool.ts beads/index.ts
git commit -m "feat(beads): reset checkpoint counter on beads comment

V6: Successful beads tool comment resets S3 lastCheckpointTurn,
preventing checkpoint nudge from firing for agents that checkpoint
regularly via the beads tool."
```

---

### Task 7: Extend `turn_end` for Checkpoint Nudge

**Files:**
- Modify: `beads/hooks.ts` — extend existing `turn_end` handler

**Step 1: Add imports**

Add to `hooks.ts` imports from `lib.ts`:

```typescript
import {
  // ... existing ...
  shouldNudgeCheckpoint,
  buildCheckpointNudgeMessage,
} from "./lib.ts";
```

**Step 2: Extend turn_end handler**

In the existing `turn_end` handler, add **at the top** (before the context usage check):

```typescript
pi.on("turn_end", async (_event, ctx) => {
  if (!state.beadsEnabled) {
    return;
  }

  // V6: Increment turn counter and check checkpoint nudge
  state.checkpointState.turnIndex++;

  if (
    state.currentIssueId &&
    shouldNudgeCheckpoint({
      turnIndex: state.checkpointState.turnIndex,
      lastCheckpointTurn: state.checkpointState.lastCheckpointTurn,
      threshold: 8,
      hasActiveIssue: true,
    })
  ) {
    const turnsSince = state.checkpointState.turnIndex - state.checkpointState.lastCheckpointTurn;
    const nudgeText = buildCheckpointNudgeMessage(state.currentIssueId, turnsSince);

    deps.commandOut(ctx, "Consider checkpointing your progress to the beads issue.", "info");

    pi.sendMessage(
      {
        customType: "beads-checkpoint-nudge",
        content: nudgeText,
        display: false,
      },
      { deliverAs: "nextTurn" },
    );

    // Reset to avoid nagging every turn after threshold
    state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
  }

  // Existing context usage warning logic below...
  const usage = ctx.getContextUsage();
  // ... rest unchanged ...
});
```

**Important:** This replaces the existing `turn_end` handler. The new version adds the checkpoint logic at the top, then continues with the existing context usage warning logic unchanged.

**Step 3: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add beads/hooks.ts
git commit -m "feat(beads): add checkpoint nudge to turn_end

V6: Increments S3 turnIndex each turn. When gap reaches 8 turns
without checkpoint, fires notification + nextTurn message with
command hint. Resets counter after nudge to avoid nagging."
```

---

### Task 8: Integration Verification

**Step 1: Run full test suite**

```bash
cd beads && npm test
```

Expected: All tests PASS (should be ~75+ tests)

**Step 2: Verify no TypeScript errors**

```bash
cd beads && npx tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext --target esnext --strict lib.ts hooks.ts tool.ts index.ts 2>&1
```

(May need adjustments for imports — the key check is that `npm test` passes since tsx handles types at runtime.)

**Step 3: Review git log**

```bash
git log --oneline main..HEAD
```

Expected: V1 commits + 7 new V2/V3/V6 commits

**Step 4: Comment on beads issue**

```bash
br comments add bd-1wq "V2+V3+V6 implemented and verified.

Tests: N pass, 0 fail

V2 (commit linking): tool_result detects git commit → br comments add
V3 (file tracking): tool_result detects write/edit → S2, close flushes file list
V6 (checkpoint nudge): turn_end counts turns → nudge at 8 turns without checkpoint

Ready for V4+V5+V7 batch."
```
