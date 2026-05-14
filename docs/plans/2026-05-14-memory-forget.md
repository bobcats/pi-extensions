# Memory Forget Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/memory forget <topic>` so users can ask the agent to remove topic-specific memories from the active brain.

**Architecture:** The command remains prompt-driven: `/memory forget <topic>` resolves the active brain, optionally seeds a prompt with QMD search candidates, and sends an agent turn. Actual vault edits still happen through the normal agent tools and are persisted through `log_operation(type="forget")`, reusing the existing git/QMD/dashboard paths.

**Tech Stack:** TypeScript ESM, Pi extension API, Node `fs`/`path`, TypeBox schemas, QMD CLI wrapper, Node test runner via `tsx --test --test-timeout=5000`.

---

## Source Spec

- `docs/design/2026-05-14-memory-forget.md`

## File Structure

- Modify `memory/types.ts`
  - Add `"forget"` to `OperationType`.
- Modify `memory/index.ts`
  - Add `"forget"` to `LogOperationParams`.
  - Import `buildForgetPrompt`.
  - Add `/memory forget` autocomplete.
  - Add command handling before the default status branch.
  - Include `forget` in default `/memory` status/help output.
- Modify `memory/prompts.ts`
  - Add `ForgetPromptCandidate` interface.
  - Add `buildForgetPrompt(vaultDir, topic, candidates)`.
- Modify `memory/prompts.test.ts`
  - Add prompt-builder tests for topic/path/candidates/raw boundary/secure erase warning.
  - Add parse/dashboard coverage for `forget` if needed by TypeScript or behavior.
- Modify `memory/index.test.ts`
  - Add command/autocomplete/status tests.
  - Add command prompt dispatch test.
  - Add `log_operation(type="forget")` acceptance/history test.

Do not create a `forget_memory` tool and do not add runtime deletion logic in the command.

---

## Task 1: Add Prompt Builder Tests

**Files:**
- Modify: `memory/prompts.test.ts`
- Modify later: `memory/prompts.ts`

- [x] **Step 1: Import the future prompt builder and candidate type**

Update the imports at the top of `memory/prompts.test.ts`:

```ts
import {
  writeConventions,
  buildReflectPrompt,
  buildDreamPrompt,
  buildForgetPrompt,
  MEMORY_TOPIC_LIMIT,
  MEMORY_INDEX_LIMIT,
} from "./prompts.ts";
```

- [x] **Step 2: Add failing tests for forget prompt essentials**

Add these tests after the existing dream prompt tests:

```ts
// --- buildForgetPrompt ---

test("buildForgetPrompt includes topic and active vault path", () => {
  const prompt = buildForgetPrompt("/test/vault", "acme client", []);
  assert.ok(prompt.includes("# Forget Topic"));
  assert.ok(prompt.includes("acme client"));
  assert.ok(prompt.includes("/test/vault/index.md"));
  assert.ok(prompt.includes("log_operation"));
  assert.ok(prompt.includes('type="forget"'));
});

test("buildForgetPrompt makes raw files a hard no-edit rule", () => {
  const prompt = buildForgetPrompt("/test/vault", "acme", []);
  assert.ok(prompt.includes("HARD BOUNDARY: `/test/vault/raw/` is read-only source material"));
  assert.ok(prompt.includes("Do not edit, delete, move, rename, split, summarize, compile, index, or otherwise modify raw files"));
});

test("buildForgetPrompt warns that forget is not secure erase", () => {
  const prompt = buildForgetPrompt("/test/vault", "acme", []);
  assert.ok(prompt.includes("not a secure erase"));
  assert.ok(prompt.includes("git history may retain"));
});

test("buildForgetPrompt renders QMD candidates as hints", () => {
  const prompt = buildForgetPrompt("/test/vault", "acme", [
    { title: "Acme Notes", file: "/test/vault/projects/acme.md", score: 0.91, snippet: "Acme deployment notes" },
  ]);

  assert.ok(prompt.includes("Candidate files"));
  assert.ok(prompt.includes("91% Acme Notes"));
  assert.ok(prompt.includes("/test/vault/projects/acme.md"));
  assert.ok(prompt.includes("Acme deployment notes"));
  assert.ok(prompt.includes("Candidate files are hints, not deletion targets"));
});
```

- [x] **Step 3: Run prompt tests and verify they fail**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 prompts.test.ts
```

Expected: FAIL because `buildForgetPrompt` is not exported yet.

---

## Task 2: Implement `buildForgetPrompt`

**Files:**
- Modify: `memory/prompts.ts`
- Test: `memory/prompts.test.ts`

- [x] **Step 1: Add candidate interface**

In `memory/prompts.ts`, after the exported constants, add:

```ts
export interface ForgetPromptCandidate {
  title: string;
  file: string;
  score: number;
  snippet?: string;
}
```

- [x] **Step 2: Add candidate formatting helper**

Below `buildReflectPrompt`, add:

```ts
function formatForgetCandidates(candidates: ForgetPromptCandidate[]): string {
  if (candidates.length === 0) {
    return "No QMD candidates were available. Use the vault index and related wikilinks to find relevant files.";
  }

  return candidates
    .map((candidate, index) => {
      const score = Math.round(candidate.score * 100);
      const snippet = candidate.snippet?.trim();
      return [
        `${index + 1}. ${score}% ${candidate.title}`,
        `   File: ${candidate.file}`,
        snippet ? `   Snippet: ${snippet}` : undefined,
      ].filter(Boolean).join("\n");
    })
    .join("\n");
}
```

- [x] **Step 3: Add `buildForgetPrompt`**

Below the helper, add:

```ts
export function buildForgetPrompt(dir: string, topic: string, candidates: ForgetPromptCandidate[] = []): string {
  return `# Forget Topic

Remove memories about this topic from the active memory vault.

**Topic:** ${topic}
**Vault:** \`${dir}/\`

This is not a secure erase. Remove content from the working vault, but git history may retain previous versions until a separate destructive history purge exists.

## Candidate files

Candidate files are hints, not deletion targets. Inspect them and their related wikilinks before editing.

${formatForgetCandidates(candidates)}

## Process

1. Read \`${dir}/index.md\` to understand the vault structure.
2. Inspect candidate files and related wikilinks for the topic.
3. Remove notes whose primary subject is the topic.
4. Surgically remove topic-specific sections, claims, examples, project/client facts, or private details from broader notes.
5. Preserve generalized lessons by rewriting them without topic-specific details when possible.
6. Treat ambiguous broad terms conservatively. If you cannot tell whether content should be forgotten, ask for clarification or log noop instead of guessing.
7. Update \`${dir}/index.md\` if files were removed or renamed.
8. Call log_operation(type="forget", status="keep"|"noop", description="...", findings_count=N) when done.

## Raw source boundary

**HARD BOUNDARY: \`${dir}/raw/\` is read-only source material.** Raw files are provenance for ingest workflows, not curated memory notes.
- You may read raw files for context.
- Do not edit, delete, move, rename, split, summarize, compile, index, or otherwise modify raw files.
- Do not create plans to split, summarize, index, delete, move, or rewrite raw files.

${writeConventions(dir)}`;
}
```

- [x] **Step 4: Run prompt tests and verify they pass**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 prompts.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit prompt builder**

Run:

```bash
git add memory/prompts.ts memory/prompts.test.ts
git commit -m "feat(memory): add forget prompt builder"
```

---

## Task 3: Add Operation Type Support

**Files:**
- Modify: `memory/types.ts`
- Modify: `memory/index.ts`
- Modify: `memory/prompts.test.ts`
- Modify: `memory/index.test.ts`

- [x] **Step 1: Add a failing dashboard/parser test for forget history**

In `memory/prompts.test.ts`, after `parseOperationsJSONL parses ingest operations`, add:

```ts
test("parseOperationsJSONL parses forget operations", () => {
  const ops = parseOperationsJSONL(JSON.stringify({ operationType: "forget", status: "keep", description: "forgot acme", timestamp: 1 }));
  assert.strictEqual(ops[0].type, "forget");
});
```

- [x] **Step 2: Add a failing log operation test**

In `memory/index.test.ts`, after `log_operation writes history into the mapped brain vault only`, add:

```ts
test("log_operation accepts forget operations", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    const logOperationTool = harness.tools.get("log_operation");
    assert.ok(memoryCommand);
    assert.ok(logOperationTool);

    await memoryCommand.handler("init", harness.ctx);
    fs.writeFileSync(path.join(homeDir, ".pi", "memories", "index.md"), "# Memory\n");

    await logOperationTool.execute(
      "tool-1",
      { type: "forget", status: "keep", description: "Forgot acme", findings_count: 1 },
      new AbortController().signal,
      () => {},
      harness.ctx,
    );

    const operations = fs.readFileSync(path.join(homeDir, ".pi", "memories", "memory-operations.jsonl"), "utf-8");
    assert.match(operations, /"operationType":"forget"/);
    assert.match(operations, /Forgot acme/);
  } finally {
    restore();
  }
});
```

- [x] **Step 3: Run targeted tests and verify failures**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 prompts.test.ts index.test.ts
```

Expected: FAIL because `OperationType` and the TypeBox enum do not accept `forget` yet.

- [x] **Step 4: Add `forget` to shared operation type**

Change `memory/types.ts`:

```ts
export type OperationType = "reflect" | "ruminate" | "dream" | "ingest" | "forget";
```

- [x] **Step 5: Add `forget` to `LogOperationParams`**

Change the enum in `memory/index.ts`:

```ts
const LogOperationParams = Type.Object({
  type: StringEnum(["reflect", "ruminate", "dream", "ingest", "forget"] as const, {
    description: "What kind of memory operation was performed",
  }),
```

- [x] **Step 6: Run targeted tests and verify they pass**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 prompts.test.ts index.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit operation type support**

Run:

```bash
git add memory/types.ts memory/index.ts memory/prompts.test.ts memory/index.test.ts
git commit -m "feat(memory): track forget operations"
```

---

## Task 4: Add `/memory forget` Command Tests

**Files:**
- Modify: `memory/index.test.ts`
- Modify later: `memory/index.ts`

- [x] **Step 1: Add autocomplete test**

In `memory/index.test.ts`, add after the brain command tests:

```ts
test("memory autocomplete includes forget", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    assert.ok(memoryCommand);

    const completions = memoryCommand.getArgumentCompletions("");
    assert.ok(completions.some((item: { value: string }) => item.value === "forget"));
  } finally {
    restore();
  }
});
```

- [x] **Step 2: Add missing-topic usage test**

Add:

```ts
test("memory forget requires a topic", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    assert.ok(memoryCommand);

    await memoryCommand.handler("forget", harness.ctx);

    const last = harness.notifications[harness.notifications.length - 1];
    assert.match(last.message, /Usage: \/memory forget <topic>/);
    assert.equal(harness.sendUserMessageCalls.length, 0);
  } finally {
    restore();
  }
});
```

- [x] **Step 3: Add prompt dispatch test**

Add:

```ts
test("memory forget sends agent prompt for active brain topic", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const vaultDir = path.join(homeDir, ".pi", "memories");
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, "index.md"), "# Memory\n");

  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    assert.ok(memoryCommand);

    await memoryCommand.handler("forget acme client", harness.ctx);

    assert.equal(harness.sendUserMessageCalls.length, 1);
    assert.match(harness.sendUserMessageCalls[0].content, /# Forget Topic/);
    assert.match(harness.sendUserMessageCalls[0].content, /acme client/);
    assert.match(harness.sendUserMessageCalls[0].content, new RegExp(vaultDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(harness.notifications.map((entry) => entry.message).join("\n"), /Forgetting topic/);
  } finally {
    restore();
  }
});
```

- [x] **Step 4: Add status/help discoverability test**

Add:

```ts
test("memory status lists forget command", async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-home-"));
  const { memoryExtension, restore } = await loadExtensionForHome(homeDir);

  try {
    const harness = createHarness();
    memoryExtension(harness.pi);

    const memoryCommand = harness.commands.get("memory");
    assert.ok(memoryCommand);

    await memoryCommand.handler("", harness.ctx);

    const last = harness.notifications[harness.notifications.length - 1];
    assert.match(last.message, /Commands: .*forget/);
  } finally {
    restore();
  }
});
```

- [x] **Step 5: Run command tests and verify they fail**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts
```

Expected: FAIL because the command is not implemented yet.

---

## Task 5: Implement `/memory forget`

**Files:**
- Modify: `memory/index.ts`
- Test: `memory/index.test.ts`

- [x] **Step 1: Import forget prompt builder and type**

Change the prompt import in `memory/index.ts`:

```ts
import { buildReflectPrompt, buildDreamPrompt, buildForgetPrompt } from "./prompts.js";
import type { ForgetPromptCandidate } from "./prompts.js";
```

- [x] **Step 2: Add autocomplete entry**

In `MEMORY_SUBCOMMANDS`, add near `search`:

```ts
{ value: "forget", label: "forget", description: "Forget a topic from the active brain" },
```

- [x] **Step 3: Add command handler before `init` and after `search`**

In the `/memory` handler, after the search block and before `if (trimmed === "init")`, add:

```ts
      if (trimmed === "forget" || trimmed.startsWith("forget ")) {
        const topic = trimmed === "forget" ? "" : trimmed.slice("forget ".length).trim();
        if (!topic) {
          ctx.ui.notify("Usage: /memory forget <topic>", "warning");
          return;
        }

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

        ctx.ui.notify(`Forgetting topic from ${brain.name}: ${topic}`, "info");
        pi.sendUserMessage(buildForgetPrompt(brain.vaultDir, topic, candidates));
        return;
      }
```

Do not catch `qmd.search`; the wrapper already degrades to `[]` on errors.

- [x] **Step 4: Update default status/help command list**

Change the status notification command suffix from:

```ts
`\n\nCommands: reflect, ruminate, dream, cancel dream, search, undo, log, init, on, off`,
```

to:

```ts
`\n\nCommands: reflect, ruminate, dream, cancel dream, search, forget, undo, log, init, on, off`,
```

- [x] **Step 5: Run command tests and verify they pass**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit command implementation**

Run:

```bash
git add memory/index.ts memory/index.test.ts
git commit -m "feat(memory): add topic forget command"
```

---

## Task 6: Full Verification and Cleanup

**Files:**
- All touched memory extension files

- [x] **Step 1: Run full memory extension tests**

Run:

```bash
cd memory && npx tsx --test --test-timeout=5000 *.test.ts
```

Expected: PASS.

- [x] **Step 2: Run root test command if available**

Run:

```bash
npm test -- --test-timeout=5000
```

Expected: PASS, or document if the root package has no compatible test script.

- [x] **Step 3: Run slop scan on the memory extension**

Run:

```bash
slop-scan memory
```

Expected: No high-confidence findings in touched code. Treat findings as leads; fix real issues only.

- [x] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git diff --stat
git diff -- memory/types.ts memory/prompts.ts memory/prompts.test.ts memory/index.ts memory/index.test.ts
```

Expected: Only intended changes remain uncommitted if any previous commit step was skipped.

- [x] **Step 5: Commit final cleanup if needed**

If Step 4 shows remaining intended changes, run:

```bash
git add memory/types.ts memory/prompts.ts memory/prompts.test.ts memory/index.ts memory/index.test.ts
git commit -m "test(memory): cover topic forget workflow"
```

Expected: either a small final test/cleanup commit is created, or no commit is needed because earlier task commits captured all changes.

---

## Out of Scope

- Secure git-history purging for sensitive-data erasure.
- Brain deletion or project mapping mutation.
- A standalone `forget_memory` tool.
- Runtime sandboxing of agent edits to prevent `raw/` writes. The first version enforces the boundary through tested prompt text.
- QMD-installed integration tests.
