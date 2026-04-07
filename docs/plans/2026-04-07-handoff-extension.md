# Handoff Extension Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `handoff` pi extension that transfers the current conversation into a fresh session using Amp's handoff-context prompt, parent-session tracking, Sonnet-first model selection with fallback, and pi's canonical `ctx.newSession()` + `ctx.ui.setEditorText()` UX.

**Architecture:** Keep the extension self-contained in `handoff/index.ts`, following the same dependency-injection pattern used by `auto-name-session` so the command logic can be unit-tested without booting pi. Put all command logic, prompt constants, model-resolution helpers, and validation helpers in that single file; keep tests in `handoff/index.test.ts`; add a tiny `handoff/package.json` matching other extensions; register the extension in the root `package.json`; and document the extension/interaction contract in `handoff/README.md`.

**Tech Stack:** TypeScript, `@mariozechner/pi-ai` (`complete`), pi extension API (`registerCommand`, `ctx.newSession`, `ctx.ui.*`), pi conversation utilities (`convertToLlm`, `serializeConversation`, `BorderedLoader`), `tsx --test`.

---

## File Map

- Create: `handoff/index.ts`
  - Owns the entire extension implementation.
  - Exports `CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT` for snapshot testing.
  - Exports `createHandoffExtension()` for dependency injection.
  - Registers `/handoff` and implements validation, model selection, summary generation, session switching, and editor prefill.

- Create: `handoff/index.test.ts`
  - Owns all unit tests for the extension factory.
  - Provides a local harness that captures `registerCommand`, notifications, confirmations, editor writes, and `newSession()` calls.
  - Tests guardrails, Sonnet fallback behavior, prompt wiring, cancellation paths, and the no-`setSessionName` rule.

- Create: `handoff/package.json`
  - Matches the per-extension package pattern already used by `auto-name-session`.
  - Supplies a local `npm test` script using `tsx --test --test-timeout=5000`.

- Create: `handoff/README.md`
  - Documents user-visible behavior, the deliberate differences from pi-amplike/real Amp, and extension interactions (`memory`, `auto-name-session`, `subagent`).

- Modify: `package.json`
  - Add `"./handoff/index.ts"` to the root `pi.extensions` list so pi discovers the extension.

- Reference during implementation:
  - `docs/design/2026-04-07-handoff-extension.md`
  - `auto-name-session/index.ts`
  - `auto-name-session/index.test.ts`
  - `/Users/brian/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.65.2/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/handoff.ts`
  - `/Users/brian/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.65.2/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`

## Task 0: Preflight spike the load-bearing session-switch behavior

**Files:**
- Create temporarily: `handoff/spike-example.ts`
- Modify temporarily: `package.json`
- Reference: `/Users/brian/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.65.2/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/handoff.ts`

- [ ] **Step 1: Create a temporary spike file from pi's canonical handoff example**

Create `handoff/spike-example.ts` by copying the current contents of:

```
/Users/brian/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.65.2/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/handoff.ts
```

Do not adapt it yet. This is a short-lived behavior spike to verify pi runtime assumptions before implementing the real extension.

- [ ] **Step 2: Temporarily register the spike extension in the root manifest**

Modify `/Users/brian/code/bobcats/pi-extensions/package.json` and add `"./handoff/spike-example.ts"` to the `pi.extensions` array. Leave existing entries untouched.

- [ ] **Step 3: Enable the local package and spike extension in pi**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions
pi config
```

In the config UI, ensure this local package is enabled and the temporary spike extension appears and is checked.

- [ ] **Step 4: Run the spike in a fresh pi session**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions
pi
```

Inside pi, create a short non-empty conversation, then run:

```text
/handoff continue the work
```

Expected:
- a new child session opens
- the **child** session's editor is prefilled after `newSession()` + `setEditorText()`
- the prefill does not land in the abandoned parent session

- [ ] **Step 5: Verify extension interactions during the spike**

Still inside pi, submit the prefilled prompt and confirm:
- `memory` still injects its vault context into the child's first turn
- `auto-name-session` names the child after the first completed exchange

Record any unexpected behavior before writing implementation code.

- [ ] **Step 6: Remove the temporary spike wiring**

Delete `handoff/spike-example.ts` and remove `"./handoff/spike-example.ts"` from the root `pi.extensions` array. Do not commit the spike file or its manifest entry.

- [ ] **Step 7: Confirm the temporary spike artifacts are fully gone**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions && git diff --check && git status --short
```

Expected:
- `git diff --check` prints no whitespace/conflict issues
- `git status --short` does **not** show `handoff/spike-example.ts` or a leftover temporary manifest edit for the spike extension

---

## Task 1: Scaffold the extension package and lock in the prompt constant

**Files:**
- Create: `handoff/index.ts`
- Create: `handoff/index.test.ts`
- Create: `handoff/package.json`
- Modify: `package.json`
- Reference: `auto-name-session/index.ts`
- Reference: `auto-name-session/index.test.ts`

- [ ] **Step 1: Copy the exact Amp prompt text into the plan before coding**

Open `docs/design/2026-04-07-handoff-extension.md` and copy the `create_handoff_context` prompt block exactly. Do not paraphrase it during implementation.

- [ ] **Step 2: Write the failing prompt snapshot test**

In `handoff/index.test.ts`, add a minimal skeleton harness and a snapshot-style test for the exported constant.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT } from "./index.ts";

test("exports Amp's handoff context prompt verbatim", () => {
  assert.equal(
    CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT,
    `Extract relevant context from the conversation. Write from first person
perspective ("I did...", "I told you...").

Consider what's useful based on the user's request. Questions that might
be relevant:
  - What did I just do or implement?
  - What instructions did I already give you which are still relevant
    (e.g. follow patterns in the codebase)?
  - Did I provide a plan or spec that should be included?
  - What did I already tell you that's important (certain libraries,
    patterns, constraints, preferences)?
  - What important technical details did I discover (APIs, methods,
    patterns)?
  - What caveats, limitations, or open questions did I find?
  - What files did I tell you to edit that I should continue working on?

Extract what matters for the specific request. Don't answer questions
that aren't relevant. Pick an appropriate length based on the complexity
of the request.

Focus on capabilities and behavior, not file-by-file changes. Avoid
excessive implementation details (variable names, storage keys, constants)
unless critical.

Format: Plain text with bullets. No markdown headers, no bold/italic,
no code fences. Use workspace-relative paths for files.`,
  );
});
```

- [ ] **Step 3: Run the prompt test to verify it fails**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "prompt verbatim"
```

Expected: FAIL because `handoff/index.ts` does not exist yet.

- [ ] **Step 4: Create `handoff/package.json` using the existing extension template**

Create `handoff/package.json` with the same shape as `auto-name-session/package.json`:

```json
{
  "name": "handoff-extension",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "tsx --test --test-timeout=5000 *.test.ts"
  },
  "devDependencies": {
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-coding-agent": "*",
    "tsx": "^4.20.0"
  }
}
```

- [ ] **Step 5: Install local test dependencies if `handoff/node_modules` does not exist**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm install
```

Expected: installs `tsx`, `@mariozechner/pi-ai`, and `@mariozechner/pi-coding-agent` locally so `npx tsx` and `npm test` work from the extension directory.

- [ ] **Step 6: Create the minimal extension skeleton**

Create `handoff/index.ts` with just enough structure to satisfy the prompt export and factory shape:

```ts
import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT = `...exact prompt text...`;

export function createHandoffExtension(deps: { completeFn?: typeof complete } = {}) {
  const completeFn = deps.completeFn ?? complete;
  void completeFn;

  return function handoff(_pi: ExtensionAPI) {
    // implemented in later tasks
  };
}

export default createHandoffExtension();
```

- [ ] **Step 7: Run the prompt test to verify it passes**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "prompt verbatim"
```

Expected: PASS.

- [ ] **Step 8: Register the extension in the root manifest**

Modify `/Users/brian/code/bobcats/pi-extensions/package.json` and add `"./handoff/index.ts"` to the `pi.extensions` array near the other extension entries.

- [ ] **Step 9: Commit the scaffold**

```bash
git add package.json handoff/index.ts handoff/index.test.ts handoff/package.json
git commit -m "feat(handoff): scaffold extension package"
```

---

## Task 2: Build the test harness, exact empty-conversation predicate, and Sonnet model resolution

**Files:**
- Modify: `handoff/index.ts`
- Modify: `handoff/index.test.ts`
- Reference: `docs/design/2026-04-07-handoff-extension.md`

- [ ] **Step 1: Write the failing harness and guardrail tests**

Add a reusable harness modeled after `auto-name-session/index.test.ts`.

```ts
function createHarness() {
  const commands = new Map<string, any>();
  const notifications: Array<{ message: string; level: string }> = [];
  const confirmations: Array<{ title: string; message: string }> = [];
  const editorTexts: string[] = [];
  let confirmResult = true;
  let editorText = "";
  let customResult: unknown = null;
  let newSessionCalls = 0;
  let setSessionNameCalls = 0;

  return {
    commands,
    notifications,
    confirmations,
    editorTexts,
    setConfirmResult(value: boolean) { confirmResult = value; },
    setEditorTextValue(value: string) { editorText = value; },
    setCustomResult(value: unknown) { customResult = value; },
    get newSessionCalls() { return newSessionCalls; },
    get setSessionNameCalls() { return setSessionNameCalls; },
    pi: {
      registerCommand(name: string, spec: any) { commands.set(name, spec); },
      setSessionName() { setSessionNameCalls += 1; },
    } as never,
    ctx: {
      hasUI: true,
      model: { provider: "openai", id: "gpt-4o" },
      cwd: "/tmp/project",
      modelRegistry: {
        find(provider: string, modelId: string) {
          return provider === "anthropic" && modelId === "claude-sonnet-4-5"
            ? { provider, id: modelId }
            : null;
        },
        async getApiKeyAndHeaders(model: any) {
          return { ok: true as const, apiKey: `key-for-${model.provider}/${model.id}`, headers: { "x-test": "1" } };
        },
      },
      sessionManager: {
        getBranch() { return []; },
        getSessionFile() { return "/tmp/project/.pi/sessions/current.jsonl"; },
      },
      newSession: async () => {
        newSessionCalls += 1;
        return { cancelled: false };
      },
      ui: {
        notify(message: string, level: string) { notifications.push({ message, level }); },
        getEditorText() { return editorText; },
        async confirm(title: string, message: string) {
          confirmations.push({ title, message });
          return confirmResult;
        },
        setEditorText(text: string) { editorTexts.push(text); },
        async custom<T>(_builder: any): Promise<T> { return customResult as T; },
      },
    } as never,
  };
}
```

Then add failing tests for:
- `!ctx.hasUI`
- `!ctx.model`
- empty goal
- empty conversation (exact predicate)
- editor text overwrite denied
- Sonnet missing from registry → fallback to `ctx.model`
- Sonnet auth failure → fallback to `ctx.model`
- both Sonnet and fallback auth unavailable → error notify

Add a short comment above `ui.custom()` in the harness explaining that it is intentionally a configurable return-value stub. That lets command-handler tests force the post-loader branch with `harness.setCustomResult(...)` instead of trying to instantiate a real `BorderedLoader` in Node tests.

- [ ] **Step 2: Run the focused guardrail tests to verify they fail**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "interactive mode|No model selected|Usage: /handoff|No conversation to hand off|overwrite|fallback|usable model credentials"
```

Expected: FAIL because the command is not registered and no validation/model helpers exist.

- [ ] **Step 3: Implement command registration and the text-content helpers**

In `handoff/index.ts`, register the command and add small helpers. Keep them in the same file.

```ts
function textOfMessage(message: any): string {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function hasConversationText(entry: any): boolean {
  if (entry?.type !== "message") return false;
  const role = entry.message?.role;
  if (role !== "user" && role !== "assistant") return false;
  return textOfMessage(entry.message).length > 0;
}
```

Register the command:

```ts
pi.registerCommand("handoff", {
  description: "Transfer context to a new focused session",
  handler: async (args, ctx) => {
    if (!ctx.hasUI) {
      ctx.ui.notify("Handoff requires interactive mode.", "error");
      return;
    }
    if (!ctx.model) {
      ctx.ui.notify("No model selected.", "error");
      return;
    }
    const goal = args.trim();
    if (!goal) {
      ctx.ui.notify("Usage: /handoff <goal for new session>", "error");
      return;
    }
    const branch = ctx.sessionManager.getBranch();
    if (!branch.some(hasConversationText)) {
      ctx.ui.notify("No conversation to hand off.", "error");
      return;
    }
    // more logic added in later tasks
  },
});
```

- [ ] **Step 4: Implement Sonnet-first model resolution with graceful fallback**

Still in `handoff/index.ts`, add a helper that the command will use later:

```ts
async function resolveSummaryModel(ctx: any, provider: string, modelId: string) {
  const preferred = ctx.modelRegistry.find(provider, modelId);
  if (preferred) {
    const preferredAuth = await ctx.modelRegistry.getApiKeyAndHeaders(preferred);
    if (preferredAuth.ok) {
      return { model: preferred, auth: preferredAuth };
    }
  }

  const fallback = ctx.model;
  if (!fallback) return null;
  const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(fallback);
  if (!fallbackAuth.ok) return null;
  return { model: fallback, auth: fallbackAuth };
}
```

In the command handler, call it early enough that failures can notify:

```ts
const resolved = await resolveSummaryModel(ctx, SUMMARY_PROVIDER, SUMMARY_MODEL);
if (!resolved) {
  ctx.ui.notify("Handoff: no usable model credentials", "error");
  return;
}
```

- [ ] **Step 5: Implement the editor-collision confirmation**

Add this guard after goal validation and before generation:

```ts
const currentEditorText = ctx.ui.getEditorText().trim();
if (currentEditorText) {
  const ok = await ctx.ui.confirm(
    "Overwrite editor with handoff prompt?",
    "The prompt editor has unsubmitted text. Replace it with the generated handoff prompt?",
  );
  if (!ok) return;
}
```

- [ ] **Step 6: Run the focused guardrail tests to verify they pass**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "interactive mode|No model selected|Usage: /handoff|No conversation to hand off|overwrite|fallback|usable model credentials"
```

Expected: PASS.

- [ ] **Step 7: Commit the guardrails and model resolution**

```bash
git add handoff/index.ts handoff/index.test.ts
git commit -m "feat(handoff): add validation and model fallback"
```

---

## Task 3: Implement summary generation and session handoff behavior

**Files:**
- Modify: `handoff/index.ts`
- Modify: `handoff/index.test.ts`
- Reference: `/Users/brian/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.65.2/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/handoff.ts`

- [ ] **Step 1: Write the failing happy-path and cancellation tests**

Add tests for:
- happy path (loader stub returns a generated summary, `newSession` called once, editor receives `goal + summary`, notify fires)
- generation aborted (`ui.custom()` returns `null`) → no `newSession`, info notify
- direct helper abort branch (`generateHandoffSummary()` sees `response.stopReason === "aborted"`) → returns `null`
- `newSession()` cancelled → no editor prefill, notify "New session cancelled"
- no `setSessionName` calls
- the pure summary-generation helper receives the exported system prompt and a user message containing serialized conversation + goal

For the command-handler tests, seed the harness with a non-empty branch and force the loader result:

```ts
harness.ctx.sessionManager.getBranch = () => [
  {
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "Please continue the auth cleanup" }] },
  },
];
harness.setCustomResult("- I already fixed auth.\n- Continue in auth/service.ts");
```

For the pure helper test, use a complete mock like:

```ts
const completeCalls: any[] = [];
const result = await generateHandoffSummary({
  completeFn: async (model, prompt, options) => {
    completeCalls.push({ model, prompt, options });
    return {
      role: "assistant",
      content: [{ type: "text", text: "- I already fixed auth.\n- Continue in auth/service.ts" }],
      stopReason: "stop",
    };
  },
  model: { provider: "anthropic", id: "claude-sonnet-4-5" },
  apiKey: "test-key",
  headers: { "x-test": "1" },
  messages: [{ role: "user", content: [{ type: "text", text: "Continue the auth cleanup" }] }],
  goal: "continue the auth cleanup",
});
```

If `generateHandoffSummary()` is file-local by default, temporarily export it for testability or expose a thin pure helper that builds the request payload. Do not add cross-session state just to make this test possible.

- [ ] **Step 2: Run the focused generation tests to verify they fail**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "happy path|aborted|New session cancelled|setSessionName|serialized conversation"
```

Expected: FAIL because generation/session-switch logic is still missing.

- [ ] **Step 3: Implement conversation serialization and the generation helper**

In `handoff/index.ts`, add a helper similar to pi's example, but using the Amp prompt constant and the resolved summary model.

```ts
import { complete, type Message } from "@mariozechner/pi-ai";
import {
  BorderedLoader,
  convertToLlm,
  serializeConversation,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";

async function generateHandoffSummary(params: {
  completeFn: typeof complete;
  model: any;
  apiKey: string | undefined;
  headers: Record<string, string> | undefined;
  messages: any[];
  goal: string;
  signal?: AbortSignal;
}) {
  const conversationText = serializeConversation(convertToLlm(params.messages));
  const userMessage: Message = {
    role: "user",
    content: [{
      type: "text",
      text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${params.goal}`,
    }],
    timestamp: Date.now(),
  };

  const response = await params.completeFn(
    params.model,
    { systemPrompt: CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT, messages: [userMessage] },
    { apiKey: params.apiKey, headers: params.headers, signal: params.signal },
  );

  if ((response as any).stopReason === "aborted") return null;

  return response.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}
```

- [ ] **Step 4: Implement the loader UI and handoff flow in the command**

Inside the command handler, after validation/model resolution:

```ts
const branch = ctx.sessionManager.getBranch();
const messages = branch
  .filter((entry: SessionEntry) => entry.type === "message")
  .map((entry: any) => entry.message);

const summary = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
  const loader = new BorderedLoader(tui, theme, "Generating handoff prompt...");
  loader.onAbort = () => done(null);

  generateHandoffSummary({
    completeFn,
    model: resolved.model,
    apiKey: resolved.auth.apiKey,
    headers: resolved.auth.headers,
    messages,
    goal,
    signal: loader.signal,
  })
    .then(done)
    .catch(() => done(null));

  return loader;
});

if (summary === null) {
  ctx.ui.notify("Handoff cancelled.", "info");
  return;
}

const finalPrompt = `${goal}\n\n${summary}`;
const newSessionResult = await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(),
});

if (newSessionResult.cancelled) {
  ctx.ui.notify("New session cancelled.", "info");
  return;
}

ctx.ui.setEditorText(finalPrompt);
ctx.ui.notify("Handoff ready — submit when ready.", "info");
```

Do **not** call `pi.setSessionName()` or `pi.sendUserMessage()`.

- [ ] **Step 5: Run the focused generation tests to verify they pass**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "happy path|aborted|New session cancelled|setSessionName|serialized conversation"
```

Expected: PASS.

- [ ] **Step 6: Run the full handoff test suite**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: all handoff tests pass.

- [ ] **Step 7: Commit the handoff flow**

```bash
git add handoff/index.ts handoff/index.test.ts
git commit -m "feat(handoff): generate summaries and switch sessions"
```

---

## Task 4: Lock the preferred Sonnet model constant with the lightest viable verification

**Files:**
- Modify: `handoff/index.ts`
- Modify: `handoff/index.test.ts` (only if the constant changes)
- Reference: `docs/design/2026-04-07-handoff-extension.md`
- Reference: `handoff/node_modules/@mariozechner/pi-ai` (after install)

- [ ] **Step 1: Search the installed `@mariozechner/pi-ai` package for candidate Sonnet IDs**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && rg -n "claude-sonnet-4-(5|6)" node_modules/@mariozechner/pi-ai -g '*.ts' -g '*.js' -g '*.mjs' -g '*.json'
```

Expected: one or both candidate IDs appear in the installed package metadata, provider definitions, or tests.

- [ ] **Step 2: Set `SUMMARY_MODEL` to the strongest candidate from the installed package**

In `handoff/index.ts`, use the candidate with the strongest evidence from Step 1:

```ts
const SUMMARY_PROVIDER = "anthropic";
const SUMMARY_MODEL = "claude-sonnet-4-5";
```

Use `claude-sonnet-4-6` instead if that is the only supported/current ID shown by Step 1.

- [ ] **Step 3: Add or adjust a focused test for the preferred lookup order**

In `handoff/index.test.ts`, add a test that seeds a non-empty conversation and asserts the first `modelRegistry.find()` lookup uses the chosen preferred ID:

```ts
test("prefers the configured Sonnet summary model id first", async () => {
  const lookups: Array<[string, string]> = [];
  const harness = createHarness();
  harness.ctx.sessionManager.getBranch = () => [
    {
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "Continue the auth cleanup" }] },
    },
  ];
  harness.ctx.modelRegistry.find = (provider: string, modelId: string) => {
    lookups.push([provider, modelId]);
    return null;
  };

  createHandoffExtension()(harness.pi);
  const command = harness.commands.get("handoff");
  await command.handler("continue the auth work", harness.ctx);

  assert.deepEqual(lookups[0], ["anthropic", "claude-sonnet-4-5"]);
});
```

Update the expected tuple if Step 1 selected `claude-sonnet-4-6`.

- [ ] **Step 4: Run the focused preferred-ID test**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npx tsx --test --test-timeout=5000 index.test.ts --test-name-pattern "configured Sonnet summary model id"
```

Expected: PASS.

- [ ] **Step 5: Re-run the full handoff test suite**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit the preferred model constant**

```bash
git add handoff/index.ts handoff/index.test.ts
git commit -m "chore(handoff): set preferred Sonnet model"
```

---

## Task 5: Write the README and run repo-level verification

**Files:**
- Create: `handoff/README.md`
- Verify: `handoff/index.ts`
- Verify: `handoff/index.test.ts`
- Verify: `package.json`

- [ ] **Step 1: Write `handoff/README.md`**

Document:
- what `/handoff <goal>` does
- what it intentionally does **not** do (no tool, no mode/model flags, no countdown UX)
- parent-session tracking via `parentSession`
- Sonnet-first model selection with fallback to current model
- extension interactions:
  - `memory` reinjects vault automatically
  - `auto-name-session` names the child automatically
  - async `subagent` panes are terminated on handoff, same as `/new`

Use content like:

```md
# handoff

Create a new focused session from the current conversation.

## Usage

/handoff continue the auth cleanup

The command:
1. validates that the current conversation has meaningful user/assistant text
2. generates a first-person handoff summary using Amp's context-extraction prompt
3. creates a new session with `parentSession` tracking
4. pre-fills the new session's editor with the goal + summary

## Deliberate non-features

- No agent-callable `handoff` tool
- No `-mode` / `-model` flags
- No countdown / preview mode
- No session-query integration
```

- [ ] **Step 2: Run the local handoff tests again**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions/handoff && npm test
```

Expected: PASS.

- [ ] **Step 3: Run a repo-level smoke check for the touched files**

Run:

```bash
cd /Users/brian/code/bobcats/pi-extensions && git diff --check && npm --prefix handoff test && npm --prefix auto-name-session test
```

Expected:
- `git diff --check` prints nothing
- `npm --prefix handoff test` passes
- `npm --prefix auto-name-session test` still passes (guards against accidentally copying patterns badly or breaking shared assumptions)

- [ ] **Step 4: Manual smoke test in pi**

Open pi in this repo using a session with working model credentials. Prefer a run where Anthropic credentials are available; if only fallback credentials are available, explicitly note that the smoke test exercised the fallback path only. Then verify:
1. `/handoff` with no args shows the usage error.
2. In a non-empty session, `/handoff continue the work` opens a new session and fills the **child** session's editor.
3. Note whether the run exercised the preferred Sonnet path or the fallback `ctx.model` path.
4. If the editor has unsent text, confirmation appears.
5. If you submit the handoff prompt, `auto-name-session` names the child session after the first completed exchange.
6. Treat this as the final live proof that the real registry + runtime behavior matches the implementation assumptions.

If the local package or extension does not appear in pi, re-open `pi config` and confirm both the package and the `handoff` extension are enabled; root `package.json` registration alone is not always sufficient in local development.

Record any divergence before shipping.

- [ ] **Step 5: Commit docs and final verification**

```bash
git add handoff/README.md handoff/index.ts handoff/index.test.ts handoff/package.json package.json
git commit -m "docs(handoff): document extension behavior"
```

---

## Final Verification Checklist

- [ ] `handoff/index.ts` exports `CREATE_HANDOFF_CONTEXT_SYSTEM_PROMPT`
- [ ] `handoff/index.ts` exports `createHandoffExtension()` and default export
- [ ] `/handoff` is registered in the extension factory
- [ ] empty-conversation predicate matches the spec exactly
- [ ] `ctx.ui.confirm` is used when `getEditorText().trim()` is non-empty
- [ ] preferred Sonnet ID is verified and encoded in `SUMMARY_MODEL`
- [ ] fallback to `ctx.model` works when preferred model is missing or unauthenticated
- [ ] the "no usable model credentials" path is covered by tests
- [ ] `ctx.newSession({ parentSession })` is used; no `globalThis`/`session_start` coordination exists
- [ ] `ctx.ui.setEditorText(finalPrompt)` is used after `newSession()`
- [ ] live spike/manual smoke proved that `setEditorText()` after `newSession()` targets the child session editor
- [ ] no `pi.setSessionName()` or `pi.sendUserMessage()` calls are added to handoff
- [ ] README documents the `subagent` shutdown interaction

## If implementation gets stuck

- Re-read `docs/design/2026-04-07-handoff-extension.md` before changing scope.
- Re-read `auto-name-session/index.ts` and `auto-name-session/index.test.ts` before inventing a new testing pattern.
- Re-read pi's canonical example at `/Users/brian/.local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.65.2/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/handoff.ts` before adding cross-session state.
- Use the `test-driven-development` skill when executing the plan.
- Use the `verification-before-completion` skill before claiming the extension is done.
