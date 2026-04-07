# Handoff Simplification Pass Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the recently added `handoff` extension code for readability and type clarity without changing behavior.

**Architecture:** Keep the implementation self-contained in `handoff/index.ts`, but refactor it into a clearer staged flow with strongly typed helper boundaries. Keep tests explicit (duplication is acceptable) in `handoff/index.test.ts`, and perform a light clarity-only documentation pass in `handoff/README.md`.

**Tech Stack:** TypeScript, `node:test` + `assert/strict`, `tsx --test`, pi extension API (`registerCommand`, `ctx.newSession`, `ctx.ui.*`), `@mariozechner/pi-ai` (`complete`).

---

## Scope Guardrails

- Only modify files touched in this session:
  - `handoff/index.ts`
  - `handoff/index.test.ts`
  - `handoff/README.md`
- Preserve all user-visible behavior exactly:
  - notification strings/punctuation
  - guardrail ordering
  - model preference/fallback behavior
  - `ctx.newSession()` then `ctx.ui.setEditorText()` ordering
  - exported `generateHandoffSummary`
- No new features.

---

## File Map

- Modify: `handoff/index.ts`
  - Add stronger local types to replace broad `any` usage in key boundaries.
  - Extract validation/orchestration helpers so the command handler reads as a linear stage pipeline.
  - Keep exported constants/exports and behavior identical.

- Modify: `handoff/index.test.ts`
  - Keep explicit tests (duplication allowed), but simplify harness naming and test organization.
  - Add/adjust characterization assertions needed to protect refactor boundaries.

- Modify: `handoff/README.md`
  - Minor editorial cleanup only: improve readability and section ordering without changing claims.

---

## Task 0: Preflight baseline and invariants

**Files:**
- Verify: `handoff/index.ts`
- Verify: `handoff/index.test.ts`
- Verify: `handoff/README.md`

- [ ] **Step 1: Record current behavior invariants before refactor**

Write these invariants into your working notes (not code):
- Exact notify strings currently emitted by `/handoff`
- Exact preferred model ID and fallback rule
- Exact empty-conversation predicate semantics
- Exact session handoff ordering (`newSession` then `setEditorText`)

- [ ] **Step 2: Run the handoff suite as baseline**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS (all tests).

- [ ] **Step 3: Run cross-extension smoke baseline**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions && npm --prefix auto-name-session test
```

Expected: PASS.

---

## Task 1: Add/adjust characterization tests that protect the refactor

**Files:**
- Modify: `handoff/index.test.ts`

- [ ] **Step 1: Extend the harness with tracking fields used by characterization assertions**

Add these explicit harness fields inside `createHarness()` before writing assertions, and expose them on the returned harness object:

```ts
const newSessionArgs: Array<{ parentSession: string }> = [];
let customCallCount = 0;
let findCalls = 0;
let authCalls = 0;
const callOrder: string[] = [];
```

Then expose e.g. `harness.newSessionArgs`, `harness.customCallCount`, `harness.findCalls`, `harness.authCalls`, `harness.callOrder` for assertions.

Wire them in the stubs:
- `newSession(options)` pushes `options` and `"newSession"` into `callOrder`
- `ui.custom(...)` increments `customCallCount`
- `modelRegistry.find(...)` increments `findCalls`
- `modelRegistry.getApiKeyAndHeaders(...)` increments `authCalls`
- `ui.setEditorText(...)` pushes `"setEditorText"`
- `ui.notify(...)` pushes `notify:<level>`

Note: some tests intentionally override `newSession`, `ui.custom`, or model registry methods. Only assert tracker counters in tests that do not override the tracked stub.

- [ ] **Step 2: Add a focused assertion that `newSession` uses `parentSession` from `getSessionFile()`**

Extend the happy-path test to assert:

```ts
assert.deepEqual(newSessionArgs[0], {
  parentSession: "/tmp/project/.pi/sessions/current.jsonl",
});
```

- [ ] **Step 3: Add a focused ordering assertion for the load-bearing session switch flow**

In happy-path test, assert exact ordering:

```ts
assert.deepEqual(callOrder, ["newSession", "setEditorText", "notify:info"]);
```

This locks the behavior that prevents editor prefill from landing in the parent session.

- [ ] **Step 4: Add a focused assertion that overwrite denial short-circuits generation/session switch**

In overwrite-denied test, also assert:

```ts
assert.equal(customCallCount, 0);
assert.equal(newSessionCalls, 0);
```

- [ ] **Step 5: Add a focused assertion that missing goal short-circuits model lookup**

In the empty-goal test, assert that model lookup/auth helpers were not called:

```ts
assert.equal(findCalls, 0);
assert.equal(authCalls, 0);
```

- [ ] **Step 6: Run focused tests to verify characterization coverage**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "happy path|overwrite|Usage: /handoff"
```

Expected: PASS.

- [ ] **Step 7: Run full handoff suite**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit characterization guardrails**

```bash
git add handoff/index.test.ts
git commit -m "test(handoff): lock refactor guardrails"
```

---

## Task 2: Refactor `handoff/index.ts` into a typed, linear pipeline

**Files:**
- Modify: `handoff/index.ts`
- Verify: `handoff/index.test.ts`

- [ ] **Step 1: Introduce local types for command flow boundaries**

Add focused types near top of file, e.g.:

```ts
type HandoffDeps = {
  completeFn?: typeof complete;
  summaryProvider?: string;
  summaryModel?: string;
};

type SummaryModelResolution = {
  model: { provider: string; id: string };
  auth: { ok: true; apiKey?: string; headers?: Record<string, string> };
};

type AuthOk = {
  ok: true;
  apiKey?: string;
  headers?: Record<string, string>;
};

type AuthError = {
  ok: false;
  error: string;
};

type AuthResult = AuthOk | AuthError;

type HandoffCommandContext = {
  hasUI: boolean;
  model: { provider: string; id: string } | undefined;
  modelRegistry: {
    find(provider: string, modelId: string): { provider: string; id: string } | null;
    getApiKeyAndHeaders(model: { provider: string; id: string }): Promise<AuthResult>;
  };
  sessionManager: {
    getBranch(): SessionEntry[];
    getSessionFile(): string;
  };
  newSession(options: { parentSession: string }): Promise<{ cancelled: boolean }>;
  ui: any;
};
```

Keep types pragmatic; do not introduce unnecessary abstractions.

Keep the `registerCommand` handler boundary consistent with current extension style (`handler: async (args: string, ctx: any)`), and narrow typing inside helpers using `HandoffCommandContext`.

Also keep `resolveSummaryModel`, but tighten its context/auth typing to use `HandoffCommandContext` + `AuthResult` rather than `any`.

- [ ] **Step 2: Extract validation helpers with unchanged side effects**

Extract small helpers, keeping exact messages/order:

```ts
function ensureInteractiveMode(ctx: HandoffCommandContext): boolean { ... }
function ensureModelSelected(ctx: HandoffCommandContext): boolean { ... }
function ensureGoal(args: string, ctx: HandoffCommandContext): string | null { ... }
function ensureConversation(branch: SessionEntry[], ctx: HandoffCommandContext): boolean { ... }
async function confirmOverwriteIfNeeded(ctx: HandoffCommandContext): Promise<boolean> { ... }
```

- [ ] **Step 3: Extract message extraction and summary loader orchestration helpers**

Add focused helpers:

```ts
function conversationMessagesFromBranch(branch: SessionEntry[]): any[] { ... }

async function generateSummaryWithLoader(params: {
  ctx: HandoffCommandContext;
  completeFn: typeof complete;
  resolved: SummaryModelResolution;
  messages: any[];
  goal: string;
}): Promise<string | null> { ... }
```

`generateSummaryWithLoader` should contain the `BorderedLoader` + `ctx.ui.custom` orchestration currently in the handler.

In this task, also tighten `generateHandoffSummary` parameter types (`model`, `messages`, and `stopReason` handling) enough to remove broad `any` at its public boundary while keeping it exported.

Type changes must remain compatible with the existing helper test contract (plain `{ provider, id }` model, `apiKey`/`headers`, and minimal message shape).

- [ ] **Step 4: Extract session-application helper**

Add helper:

```ts
async function applyHandoffToNewSession(params: {
  ctx: HandoffCommandContext;
  goal: string;
  summary: string;
}): Promise<boolean> { ... }
```

Behavior must remain:
- call `ctx.newSession({ parentSession: ctx.sessionManager.getSessionFile() })`
- notify + return false on cancel
- set editor text and ready notify on success

- [ ] **Step 5: Rewrite command handler as linear stage sequence**

Target shape:

```ts
handler: async (args, ctx) => {
  if (!ensureInteractiveMode(ctx)) return;
  if (!ensureModelSelected(ctx)) return;

  const goal = ensureGoal(args, ctx);
  if (!goal) return;

  const branch = ctx.sessionManager.getBranch();
  if (!ensureConversation(branch, ctx)) return;
  if (!(await confirmOverwriteIfNeeded(ctx))) return;

  const resolved = await resolveSummaryModel(...);
  if (!resolved) {
    ctx.ui.notify("Handoff: no usable model credentials", "error");
    return;
  }

  const messages = conversationMessagesFromBranch(branch);
  const summary = await generateSummaryWithLoader(...);
  if (summary === null) {
    ctx.ui.notify("Handoff cancelled.", "info");
    return;
  }

  await applyHandoffToNewSession({ ctx, goal, summary });
}
```

- [ ] **Step 6: Run focused flow tests**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "interactive mode|No model selected|Usage: /handoff|No conversation to hand off|overwrite|fallback|happy path|cancelled|setSessionName"
```

Expected: PASS.

- [ ] **Step 7: Run full handoff suite**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS.

- [ ] **Step 8: Commit typed pipeline simplification**

```bash
git add handoff/index.ts
git commit -m "refactor(handoff): simplify command flow with typed stages"
```

---

## Task 3: Simplify test file readability while keeping explicit tests

**Files:**
- Modify: `handoff/index.test.ts`

- [ ] **Step 1: Improve harness naming and type annotations without over-abstraction**

Examples:
- `commands` -> `commandMap` (if clearer)
- keep the Task 1 tracking fields, but tighten their types and naming clarity
- keep explicit per-test setup; do not introduce large shared helper layers

- [ ] **Step 2: Reorder tests by execution phase (guardrails -> fallback -> generation -> session apply -> regressions)**

Keep each test standalone and explicit.

- [ ] **Step 3: Replace dynamic import pattern in helper test with direct import**

Update existing top-level import to include `generateHandoffSummary`, and remove `await import("./index.ts")` from the helper test:

```ts
import {
  CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT,
  createHandoffExtension,
  generateHandoffSummary,
} from "./index.ts";
```

- [ ] **Step 4: Run focused test subset for renamed/reordered tests**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "prompt verbatim|fallback|happy path|cancelled|configured Sonnet"
```

Expected: PASS.

- [ ] **Step 5: Run full handoff suite**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit test readability simplification**

```bash
git add handoff/index.test.ts
git commit -m "refactor(handoff-tests): simplify harness and test organization"
```

---

## Task 4: README clarity pass (editorial only)

**Files:**
- Modify: `handoff/README.md`

- [ ] **Step 1: Reorder sections for scanability without changing meaning**

Preferred order:
1. Usage
2. What the command does (step list)
3. Model selection
4. Parent session tracking
5. Extension interactions
6. Deliberate non-features
7. Tests

- [ ] **Step 2: Tighten repetitive prose while preserving all existing claims**

Do not remove these points:
- Sonnet-first with fallback
- `parentSession` tracking
- no agent-callable tool
- no mode/model flags
- no auto-submit
- subagent shutdown behavior

- [ ] **Step 3: Run handoff tests (sanity after docs-only change)**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS.

- [ ] **Step 4: Commit README cleanup**

```bash
git add handoff/README.md
git commit -m "docs(handoff): simplify README structure and wording"
```

---

## Task 5: Final verification and handoff

**Files:**
- Verify: `handoff/index.ts`
- Verify: `handoff/index.test.ts`
- Verify: `handoff/README.md`

- [ ] **Step 1: Run repo-level verification for touched area**

```bash
cd /Users/brian/code/bobcats/pi-extensions && git diff --check && npm --prefix handoff test && npm --prefix auto-name-session test
```

Expected:
- no `git diff --check` output
- both suites PASS

- [ ] **Step 2: Run manual pi smoke test for behavior parity**

In pi at `/Users/brian/code/bobcats/pi-extensions`:
1. Run `/handoff` with no args -> verify usage error text unchanged
2. In a non-empty session, run `/handoff continue the work` -> verify child session opens and editor prefill appears in child
3. If editor has unsent text, verify overwrite confirmation appears

- [ ] **Step 3: Confirm no behavior regressions against invariants**

Re-check Task 0 invariants; ensure all still true.

- [ ] **Step 4: Final commit if verification required a small follow-up fix**

```bash
git add handoff/index.ts handoff/index.test.ts handoff/README.md
git commit -m "chore(handoff): finalize simplification verification"
```

(Only if you changed files during final verification.)

---

## Final Verification Checklist

- [ ] `handoff/index.ts` behavior is unchanged (messages/order/fallback/session flow)
- [ ] `generateHandoffSummary` remains exported and tested
- [ ] command handler reads as a linear staged flow
- [ ] broad `any` usage is reduced at key boundaries with clear local types
- [ ] tests remain explicit and easy to follow (duplication acceptable)
- [ ] README remains accurate and clearer to scan
- [ ] `handoff` and `auto-name-session` tests pass
