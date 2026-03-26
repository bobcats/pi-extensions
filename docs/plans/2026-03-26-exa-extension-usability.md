# Exa Extension Usability Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** Make the Exa pi extension easier for the model and the user to use by default: fewer active tools, clearer tool-selection guidance, better streamed answer rendering, and a real `/exa` connectivity check.

**Architecture:** Keep the full Exa wrapper in `exa/index.ts`, but separate the exported tool definitions from the active-tool policy so the extension can register everything while enabling only a minimal default set. Tighten tool descriptions/guidelines around the common workflows (`search`, `get_contents`, `answer`) and improve `exa_answer` streaming so intermediate updates are useful without dumping awkward partial output. Extend `/exa` from an env-var check to a live API sanity check using the already-configured client.

**Tech Stack:** TypeScript, pi extension API (`registerTool`, `registerCommand`, `setActiveTools`, `getActiveTools`), `exa-js`, `tsx --test`.

---

### Task 1: Lock down the default active tool set

**Files:**
- Modify: `exa/index.ts`
- Test: `exa/index.test.ts`

- [x] **Step 1: Write the failing test for the default active tools policy**

In `exa/index.test.ts`, add a test that captures calls to `pi.setActiveTools()` and asserts the extension enables only the core tools by default.

```ts
test("enables only the core Exa tools by default", async () => {
  const calls: string[][] = [];

  createExaExtension(() => ({ getContents: async () => ({ results: [] }) }))({
    registerTool() {},
    registerCommand() {},
    setActiveTools(names: string[]) {
      calls.push(names);
    },
  } as never);

  assert.deepEqual(calls, [[
    "exa_search",
    "exa_get_contents",
    "exa_answer",
  ]]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "core Exa tools"
```

Expected: FAIL because `exa/index.ts` does not currently call `setActiveTools()`.

- [x] **Step 3: Add named constants for the tool groups**

In `exa/index.ts`, add constants near the top:

```ts
const CORE_TOOL_NAMES = ["exa_search", "exa_get_contents", "exa_answer"] as const;
const ADVANCED_TOOL_NAMES = [
  "exa_find_similar",
  "exa_research_create",
  "exa_research_get",
  "exa_research_poll",
  "exa_research_list",
] as const;
```

- [x] **Step 4: Enable only the core tools by default**

At the end of the extension factory in `exa/index.ts`, after registering all tools, call:

```ts
pi.setActiveTools([...CORE_TOOL_NAMES]);
```

Do not unregister advanced tools; keep them available for future activation and testing.

- [x] **Step 5: Run the focused test to verify it passes**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "core Exa tools"
```

Expected: PASS.

- [x] **Step 6: Run the full Exa test suite**

Run:

```bash
cd exa && npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add exa/index.ts exa/index.test.ts
git commit -m "feat(exa): default to core active tools"
```

---

### Task 2: Tighten tool descriptions and prompt guidance

**Files:**
- Modify: `exa/index.ts`
- Test: `exa/index.test.ts`
- Modify: `exa/README.md`

- [ ] **Step 1: Write the failing test for the key tool descriptions**

Add a test that captures the registered tool definitions and asserts the three core tools have stronger descriptions/guidelines.

```ts
test("core tool definitions explain when to use each workflow", async () => {
  const tools: Array<{ name: string; description: string; promptGuidelines?: string[] }> = [];

  createExaExtension(() => ({ getContents: async () => ({ results: [] }) }))({
    registerTool(tool: any) { tools.push(tool); },
    registerCommand() {},
    setActiveTools() {},
  } as never);

  const search = tools.find((tool) => tool.name === "exa_search");
  const contents = tools.find((tool) => tool.name === "exa_get_contents");
  const answer = tools.find((tool) => tool.name === "exa_answer");

  assert.match(search?.description ?? "", /exploratory/i);
  assert.match(contents?.description ?? "", /known urls?/i);
  assert.match(answer?.description ?? "", /direct answer/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "core tool definitions"
```

Expected: FAIL because the current descriptions are generic.

- [ ] **Step 3: Rewrite the `exa_search` tool text around exploratory search**

In `exa/index.ts`, update `exa_search` so the description and guidelines explicitly say:
- use it for exploratory search, current information, and when the right URL is not yet known
- prefer natural-language queries
- prefer highlights first, text second

Use wording like:

```ts
description: "Explore the web with Exa when you do not yet know the right URL. Best for current info, broad discovery, and short ranked excerpts.",
promptGuidelines: [
  "Use exa_search when the right source is not known yet or when the user needs current web information.",
  "Write Exa queries as natural language, not keyword fragments.",
  "Start with highlights-only output; request text only when the excerpt is insufficient.",
],
```

- [ ] **Step 4: Rewrite the `exa_get_contents` tool text around known URLs**

In `exa/index.ts`, update `exa_get_contents` so it explicitly says it is for URLs already chosen via search or provided by the user.

```ts
description: "Fetch clean page contents from URLs you already know you want to inspect.",
promptGuidelines: [
  "Use exa_get_contents only after you already have the target URL or list of URLs.",
  "Prefer exa_search first when you still need to discover the right source.",
],
```

- [ ] **Step 5: Rewrite the `exa_answer` tool text around direct answers vs raw results**

In `exa/index.ts`, update `exa_answer` so it explicitly says:
- use it when the user wants a direct answer with citations
- use `exa_search` instead when the user wants to browse candidate sources
- use `exa_research_*` for long-running synthesis

- [ ] **Step 6: Add README guidance matching the tool-selection policy**

In `exa/README.md`, add a short “Which tool should I use?” section:

```md
## Which tool should I use?

- `exa_search` — discover sources or get current web information
- `exa_get_contents` — read URLs you already know
- `exa_answer` — get a direct cited answer
- `exa_find_similar` — expand from one strong source
- `exa_research_*` — longer-running research jobs
```

- [ ] **Step 7: Run the focused definition test**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "core tool definitions"
```

Expected: PASS.

- [ ] **Step 8: Run the full Exa test suite**

Run:

```bash
cd exa && npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add exa/index.ts exa/index.test.ts exa/README.md
git commit -m "refactor(exa): clarify tool selection guidance"
```

---

### Task 3: Polish streamed `exa_answer` output

**Files:**
- Modify: `exa/index.ts`
- Test: `exa/index.test.ts`

- [ ] **Step 1: Write the failing test for streamed answer formatting**

Add a test that verifies streamed updates are labeled and the final result includes citations after the full answer body.

```ts
test("exa_answer stream mode sends labeled progressive updates and final citations", async () => {
  const updates: unknown[] = [];

  // register mocked streamAnswer yielding two chunks
  // invoke answer.execute(..., { stream: true }, ..., update => updates.push(update))

  assert.match((updates[0] as any).content[0].text, /^Exa answer \(streaming\)/);
  assert.match(result.content[0].text, /Citations:/);
  assert.doesNotMatch(result.content[0].text, /\[object Object\]/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "stream mode sends labeled progressive updates"
```

Expected: FAIL because the current streaming path emits bare text and minimal final labeling.

- [ ] **Step 3: Add a small formatter for streamed answer bodies**

In `exa/index.ts`, extract the stream formatting into a helper such as:

```ts
function formatStreamedAnswer(answerText: string, citations: ExaResult[]): string {
  return [
    "Exa answer (streaming)",
    answerText,
    citations.length ? `Citations:\n${formatCitations(citations)}` : null,
  ].filter(Boolean).join("\n\n");
}
```

- [ ] **Step 4: Use labeled progressive updates**

In the `params.stream` branch of `exa_answer`, change:

```ts
onUpdate?.({ content: [{ type: "text", text: answerText }] });
```

to:

```ts
onUpdate?.({
  content: [{ type: "text", text: `Exa answer (streaming)\n\n${answerText}` }],
});
```

This keeps the live output understandable in the tool UI.

- [ ] **Step 5: Use the formatter for the final streamed result**

Return the final content using `formatStreamedAnswer(answerText, citations)` and keep the existing structured `details` payload.

- [ ] **Step 6: Run the focused streaming test**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "stream mode sends labeled progressive updates"
```

Expected: PASS.

- [ ] **Step 7: Run the full Exa test suite**

Run:

```bash
cd exa && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add exa/index.ts exa/index.test.ts
git commit -m "refactor(exa): polish streamed answer output"
```

---

### Task 4: Make `/exa` perform a live health check

**Files:**
- Modify: `exa/index.ts`
- Test: `exa/index.test.ts`
- Modify: `exa/README.md`

- [ ] **Step 1: Write the failing test for `/exa` live status behavior**

Add a test that invokes the registered `/exa` command and asserts it uses the Exa client to perform a minimal live request when `EXA_API_KEY` is present.

```ts
test("/exa performs a live sanity check when configured", async () => {
  let called = false;
  const notifications: Array<{ message: string; level: string }> = [];

  process.env.EXA_API_KEY = "test-key";
  try {
    const harness = createPiHarness();
    createExaExtension(() => ({
      search: async () => {
        called = true;
        return { requestId: "req_health", results: [] };
      },
      getContents: async () => ({ results: [] }),
    }))(harness.pi);

    await harness.commands.get("exa")!.handler("", {
      ui: { notify(message: string, level: string) { notifications.push({ message, level }); } },
    });

    assert.equal(called, true);
    assert.match(notifications[0].message, /live check/i);
  } finally {
    delete process.env.EXA_API_KEY;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "live sanity check"
```

Expected: FAIL because `/exa` currently only inspects the environment.

- [ ] **Step 3: Extract a tiny health-check helper**

In `exa/index.ts`, add a helper:

```ts
async function runHealthCheck(client: ExaClient): Promise<{ requestId?: string; ok: boolean }> {
  if (!client.search) throw new Error("Installed exa-js client does not support search().");
  const response = await client.search("Exa", { numResults: 1, contents: { highlights: false, text: false } });
  return { ok: true, requestId: response.requestId };
}
```

Keep the request tiny and deterministic.

- [ ] **Step 4: Update `/exa` to report three states**

In `exa/index.ts`, change `/exa` so it reports:
- missing key → error with setup message
- key present and live check passes → success with request ID
- key present but live check fails → error with the failure message

Use notification text like:

```ts
"Exa is configured and passed a live API check (request req_health)."
```

- [ ] **Step 5: Document the new `/exa` behavior**

In `exa/README.md`, update the `/exa` command description from “Show whether `EXA_API_KEY` is configured” to “Check configuration and perform a live API sanity check”.

- [ ] **Step 6: Run the focused `/exa` test**

Run:

```bash
cd exa && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "live sanity check"
```

Expected: PASS.

- [ ] **Step 7: Run the full Exa test suite**

Run:

```bash
cd exa && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add exa/index.ts exa/index.test.ts exa/README.md
git commit -m "feat(exa): add live health check command"
```

---

### Task 5: Final verification and package-level smoke check

**Files:**
- Modify: none
- Test: package-level verification only

- [ ] **Step 1: Run the Exa test suite one final time**

Run:

```bash
cd exa && npm test
```

Expected: all tests pass.

- [ ] **Step 2: Verify the package still exposes the Exa extension entry**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions && node -e "const pkg=require('./package.json'); console.log(pkg.pi.extensions.includes('./exa/index.ts'))"
```

Expected: prints `true`.

- [ ] **Step 3: Reload pi and manually smoke test the user-facing flows**

From pi, run:

```text
/reload
/exa
```

Then manually test:
- `exa_search` for exploratory docs discovery
- `exa_get_contents` on one known Exa docs URL
- `exa_answer` with `stream: true`

Expected:
- only core tools are active by default
- `/exa` reports a live API check result
- streamed answers show labeled progressive text
- advanced tools remain available for later activation if needed

- [ ] **Step 4: Commit the final verification checkpoint**

```bash
git add -A
git commit -m "chore(exa): verify usability improvements"
```
