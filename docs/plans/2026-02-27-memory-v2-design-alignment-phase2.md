# Memory v2 Design Alignment (Phase 2) Implementation Plan

> REQUIRED SUB-SKILL: Use superpowers:executing-plans skill to implement this plan task-by-task.

**Goal:** Close all remaining design gaps: strict prompt parity (Claude→pi only), parallel ruminate miners, meditate apply workflow handoff, and structured ruminate synthesis output.

**Architecture:** Keep subagent execution in `pi --mode json` from extension runtime, but strengthen orchestration and reporting. Treat brainmaxxing prompt text as source-of-truth and mirror it in our memory prompts/agent definitions with only platform substitutions (Claude/brain/.claude → pi/memory vault/.pi where required).

**Tech Stack:** TypeScript, pi ExtensionAPI, `pi --mode json` subprocess runner (`child_process.spawn`), node:fs/path/os, tsx tests.

---

## Pre-Execution Handoff Notes

1. **Prompt parity is now a hard requirement (no "close enough")**
   - Prompts/agent definitions must match brainmaxxing text exactly, except explicit Claude→pi substitutions.
   - Do not reword for style. Let tests enforce this.

2. **Design doc is source-of-truth for behavior**
   - Resolve any ambiguity by preferring architecture constraints in `docs/design/2026-02-27-memory-v2.md`.
   - In particular: subagent workflows must stay on direct `pi --mode json` subprocess execution.

3. **Reviewer/miner Sonnet model pin**
   - Use `claude-sonnet-4-6` for Sonnet-based agents.
   - Keep auditor on `claude-haiku-4-5` unless explicitly changed.

4. **Do not regress completed v2 foundations**
   - Keep index-only injection, line limits, init/migrate behavior, and index auto-rebuild intact while aligning phase 2.

5. **Verification discipline per task**
   - Run targeted tests first (expected fail/pass cycle), then full `cd memory && npm test` before each task commit.

6. **Commit scope discipline**
   - One commit per task in this plan. Do not batch across tasks.

---

## Task 1: Enforce exact prompt parity baseline (text-level)

**Files:**
- Modify: `memory/prompts.ts`
- Modify: `memory/agents/auditor.md`
- Modify: `memory/agents/reviewer.md`
- Modify: `memory/agents/miner.md`
- Create: `memory/prompt-parity.test.ts`

### Step 1: Build source snippets from brainmaxxing

Read and extract exact source text from:
- `/tmp/brainmaxxing/.agents/skills/reflect/SKILL.md`
- `/tmp/brainmaxxing/.agents/skills/meditate/SKILL.md`
- `/tmp/brainmaxxing/.agents/skills/ruminate/SKILL.md`
- `/tmp/brainmaxxing/.agents/skills/meditate/references/agents.md`

### Step 2: Define allowed substitutions list in test

Create explicit substitution map in `memory/prompt-parity.test.ts`:
- `Claude` → `pi agent` (or `pi` when grammatical)
- `brain/` → memory vault paths
- `brain/index.md` / `brain/principles.md` → `${globalDir}/index.md` and `${projectDir}/index.md` forms
- `~/.claude/...` → `~/.pi/...`

### Step 3: Write failing parity test for reflect prompt

In `memory/prompt-parity.test.ts`, compare `buildReflectPrompt(...)` against expected transformed source string.

### Step 4: Run test to verify failure

Run: `cd memory && npx tsx --test prompt-parity.test.ts`
Expected: FAIL with diff.

### Step 5: Update `buildReflectPrompt` to exact transformed text

Modify `memory/prompts.ts` to match transformed source exactly.

### Step 6: Re-run parity test

Run: `cd memory && npx tsx --test prompt-parity.test.ts`
Expected: reflect parity PASS.

### Step 7: Add failing parity tests for meditate + ruminate + agent files

Add tests asserting exact transformed text for:
- `buildMeditatePrompt`
- `buildRuminatePrompt`
- `memory/agents/auditor.md`
- `memory/agents/reviewer.md`
- `memory/agents/miner.md`

### Step 8: Run tests to verify failure

Run: `cd memory && npx tsx --test prompt-parity.test.ts`
Expected: FAIL.

### Step 9: Update prompt/agent files to pass exact parity tests

Apply only allowed substitutions. No structural rewrites beyond substitution requirements.

### Step 10: Run parity test again

Run: `cd memory && npx tsx --test prompt-parity.test.ts`
Expected: PASS.

### Step 11: Add parity test file to package test script

Modify `memory/package.json` test script to include `prompt-parity.test.ts`.

### Step 12: Run full suite

Run: `cd memory && npm test`
Expected: all PASS.

### Step 13: Commit

```bash
git add memory/prompts.ts memory/agents/auditor.md memory/agents/reviewer.md memory/agents/miner.md memory/prompt-parity.test.ts memory/package.json
git commit -m "test(memory): enforce exact prompt parity with brainmaxxing (pi-adapted substitutions only)"
```

---

## Task 2: Implement parallel miner execution for `/memory ruminate`

**Files:**
- Modify: `memory/index.ts`
- Modify: `memory/subagent.ts` (only if helper is needed)
- Modify: `memory/index.test.ts`

### Step 1: Write failing test for parallel miner dispatch count

Add an `index.test.ts` test that:
- injects multiple conversation batches
- stubs `runSubagent` with timing markers
- asserts miners are launched before first completes (parallel behavior)

### Step 2: Run targeted tests to fail

Run: `cd memory && npx tsx --test index.test.ts`
Expected: FAIL.

### Step 3: Implement Promise.all miner fan-out

In `memory/index.ts`, change ruminate batch loop from sequential `await` to:
- map batches to async miner tasks
- `await Promise.all(tasks)`
- preserve deterministic ordering for final display by sorting by batch index

### Step 4: Re-run targeted tests

Run: `cd memory && npx tsx --test index.test.ts`
Expected: PASS.

### Step 5: Run full suite

Run: `cd memory && npm test`
Expected: all PASS.

### Step 6: Commit

```bash
git add memory/index.ts memory/index.test.ts memory/subagent.ts
git commit -m "feat(memory): run ruminate miner batches in parallel"
```

---

## Task 3: Add structured ruminate synthesis table output

**Files:**
- Modify: `memory/index.ts`
- Create: `memory/ruminate.ts`
- Create: `memory/ruminate.test.ts`
- Modify: `memory/package.json`

### Step 1: Write failing tests for synthesis formatting

Create `memory/ruminate.test.ts` with tests for:
- dedupe identical findings across batches
- frequency counting
- output rows with columns: finding, frequency/evidence, proposed action

### Step 2: Run targeted test to fail

Run: `cd memory && npx tsx --test ruminate.test.ts`
Expected: FAIL (module missing).

### Step 3: Implement minimal synthesis helpers

In `memory/ruminate.ts`, add:
- parser to extract bullet findings from miner markdown
- frequency aggregator
- `formatSynthesisTable(...)` returning markdown table

### Step 4: Wire helper into `/memory ruminate`

Update `memory/index.ts` to use synthesis helper for final summary.

### Step 5: Re-run targeted tests

Run: `cd memory && npx tsx --test ruminate.test.ts`
Expected: PASS.

### Step 6: Add test script inclusion and run full suite

Modify package script and run:
- `cd memory && npm test`
Expected: all PASS.

### Step 7: Commit

```bash
git add memory/ruminate.ts memory/ruminate.test.ts memory/index.ts memory/package.json
git commit -m "feat(memory): add structured ruminate synthesis table with dedupe and frequency"
```

---

## Task 4: Add meditate apply-workflow handoff prompt (post-report)

**Files:**
- Modify: `memory/prompts.ts`
- Modify: `memory/index.ts`
- Modify: `memory/index.test.ts`

### Step 1: Write failing test for post-meditate apply handoff

Add test asserting after successful meditate run:
- extension sends a follow-up apply prompt that includes auditor/reviewer summaries and explicit apply steps

### Step 2: Run targeted test to fail

Run: `cd memory && npx tsx --test index.test.ts`
Expected: FAIL.

### Step 3: Implement `buildMeditateApplyPrompt(...)`

In `memory/prompts.ts`, add template instructing main agent to:
- read generated reports
- propose concrete edits
- apply approved updates to vault files/indexes

### Step 4: Wire into meditate completion flow

In `memory/index.ts`, after report synthesis, send follow-up message with apply prompt and references to report text.

### Step 5: Re-run targeted tests

Run: `cd memory && npx tsx --test index.test.ts`
Expected: PASS.

### Step 6: Run full suite

Run: `cd memory && npm test`
Expected: all PASS.

### Step 7: Commit

```bash
git add memory/prompts.ts memory/index.ts memory/index.test.ts
git commit -m "feat(memory): add meditate apply-workflow handoff prompt after subagent reports"
```

---

## Task 5: Add explicit session path encoding verification test

**Files:**
- Modify: `memory/subagent.ts` (extract encoder helper if needed)
- Modify: `memory/subagent.test.ts`

### Step 1: Write failing encoding test

Add test for:
- cwd `/Users/a/b/project`
- expected encoded directory `--Users--a--b--project--`

### Step 2: Run targeted tests to fail

Run: `cd memory && npx tsx --test subagent.test.ts`
Expected: FAIL (helper missing / mismatch).

### Step 3: Implement encoder helper

Add `encodeProjectSessionPath(cwd: string): string` and reuse in ruminate flow.

### Step 4: Re-run targeted tests

Run: `cd memory && npx tsx --test subagent.test.ts`
Expected: PASS.

### Step 5: Run full suite

Run: `cd memory && npm test`
Expected: all PASS.

### Step 6: Commit

```bash
git add memory/subagent.ts memory/subagent.test.ts memory/index.ts
git commit -m "test(memory): verify project session directory encoding for ruminate"
```

---

## Task 6: Final docs and design parity check

**Files:**
- Modify: `memory/README.md`
- Modify: `docs/design/2026-02-27-memory-v2.md` (if implementation details changed)

### Step 1: Update README behavior notes

Document:
- prompt parity policy
- parallel ruminate miners
- structured synthesis table
- meditate apply handoff

### Step 2: Verify design doc alignment notes

Adjust any sections that are now fully aligned or intentionally different.

### Step 3: Run final suite

Run: `cd memory && npm test`
Expected: all PASS.

### Step 4: Commit

```bash
git add memory/README.md docs/design/2026-02-27-memory-v2.md
git commit -m "docs(memory): document phase 2 alignment and final design parity"
```
