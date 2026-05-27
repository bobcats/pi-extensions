# Unify skills, prompt templates, and Pi extensions

## Goal

Make this repository (`pi-extensions`) the single canonical source for Bobcats Pi extensions, Pi prompt templates, shared agent skills, extension-owned skills, and non-Pi skill installs.

The finished system should let:

- Pi load extensions, prompt templates, shared skills, and extension-owned skills from this repo through `package.json` so `pi update` continues to work for Pi-native resources.
- Claude Code, Codex, OpenCode, and other skill-only agents receive flattened installed skills through `make install`.
- Prompt templates remain canonical under `prompts/*.md`, while `make install` generates manual-only prompt-skills for agents that do not support Pi prompt templates.

## Approach

Migrate the current sibling `../skills` repo into this repo without preserving git history. Keep prompt templates as Pi-native source files, preserve the shared skill bucket taxonomy, move extension-owned `memory-ingest` next to the memory extension, and port the safe installer so it builds a flattened install tree from all skill sources plus generated prompt-skills.

## Assumptions

- The current `../skills` working tree, including uncommitted changes and untracked `grill-with-memory` files, is the source to migrate.
- Existing `bobcats-skills` installer state under `$XDG_STATE_HOME` / `~/.local/state` should remain the manifest namespace for global skill installs.
- Generated prompt-skills use Pi's skill frontmatter field `disable-model-invocation: true` and are named `prompt-<template-name>` to avoid collisions with authored skills.
- Pi-native prompt templates remain enabled through `package.json` `pi.prompts`; generated prompt-skills are only build/install artifacts.
- `memory-ingest` is extension-owned and should live at `memory/skills/memory-ingest/`.

## Out of scope

- Preserving `../skills` git history.
- Automatically mutating `~/.agents/skills` or `~/.claude/skills` during `pi update`.
- Redesigning individual skill content beyond path/frontmatter adjustments required by the merge.
- Changing Pi extension behavior except where paths or package manifests require it.

## Risks and mitigations

- **Uncommitted source loss in `../skills`:** copy from the live working tree and create a local migration backup before moving files.
- **Runtime namespace collisions:** fail the build when two authored skills share the same flattened name; generated prompt-skills use `prompt-<template-name>` and still fail if that generated name collides with an authored skill.
- **Pi package drift:** keep root `package.json` as canonical for Pi resources and verify with `pi` package docs assumptions.
- **Installer safety regression:** port the existing installer tests first, then add tests for multiple roots, extension-owned skills, and generated prompt-skills.
- **Prompt/frontmatter parsing bugs:** keep parsing intentionally small and covered by tests for prompt files with and without frontmatter.

## Execution plan

### 1. Preflight and preserve source state

- [x] Read and record the current status and commit identity of both repositories with `git status --short` and `git rev-parse --short HEAD` in `.` and `../skills`; expected signal: this repo has no unexpected working-tree changes beyond the plan file, and `../skills` changes/untracked files are visible with a reproducible source commit noted.
  - Recorded 2026-05-27: `pi-extensions` HEAD `4e20dede` with untracked `docs/plans/`; `../skills` HEAD `d15aacb` with modified prompt/build/test/skill files, deleted `grill-with-docs`, and untracked `skills/deprecated/` plus `skills/engineering/grill-with-memory/`.
- [x] Create a non-git migration backup of the live `../skills` working tree, excluding `.git`, caches, `node_modules`, and `build`, using a path such as `/tmp/bobcats-skills-migration-$(date +%Y%m%d-%H%M%S)`; expected signal: backup contains `skills/`, `prompts/`, `scripts/build.py`, `tests/`, `Makefile`, `README.md`, and `AGENTS.md`.
  - Backup: `/tmp/bobcats-skills-migration-20260527-113133`.
- [x] Inspect `../skills` uncommitted changes before copying (`git -C ../skills diff --stat` and `git -C ../skills ls-files --others --exclude-standard`); expected signal: migration source includes the `grill-with-memory` rename/addition and related test/build changes.

**Commit checkpoint:** no commit yet; this is safety-only preflight.

### 2. Port the build/install foundation into this repo

- [x] Copy `../skills/Makefile`, `../skills/scripts/build.py`, and `../skills/tests/test_build_installer.py` into this repo as `Makefile`, `scripts/build.py`, and `tests/test_build_installer.py`; expected signal: files exist in this repo and still refer to the `bobcats-skills` state namespace.
- [x] Update `.gitignore` to include generated/install artifacts used by the installer (`build/`, Python caches, pytest/unittest caches if needed, eval/local artifacts only if copied docs mention them); expected signal: `git status --short` does not show generated build artifacts after test runs.
- [x] Run `python3 -m unittest discover -s tests`; expected signal: copied installer tests pass before feature changes. Stop and diagnose before continuing if they fail.

**Required skill for execution:** `diagnose` if the copied tests fail unexpectedly.

**Commit checkpoint:** commit as `chore: port skill installer foundation` after this section passes or has a clearly diagnosed expected failure captured in the next section.

### 3. Teach the builder the merged source model

- [x] Refactor `scripts/build.py` to support an explicit list of authored skill roots: shared `skills/` and extension-owned `memory/skills/`; expected signal: a test can build one skill from `skills/engineering/demo/SKILL.md` and one from `memory/skills/memory-ingest/SKILL.md` into `build/skills/demo` and `build/skills/memory-ingest`, while stale `build/skills/` is ignored.
- [x] Preserve deprecated-skill cleanup for the shared `skills/deprecated/` bucket and document that deprecated extension-owned skills are unsupported; expected signal: existing deprecated cleanup test still passes and docs/comments identify `skills/deprecated/` as the only deprecated cleanup source.
- [x] Add duplicate-name detection across all authored skill roots; expected signal: a test with duplicate `SKILL.md` parent names in two roots raises a clear error.
- [x] Add prompt-template discovery from root `prompts/*.md`, excluding `README.md`; expected signal: a test sees `prompts/zoom-out.md` as a prompt template source but ignores non-template docs.
- [x] Add generated prompt-skill output into `build/skills/prompt-<prompt-name>/SKILL.md`; expected signal: generated `SKILL.md` contains `name: prompt-<prompt-name>`, mapped `description`, `disable-model-invocation: true`, generated-source metadata including `source-prompt: <prompt-name>`, preserved prompt-only fields such as `argument-hint` under `metadata`, and the original prompt body.
- [x] Make prompt-skill generation fail on collisions with authored skills using the generated `prompt-<prompt-name>` name or another prompt template producing the same generated name; expected signal: collision tests fail with a clear duplicate-name message.
- [x] Add a real-tree collision precheck fixture covering the known `prompts/code-review.md` and migrated `skills/review/code-review/SKILL.md` case; expected signal: build succeeds because the generated prompt-skill is named `prompt-code-review`, not `code-review`.
- [x] Define prompt-template variable semantics in the generated skill wrapper; expected signal: generated skill text explains that template variables such as `$ARGUMENTS`, `$@`, or `$1` refer to the user input supplied with the manual skill invocation.
- [x] Keep generated prompt-skills as build artifacts only; expected signal: no generated prompt-skill files are written under source `skills/` or `memory/skills/`.
- [x] Add an installer-level test that patches `INSTALL_PATHS` to temporary `~/.agents/skills` and `~/.claude/skills` destinations, runs the normal `build_skills()` + `install_skills()` flow, and proves generated prompt-skills are installed to both targets; expected signal: both temp install roots contain the `prompt-<name>` skill with `disable-model-invocation: true`.
- [x] Run `python3 -m unittest discover -s tests`; expected signal: all installer/build tests pass.

**Required skill for execution:** `tdd` for the new builder behavior tests.

**Commit checkpoint:** commit as `feat: build merged skill and prompt install tree`.

### 4. Move extension-owned `memory-ingest`

- [x] Move `skills/memory-ingest/` to `memory/skills/memory-ingest/`; expected signal: `memory/skills/memory-ingest/SKILL.md`, `examples.md`, and `scripts/` exist, and old `skills/memory-ingest/` is gone.
- [x] Update `memory/skills/memory-ingest/SKILL.md` command examples from the old `skills/memory-ingest/scripts/...` source path to installed-skill-safe `scripts/ingest-runner.ts` references resolved relative to the skill directory; expected signal: commands in the skill point at existing files in both source and flattened installs.
- [x] Update any tests or references that hard-code `skills/memory-ingest`; expected signal: `rg "skills/memory-ingest"` returns only intentional historical references, if any.
- [x] Run `npx tsx --test --test-timeout=5000 memory/skills/memory-ingest/scripts/*.test.ts`; expected signal: memory-ingest script contract tests pass from the new location.
- [x] Run `python3 -m unittest discover -s tests`; expected signal: builder tests still discover extension-owned `memory-ingest` correctly.

**Required skill for execution:** `diagnose` if TypeScript tests fail due to path assumptions.

**Commit checkpoint:** commit as `refactor: colocate memory ingest skill with memory extension`.

### 5. Migrate shared skills and prompt templates from `../skills`

- [x] Copy shared skill buckets from the live `../skills/skills/` working tree into this repo's `skills/`, preserving `engineering`, `design`, `review`, `tools`, `languages`, `prototyping`, `productivity`, and `deprecated`; expected signal: `find skills -path '*/SKILL.md'` shows the migrated shared skills and no top-level `skills/memory-ingest`.
- [x] Copy prompt templates from the live `../skills/prompts/*.md` into this repo's `prompts/`; expected signal: existing Pi prompt templates remain, new templates such as `branch-quiz.md`, `caveman.md`, `grill-me.md`, and `zoom-out.md` exist, and no filename collisions occurred.
- [x] Copy and adapt `../skills/prompts/README.md` into this repo as `prompts/README.md`; expected signal: prompt authoring rules explain Pi-native prompts plus generated `prompt-<name>` prompt-skills, including that `disable-model-invocation` is honored only by agents that support that field.
- [x] Integrate `../skills/AGENTS.md` guidance into this repo's `AGENTS.md`, adjusting it for the merged repo structure and avoiding stale references to `../skills`; expected signal: agents editing this repo have guidance for extensions, skills, prompts, and installer safety.
- [x] Update root `README.md` to describe the singular system: extensions, Pi prompt templates, shared skills, extension-owned skills, `pi install`/`pi update`, and `make install` for non-Pi skill surfaces; expected signal: install/development docs match the resolved architecture.
- [x] Run `python3 scripts/build.py build`; expected signal: `build/skills/` contains migrated shared skills, `memory-ingest`, and generated prompt-skills with `prompt-` prefixes.
- [x] Run `python3 -m unittest discover -s tests`; expected signal: installer/build tests pass with the real migrated tree.

**Required skill for execution:** `write-docs` for README/AGENTS integration if the docs become large.

**Commit checkpoint:** commit as `feat: migrate shared skills and prompt templates`.

### 6. Update Pi package manifest and package docs

- [x] Update root `package.json` `pi.skills` to include authored skill roots required by Pi, with active shared skills under `skills`, deprecated exclusions, and extension-owned skills under `memory/skills`; expected signal: package manifest points Pi at shared and extension-owned skills while excluding `skills/deprecated`.
- [x] Validate this manifest shape before migrating all skills by running the package JSON parse command and checking the `pi.skills` array manually; expected signal: final Pi-native discovery roots are correct early, before full migration verification.
- [x] Keep `package.json` `pi.prompts` pointing at prompt templates while excluding `prompts/README.md`; expected signal: Pi-native slash-command templates remain source-native and are not replaced by generated skills.
- [x] Confirm `package-lock.json` remains unchanged because the builder uses only the Python standard library; expected signal: `git diff -- package-lock.json` is empty.
- [x] Run `node -e 'JSON.parse(require("fs").readFileSync("package.json", "utf8")); JSON.parse(require("fs").readFileSync("package-lock.json", "utf8"))'`; expected signal: package JSON files parse successfully.
- [x] Run `python3 scripts/build.py build`; expected signal: build still succeeds after manifest/doc changes.

**Commit checkpoint:** commit as `chore: expose merged skills in pi package manifest`.

### 7. Verify installs without mutating real global state

- [x] Add or update tests that run `safe_install_targets` against temporary destinations for both install targets; expected signal: unmanaged sibling files are preserved, stale managed files are removed, and generated prompt-skills are included in the manifest.
- [x] Add or update a full installer-flow test that invokes `install_skills()` with mocked `INSTALL_PATHS`, `MANIFEST_PATH`, `STATE_DIR`, and `LOCK_PATH`; expected signal: the same flattened tree produced by `make build` is what gets installed to both temp skill roots, including generated prompt-skills and extension-owned skills.
- [x] Run `python3 -m unittest discover -s tests`; expected signal: all Python installer tests pass.
- [x] Run `make build`; expected signal: flattened build completes and prints the expected skill count.
- [x] Inspect `build/skills/prompt-zoom-out/SKILL.md` and one existing prompt-derived skill such as `build/skills/prompt-code-review/SKILL.md`; expected signal: `disable-model-invocation: true`, `source-prompt`, and generated metadata are present.
- [x] Inspect `build/skills/memory-ingest/SKILL.md`; expected signal: extension-owned skill appears in flattened output.
- [x] Do not run real `make install` until review unless the user explicitly approves mutation of `~/.agents/skills` and `~/.claude/skills`; expected signal: plan execution proves the real install code path through mocked temporary install-flow tests without changing real agent installs.

**Required skill for execution:** `verify` before claiming the merge is complete.

**Commit checkpoint:** commit as `test: verify merged skill installer behavior`.

### 8. Final review and cleanup

- [x] Run `git status --short`; expected signal: only intentional source changes remain, with no `build/`, caches, or backup files staged.
- [x] Run `rg "../skills|dotagents|skills/memory-ingest|grill-with-docs" README.md AGENTS.md package.json scripts tests skills prompts memory/skills`; expected signal: matches are either intentionally historical/deprecated or updated to the merged repo terminology.
- [x] Run `npx tsx --test --test-timeout=5000 memory/*.test.ts`; expected signal: memory extension tests pass after the skill move.
- [x] Run `slop_scan .` because this is a JavaScript/TypeScript repository and paths/docs changed around extension code; expected signal: no actionable high-confidence findings introduced by the merge.
- [x] Request a focused code review of the final diff; expected signal: reviewer finds no blocking issues, or feedback is triaged with `respond-to-review`.
- [x] Produce a final verification summary listing commands run, generated artifacts inspected, and any real install command intentionally skipped.

**Required skills for execution:** `code-review`, `respond-to-review`, and `verify`.

**Commit checkpoint:** commit as `chore: finalize unified agent system` if cleanup changes remain after review.

## Success criteria

- Root `package.json` lets Pi discover extensions, Pi prompt templates, shared skills, and extension-owned skills from this repo.
- `make build` creates a flattened `build/skills/` tree containing:
  - shared authored skills from bucketed `skills/`,
  - extension-owned `memory-ingest`,
  - generated manual-only prompt-skills from `prompts/*.md`.
- Generated prompt-skills use `prompt-<template-name>` names, include `disable-model-invocation: true`, and preserve useful prompt frontmatter metadata. Documentation notes that manual-only behavior depends on the consuming agent honoring that frontmatter.
- Installer tests prove safe install behavior without mutating real global skill directories.
- README/AGENTS docs describe the merged source and install model.
- No stale canonical-source references remain to `../skills` or `dotagents` for general-purpose skills.

## Deferred ideas

- Add a `make install-dry-run` command if repeated real install review becomes cumbersome.
- Add a generated build manifest under `build/` to summarize authored vs generated skill sources.
- Consider a future Pi package enhancement that can expose generated prompt-skills only to non-Pi harnesses, if Pi ever distinguishes those install targets.
