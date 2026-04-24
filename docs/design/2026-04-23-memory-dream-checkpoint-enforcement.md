# Memory Dream Checkpoint Enforcement Design

Date: 2026-04-23
Status: Approved in chat; pending spec review and user review
Scope: Make `memory` dream mode follow a stricter autonomous loop by enforcing dream checkpoints at the `log_operation` tool boundary instead of relying on prompt obedience.

## 1) Context

`memory` dream mode currently has named phases and good qualitative guidance, but most of that discipline lives only in the prompt. In practice that means the model can drift:
- linger in low-value exploration
- log vague noop cycles
- resume without a strong sense of where the last cycle left off
- treat phases as advice instead of as part of the loop contract

`pi-autoresearch` behaves better for a simple reason: its loop is structured at the tool boundary. The agent must pass through `run_experiment` and `log_experiment`, and the session ledger (`autoresearch.jsonl`) persists structured checkpoints that later turns can reconstruct.

This design applies that lesson to dream mode without overbuilding a second harness.

## 2) Goals and Non-Goals

### Goals

1. Keep `log_operation` as the single checkpoint/commit boundary for dream mode.
2. Enforce a minimum structured contract for every `type="dream"` checkpoint.
3. Make noop cycles informative rather than hand-wavy.
4. Persist dream checkpoint metadata into `memory-operations.jsonl` so resume and reconstruction are ledger-driven.
5. Shorten dream prompting so it points at the enforced contract instead of carrying the whole methodology in prose.
6. Keep the design incremental: improve discipline now without introducing a separate dream workflow engine.

### Non-Goals

- No new dedicated `log_dream_cycle` tool in this phase.
- No full dream state machine with explicit phase transitions in runtime state.
- No replacement of `dream-journal.md`.
- No change to `reflect`, `ruminate`, or `ingest` semantics beyond backward-compatible parser updates.
- No attempt to redesign the whole dashboard in this phase.

## 3) Approaches Considered

### Approach A — Prompt-only tightening

Keep `log_operation` unchanged and strengthen dream prompt wording.

Pros:
- Smallest code change
- No schema changes

Cons:
- Weakest enforcement
- Same failure mode as today: phases remain optional in practice
- More prose tends to decay into background noise

### Approach B — Extend `log_operation` with dream-specific validation (recommended)

Keep the existing tool, but require dream-only metadata and reject weak checkpoints.

Pros:
- Reuses the existing checkpoint/commit boundary
- Copies the strongest part of autoresearch's structure: tool-level enforcement + JSONL ledger
- Lower complexity than a dedicated dream state machine
- Easier migration and lower UX disruption

Cons:
- Dream validation logic makes `log_operation` somewhat more specialized
- Only partial enforcement: still less rigid than a separate dream harness

### Approach C — Add a dedicated dream tool and state machine

Introduce a separate `log_dream_cycle` tool and explicit runtime-controlled phase transitions.

Pros:
- Maximum control
- Easier to model future phase analytics or explicit transitions

Cons:
- More moving parts
- Higher implementation and maintenance cost
- Premature until we know medium enforcement is insufficient

### Recommendation

Use **Approach B**.

The current problem is not lack of prompting; it is lack of enforcement. Extending `log_operation` for dream checkpoints gives dream mode the core benefit autoresearch gets from structure, while avoiding the extra control surface and complexity of a separate dream-specific tool.

## 4) Architecture

The enforcement point for dream mode should be the existing `log_operation` tool.

For `type="dream"`, `log_operation` becomes a stricter checkpoint contract:
- validate required dream metadata before writing history
- validate noop discipline before accepting a noop checkpoint
- classify changed files and dream status **before** any git commit or JSONL append
- reject invalid dream checkpoints without mutating the repo or ledger
- persist dream metadata into `memory-operations.jsonl`
- keep using git-backed commit behavior and dashboard/state reconstruction already centered on `log_operation`

Runtime state remains intentionally small in this phase:
- `dreamMode`
- cycle count
- consecutive noops
- existing auto-resume state

This phase does **not** introduce runtime-owned phase transitions or a separate state machine. The ledger remains the source of truth; runtime state is only a convenience cache for current-session behavior.

### Restart and reconstruction contract

This design draws an explicit line between **loop activation** and **loop history**:
- **Loop activation** (`dreamMode` actively running) stays runtime-only in this phase. A full pi restart does not silently resume an active dream loop.
- **Loop history** is ledger-backed. `memory-operations.jsonl` must carry enough structured dream data to reconstruct the last known cycle number, recent noop streak, and last dream checkpoint details.
- **Escalation checks** use an effective noop streak derived from the same source of truth on every dream log call: prefer current runtime state when dream mode is active, otherwise derive the recent consecutive dream noops from the latest JSONL history.

Operationally, that means:
- context resets/compactions during an active session keep using the existing runtime loop plus auto-resume behavior
- a fresh process/session does **not** auto-restart dream mode on its own
- when the user starts dream mode again, the extension should seed cycle/noop context from the latest dream entries in `memory-operations.jsonl` rather than pretending it is a brand-new pass

Legacy fallback for cycle reconstruction:
- if prior dream entries include `cycle`, seed the next cycle as `max(existing cycle) + 1`
- if prior dream entries do not include `cycle`, seed the next cycle as `count(prior dream entries) + 1`
- every **newly accepted** dream entry persists a `cycle` value, even if `type="dream"` was logged while runtime `dreamMode` was off
- noop streak reconstruction does **not** depend on `cycle`; it should be derived from the most recent consecutive dream entry statuses in history

## 5) Dream Checkpoint Contract

`log_operation` keeps its existing top-level fields and gains additional dream-only fields when `type="dream"` is used.

Required dream checkpoint fields:
- `dream_phase`
- `dream_area`
- `dream_action`
- `dream_next_step`

Conditionally required:
- `dream_journal_note` when `status="noop"`

`dream_phase` is an exact lowercase enum in this phase:
- `explore`
- `reorganize`
- `synthesize`
- `conceptualize`
- `simplify`
- `disrupt`

No synonyms or alternate casing are accepted for new writes. Older history lines without these fields remain readable, but new dream checkpoints must use the exact values above.

Status meanings become stricter in dream mode:
- **`keep`** = curated vault content changed in a meaningful way
- **`noop`** = no curated vault content changed, and a substantive `dream-journal.md` note was added and summarized in `dream_journal_note`

For validation purposes, **curated vault content** means markdown content under the active vault excluding:
- `dream-journal.md`
- `memory-operations.jsonl`
- anything under `raw/`

Notable consequences:
- changes to `index.md` count as curated changes
- changes only to `dream-journal.md` do not qualify for `keep`
- mixed curated + journal changes qualify for `keep`
- raw-file edits are already outside dream-mode policy and should not be treated as valid curated progress

This keeps the contract small enough to be usable while still forcing the model to say:
- what phase it was in
- what area it worked on
- what kind of action it took
- what should happen next

## 6) JSONL Ledger Shape

Dream metadata should follow autoresearch's JSONL style: flat core fields plus a small number of nested maps only where they clearly earn their keep.

Dream-specific fields should therefore be persisted as flat top-level fields on each dream entry, for example:
- `dream_phase`
- `dream_area`
- `dream_action`
- `dream_next_step`
- `dream_journal_note`

Example result line:

```json
{
  "operationType": "dream",
  "type": "dream",
  "status": "noop",
  "description": "Deferred merging overlapping project notes after reviewing link structure",
  "findingsCount": 0,
  "filesChanged": [],
  "durationMs": 4200,
  "timestamp": 1776900000000,
  "cycle": 7,
  "dream_phase": "reorganize",
  "dream_area": "projects/pi-extensions + projects/app",
  "dream_action": "considered merge; deferred after comparison",
  "dream_next_step": "review shared terminology and extract a cross-project note",
  "dream_journal_note": "Merge is promising but should follow a terminology pass to avoid flattening distinct concepts."
}
```

### Ledger rules

- `memory-operations.jsonl` remains the source of truth.
- Runtime state may cache recent facts, but reconstruction should come from JSONL.
- Older lines without dream-specific fields must continue to parse safely.
- Malformed lines should continue to be skipped rather than breaking the dashboard or startup reconstruction.
- Dream metadata should be parsed into optional in-memory operation fields now, even if the widget does not display them yet. Reconstruction logic needs them before dashboard polish does.
- On startup or when entering dream mode, the extension should derive the next cycle number and recent noop streak from the latest dream entries rather than relying only on fresh runtime defaults.
- The same ledger-derived noop streak should be used for escalation checks whenever a `type="dream"` checkpoint is logged outside an actively running dream session.
- Every newly accepted dream entry must persist `cycle`, so the legacy fallback path is only needed for older history.
- Legacy histories without `cycle` or `dream_*` fields must still reconstruct deterministically using the fallback rules from Section 4.

## 7) Validation Rules

Dream-specific validation applies whenever `log_operation` is called with `type="dream"`, even if `dreamMode` is not currently active in runtime state. The ledger contract should not depend on whether a toggle happened to be on in memory.

### 7.1 Required fields and valid phase values

For `type="dream"`, reject the tool call unless all of the following are present:
- `dream_phase`
- `dream_area`
- `dream_action`
- `dream_next_step`

Reject unknown or malformed `dream_phase` values. Accepted values are exactly:
- `explore`
- `reorganize`
- `synthesize`
- `conceptualize`
- `simplify`
- `disrupt`

Validation errors must be actionable and explicit, in the same spirit as autoresearch's tool messages. Example:
- `❌ Missing dream_phase. Call log_operation again with dream_phase set to one of: explore, reorganize, synthesize, conceptualize, simplify, disrupt.`

### 7.2 Curated-versus-journal classification

`log_operation` should classify changed files before accepting dream statuses:
- **curated changes** = markdown files in the active vault excluding `dream-journal.md`, `memory-operations.jsonl`, and `raw/**`
- **journal-only changes** = changes limited to `dream-journal.md`
- **mixed changes** = both curated changes and journal changes

Contract consequences:
- `keep` requires at least one curated change
- `noop` requires zero curated changes
- `noop` with curated changes is invalid and should instruct the caller to log `keep` instead
- `keep` with only journal changes is invalid and should instruct the caller to log `noop` instead
- non-markdown changes do not count as curated progress for status validation
- non-markdown-only changes should be rejected in dream mode with guidance to keep dream work focused on markdown knowledge files
- mixed markdown + non-markdown changes are acceptable only if the markdown side independently satisfies the chosen `keep` or `noop` contract

### 7.3 Noop discipline

For `type="dream"` with `status="noop"`:
- require `dream_journal_note`
- require a `dream-journal.md` file change
- require zero curated changes
- require `description.trim().length >= 20`
- require `dream_action.trim().length >= 12`
- require `dream_next_step.trim().length >= 12`
- require `dream_journal_note.trim().length >= 40`
- require `dream_action !== dream_next_step`

This intentionally avoids fragile keyword heuristics. The model must provide enough structured content to show what was considered, why it was deferred, and what should happen next.

The goal is not to ban noop. The goal is to make noop informative enough that future turns and future agents do not rediscover the same dead end.

### 7.4 Keep discipline

For `type="dream"` with `status="keep"`:
- require actual curated vault changes to exist
- permit mixed curated + journal changes
- reject inconsistent `keep` requests when only journal changes or no curated changes were committed

This mirrors the existing spirit of `log_operation` while making the contract operational instead of implicit.

### 7.5 Soft phase enforcement

The design keeps phases as guided values rather than as a full transition graph, but adds one important structural guard:
- once the **effective** noop streak reaches escalation (`>= 2`), reject `dream_phase="explore"`

`effective noop streak` means:
- the current runtime `consecutiveNoops` when dream mode is actively running
- otherwise, the most recent consecutive dream noops reconstructed from JSONL history

This keeps the model from stalling in the easiest phase after the extension has already determined that exploration is no longer paying off.

## 8) Prompting and Resume

Dream prompting should become shorter and more operational.

The injected dream prompt should focus on:
1. dream mode is active
2. the checkpoint contract is enforced at `log_operation`
3. noop requires `dream_journal_note`
4. escalation forbids staying in `explore`
5. read `index.md`, use `dream-journal.md`, continue the loop

The prompt should stop trying to restate the entire dream methodology every turn. The methodology still matters, but the tool contract should carry the real discipline.

Resume messages should similarly stay concrete and repetitive, for example:
- read `index.md`
- check `dream-journal.md`
- continue from a non-explore phase when escalated
- checkpoint with the required `dream_*` fields

This makes dream mode look more like autoresearch's successful harness pattern: short prompt, clear ledger, enforced checkpoint.

## 9) Additional Lessons Borrowed from Autoresearch

### 9.1 Validation errors are part of the harness

Rejected tool calls should not merely say "invalid". They should explain exactly how to recover on the next call.

### 9.2 Ledger first, runtime second

Like autoresearch, dream mode should treat JSONL as the durable ledger and runtime as reconstructible cache.

### 9.3 More visible loop state is helpful

The dashboard/widget does not need a redesign in this phase, but it would benefit from eventually surfacing some dream-loop state such as:
- current phase
- consecutive noops
- possibly the latest area

This is not required for phase 1 of enforcement, but it is a worthwhile follow-on.

### 9.4 Leave room for future segments/passes

Autoresearch has explicit segments when the optimization target changes. Dream mode does not need that yet, but this design should not block a future notion of full-vault passes or sweeps if that later proves useful.

## 10) Testing Strategy

### 10.1 Prompt tests

Update `memory/prompts.test.ts` to verify:
- dream prompt mentions the required dream checkpoint fields
- noop requires `dream_journal_note`
- escalation disallows staying in `explore`

### 10.2 Tool validation tests

Add `memory/index.test.ts` coverage for:
- missing `dream_phase`
- missing `dream_area`
- missing `dream_action`
- missing `dream_next_step`
- invalid or unknown `dream_phase`
- noop without `dream_journal_note`
- noop without a `dream-journal.md` file change
- invalid/too-short noop fields (`description`, `dream_action`, `dream_next_step`, `dream_journal_note`)
- escalated `explore` rejection
- escalation check uses ledger-derived noop streak outside active dream runtime
- `keep` with only journal changes
- `noop` with curated changes
- mixed curated + journal changes accepted as `keep`
- valid dream `keep`
- valid dream `noop`
- accepted dream logs outside active runtime still persist `cycle`
- rejected dream checkpoints do not commit or append JSONL

### 10.3 JSONL persistence and compatibility tests

Verify that:
- dream entries persist the flat `dream_*` fields
- older entries without those fields still parse safely
- malformed lines are still skipped safely
- reconstruction can derive cycle/noop context from existing dream entries in JSONL, including legacy histories with no `cycle` field
- non-markdown-only file changes are rejected for dream status validation
- a fresh process does not auto-resume dream mode without the user explicitly starting it again

## 11) Acceptance Criteria

1. `log_operation(type="dream", ...)` rejects checkpoints missing required dream metadata.
2. `log_operation(type="dream", ...)` rejects unknown `dream_phase` values and accepts only the exact lowercase phase enum defined in this spec.
3. `log_operation(type="dream", status="noop", ...)` requires both a `dream-journal.md` file change and a substantive `dream_journal_note`, using deterministic minimum-content rules rather than vague keyword heuristics.
4. `log_operation(type="dream", status="keep", ...)` requires curated vault changes; journal-only changes cannot be logged as `keep`.
5. Dream entries persist flat `dream_*` fields and `cycle` to `memory-operations.jsonl`.
6. Escalation checks use the effective noop streak consistently, whether that streak comes from active runtime state or ledger-derived history.
7. Dream validation/classification runs before commit or JSONL append; rejected dream checkpoints leave the working tree and ledger unchanged.
8. Full pi restarts do not silently auto-resume dream mode, but re-entering dream mode seeds cycle/noop context from persisted dream history.
9. Older `memory-operations.jsonl` entries remain backward-compatible.
10. Dream prompting becomes shorter and points directly at the enforced contract.
11. Existing `reflect`, `ruminate`, and `ingest` flows remain unchanged.

## 12) Future Escalation Path

If medium enforcement still allows drift after real usage, the next step should be a separate design for a harder dream harness:
- explicit runtime-owned phase state
- dedicated dream checkpoint tool
- possible phase transition rules or pass segmentation

That work is intentionally deferred until the lighter, tool-boundary approach has been tried and evaluated.