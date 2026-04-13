# Memory Brains Implementation Plan

> REQUIRED: Use the `executing-plans` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add globally configured named brains so the memory extension resolves each project to one isolated vault, defaulting to `main`.

**Architecture:** Introduce a small global-config module at `~/.pi/memory-config.json` that defines brains and project mappings, then thread a resolved `activeBrain` object through the memory extension instead of hard-coding `~/.pi/memories`. Keep the current vault as `main`, add `/memory brain ...` management commands, and make every memory-facing path, git action, dashboard readout, and QMD action use the resolved brain only.

**Tech Stack:** TypeScript, Node.js filesystem/path APIs, Pi extension APIs, node:test, existing memory extension modules

---

## File map

### New files

- `memory/config.ts` — global brain config types, defaults, path expansion, load/save helpers, active-brain resolution
- `memory/config.test.ts` — tests for config bootstrap, validation, and project mapping resolution

### Modified files

- `memory/index.ts` — replace hard-coded vault path usage with resolved brain state; add `/memory brain ...` commands and brain-aware status text
- `memory/lib.ts` — keep vault helpers path-parameterized; add any tiny helpers needed by config/init flows only if they truly belong here
- `memory/qmd.ts` — support per-brain collection names instead of one global `memory` collection
- `memory/dashboard.ts` — optionally render active brain metadata in widget/overlay summaries if needed
- `memory/types.ts` — add shared brain/config types if they are used across modules
- `memory/index.test.ts` — extend harness tests to cover brain resolution and command behavior
- `memory/qmd.test.ts` — verify per-brain collection naming and path conversion still work
- `README.md` — document brain config and command usage if memory extension commands are documented there

### Existing files to inspect while implementing

- `memory/git.ts` — confirm all git helpers already accept a vault path and need no behavior change
- `memory/session.ts` — ensure ruminate prompts receive the resolved vault path, not the old constant
- `docs/design/2026-04-13-memory-brains.md` — implementation spec for this plan

## Task 1: Add global brain config and active-brain resolution

**Files:**
- Create: `memory/config.ts`
- Test: `memory/config.test.ts`
- Modify: `memory/types.ts`

- [x] **Step 1: Write failing config tests for the default `main` brain bootstrap**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { loadMemoryConfig } from "./config.ts";

test("loadMemoryConfig returns implicit main brain config when file is absent", () => {
  const homeDir = "/tmp/home";
  const config = loadMemoryConfig(homeDir);

  assert.equal(config.defaultBrain, "main");
  assert.equal(config.brains.main.path, path.join(homeDir, ".pi", "memories"));
});
```

- [x] **Step 2: Run the new config test to verify it fails**

Run: `cd memory && npm test -- config.test.ts`
Expected: FAIL because `config.ts` and `loadMemoryConfig` do not exist yet.

- [x] **Step 3: Implement config types and helpers in `memory/config.ts`**

```ts
export interface MemoryBrainConfig {
  defaultBrain: string;
  brains: Record<string, { path: string }>;
  projectMappings: Array<{ projectPath: string; brain: string }>;
}

export interface ActiveBrain {
  name: string;
  vaultDir: string;
  source: "mapped" | "default";
}

export function loadMemoryConfig(homeDir: string): MemoryBrainConfig { /* ... */ }
export function saveMemoryConfig(homeDir: string, config: MemoryBrainConfig): void { /* ... */ }
export function resolveActiveBrain(config: MemoryBrainConfig, projectPath: string): ActiveBrain { /* ... */ }
```

Implementation requirements:
- config file lives under `~/.pi/` and is JSON
- missing file returns an in-memory default with `main -> ~/.pi/memories`
- save writes a stable, pretty-printed file
- project paths are normalized before matching
- exact path match is enough for v1; do not add fuzzy heuristics
- reject unknown brain mappings when saving or resolving

- [x] **Step 4: Add mapping and validation tests before finishing the module**

Include tests for:
- explicit project mapping wins over default
- unknown mapped brain throws a useful error
- additional brains can point at `~/.pi/memory-brains/<name>`
- save/load round-trips JSON without dropping mappings

- [x] **Step 5: Run the focused config test file and make it pass**

Run: `cd memory && npm test -- config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the config foundation**

```bash
git add memory/config.ts memory/config.test.ts memory/types.ts docs/design/2026-04-13-memory-brains.md docs/plans/2026-04-13-memory-brains.md
git commit -m "feat: add memory brain config resolution"
```

## Task 2: Make the extension brain-aware instead of using one hard-coded vault

**Files:**
- Modify: `memory/index.ts`
- Modify: `memory/dashboard.ts`
- Modify: `memory/types.ts`
- Test: `memory/index.test.ts`

- [ ] **Step 1: Write failing extension tests for active-brain selection**

Add tests that:
- create a fake home dir with config mapping `/tmp/project` to `poe`
- initialize the extension harness with `ctx.cwd = "/tmp/project"`
- assert `/memory` status output and prompt injection mention the `poe` vault path, not `~/.pi/memories`

Suggested assertion shape:

```ts
assert.match(notification.message, /Brain: poe/);
assert.match(notification.message, /memory-brains\/poe/);
```

- [ ] **Step 2: Run the targeted extension tests to verify they fail**

Run: `cd memory && npm test -- index.test.ts`
Expected: FAIL because `index.ts` still uses the `VAULT_DIR` constant everywhere.

- [ ] **Step 3: Replace the global `VAULT_DIR`/`OPERATIONS_PATH` constants with resolved brain state**

Refactor `memory/index.ts` so one helper computes the current brain from `ctx.cwd` and cached global config:

```ts
function getActiveBrain(ctx: ExtensionContext): ActiveBrain {
  const config = loadMemoryConfig(os.homedir());
  return resolveActiveBrain(config, ctx.cwd);
}
```

Then thread `activeBrain.vaultDir` and `activeBrain.name` through:
- `reconstructState`
- widget rendering
- dream auto-resume
- `before_agent_start`
- `startReflect`
- `/memory init|reflect|ruminate|dream|search|undo|log`
- `request_reflect`, `search_memory`, `log_operation`

Use one small local accessor instead of repeatedly re-reading ad hoc paths.

- [ ] **Step 4: Update dashboard/status text so the active brain is visible**

Add `Brain: <name>` to status output and show the brain in the collapsed or expanded widget summary if it fits cleanly. Keep it terse; no wall of metadata.

- [ ] **Step 5: Ensure brain changes are recomputed on session lifecycle events**

When handling `session_start`, `session_switch`, `session_fork`, `session_tree`, and `before_agent_start`, rebuild state from the resolved brain for the current `ctx.cwd` so a project switch cannot keep stale history from another brain.

- [ ] **Step 6: Run the focused extension tests and make them pass**

Run: `cd memory && npm test -- index.test.ts`
Expected: PASS

- [ ] **Step 7: Commit the brain-aware extension refactor**

```bash
git add memory/index.ts memory/dashboard.ts memory/types.ts memory/index.test.ts
git commit -m "feat: resolve memory vaults by brain"
```

## Task 3: Add `/memory brain ...` management commands

**Files:**
- Modify: `memory/index.ts`
- Modify: `memory/index.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing command tests for brain management**

Cover these command flows:
- `/memory brain list` shows known brains and marks the active one
- `/memory brain which` shows the active brain for the current project
- `/memory brain create poe` adds config entry and initializes the new vault directory
- `/memory brain map /tmp/project poe` updates the global config
- `/memory brain unmap /tmp/project` removes the mapping
- `/memory brain remove poe` refuses removal when mappings still exist, then succeeds after unmapping

Example expectations:

```ts
assert.match(message, /main/);
assert.match(message, /poe/);
assert.match(message, /active/);
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `cd memory && npm test -- index.test.ts`
Expected: FAIL because the `brain` subcommands do not exist yet.

- [ ] **Step 3: Add `brain` autocomplete entries and command parsing**

Implement these required subcommands only:
- `brain list`
- `brain add <name> [path]`
- `brain remove <name>`
- `brain create <name>`
- `brain map <project-path> <brain>`
- `brain unmap <project-path>`
- `brain which`

Behavior rules:
- `main` cannot be removed
- `create <name>` uses `~/.pi/memory-brains/<name>` and runs normal vault init + git init for that brain
- `add <name> [path]` registers a brain without initializing content if the caller wants a custom path
- remove should fail if any project mapping still points at that brain
- remove only deletes config state in v1; it does not delete on-disk vault contents
- success messages should always include the brain name and path or project path that changed

- [ ] **Step 4: Document the commands and config file shape**

Update `README.md` with one short section showing:
- default `main` behavior
- where the config file lives
- example `/memory brain create poe`
- example `/memory brain map /Users/brian/code/poe poe`

- [ ] **Step 5: Run the updated command tests and make them pass**

Run: `cd memory && npm test -- index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the brain command surface**

```bash
git add memory/index.ts memory/index.test.ts README.md
git commit -m "feat: add memory brain management commands"
```

## Task 4: Isolate QMD and operations history per brain

**Files:**
- Modify: `memory/qmd.ts`
- Modify: `memory/qmd.test.ts`
- Modify: `memory/index.ts`
- Test: `memory/index.test.ts`

- [ ] **Step 1: Write failing QMD tests for per-brain collection naming**

Add tests for a helper like:

```ts
assert.equal(collectionNameForBrain("main"), "memory");
assert.equal(collectionNameForBrain("poe"), "memory-poe");
```

Also verify `toVaultPath` still resolves paths correctly when a collection name is provided.

- [ ] **Step 2: Run the QMD test file to verify it fails**

Run: `cd memory && npm test -- qmd.test.ts`
Expected: FAIL because QMD is still hard-coded to the `memory` collection.

- [ ] **Step 3: Make QMD helpers accept a brain/collection argument**

Refactor signatures to be explicit:

```ts
export function buildSearchArgs(collection: string, query: string, options?: { limit?: number }): string[];
export function search(collection: string, query: string, options?: { limit?: number }): Promise<QmdSearchResult[]>;
export function update(collection: string): Promise<void>;
export function embed(collection: string): Promise<void>;
export function ensureCollection(collection: string, vaultDir: string): Promise<boolean>;
```

Use `memory` for `main` to preserve backward compatibility. Use deterministic names for other brains, such as `memory-<brain>`.

- [ ] **Step 4: Make operation history and git actions stay inside the active brain only**

Verify `log_operation` writes to `<activeBrain.vaultDir>/memory-operations.jsonl` and all `undo`, `log`, and `getChangedFiles` calls use that same vault path. Add or extend tests if any of these still accidentally hit the old default path.

- [ ] **Step 5: Run the focused QMD and extension tests and make them pass**

Run: `cd memory && npm test -- qmd.test.ts index.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the per-brain isolation work**

```bash
git add memory/qmd.ts memory/qmd.test.ts memory/index.ts memory/index.test.ts
git commit -m "feat: isolate memory indexing and history by brain"
```

## Task 5: Full verification and cleanup

**Files:**
- Modify: any files from prior tasks if verification finds gaps
- Test: `memory/*.test.ts`

- [ ] **Step 1: Run the full memory extension test suite**

Run: `cd memory && npm test`
Expected: PASS across all existing and new tests.

- [ ] **Step 2: Manually smoke-test the expected CLI flow in a temp home directory**

Run commands equivalent to:

```bash
HOME="$(mktemp -d)" USERPROFILE="$HOME" node -e "console.log(process.env.HOME)"
```

Then in a Pi session or harness-backed script, verify this sequence:
- `/memory init`
- `/memory brain create poe`
- `/memory brain map <project> poe`
- `/memory brain which`
- `/memory` status

Expected:
- `main` remains at `~/.pi/memories`
- `poe` uses `~/.pi/memory-brains/poe`
- mapped project reports `poe` as active
- unmapped project reports `main`
- `request_reflect` follow-up prompts use the mapped brain's vault path
- `search_memory` reads only from the mapped brain's QMD collection
- `log_operation` appends only to the mapped brain's `memory-operations.jsonl`

- [ ] **Step 3: Remove any dead constants or helper assumptions left from single-vault mode**

Clean up leftover `VAULT_DIR` assumptions, duplicated path joins, and any status text that still implies there is only one vault.

- [ ] **Step 4: Re-run the full test suite after cleanup**

Run: `cd memory && npm test`
Expected: PASS

- [ ] **Step 5: Commit the verified final state**

```bash
git add memory README.md
git commit -m "refactor: finalize memory brain isolation"
```

## Deferred ideas

- Cross-brain search flags such as `/memory search --all ...`
- Prefix or longest-parent project mapping resolution if exact matches prove too strict
- Temporary session-only brain overrides
- Brain import/export or clone helpers
