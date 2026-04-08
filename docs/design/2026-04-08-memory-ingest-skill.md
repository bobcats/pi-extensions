# Memory Ingest Skill Design

Date: 2026-04-08
Status: Revised after scope correction
Scope: Make `/skill:memory-ingest` an end-to-end knowledge ingestion workflow: raw acquisition **and** immediate brain/wiki compilation.

## 1) Context

The earlier design incorrectly treated `raw/` as the product boundary. That does not match the intended workflow.

The intended workflow is:
- gather heterogeneous sources (URLs, papers, repos, datasets, images, pasted text)
- normalize/preserve them into `~/.pi/memories/raw/`
- immediately compile them into curated markdown notes under `~/.pi/memories/`
- incrementally grow the brain/wiki with summaries, concept notes, backlinks, and index updates

Primary UX target remains:
- `/skill:memory-ingest <anything>`

But success now means:
1. raw artifacts were ingested safely
2. curated brain/wiki notes were updated immediately
3. the operation was logged

## 2) Goals and Non-Goals

### Goals

1. Keep a single packaged entrypoint: `/skill:memory-ingest`.
2. Support URLs, local files/directories, repo URLs/paths, dataset URLs/paths, and pasted blobs.
3. Always write normalized source artifacts under `~/.pi/memories/raw/`.
4. Always perform an immediate compile step into curated notes under `~/.pi/memories/`.
5. Preserve useful originals/assets when helpful for future synthesis.
6. Add provenance to raw markdown artifacts.
7. Add or update curated note(s), concept/topic note(s), backlinks, and indexes when warranted.
8. Fail safe on ambiguity: ask instead of guessing.

### Non-Goals

- no separate user-facing compile command for the core workflow
- no sidecar metadata architecture
- no independent Q&A/lint pipeline in this phase
- no reorganization of the entire vault unrelated to the new source

## 3) Architecture Decision

### Recommended approach: deterministic ingest + agent-driven compile

`memory-ingest` should remain one skill, but internally split into two stages:

1. **Ingest stage (deterministic)**
   - classify source
   - acquire/convert/preserve artifacts
   - write to `~/.pi/memories/raw/`
   - emit a structured result describing what was written

2. **Compile stage (LLM-driven, same skill invocation)**
   - read the newly written raw artifact(s)
   - synthesize curated note updates in `~/.pi/memories/`
   - update concept/topic notes if new reusable knowledge appears
   - add backlinks between raw source note and curated notes
   - update indexes if a new note family appears
   - log the ingest operation once the full pipeline succeeds

Why this split:
- acquisition/classification should stay deterministic and testable
- synthesis/linking should use the model, not hard-coded rules
- user experience remains one command

## 4) Output Model

### 4.1 Raw layer

All source artifacts still land in:
- `~/.pi/memories/raw/`

Examples:
- `raw/2026-04-08-react-dev-learn-you-might-not-need-an-effect.md`
- `raw/2026-04-08-paper.assets/original.pdf`

Raw files contain fixed provenance frontmatter:

```yaml
---
source: <original URL/path/input label>
ingested_at: <ISO timestamp>
method: <adapter/converter>
---
```

### 4.2 Curated layer

The compile stage updates the main brain/wiki under `~/.pi/memories/`.

Expected curated outputs per ingest:
- one source summary note or source-linked update in an existing note family
- zero or more concept/topic note updates
- backlinks from curated notes to the raw source slug
- index updates if a new category/note family is introduced

The compile stage should prefer updating existing notes over creating redundant new ones.

## 5) Compile Rules

When raw ingest succeeds, the same skill must immediately compile:

1. **Read newly created raw artifacts first**
2. **Find the best destination** among existing notes
   - append/update existing concept notes when the knowledge fits
   - create a new note only if the concept does not fit existing structure
3. **Preserve traceability**
   - link curated notes back to the raw source
   - mention source slug or wikilink consistently
4. **Update indexes minimally**
   - only when new curated notes/categories are created
5. **Stay incremental**
   - do not attempt whole-vault reorganization during normal ingest

## 6) Source-Type Behavior

| Source type | Raw ingest output | Compile expectation |
|---|---|---|
| URL/article | markdown article + assets when available | source summary + concept/topic updates + backlinks |
| Local document | markdown conversion + original if useful | source summary + concept/topic updates + backlinks |
| Local directory | corpus summary + preserved files + converted docs | corpus summary note + updates to relevant concepts |
| Repo | repo summary + preserved key docs/files | repo knowledge summary + updates to project/tech notes |
| Dataset | dataset preview/summary + preserved artifacts | dataset summary + updates to relevant concept/domain notes |
| Pasted blob | normalized markdown note | direct synthesis into existing or new curated note |

## 7) Memory Extension Integration

Minimal extension support remains valid:
- `log_operation(type="ingest")`

But the semantics change:
- `ingest keep` now means **raw ingest + compile completed**
- not merely that a file was dropped into `raw/`

## 8) Failure Policy

- **Ambiguous classification** → ask, do not ingest or compile
- **Ingest failure before raw write** → report failure, stop
- **Raw ingest succeeds but compile fails** → report partial failure clearly; do not pretend the brain was updated
- **Missing converter/tool** → still write raw markdown artifact with degradation note, then compile from that degraded artifact if possible
- **Path safety failure** → abort

## 9) Testing Strategy

### Deterministic tests
- source classification
- naming/collision behavior
- raw-root guard
- converter fallback behavior
- structured ingest runner outputs

### Integration tests
- successful ingest produces raw artifact(s)
- compile stage updates curated note(s)
- backlinks/source references appear in curated output
- indexes update only when new notes are introduced
- `log_operation(type="ingest")` still works

### Acceptance tests
- `/skill:memory-ingest <article>` updates both `raw/` and curated memory
- `/skill:memory-ingest <pdf/docx>` converts, preserves, and compiles
- `/skill:memory-ingest <repo/dataset>` produces both raw summary artifacts and curated summaries

## 10) Acceptance Criteria

1. `/skill:memory-ingest <anything>` remains the single ingest entrypoint.
2. Every successful run writes source artifacts under `~/.pi/memories/raw/`.
3. Every successful run also updates curated notes under `~/.pi/memories/`.
4. Curated notes link back to the ingested source.
5. Existing note structure is reused when possible; note sprawl is minimized.
6. The operation is logged only after the full ingest+compile workflow succeeds or with clear partial-failure reporting.
7. The workflow remains fail-safe and deterministic where classification/acquisition are concerned.
