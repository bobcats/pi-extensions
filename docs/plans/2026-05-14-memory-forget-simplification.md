# Memory Forget Simplification Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the recently added `/memory forget` implementation and tests without changing behavior.

**Architecture:** Keep the existing memory extension structure and `/memory` command handler. Extract only a small forget-candidate helper near the command branch, keep prompt candidate formatting isolated in `memory/prompts.ts`, and reduce forget-test setup repetition with small test fixture helpers that do not hide assertions.

**Tech Stack:** TypeScript ESM, Node test runner via `tsx --test --test-timeout=5000`, Pi extension API test harness, QMD wrapper functions.

---

## Source Spec

- `docs/design/2026-05-14-memory-forget-simplification.md`

## File Structure

- Modify `memory/prompts.test.ts`
  - Add narrow coverage for blank/whitespace candidate snippets.
- Modify `memory/prompts.ts`
  - Rename local `score` to `scorePercent` in `formatForgetCandidates`.
  - Preserve candidate rendering behavior and prompt safety text.
- Modify `memory/index.ts`
  - Add a small helper for forget candidate lookup/mapping.
  - Replace the inline QMD candidate mapping in the forget command branch with the helper.
- Modify `memory/index.test.ts`
  - Extract small forget-test fixture helpers.
  - Keep assertions in individual tests.

Do not modify unrelated memory commands, operation logging behavior, brain configuration, QMD wrapper code, or general slop-scan findings outside touched forget code.

---

## Task 1: Add Prompt Candidate Boundary Coverage

**Files:**
- Modify: `memory/prompts.test.ts`
- Modify: `memory/prompts.ts`
- Test: `memory/prompts.test.ts`

- [x] **Step 1: Add a prompt-builder test for blank snippets**

In `memory/prompts.test.ts`, after `buildForgetPrompt renders QMD candidates as hints`, add:

```ts
test("buildForgetPrompt omits blank candidate snippets", () => {
  const prompt = buildForgetPrompt("/test/vault", "acme", [
    { title: "Acme Notes", file: "/test/vault/projects/acme.md", score: 0.91, snippet: "   " },
  ]);

  assert.ok(prompt.includes("91% Acme Notes"));
  assert.ok(prompt.includes("/test/vault/projects/acme.md"));
  assert.ok(!prompt.includes("Snippet:"));
});
```

- [x] **Step 2: Run prompt tests to characterize current behavior**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 prompts.test.ts
```

Expected: PASS. This is characterization coverage for the existing blank-snippet behavior.

- [x] **Step 3: Rename the score local for clarity**

In `memory/prompts.ts`, change this block in `formatForgetCandidates`:

```ts
      const score = Math.round(candidate.score * 100);
      const snippet = candidate.snippet?.trim();
      return [
        `${index + 1}. ${score}% ${candidate.title}`,
```

to:

```ts
      const scorePercent = Math.round(candidate.score * 100);
      const snippet = candidate.snippet?.trim();
      return [
        `${index + 1}. ${scorePercent}% ${candidate.title}`,
```

Do not change any other prompt text.

- [x] **Step 4: Run prompt tests again**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 prompts.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit prompt simplification**

Run:

```bash
git add memory/prompts.ts memory/prompts.test.ts
git commit -m "test(memory): cover forget candidate snippet formatting"
```

---

## Task 2: Extract Forget Candidate Lookup Helper

**Files:**
- Modify: `memory/index.ts`
- Test: `memory/index.test.ts`

- [x] **Step 1: Run command tests before refactor**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts
```

Expected: PASS. This establishes the behavior baseline before refactoring.

- [x] **Step 2: Add a local forget candidate helper**

In `memory/index.ts`, inside `memoryExtension`, near the other local helper constants and after `isValidBrainName`, add:

```ts
  const searchForgetCandidates = async (brain: ActiveBrain, topic: string): Promise<ForgetPromptCandidate[]> => {
    if (!qmdAvailable) {
      return [];
    }

    const collection = qmd.collectionNameForBrain(brain.name);
    const results = await qmd.search(collection, topic, { limit: 10 });
    return results.map((result) => ({
      title: result.title,
      file: qmd.toVaultPath(brain.vaultDir, result.file, collection),
      score: result.score,
      snippet: result.snippet,
    }));
  };
```

Keep it inside `memoryExtension` so it can read the existing `qmdAvailable` state without changing wider module structure.

- [x] **Step 3: Replace inline candidate mapping in the forget branch**

In the `/memory forget` command branch, replace:

```ts
        let candidates: ForgetPromptCandidate[] = [];
        if (qmdAvailable) {
          const collection = qmd.collectionNameForBrain(brain.name);
          const results = await qmd.search(collection, topic, { limit: 10 });
          candidates = results.map((result) => ({
            title: result.title,
            file: qmd.toVaultPath(brain.vaultDir, result.file, collection),
            score: result.score,
            snippet: result.snippet,
          }));
        }
```

with:

```ts
        const candidates = await searchForgetCandidates(brain, topic);
```

Do not change topic parsing, usage text, notification text, or `pi.sendUserMessage` behavior.

- [x] **Step 4: Run command tests after refactor**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit command simplification**

Run:

```bash
git add memory/index.ts
git commit -m "refactor(memory): simplify forget candidate lookup"
```

---

## Task 3: Extract Forget Test Fixture Helpers

**Files:**
- Modify: `memory/index.test.ts`
- Test: `memory/index.test.ts`

- [x] **Step 1: Add a command fixture helper**

In `memory/index.test.ts`, after `loadExtensionForHome`, add:

```ts
async function createMemoryCommandFixture(homeDir: string) {
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);
  const harness = createHarness();
  memoryExtension(harness.pi);

  const memoryCommand = harness.commands.get("memory");
  assert.ok(memoryCommand);

  return { harness, memoryCommand, restore };
}
```

This helper prepares common fixture state only. It must not perform forget-specific assertions.

- [x] **Step 2: Add a vault fixture helper**

In `memory/index.test.ts`, after `createMemoryCommandFixture`, add:

```ts
function createDefaultVault(homeDir: string): string {
  const vaultDir = path.join(homeDir, ".pi", "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");
  return vaultDir;
}
```

- [x] **Step 3: Use the command fixture in forget autocomplete test**

Change `memory autocomplete includes forget` so the setup is:

```ts
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryCommand, restore } = await createMemoryCommandFixture(homeDir);

  try {
    const completions = memoryCommand.getArgumentCompletions("");
    assert.ok(completions.some((item: { value: string }) => item.value === "forget"));
  } finally {
    restore();
  }
```

Keep the assertion unchanged.

- [x] **Step 4: Use the command fixture in missing-topic test**

Change `memory forget requires a topic` so the setup is:

```ts
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { harness, memoryCommand, restore } = await createMemoryCommandFixture(homeDir);
```

Keep the existing `try/finally`, handler call, usage assertion, and `sendUserMessageCalls` assertion.

- [x] **Step 5: Use both helpers in prompt dispatch test**

Change `memory forget sends agent prompt for active brain topic` so the setup is:

```ts
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const vaultDir = createDefaultVault(homeDir);
  const { harness, memoryCommand, restore } = await createMemoryCommandFixture(homeDir);
```

Keep all existing prompt, topic, vault-path, notification, and call-count assertions.

- [x] **Step 6: Use the command fixture in status discoverability test**

Change `memory status lists forget command` so the setup is:

```ts
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { harness, memoryCommand, restore } = await createMemoryCommandFixture(homeDir);
```

Keep the status handler call and assertion unchanged.

- [x] **Step 7: Run command tests**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit test simplification**

Run:

```bash
git add memory/index.test.ts
git commit -m "test(memory): simplify forget command fixtures"
```

---

## Task 4: Full Verification and Diff Review

**Files:**
- All touched files from this plan

- [x] **Step 1: Run targeted forget-related tests**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts prompts.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full memory extension tests**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 *.test.ts
```

Expected: PASS.

- [x] **Step 3: Run slop scan on the memory extension**

Run:

```bash
slop-scan memory
```

Expected: No new high-confidence findings in touched forget code. Existing findings outside touched forget code are out of scope.

- [x] **Step 4: Inspect git diff and status**

Run:

```bash
git status --short
git diff --stat
git diff -- memory/index.ts memory/index.test.ts memory/prompts.ts memory/prompts.test.ts
```

Expected: no uncommitted code changes remain after the implementation commits.

---

## Out of Scope

- General `/memory` command-handler restructuring.
- New runtime sandboxing for `raw/` files.
- QMD integration tests that require QMD to be installed.
- Changes to command UX, prompt semantics, operation history behavior, or active-brain resolution.
- Fixing slop-scan findings outside the touched forget implementation and tests.
