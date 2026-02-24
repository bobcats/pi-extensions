# Extension Refactoring Plan

> Use @beads-code to implement this plan.

**Goal:** Improve code quality across context, files, session-breakdown, and notify extensions — extract shared utilities, add test coverage, parallelize git operations.

**Architecture:** Single-file extensions → extract shared/lib.ts for duplicated utility functions. Add test files alongside each extension. Pure functions tested in isolation.

**Tech Stack:** TypeScript, tsx --test (node:test), pi ExtensionAPI

**Beads Epic:** bd-1s5

---

## Feature 1: Extract Shared Utilities — bd-2i8

### Task 1: Write tests for shared formatUsd and extractCostTotal — bd-1zx

**Files:**
- Create: `shared/lib.ts` (stub exports)
- Create: `shared/lib.test.ts`

**Step 1: Create shared/lib.ts with function signatures**

```typescript
// shared/lib.ts
export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(4)}`;
}

export function extractCostTotal(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const rec = usage as Record<string, unknown>;
  const c = rec.cost;
  if (typeof c === "number") return Number.isFinite(c) ? c : 0;
  if (typeof c === "string") {
    const n = Number(c);
    return Number.isFinite(n) ? n : 0;
  }
  if (c && typeof c === "object") {
    const t = (c as Record<string, unknown>).total;
    if (typeof t === "number") return Number.isFinite(t) ? t : 0;
    if (typeof t === "string") {
      const n = Number(t);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}
```

**Step 2: Write tests in shared/lib.test.ts**

Test cases for `formatUsd`:
- `formatUsd(0)` → `"$0.00"`
- `formatUsd(-5)` → `"$0.00"`
- `formatUsd(NaN)` → `"$0.00"`
- `formatUsd(Infinity)` → `"$0.00"`
- `formatUsd(0.0001)` → `"$0.0001"`
- `formatUsd(0.05)` → `"$0.0500"`
- `formatUsd(0.15)` → `"$0.150"`
- `formatUsd(1.5)` → `"$1.50"`
- `formatUsd(42.678)` → `"$42.68"`

Test cases for `extractCostTotal`:
- `extractCostTotal(null)` → `0`
- `extractCostTotal(undefined)` → `0`
- `extractCostTotal({})` → `0`
- `extractCostTotal({ cost: 1.5 })` → `1.5`
- `extractCostTotal({ cost: "2.0" })` → `2`
- `extractCostTotal({ cost: { total: 3.5 } })` → `3.5`
- `extractCostTotal({ cost: { total: "4.0" } })` → `4`
- `extractCostTotal({ cost: NaN })` → `0`
- `extractCostTotal({ cost: Infinity })` → `0`

**Step 3: Verify RED then GREEN**
```bash
cd shared && npx tsx --test lib.test.ts
```

**Step 4: Commit**
```bash
git add shared/ && git commit -m "test: add tests for shared formatUsd and extractCostTotal"
```

---

### Task 2: Extract formatUsd and extractCostTotal into shared/lib.ts — bd-1na

**Files:**
- Modify: `context/index.ts` — remove local `formatUsd`, `extractCostTotal`; import from `../shared/lib.ts`
- Modify: `session-breakdown/index.ts` — remove local `formatUsd`, `extractCostTotal`; import from `../shared/lib.ts`

**Step 1: Update context/index.ts**

Remove the two local function definitions. Add import:
```typescript
import { formatUsd, extractCostTotal } from "../shared/lib.ts";
```

**Step 2: Update session-breakdown/index.ts**

Same: remove local definitions, add import from `../shared/lib.ts`.

**Step 3: Verify shared tests still pass**
```bash
cd shared && npx tsx --test lib.test.ts
```

**Step 4: Verify existing beads tests still pass**
```bash
cd beads && npm test
```

**Step 5: Commit**
```bash
git add -A && git commit -m "refactor: extract formatUsd and extractCostTotal into shared/lib.ts"
```

---

### Task 3: Verify shared utility extraction — bd-2vj

Run full test suite, check no duplicates remain:
```bash
rg "function formatUsd" context/ session-breakdown/  # should find nothing
rg "function extractCostTotal" context/ session-breakdown/  # should find nothing
cd shared && npx tsx --test lib.test.ts
cd beads && npm test
```

---

## Feature 2: Add Test Coverage — bd-1kc

### Task 4: Write tests for notify pure functions — bd-3vf

**Files:**
- Create: `notify/index.test.ts`

Functions to test (all are module-private, so test via the default export behavior or extract them):

Since `extractLastAssistantText`, `formatNotification`, and `simpleMarkdown` are not exported, the simplest approach is to extract them into `notify/lib.ts` and export, then test that file.

**Alternative:** Create a small test helper that imports the module and tests the `agent_end` hook behavior end-to-end. But pure function tests are cleaner.

**Step 1: Extract testable functions to notify/lib.ts**

Move `extractLastAssistantText`, `formatNotification`, `isTextPart`, `simpleMarkdown`, `plainMarkdownTheme` to `notify/lib.ts`. Import them back into `notify/index.ts`.

**Step 2: Write tests**

- `extractLastAssistantText([])` → `null`
- `extractLastAssistantText([{ role: "user", content: "hi" }])` → `null`
- `extractLastAssistantText([{ role: "assistant", content: "hello" }])` → `"hello"`
- `extractLastAssistantText([{ role: "assistant", content: [{ type: "text", text: "hello" }] }])` → `"hello"`
- `formatNotification(null)` → `{ title: "Ready for input", body: "" }`
- `formatNotification("short text")` → `{ title: "π", body: "short text" }`
- `formatNotification("x".repeat(300))` → body truncated to ~200 chars with `…`

```bash
cd notify && npx tsx --test index.test.ts
```

---

### Task 5: Write tests for context pure functions — bd-kx5

**Files:**
- Create: `context/lib.ts` (extract pure functions)
- Create: `context/lib.test.ts`

Extract and test: `formatUsd` (now from shared), `estimateTokens`, `normalizeReadPath`, `shortenPath`, `normalizeSkillName`, `sumSessionUsage` (needs mock session entries).

Focus on what's extractable without pulling in the full ExtensionAPI.

---

### Task 6: Write tests for files path extraction functions — bd-2sa

**Files:**
- Create: `files/lib.ts` (extract pure functions)
- Create: `files/lib.test.ts`

Extract and test: `extractFileReferencesFromText`, `sanitizeReference`, `isCommentLikeReference`, `stripLineSuffix`, `normalizeReferencePath`, `formatDisplayPath`, `extractPathsFromToolArgs`.

These are all pure string → string functions, easy to test.

---

### Task 7: Write tests for session-breakdown parser functions — bd-3fm

**Files:**
- Create: `session-breakdown/lib.ts` (extract pure functions)
- Create: `session-breakdown/lib.test.ts`

Extract and test: `parseSessionStartFromFilename`, `modelKeyFromParts`, `extractTokensTotal`, `formatCount`, `toLocalDayKey`, `mondayIndex`, `localMidnight`, `addDaysLocal`, `clamp01`, `lerp`, `mixRgb`.

---

### Task 8: Verify test coverage addition — bd-1g9

Run all test files:
```bash
for dir in shared notify context files session-breakdown beads ext-prof memory; do
  echo "=== $dir ===" && cd $dir && npx tsx --test *.test.ts 2>/dev/null; cd ..
done
```

Report total new tests added.

---

## Feature 3: Parallelize Git Operations — bd-cuy

### Task 9: Write tests for parallelized git operations — bd-2vr

**Files:**
- Add to: `files/lib.test.ts` (or `files/index.test.ts`)

Test that `buildFileEntries` produces correct results. Since this involves `pi.exec` calls, test the observable behavior — given mock exec responses, the file list is correct.

---

### Task 10: Parallelize git ls-files and git status — bd-zo3

**Files:**
- Modify: `files/index.ts`

**Change 1: Parallelize in getGitFiles**

```typescript
// Before (sequential):
const trackedResult = await pi.exec("git", ["ls-files", "-z"], { cwd: gitRoot });
// ... process ...
const untrackedResult = await pi.exec("git", ["ls-files", "-z", "--others", "--exclude-standard"], { cwd: gitRoot });

// After (parallel):
const [trackedResult, untrackedResult] = await Promise.all([
  pi.exec("git", ["ls-files", "-z"], { cwd: gitRoot }),
  pi.exec("git", ["ls-files", "-z", "--others", "--exclude-standard"], { cwd: gitRoot }),
]);
```

**Change 2: Parallelize in buildFileEntries**

```typescript
// Before (sequential):
const statusMap = gitRoot ? await getGitStatusMap(pi, gitRoot) : new Map();
const { tracked, files } = gitRoot ? await getGitFiles(pi, gitRoot) : { tracked: new Set(), files: [] };

// After (parallel):
const [statusMap, gitListing] = await Promise.all([
  gitRoot ? getGitStatusMap(pi, gitRoot) : Promise.resolve(new Map()),
  gitRoot ? getGitFiles(pi, gitRoot) : Promise.resolve({ tracked: new Set<string>(), files: [] }),
]);
const { tracked: trackedSet, files: gitFiles } = gitListing;
```

---

### Task 11: Verify files parallelization — bd-24a

Run files tests, manually test `/files` in a repo, confirm same behavior.

---

## Execution Order (from br ready)

1. **bd-1zx** — Write shared utility tests (unblocked)
2. **bd-3vf** — Write notify tests (unblocked, parallel with 1)
3. **bd-2sa** — Write files tests (unblocked, parallel with 1-2)
4. **bd-1na** — Extract shared utilities (blocked on 1)
5. **bd-kx5** — Write context tests (blocked on 4)
6. **bd-3fm** — Write session-breakdown tests (blocked on 4)
7. **bd-2vj** — Verify shared extraction (blocked on 4)
8. **bd-2vr** — Write files parallelization tests (blocked on 3)
9. **bd-zo3** — Implement parallelization (blocked on 8)
10. **bd-1g9** — Verify all tests (blocked on 5, 6, 3, 2)
11. **bd-24a** — Verify parallelization (blocked on 9)

## Subagent Model Override Note

The installed subagent extension already supports `model` override in all modes. If overrides aren't taking effect, check that the model string matches an entry in `settings.json` `enabledModels` — `pi --model` does fuzzy matching against that list.
