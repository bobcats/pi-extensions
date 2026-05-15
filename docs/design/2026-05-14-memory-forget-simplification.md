# Memory Forget Simplification Pass

## Status

Approved for spec review.

## Context

The recent `/memory forget <topic>` work added a prompt builder, operation type support, command handling, and focused tests. The feature is passing, but the new code can be reviewed once for clarity while the context is fresh.

This is a simplification pass, not a behavior change. It should preserve current functionality and only refine how the recently added forget code is organized and tested.

## Goals

- Simplify only the recently added `/memory forget` implementation and tests.
- Improve readability by reducing inline detail in the command branch.
- Remove avoidable test repetition with small helpers where that makes test intent clearer.
- Add narrow coverage if a simplification exposes a useful boundary.
- Keep behavior, command UX, prompt semantics, QMD fallback behavior, operation logging, and safety text unchanged.

## Non-goals

- No general `/memory` command-handler refactor.
- No broad memory extension cleanup.
- No changes to existing slop-scan findings outside touched forget code.
- No prompt rewrites beyond clarity-preserving local wording if tests continue to enforce the safety contract.
- No changes to secure-erase semantics, brain deletion, project mappings, or raw-file handling.

## Scope

Allowed files and regions:

- `memory/index.ts`
  - The forget command branch.
  - Direct helper code needed by that branch.
  - Direct imports/types needed by that helper.
- `memory/prompts.ts`
  - `ForgetPromptCandidate`.
  - `formatForgetCandidates`.
  - `buildForgetPrompt`.
- `memory/index.test.ts`
  - Forget-related tests.
  - Small shared helpers used by those tests if they reduce setup noise without hiding assertions.
- `memory/prompts.test.ts`
  - Forget prompt tests and any narrow candidate-formatting edge coverage.

Everything else should be treated as out of scope unless required to keep tests compiling.

## Implementation design

### Command handler simplification

Keep the existing `/memory` command structure. Do not split the whole command into subcommand modules or handlers.

Within the forget path, reduce inline detail by extracting a small helper near the command handler. A suitable shape is:

```ts
const searchForgetCandidates = async (brain: ActiveBrain, topic: string): Promise<ForgetPromptCandidate[]> => { ... }
```

The helper should preserve current behavior:

- If QMD is unavailable, return `[]`.
- If QMD is available, use `qmd.collectionNameForBrain(brain.name)`.
- Search the collection with the same topic and limit.
- Convert result files through `qmd.toVaultPath(brain.vaultDir, result.file, collection)`.
- Preserve title, score, and snippet.
- Do not add new error handling around `qmd.search`; keep the existing wrapper behavior.

After extraction, the forget branch should read as a short sequence:

1. Parse topic.
2. Show usage and return if topic is missing.
3. Load candidates.
4. Notify the user.
5. Send `buildForgetPrompt(brain.vaultDir, topic, candidates)`.

### Prompt helper simplification

Keep `formatForgetCandidates` separate from `buildForgetPrompt` because candidate rendering is a focused unit with direct tests.

Possible clarity refinements:

- Rename local `score` to `scorePercent`.
- Keep the candidate object name explicit.
- Preserve the existing blank-snippet behavior: whitespace-only snippets should not render a `Snippet:` line.
- Avoid clever rewrites. The current array/filter/join structure is acceptable if it remains the clearest option.

Do not alter required prompt safety text unless the existing tests continue to prove:

- The raw source boundary remains a hard no-edit rule.
- The prompt states this is not a secure erase.
- The prompt instructs `log_operation(type="forget", ...)`.

## Test design

### Test helper extraction

In `memory/index.test.ts`, extract only small helpers that make forget tests easier to read. Good candidates:

- A helper that loads the memory extension into a harness and returns the memory command.
- A helper that creates an initialized test vault for the forget prompt dispatch test.

Keep assertions in the test bodies. Helpers should prepare fixtures, not hide test expectations.

### Coverage additions

Because broader edge coverage was approved, add only narrow tests tied to simplification boundaries:

- Prefer a prompt-builder test that verifies a blank or whitespace-only candidate snippet does not render a `Snippet:` line.
- Add a command-level QMD candidate-seeding test only if it can be done cleanly without brittle global mocking or dependency surgery.

Do not add broad parser coverage for unrelated `/memory` subcommands.

## Safety and behavior constraints

The simplification must not change observable behavior:

- `/memory forget` without a topic still shows `Usage: /memory forget <topic>` and does not send a prompt.
- `/memory forget <topic>` still sends exactly one user message with a forget prompt.
- QMD-unavailable environments still proceed with an empty candidate list.
- `log_operation(type="forget")` remains accepted.
- The command still targets the active brain only.
- Candidate files remain hints, not deletion targets.

## Verification

Run targeted tests after the simplification:

```bash
cd memory && npx tsx --test --test-timeout=5000 index.test.ts prompts.test.ts
```

Run the full memory extension test suite:

```bash
cd memory && npx tsx --test --test-timeout=5000 *.test.ts
```

Run slop scan on the memory extension:

```bash
slop-scan memory
```

Treat findings as leads. Only fix findings in touched forget code; do not broaden the cleanup.

Finally inspect the diff to confirm the pass stayed in scope.
