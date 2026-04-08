# Memory Ingest Skill Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a packaged `/skill:memory-ingest` workflow that deterministically classifies freeform input, ingests supported sources into `~/.pi/memories/raw/`, and logs ingest outcomes via existing memory operations.

**Architecture:** Put deterministic logic in testable TypeScript modules (`memory/ingest.ts` for classification/naming/safety/frontmatter and `skills/memory-ingest/scripts/ingest-runner.ts` for adapter execution and cap enforcement). The packaged skill delegates execution to the runner and follows fail-safe clarification rules. The memory extension only adds `ingest` as a valid operation type for `log_operation`.

**Tech Stack:** TypeScript, Node.js fs/path/url APIs, pi packaged skills (`SKILL.md`), pi extension API, `tsx --test`

**Dependency policy (resolved):** Soft dependencies with explicit fallback behavior. If a preferred converter/tool is unavailable, ingest must still produce a markdown artifact with provenance + clear degradation notes, and must not fail silently.

---

## Scope check

- Single subsystem only: **source ingestion into memory raw store**.
- Explicitly excluded: compile/Q&A/lint pipelines.

## File structure map

### Create
- `memory/ingest.ts` — pure helpers: classify input, classify local paths, slug/date naming, collision handling, raw-root path guard, provenance frontmatter formatter.
- `memory/ingest.test.ts` — exhaustive unit tests for all required source classes and safety constraints.
- `skills/memory-ingest/scripts/ingest-runner.ts` — executable ingest adapters (url, local-document, local-directory, repo, dataset, pasted-blob), cap checks, confirmation prompts, file writes.
- `skills/memory-ingest/scripts/ingest-runner.test.ts` — adapter tests (including cap overflow and confirmation behavior).
- `skills/memory-ingest/SKILL.md` — packaged skill instructions that call ingest runner and enforce fail-safe behavior.
- `skills/memory-ingest/examples.md` — deterministic examples and expected outcomes.

### Modify
- `package.json` — add `pi.skills` entry for packaged skill discovery.
- `README.md` — document packaged skill.
- `memory/types.ts` — add `ingest` operation type.
- `memory/index.ts` — allow `log_operation(type="ingest")`.
- `memory/prompts.test.ts` — add ingest operation parsing/rendering test.

---

### Task 1: Write ingest core tests first (RED)

**Files:**
- Create: `memory/ingest.test.ts`
- Test: `memory/ingest.test.ts`

- [x] **Step 1: Add failing tests for all top-level source classes**

```ts
import { test } from "node:test";
import * as assert from "node:assert";
import { classifyIngestInput } from "./ingest.ts";

test("classifyIngestInput: url", () => {
  const r = classifyIngestInput("https://example.com/x");
  assert.deepStrictEqual({ kind: r.kind, ambiguous: r.ambiguous }, { kind: "url", ambiguous: false });
});

test("classifyIngestInput: pasted blob", () => {
  const r = classifyIngestInput("Line 1\nLine 2\nLine 3");
  assert.strictEqual(r.kind, "pasted-blob");
});
```

- [x] **Step 2: Add failing tests for local path classification**

```ts
import { classifyLocalPath } from "./ingest.ts";

test("classifyLocalPath: local document", () => {
  assert.strictEqual(classifyLocalPath("/tmp/paper.pdf", false, true), "local-document");
});

test("classifyLocalPath: local directory", () => {
  assert.strictEqual(classifyLocalPath("/tmp/corpus", true, false), "local-directory");
});
```

- [x] **Step 3: Add failing ambiguity tests (fail-safe behavior)**

```ts
test("ambiguous token requires clarification", () => {
  const r = classifyIngestInput("project-alpha");
  assert.strictEqual(r.ambiguous, true);
  assert.ok(r.reason?.includes("clarify"));
});
```

- [x] **Step 4: Add failing naming and collision tests**

```ts
import { buildOutputBaseName } from "./ingest.ts";

test("collision suffix increments", () => {
  const out = buildOutputBaseName("2026-04-08", "paper", new Set(["2026-04-08-paper.md", "2026-04-08-paper-2.md"]));
  assert.strictEqual(out, "2026-04-08-paper-3");
});
```

- [x] **Step 5: Add failing raw-root safety tests**

```ts
import { resolveSafeRawPath } from "./ingest.ts";

test("rejects traversal", () => {
  assert.throws(() => resolveSafeRawPath("/home/u/.pi/memories/raw", "../oops.md"), /outside raw root/);
});
```

- [x] **Step 6: Add failing provenance frontmatter format test**

```ts
import { buildProvenanceFrontmatter } from "./ingest.ts";

test("provenance uses fixed yaml frontmatter", () => {
  const fm = buildProvenanceFrontmatter("https://x", "2026-04-08T00:00:00.000Z", "url-adapter");
  assert.ok(fm.startsWith("---\nsource:"));
  assert.ok(fm.includes("ingested_at:"));
  assert.ok(fm.includes("method:"));
  assert.ok(fm.endsWith("---\n\n"));
});
```

- [x] **Step 7: Run red tests**

Run: `cd memory && npm test -- ingest.test.ts`
Expected: FAIL (missing `memory/ingest.ts` exports).

- [x] **Step 8: Commit red tests**

```bash
git add memory/ingest.test.ts
git commit -m "test(memory): add ingest core red tests for classification naming and safety"
```

---

### Task 2: Implement ingest core helpers (GREEN)

**Files:**
- Create: `memory/ingest.ts`
- Test: `memory/ingest.test.ts`

- [x] **Step 1: Implement explicit source-kind and result types**

```ts
export type IngestKind =
  | "url"
  | "local-document"
  | "local-directory"
  | "repo"
  | "dataset"
  | "pasted-blob"
  | "unknown";

export interface ClassificationResult {
  kind: IngestKind;
  ambiguous: boolean;
  reason?: string;
}
```

- [x] **Step 2: Implement `classifyIngestInput` with local-path detection hook (no placeholders)**

```ts
export function classifyIngestInput(
  input: string,
  inspectLocalPath?: (value: string) => { exists: boolean; isFile: boolean; isDirectory: boolean }
): ClassificationResult {
  const value = input.trim();
  if (!value) return { kind: "unknown", ambiguous: true, reason: "Empty input; clarify source." };
  if (/^https?:\/\//i.test(value)) {
    if (/\.(csv|parquet|jsonl?|tsv|zip)(\?|#|$)/i.test(value)) return { kind: "dataset", ambiguous: false };
    if (/github\.com\//i.test(value) || /\.git(\?|#|$)/i.test(value)) return { kind: "repo", ambiguous: false };
    return { kind: "url", ambiguous: false };
  }
  if (value.includes("\n") || value.length > 280) return { kind: "pasted-blob", ambiguous: false };
  if (/^(git@|ssh:\/\/git@)/i.test(value) || /\.git$/i.test(value)) return { kind: "repo", ambiguous: false };

  if (inspectLocalPath) {
    const p = inspectLocalPath(value);
    if (p.exists) return { kind: classifyLocalPath(value, p.isDirectory, p.isFile), ambiguous: false };
  }

  return { kind: "unknown", ambiguous: true, reason: "Unable to classify safely; clarify source type." };
}
```

- [x] **Step 3: Implement local-path classifier + naming helpers (fail-safe, ambiguity-first)**

```ts
export function classifyLocalPath(pathLike: string, isDirectory: boolean, isFile: boolean): IngestKind {
  if (isFile) {
    if (/\.(csv|parquet|jsonl?|tsv|zip)$/i.test(pathLike)) return "dataset";
    return "local-document";
  }

  if (isDirectory) {
    // Deterministic repo signal only
    if (fs.existsSync(path.join(pathLike, ".git"))) return "repo";
    // Deterministic dataset signal only
    if (fs.existsSync(path.join(pathLike, "dataset.yaml")) || fs.existsSync(path.join(pathLike, "dataset.json"))) return "dataset";
    // Otherwise treat as generic local directory (not repo/dataset)
    return "local-directory";
  }

  return "unknown";
}

// In runner: if directory intent is unclear and would materially change adapter choice,
// return status:"clarify" instead of guessing.

export function buildOutputBaseName(date: string, sourceSlug: string, existing: Set<string>): string {
  let i = 1;
  let candidate = `${date}-${sourceSlug}`;
  while (existing.has(`${candidate}.md`)) {
    i += 1;
    candidate = `${date}-${sourceSlug}-${i}`;
  }
  return candidate;
}
```

- [x] **Step 4: Implement raw-root safety + provenance formatter**

```ts
import * as path from "node:path";

export function resolveSafeRawPath(rawRoot: string, relativeTarget: string): string {
  const root = path.resolve(rawRoot);
  const resolved = path.resolve(root, relativeTarget);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Target path is outside raw root");
  }
  return resolved;
}

export function buildProvenanceFrontmatter(source: string, ingestedAtIso: string, method: string): string {
  return `---\nsource: ${source}\ningested_at: ${ingestedAtIso}\nmethod: ${method}\n---\n\n`;
}
```

- [x] **Step 5: Run ingest core tests**

Run: `cd memory && npm test -- ingest.test.ts`
Expected: PASS.

- [x] **Step 6: Commit green ingest core**

```bash
git add memory/ingest.ts memory/ingest.test.ts
git commit -m "feat(memory): add ingest core classification naming safety and frontmatter helpers"
```

---

### Task 3: Write ingest runner adapter tests first (RED)

**Files:**
- Create: `skills/memory-ingest/scripts/ingest-runner.test.ts`
- Test: `skills/memory-ingest/scripts/ingest-runner.test.ts`

- [x] **Step 1: Add failing tests for adapter routing**

```ts
import { test } from "node:test";
import * as assert from "node:assert";
import { planIngest } from "./ingest-runner.ts";

test("planIngest routes url to url adapter", () => {
  const p = planIngest("https://example.com/post", { nowIso: "2026-04-08T00:00:00.000Z" });
  assert.strictEqual(p.kind, "url");
  assert.strictEqual(p.method, "url-adapter");
});
```

- [x] **Step 2: Add failing tests for cap confirmation requirements**

```ts
import { requiresConfirmationForCaps } from "./ingest-runner.ts";

test("repo over cap requires confirmation", () => {
  const r = requiresConfirmationForCaps("repo", { files: 250, bytes: 10_000_000, depth: 3 });
  assert.strictEqual(r.required, true);
});
```

- [x] **Step 3: Add failing tests for write boundary enforcement**

```ts
import { buildWriteTargets } from "./ingest-runner.ts";

test("write targets stay under raw root", () => {
  const t = buildWriteTargets("/home/u/.pi/memories/raw", "2026-04-08-paper");
  assert.ok(t.markdownPath.startsWith("/home/u/.pi/memories/raw/"));
});
```

- [x] **Step 4: Run red runner tests**

Run: `npx tsx --test skills/memory-ingest/scripts/ingest-runner.test.ts`
Expected: FAIL (missing `ingest-runner.ts`).

- [x] **Step 5: Commit red runner tests**

```bash
git add skills/memory-ingest/scripts/ingest-runner.test.ts
git commit -m "test(memory-ingest): add ingest runner red tests for routing caps and path safety"
```

---

### Task 4: Implement ingest runner adapters and wiring (GREEN)

**Files:**
- Create: `skills/memory-ingest/scripts/ingest-runner.ts`
- Modify: `skills/memory-ingest/scripts/ingest-runner.test.ts`
- Modify: `memory/ingest.ts` (only if additional exports are required)

- [x] **Step 1: Implement explicit runner CLI contract**

`ingest-runner.ts` accepts JSON payload only (single canonical API) for deterministic single-vs-list handling and confirmation replay:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["https://example.com"],"confirm":false}'
```

For confirmation replay, same payload with `confirm:true`:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["https://example.com","https://example.com/2"],"confirm":true}'
```

Output JSON schema:

```ts
type RunnerResult = {
  status: "ok" | "clarify" | "confirm" | "error";
  kind?: string;
  filesWritten?: string[];
  question?: string;
  reason?: string;
};
```

- [x] **Step 2: Wire runner planner to `classifyIngestInput(..., inspectLocalPath)`**

```ts
const c = classifyIngestInput(input, (v) => {
  const s = fs.existsSync(v) ? fs.statSync(v) : null;
  return { exists: !!s, isFile: !!s?.isFile(), isDirectory: !!s?.isDirectory() };
});
```

- [x] **Step 3: Implement full cap/confirmation rules (all required source types)**

Rules to encode and test:
- URL: max 1 unless explicit list (`inputs` array length > 1)
- Local document: max 1 unless explicit list (`inputs` array length > 1)
- Local directory: depth <= 3, files <= 100, bytes <= 25MB
- Repo: depth <= 4, files <= 200, bytes <= 25MB
- Dataset: files <= 50, bytes <= 100MB
- Pasted blob: <= 200KB

If a cap is exceeded and `confirm:false`, return `status:"confirm"` with reason.
If user replays same payload with `confirm:true`, proceed.

- [x] **Step 4: Implement URL adapter + test**

Implementation target:
- fetch/convert URL content to markdown body using preferred extractor
- if extractor unavailable/fails, write markdown artifact with provenance + explicit fallback note
- write `<date>-<slug>.md` with provenance header
- optionally preserve downloaded assets under `<date>-<slug>.assets/`

Test target:
- successful URL ingest writes markdown + frontmatter
- extractor-unavailable path still writes markdown with degradation note
- second URL in non-list mode returns `status: "confirm"`

- [x] **Step 5: Implement local-document adapter + test**

Implementation target:
- convert document/text to markdown using preferred converter(s)
- if converter unavailable/fails, write markdown artifact with fallback note and preserve original
- preserve original if not plain markdown/text
- write markdown artifact always

Test target:
- `.pdf` input writes markdown + preserves source copy
- converter-unavailable path still writes markdown with degradation note
- `.md` input writes markdown artifact without redundant copy requirement

- [x] **Step 6: Implement local-directory adapter + test**

Implementation target:
- recurse supported files (`.md`, `.txt`, `.html`, `.pdf`, `.docx`) up to caps
- produce corpus summary markdown + per-file markdown artifacts
- if preferred conversion tooling is unavailable for any file, still emit markdown artifact(s) with degradation note(s)

Test target:
- over-cap directory returns `status: "confirm"`
- successful ingest writes corpus summary markdown with frontmatter
- tooling-unavailable path still writes markdown with degradation note

- [x] **Step 7: Implement repo adapter + test**

Implementation target:
- generate repo summary markdown
- preserve key docs (`README*`, `docs/**`, selected config files)
- if preferred repo tooling is unavailable, still emit markdown artifact with explicit degradation note

Test target:
- repo fixture writes summary markdown + key docs copy
- tooling-unavailable path still writes markdown with degradation note
- over-cap repo returns `status: "confirm"`

- [x] **Step 8: Implement dataset adapter + test**

Implementation target:
- generate dataset summary/preview markdown
- preserve retrievable dataset artifacts
- if preview tooling unavailable, emit markdown with schema/filename fallback summary

Test target:
- dataset fixture writes preview markdown + preserved artifact
- tooling-unavailable path still writes markdown with degradation note
- over-cap dataset returns `status: "confirm"`

- [x] **Step 9: Implement pasted-blob adapter + test**

Implementation target:
- write normalized markdown note with provenance frontmatter

Test target:
- >200KB returns `status: "confirm"`
- valid blob writes markdown

- [x] **Step 10: Implement shared write-target builder + markdown emitter**

```ts
export function buildWriteTargets(rawRoot: string, baseName: string) {
  return {
    markdownPath: resolveSafeRawPath(rawRoot, `${baseName}.md`),
    assetsDir: resolveSafeRawPath(rawRoot, `${baseName}.assets`),
  };
}

export function buildMarkdownOutput(source: string, method: string, ingestedAtIso: string, body: string): string {
  return buildProvenanceFrontmatter(source, ingestedAtIso, method) + body.trim() + "\n";
}
```

- [x] **Step 11: Run runner tests**

Run: `npx tsx --test skills/memory-ingest/scripts/ingest-runner.test.ts`
Expected: PASS, including per-source adapter and cap-confirmation coverage.

- [x] **Step 12: Commit ingest runner implementation**

```bash
git add skills/memory-ingest/scripts/ingest-runner.ts skills/memory-ingest/scripts/ingest-runner.test.ts memory/ingest.ts
git commit -m "feat(memory-ingest): implement source adapters with cap-confirmation and safe raw writes"
```

---

### Task 5: Integrate `ingest` operation type in memory extension

**Files:**
- Modify: `memory/types.ts`
- Modify: `memory/index.ts`
- Modify: `memory/prompts.test.ts`
- Test: `memory/prompts.test.ts`

- [x] **Step 1: Add `ingest` to `OperationType` union**

```ts
export type OperationType = "reflect" | "ruminate" | "dream" | "ingest";
```

- [x] **Step 2: Update `LogOperationParams` enum in `memory/index.ts`**

```ts
type: StringEnum(["reflect", "ruminate", "dream", "ingest"] as const, {
  description: "What kind of memory operation was performed",
}),
```

- [x] **Step 3: Add ingest operation parse test in `memory/prompts.test.ts`**

```ts
test("parseOperationsJSONL parses ingest operations", () => {
  const ops = parseOperationsJSONL(JSON.stringify({ operationType: "ingest", status: "keep", description: "ingested", timestamp: 1 }));
  assert.strictEqual(ops[0].type, "ingest");
});
```

- [x] **Step 4: Run targeted memory tests**

Run: `cd memory && npm test -- prompts.test.ts`
Expected: PASS.

- [x] **Step 5: Commit operation-type integration**

```bash
git add memory/types.ts memory/index.ts memory/prompts.test.ts
git commit -m "feat(memory): allow ingest operation logging"
```

---

### Task 6: Package and document `/skill:memory-ingest`

**Files:**
- Create: `skills/memory-ingest/SKILL.md`
- Create: `skills/memory-ingest/examples.md`
- Modify: `package.json`
- Modify: `README.md`

- [x] **Step 1: Author `SKILL.md` to invoke the runner script**

Must include valid skill frontmatter at top:

```yaml
---
name: memory-ingest
description: Ingest heterogeneous knowledge sources into ~/.pi/memories/raw/ using deterministic routing and fail-safe clarification.
---
```

Must include explicit execution call (JSON payload only):

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["<user input>"],"confirm":false}'
```

For cap/size/list confirmations, skill must ask the user, then replay with:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["..."],"confirm":true}'
```

And explicit rules:
- ambiguity => ask clarification, stop
- write only under `~/.pi/memories/raw/`
- enforce source caps + confirmation policy
- apply soft-dependency fallback behavior (always produce markdown artifact with degradation note)
- after successful write, call `log_operation(type="ingest", status="keep", ...)`

- [x] **Step 2: Add examples file with expected outputs**

Include URL, local doc, local directory, repo, dataset, pasted blob examples, plus one ambiguous case that should ask clarification.

- [x] **Step 3: Add packaged skills entry in `package.json`**

```json
"pi": {
  "extensions": [...],
  "prompts": ["./prompts"],
  "skills": ["./skills"]
}
```

- [x] **Step 4: Update `README.md` with Skills section**

Document:
- `memory-ingest` purpose
- invocation example
- where files are written (`~/.pi/memories/raw/`)

- [x] **Step 5: Validate package and skill load**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: `ok`

Run: `pi --no-extensions --skill ./skills/memory-ingest/SKILL.md -p "/skill:memory-ingest https://example.com"`
Expected: skill loads; no skill frontmatter/path errors.

- [x] **Step 6: Commit package wiring/docs**

```bash
git add skills/memory-ingest/SKILL.md skills/memory-ingest/examples.md package.json README.md
git commit -m "feat(skills): package memory-ingest skill and docs"
```

---

### Task 7: Full verification and final checkpoint

**Files:**
- Modify (if needed): touched files from Tasks 1-6 only

- [x] **Step 1: Run full memory tests**

Run: `cd memory && npm test`
Expected: PASS.

- [x] **Step 2: Run ingest runner tests**

Run: `npx tsx --test skills/memory-ingest/scripts/ingest-runner.test.ts`
Expected: PASS.

- [x] **Step 3: Manual acceptance pass using spec checklist**

Verify:
- `/skill:memory-ingest <anything>` is deterministic or asks clarification
- writes only under raw root
- markdown includes YAML provenance frontmatter
- cap overflow requests confirmation
- ingest can be logged via `log_operation(type="ingest")`

- [ ] **Step 4: Commit final fixes (only if needed)**

```bash
git add -A
git commit -m "chore(memory-ingest): finalize verification fixes"
```

---

## Execution reminders

- Use `test-driven-development` during implementation (RED → GREEN → REFACTOR per task).
- Use `verification-before-completion` before claiming done.
- Keep changes DRY and YAGNI; do not add compile/Q&A/lint features in this branch.
