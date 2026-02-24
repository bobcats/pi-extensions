# Beads Extension Refactoring Plan

> Use @beads-code to implement this plan.

**Goal:** Deduplicate shared types/functions, remove dead code, parallelize independent awaits.

**Architecture:** All changes are within the beads extension (7 files). Extract shared definitions to `lib.ts`, remove unused exports, and use `Promise.all` for independent async calls.

**Tech Stack:** TypeScript, pi ExtensionAPI

**Beads Epic:** bd-27i

---

## Feature 1: Deduplicate shared types and functions — bd-w1u

### Task 1: Extract ExecResult type to lib.ts — bd-jkp

**Files:** `beads/lib.ts`, `beads/hooks.ts`, `beads/index.ts`, `beads/commands.ts`, `beads/tool.ts`

**Step 1:** In `lib.ts`, export the `ExecResult` type (it already exists locally at line ~409 — just add `export`):
```typescript
export type ExecResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
};
```

**Step 2:** In each of `hooks.ts`, `index.ts`, `commands.ts`, `tool.ts`:
- Add `ExecResult` to the import from `./lib.ts`
- Remove the local `type ExecResult = { ... }` block

**Step 3:** Verify
```bash
cd beads && npm test
# Expected: 97 tests pass
```

**Step 4:** Commit
```bash
git add beads/ && git commit -m "refactor(beads): extract ExecResult type to lib.ts"
```

---

### Task 2: Extract UiContext and NotifyContext types to lib.ts — bd-2mr

**Files:** `beads/lib.ts`, `beads/hooks.ts`, `beads/commands.ts`, `beads/tool.ts`, `beads/index.ts`

**Step 1:** In `lib.ts`, add exports:
```typescript
export type UiContext = { ui: { setStatus: (key: string, value?: string) => void } };
export type NotifyContext = { hasUI: boolean; ui: { notify: (message: string, level: "info" | "warning" | "error") => void } };
```

**Step 2:** In `hooks.ts`, `commands.ts`, `tool.ts`:
- Add `UiContext`, `NotifyContext` to imports from `./lib.ts`
- Remove local type definitions

**Step 3:** In `index.ts`:
- Add `UiContext` to imports from `./lib.ts`
- Remove the local `type UiContext` inside the function body

**Step 4:** Verify
```bash
cd beads && npm test
```

**Step 5:** Commit
```bash
git add beads/ && git commit -m "refactor(beads): extract UiContext and NotifyContext types to lib.ts"
```

---

### Task 3: Extract extractErrorSummary to lib.ts — bd-37w

**Files:** `beads/lib.ts`, `beads/index.ts`, `beads/tool.ts`

**Step 1:** The function exists identically in `index.ts:21` and `tool.ts:101`. Move to `lib.ts` with export:
```typescript
export function extractErrorSummary(output: unknown): string | null {
  // ... (existing body)
}
```

**Step 2:** In `index.ts` and `tool.ts`:
- Add `extractErrorSummary` to imports from `./lib.ts`
- Remove the local function definition

**Step 3:** Verify
```bash
cd beads && npm test
```

**Step 4:** Commit
```bash
git add beads/ && git commit -m "refactor(beads): extract extractErrorSummary to lib.ts"
```

---

### Task 4: Verify deduplication — bd-3ts

```bash
cd beads && npm test
# Confirm: 97 tests pass

# Confirm no remaining duplicates:
rg "type ExecResult" beads/ --type ts  # Should only appear in lib.ts
rg "type UiContext" beads/ --type ts   # Should only appear in lib.ts
rg "type NotifyContext" beads/ --type ts  # Should only appear in lib.ts
rg "function extractErrorSummary" beads/ --type ts  # Should only appear in lib.ts
```

---

## Feature 2: Remove dead code — bd-3pc

### Task 5: Remove buildResumeContext — bd-1yh

**Files:** `beads/lib.ts`, `beads/lib.test.ts`

**Step 1:** In `lib.ts`, remove the `buildResumeContext` function (line ~460, ~12 lines).

**Step 2:** In `lib.test.ts`, remove the two tests:
- "buildResumeContext includes id, title, and last comment"
- "buildResumeContext works without comments"

**Step 3:** Remove any import of `buildResumeContext` if present.

**Step 4:** Verify
```bash
cd beads && npm test
# Expected: 95 tests pass (2 removed)
```

**Step 5:** Commit
```bash
git add beads/ && git commit -m "refactor(beads): remove unused buildResumeContext"
```

---

### Task 6: Unexport RecoveryDeps type — bd-10p

**Files:** `beads/lib.ts`

**Step 1:** Change `export type RecoveryDeps` to `type RecoveryDeps` (remove `export` keyword, line ~416).

**Step 2:** Verify
```bash
cd beads && npm test
```

**Step 3:** Commit
```bash
git add beads/ && git commit -m "refactor(beads): unexport RecoveryDeps (internal to lib.ts)"
```

---

### Task 7: Verify dead code removal — bd-2dm

```bash
cd beads && npm test
rg "buildResumeContext" beads/ --type ts  # Should return nothing
rg "export type RecoveryDeps" beads/ --type ts  # Should return nothing
```

---

## Feature 3: Parallelize beads-status command — bd-2br

### Task 8: Parallelize beads-status sequential awaits — bd-zst

**Files:** `beads/commands.ts`

**Step 1:** In the `beads-status` command handler (~line 211), replace:
```typescript
const stats = await deps.runBr(["stats"]);
const blocked = await deps.runBr(["blocked"]);
const inProgress = await deps.runBr(["list", "--status", "in_progress"]);
```

With:
```typescript
const [stats, blocked, inProgress] = await Promise.all([
  deps.runBr(["stats"]),
  deps.runBr(["blocked"]),
  deps.runBr(["list", "--status", "in_progress"]),
]);
```

**Step 2:** Verify
```bash
cd beads && npm test
```

**Step 3:** Commit
```bash
git add beads/ && git commit -m "perf(beads): parallelize beads-status command queries"
```

---

### Task 9: Verify beads-status parallelization — bd-vm4

```bash
cd beads && npm test
```
