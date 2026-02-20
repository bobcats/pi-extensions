# V4+V5+V7: Final Batch — Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:executing-plans skill to implement this plan task-by-task.

**Goal:** Add pre-compaction auto-checkpoint (V4), auto-continue after close (V5), and dependency-aware ready output (V7) to complete Shape D.

**Architecture:** V4 enhances `session_before_compact` to flush a checkpoint comment from S2/S3 before compaction. V5 injects a `followUp` message after close to trigger the agent's work loop. V7 enriches the `ready` action by querying dep tree for the first 5 issues. All three are independent slices touching different hooks/actions.

**Tech Stack:** TypeScript, `tsx --test`, pi `ExtensionAPI` (`session_before_compact`, `sendMessage`), `br` CLI

---

## File Map

| File | Role |
|------|------|
| `beads/lib.ts` | New: `buildCheckpointSummary()`, `buildContinueMessage()`, `formatEnrichedReadyOutput()` |
| `beads/lib.test.ts` | Tests for all new lib functions |
| `beads/hooks.ts` | Enhance `session_before_compact` for auto-checkpoint |
| `beads/tool.ts` | Enhance `close` for auto-continue, enhance `ready` for dep-aware output |
| `beads/index.ts` | Wire `sendMessage` into tool deps |

## How to Run Tests

```bash
cd beads && npm test
```

---

### Task 1: Add `buildCheckpointSummary()`

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

**Step 1: Write the failing tests**

Add to imports in `lib.test.ts`:

```typescript
import {
  // ... existing ...
  buildCheckpointSummary,
} from "./lib.ts";
```

Add tests:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`
Expected: FAIL — `buildCheckpointSummary` not exported

**Step 3: Implement**

```typescript
export function buildCheckpointSummary(opts: {
  editedFiles: Set<string>;
  turnsSinceCheckpoint: number;
}): string {
  const lines = [`Auto-checkpoint (pre-compaction): ${opts.turnsSinceCheckpoint} turns since last checkpoint.`];

  if (opts.editedFiles.size > 0) {
    const MAX = 20;
    const sorted = [...opts.editedFiles].sort();
    const shown = sorted.slice(0, MAX);
    let fileList = `Files: ${shown.join(", ")}`;
    if (sorted.length > MAX) {
      fileList += ` ...and ${sorted.length - MAX} more`;
    }
    lines.push(fileList);
  }

  return lines.join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All PASS

**Step 5: Commit**

```bash
git add beads/lib.ts beads/lib.test.ts
git commit -m "feat(beads): add buildCheckpointSummary for pre-compaction checkpoint

Formats auto-checkpoint comment from S2 editedFiles and S3 turn gap.
File list truncated to 20 entries."
```

---

### Task 2: Wire Auto-Checkpoint into `session_before_compact`

**Files:**
- Modify: `beads/hooks.ts`

**Step 1: Add import**

```typescript
import {
  // ... existing ...
  buildCheckpointSummary,
} from "./lib.ts";
```

**Step 2: Enhance session_before_compact handler**

Replace the existing handler:

```typescript
pi.on("session_before_compact", async () => {
  if (state.beadsEnabled) {
    state.shouldPrime = true;

    // V4: Auto-checkpoint before compaction
    if (state.currentIssueId) {
      const files = state.editedFiles.get(state.currentIssueId) ?? new Set();
      const turnsSince = state.checkpointState.turnIndex - state.checkpointState.lastCheckpointTurn;

      if (turnsSince > 0 || files.size > 0) {
        const summary = buildCheckpointSummary({ editedFiles: files, turnsSinceCheckpoint: turnsSince });
        deps.runBr(["comments", "add", state.currentIssueId, summary], 3000).catch(() => {});
        state.checkpointState.lastCheckpointTurn = state.checkpointState.turnIndex;
      }
    }
  }
});
```

**Step 3: Run tests**

Run: `cd beads && npm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add beads/hooks.ts
git commit -m "feat(beads): auto-checkpoint to beads on compaction

V4: session_before_compact flushes checkpoint comment with edited
files and turn count. Fire-and-forget with 3s timeout. Resets S3."
```

---

### Task 3: Add `buildContinueMessage()`

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

**Step 1: Write the failing tests**

Add to imports:

```typescript
import {
  // ... existing ...
  buildContinueMessage,
} from "./lib.ts";
```

Add tests:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`
Expected: FAIL

**Step 3: Implement**

```typescript
export function buildContinueMessage(closedId: string): string {
  return [
    `Issue ${closedId} closed.`,
    `Check for next ready work: run \`br ready --sort priority\` to pick the next issue.`,
    `If no ready issues remain, summarize what was accomplished and ask the user what's next.`,
  ].join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All PASS

**Step 5: Commit**

```bash
git add beads/lib.ts beads/lib.test.ts
git commit -m "feat(beads): add buildContinueMessage for auto-continue

Pure formatter for the followUp message injected after close.
Includes ready command hint and fallback guidance."
```

---

### Task 4: Wire Auto-Continue into Close Action

**Files:**
- Modify: `beads/tool.ts`
- Modify: `beads/index.ts`

**Step 1: Add dep type to tool.ts**

In the `registerBeadsTool` deps type, add to the existing deps object type:

```typescript
sendContinueMessage(closedId: string): void;
```

**Step 2: Call sendContinueMessage after close**

In the `close` case, add `deps.sendContinueMessage(input.id);` immediately after the existing `deps.onClose(input.id);` line. Do NOT duplicate the if-block.

**Step 3: Wire in index.ts**

Add `buildContinueMessage` to the existing lib.ts import block:

```typescript
import {
  buildContinueMessage,
  DIRTY_TREE_CLOSE_WARNING,
  detectTrackingMode,
  formatBeadsModeStatus,
  parseBrInfoJson,
  parseBrReadyJson,
} from "./lib.ts";
```

Add to `registerBeadsTool` deps object:

```typescript
sendContinueMessage(closedId: string) {
  const msg = buildContinueMessage(closedId);
  pi.sendMessage(
    {
      customType: "beads-auto-continue",
      content: msg,
      display: false,
    },
    { deliverAs: "followUp", triggerTurn: true },
  );
},
```

**Step 4: Run tests**

Run: `cd beads && npm test`
Expected: All PASS

**Step 5: Commit**

```bash
git add beads/tool.ts beads/index.ts
git commit -m "feat(beads): auto-continue after issue close

V5: After successful close, injects followUp message that triggers
agent to check br ready and pick next issue. Uses pi.sendMessage
with deliverAs: followUp, triggerTurn: true."
```

---

### Task 5: Add `formatEnrichedReadyOutput()`

**Files:**
- Modify: `beads/lib.ts`
- Modify: `beads/lib.test.ts`

**Step 1: Write the failing tests**

Add to imports:

```typescript
import {
  // ... existing ...
  formatEnrichedReadyOutput,
} from "./lib.ts";
```

Add tests:

```typescript
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
  assert.match(output, /parent:.*bd-p.*Widget system/i);
  assert.match(output, /unblocks:.*bd-2.*Renderer/i);
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
```

**Step 2: Run tests to verify they fail**

Run: `cd beads && npm test`
Expected: FAIL

**Step 3: Implement**

```typescript
export type EnrichedReadyIssue = {
  issue: BrIssueSummary;
  parent: BrIssueSummary | null;
  unblocks: BrIssueSummary[];
};

export function formatEnrichedReadyOutput(issues: EnrichedReadyIssue[]): string {
  if (issues.length === 0) return "No ready issues.";

  return issues.map((entry) => {
    const { issue, parent, unblocks } = entry;
    const lines = [formatIssueLabel(issue)];

    if (parent) {
      lines.push(`  ↳ parent: ${parent.id} ${parent.title}`);
    }

    if (unblocks.length > 0) {
      const items = unblocks.map((u) => `${u.id} ${u.title}`).join(", ");
      lines.push(`  ↳ unblocks: ${items}`);
    }

    return lines.join("\n");
  }).join("\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `cd beads && npm test`
Expected: All PASS

**Step 5: Commit**

```bash
git add beads/lib.ts beads/lib.test.ts
git commit -m "feat(beads): add formatEnrichedReadyOutput for dep-aware ready

Renders each ready issue with optional parent and unblocks lines.
Uses ↳ prefix for dep info. Returns 'No ready issues.' when empty."
```

---

### Task 6: Wire Dep-Aware Ready into Tool

**Files:**
- Modify: `beads/tool.ts`

**Step 1: Add imports**

```typescript
import {
  // ... existing ...
  formatEnrichedReadyOutput,
  parseBrDepListJson,
  type EnrichedReadyIssue,
} from "./lib.ts";
```

**Step 2: Enhance ready action**

Replace the existing `ready` case:

```typescript
case "ready": {
  const result = await deps.runBr(["ready", "--sort", "priority", "--json"]);

  if (result.code !== 0) {
    return fail("beads ready failed", {
      action: input.action,
      command: "br ready --sort priority --json",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    });
  }

  const issues = parseBrReadyJson(result.stdout);

  // V7: Enrich first 5 issues with dep info
  const MAX_ENRICH = 5;
  const toEnrich = issues.slice(0, MAX_ENRICH);
  const enriched: EnrichedReadyIssue[] = await Promise.all(
    toEnrich.map(async (issue) => {
      const [upResult, downResult] = await Promise.all([
        deps.runBr(["dep", "list", issue.id, "--direction", "up", "--json"], 5000).catch(() => ({ stdout: "[]", stderr: "", code: 1, killed: false })),
        deps.runBr(["dep", "list", issue.id, "--direction", "down", "--json"], 5000).catch(() => ({ stdout: "[]", stderr: "", code: 1, killed: false })),
      ]);

      const parents = upResult.code === 0 ? parseBrDepListJson(upResult.stdout) : [];
      const unblocks = downResult.code === 0 ? parseBrDepListJson(downResult.stdout) : [];

      return { issue, parent: parents[0] ?? null, unblocks };
    }),
  );

  // Append remaining issues without enrichment
  for (let i = MAX_ENRICH; i < issues.length; i++) {
    enriched.push({ issue: issues[i], parent: null, unblocks: [] });
  }

  const text = formatEnrichedReadyOutput(enriched);

  return {
    content: [{ type: "text" as const, text }],
    details: {
      action: input.action,
      command: "br ready --sort priority --json",
      issues,
      issueCount: issues.length,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    },
  };
}
```

**Step 3: Run tests**

Run: `cd beads && npm test`
Expected: All PASS

**Step 4: Commit**

```bash
git add beads/tool.ts
git commit -m "feat(beads): dep-aware ready output

V7: First 5 ready issues enriched with parent + unblocks from
br dep list. Remaining issues shown without dep info. Each dep
query has 5s timeout with graceful fallback."
```

---

### Task 7: Verification

**Step 1: Run full test suite**

```bash
cd beads && npm test
```

Expected: All tests PASS (should be ~95+)

**Step 2: Check for clean code**

```bash
git diff main..HEAD -- beads/ | grep -E '^\+.*console\.(log|debug|warn)|^\+.*TODO|^\+.*FIXME' | head
```

Expected: empty

**Step 3: Review git log**

```bash
git log --oneline main..HEAD
```

**Step 4: Comment on epic**

```bash
br comments add bd-fy9 "V4+V5+V7 batch complete (bd-3iv closed).
All Shape D slices implemented. Tests: N pass, 0 fail."
```
