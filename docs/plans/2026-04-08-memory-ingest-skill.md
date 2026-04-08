# Memory Ingest Skill Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/skill:memory-ingest` a single end-to-end workflow that ingests source material into `~/.pi/memories/raw/` and immediately compiles it into curated notes under `~/.pi/memories/`.

**Architecture:** Keep deterministic acquisition logic in the ingest runner, but make the packaged skill orchestrate a second compile stage that reads newly written raw artifacts and updates the brain/wiki incrementally. Raw ingest stays testable and safe; synthesis/backlinks/index updates are performed in the same skill invocation.

**Tech Stack:** TypeScript, Node.js fs/path/url APIs, pi packaged skills (`SKILL.md`), existing memory extension tools, `tsx --test`

---

## Scope check

- Single subsystem only: **end-to-end memory ingestion (raw ingest + immediate compile)**.
- Explicitly excluded: independent ask/lint products, whole-vault reorganization, standalone compile UX.

## File structure map

### Modify
- `skills/memory-ingest/SKILL.md` — change contract from raw-only to ingest+compile orchestration.
- `skills/memory-ingest/examples.md` — update examples to include curated-note outcomes.
- `skills/memory-ingest/scripts/ingest-runner.ts` — if needed, return richer structured output for compile handoff.
- `skills/memory-ingest/scripts/ingest-runner.test.ts` — cover richer handoff output if runner changes.
- `memory/ingest.ts` — shared helpers for normalized markdown output if compile-facing cleanup is needed.
- `README.md` — document that `memory-ingest` updates raw and curated memory.
- `docs/design/2026-04-08-memory-ingest-skill.md` — keep aligned with shipped behavior.

### Create (only if needed)
- `docs/acceptance/2026-04-08-memory-ingest-compile-checklist.md` — manual checklist if compile behavior needs explicit operator review.

---

### Task 1: Lock the corrected workflow contract in docs first

**Files:**
- Modify: `docs/design/2026-04-08-memory-ingest-skill.md`
- Modify: `docs/plans/2026-04-08-memory-ingest-skill.md`

- [x] **Step 1: Update the design doc to state that `memory-ingest` always performs raw ingest and immediate compile**

- [x] **Step 2: Update the plan file to replace raw-only scope with ingest+compile scope**

- [x] **Step 3: Review both docs for consistency**

Check:
- one entrypoint
- raw stage is internal, not terminal
- compile stage is mandatory on success
- `log_operation(type="ingest")` now represents end-to-end success

- [ ] **Step 4: Commit corrected docs**

```bash
git add docs/design/2026-04-08-memory-ingest-skill.md docs/plans/2026-04-08-memory-ingest-skill.md
git commit -m "docs(memory-ingest): redefine workflow as ingest plus compile"
```

---

### Task 2: Write failing tests for compile-stage orchestration (RED)

**Files:**
- Modify: `skills/memory-ingest/SKILL.md`
- Create or Modify: skill-adjacent tests if there is an existing harness; otherwise use a deterministic shell/integration test file under `skills/memory-ingest/scripts/`

- [ ] **Step 1: Add a failing test/spec for successful ingest producing a compile handoff payload**

Test should prove the post-ingest step knows:
- raw files written
- source kind
- source label
- enough context to update curated notes

- [ ] **Step 2: Add a failing test/spec for compile behavior expectations**

Expected outputs:
- curated note updated or created under `~/.pi/memories/`
- backlink/reference to raw source present
- no success log before compile stage finishes

- [ ] **Step 3: Run the focused test and observe failure**

Run: `npx tsx --test skills/memory-ingest/scripts/ingest-runner.test.ts`
Expected: FAIL because compile orchestration is not implemented yet.

- [ ] **Step 4: Commit red tests**

```bash
git add skills/memory-ingest/scripts/ingest-runner.test.ts
git commit -m "test(memory-ingest): add compile orchestration red tests"
```

---

### Task 3: Enrich runner output for compile handoff (GREEN)

**Files:**
- Modify: `skills/memory-ingest/scripts/ingest-runner.ts`
- Modify: `skills/memory-ingest/scripts/ingest-runner.test.ts`

- [ ] **Step 1: Extend runner result details to include compile-relevant context**

Target shape should include at least:

```ts
type RunnerResult = {
  status: "ok" | "clarify" | "confirm" | "error";
  kind?: string;
  filesWritten?: string[];
  sourceSummaries?: Array<{
    source: string;
    rawMarkdownPath?: string;
    preservedAssets?: string[];
    kind: string;
  }>;
  question?: string;
  reason?: string;
};
```

- [ ] **Step 2: Populate the new fields for all successful ingest paths**

- [ ] **Step 3: Run the focused runner tests**

Run: `npx tsx --test skills/memory-ingest/scripts/ingest-runner.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit runner handoff changes**

```bash
git add skills/memory-ingest/scripts/ingest-runner.ts skills/memory-ingest/scripts/ingest-runner.test.ts
git commit -m "feat(memory-ingest): return compile handoff details"
```

---

### Task 4: Implement compile-stage orchestration in the packaged skill

**Files:**
- Modify: `skills/memory-ingest/SKILL.md`
- Modify: `skills/memory-ingest/examples.md`

- [ ] **Step 1: Rewrite `SKILL.md` so success requires both raw ingest and compile**

Must state explicitly:
- run ingest runner first
- on `ok`, read the newly written raw artifact(s)
- inspect existing vault notes relevant to the topic
- update/create curated notes under `~/.pi/memories/`
- add backlinks/source references
- only then call `log_operation(type="ingest", status="keep", ...)`

- [ ] **Step 2: Define compile heuristics in the skill**

Rules:
- prefer updating existing topic/concept notes over creating new notes
- create a source-summary note only when there is no obvious destination
- preserve traceability to raw source note
- update indexes only when new note families appear
- avoid whole-vault rewrites during normal ingest

- [ ] **Step 3: Update examples to show both raw and curated outcomes**

Examples should include:
- article → raw markdown + curated concept/source summary note
- PDF → raw conversion + preserved original + curated summary note
- repo/dataset → raw summary + curated summary/update

- [ ] **Step 4: Commit skill contract changes**

```bash
git add skills/memory-ingest/SKILL.md skills/memory-ingest/examples.md
git commit -m "feat(memory-ingest): compile ingests into curated memory"
```

---

### Task 5: Verify curated-memory update behavior end-to-end

**Files:**
- Modify only files touched above if fixes are required

- [ ] **Step 1: Run runner tests**

Run: `npx tsx --test skills/memory-ingest/scripts/ingest-runner.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full memory tests**

Run: `cd memory && npm test`
Expected: PASS.

- [ ] **Step 3: Manual acceptance test with a representative source**

Verify all of:
- raw artifact created in `~/.pi/memories/raw/`
- curated note(s) updated in `~/.pi/memories/`
- backlink/reference to raw source present
- operation logged only after compile work completes

- [ ] **Step 4: Update README to describe the corrected workflow**

Document that `memory-ingest` updates both raw artifacts and curated memory.

- [ ] **Step 5: Commit final verification fixes**

```bash
git add README.md skills/memory-ingest/SKILL.md skills/memory-ingest/examples.md skills/memory-ingest/scripts/ingest-runner.ts skills/memory-ingest/scripts/ingest-runner.test.ts docs/design/2026-04-08-memory-ingest-skill.md docs/plans/2026-04-08-memory-ingest-skill.md
git commit -m "chore(memory-ingest): finalize ingest plus compile workflow"
```

---

## Execution reminders

- Use `test-driven-development` for any behavior change.
- Use `verification-before-completion` before claiming the corrected workflow is complete.
- Do not ship more raw-only behavior under the name `memory-ingest`.
- Prefer updating existing notes over note sprawl during compile.
