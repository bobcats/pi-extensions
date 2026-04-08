# Memory Ingest Skill Design

Date: 2026-04-08
Status: Draft approved in brainstorming; ready for spec review
Scope: Add packaged `/skill:memory-ingest` to support LLM Knowledge Base source ingestion into memory raw store.

## 1) Context

The current `memory` extension is strong for reflection workflows (`reflect`, `ruminate`, `dream`) and vault operations, but it does not provide a first-class source ingestion workflow for knowledge-base building.

The target workflow is:
- Gather heterogeneous sources (URLs, docs, repos, datasets, images, pasted text)
- Convert/normalize them into markdown-friendly artifacts
- Store everything in `~/.pi/memories/raw/`
- Keep the rest of the existing memory/brain structure unchanged

Primary UX target:
- `/skill:memory-ingest <pasted thing here>`
- Skill should classify input and select the right ingestion path
- If ambiguous, stop and ask for clarification (fail-safe behavior)

## 2) Goals and Non-Goals

### Goals (v1)

1. Ship a **packaged skill**: `memory-ingest`, invokable with `/skill:memory-ingest`.
2. Support broad source classes:
   - URLs
   - Local files/directories
   - Repo URLs/paths
   - Dataset URLs/paths
   - Pasted text/blob input
3. Write outputs **only** to `~/.pi/memories/raw/`.
4. Use reasonable human-readable filenames (date + slug; collision suffixes).
5. Preserve useful originals/assets when appropriate, while also producing markdown summaries.
6. Add a tiny inline provenance header at the top of generated markdown (source + timestamp + ingest method).
7. Fail-safe on ambiguity or unsupported cases (ask user; do not guess).

### Non-Goals (v1)

- No wiki compilation engine
- No dedicated Q&A command/output pipeline
- No lint/health-check framework
- No metadata sidecar architecture (provenance lives inline in markdown only)
- No reorganization of existing memory vault structure outside `raw/`

## 3) Design Approach Options Considered

### Option A: Skill-only
- Add `memory-ingest` skill with no memory extension changes.
- Pros: fastest
- Cons: weak ingest visibility in memory operation history

### Option B: Hybrid (recommended)
- Packaged `memory-ingest` skill handles classification/routing/execution.
- Minimal memory-extension change to support logging `ingest` operations into the same operation stream/dashboard semantics.
- Pros: flexible ingest + durable history; good foundation for future compile/ask/lint
- Cons: small extension changes required

### Option C: Extension-first ingest engine
- Build all ingest behavior into `/memory ingest` command.
- Pros: single extension command surface
- Cons: inflexible for heterogenous sources; increases complexity in already-large `memory/index.ts`

**Decision:** Option B (Hybrid)

## 4) Architecture

### 4.1 Packaged Skill: `skills/memory-ingest/SKILL.md`

Responsibilities:
1. Parse freeform user input payload
2. Classify source type
3. Route to best ingestion strategy
4. Execute conversion/acquisition using existing tools/skills
5. Write artifacts to `~/.pi/memories/raw/`
6. Return concise summary and explicit next steps when blocked

### 4.2 Ingest Adapters (within skill workflow)

The skill routes to one of these strategy paths:
- **URL/article path**: convert page content to markdown; collect local assets when feasible
- **Document path** (PDF/DOCX/etc.): convert to markdown/text; preserve original as needed
- **Repo path**: capture useful repository content for knowledge work (docs and key files), with markdown summary
- **Dataset path**: preserve dataset artifacts where feasible + markdown summary/preview
- **Pasted blob path**: store normalized markdown note directly

Implementation should reuse existing capabilities where available (e.g., summarize/web extraction, subagent delegation for larger jobs), rather than building bespoke converters in memory extension code.

#### 4.2.1 Source-type output contract (v1 defaults)

| Source type | Always produce | Preserve originals/assets | Default caps |
|---|---|---|---|
| URL/article | One `.md` file with extracted content | Downloaded local images/attachments when extraction returns them | Max 1 URL per call unless user passes explicit list |
| Local document (pdf/docx/html/txt/md) | One `.md` conversion/normalization file | Original file copied only when input is not already markdown/text | Max 1 input path per call unless explicit list |
| Repo (url/path) | One `.md` repo summary (purpose, structure, key docs/files) | Key documentation files (`README*`, `/docs/**`, selected config files) | Max 200 files, max depth 4, max 25 MB total copied |
| Dataset (url/path) | One `.md` dataset summary/preview | Source files preserved when directly retrievable | Max 50 files, max 100 MB total copied |
| Pasted blob | One `.md` note with normalized content | N/A | Max 200 KB pasted text |

If a source exceeds caps, skill asks for explicit confirmation before continuing.

### 4.3 Output Layout and Naming

All writes go to:
- `~/.pi/memories/raw/`

File naming convention (simple and human-readable):
- `<yyyy-mm-dd>-<source-slug>.md` (primary markdown)
- `<yyyy-mm-dd>-<source-slug>-2.md`, etc. for collisions
- Preserve originals/assets adjacent within `~/.pi/memories/raw/` when useful (especially repos/datasets/docs/images)

Each generated markdown file begins with a minimal provenance header, e.g.:
- `source:` original URL/path/input label
- `ingested_at:` ISO timestamp
- `method:` adapter/converter used

No run-id directory indexing for v1.

### 4.4 Memory Extension Integration (Minimal)

Targeted refactor only:
1. Add `ingest` as a supported operation type in memory operation model
2. Reuse existing log flow (`log_operation`) for ingest result visibility
3. Keep existing reflect/ruminate/dream behavior unchanged

This avoids bloating extension architecture while enabling durable ingest history.

## 5) Interaction and Behavior Contract

### Command contract

User calls:
- `/skill:memory-ingest <input>`

Where `<input>` can be any of:
- URL
- local path
- repo identifier/path
- dataset locator/path
- free text blob

### Decision policy

- Prefer deterministic classification
- If classification confidence is insufficient: stop and ask one concise clarifying question
- Do not silently choose high-risk transformations

### Write safety policy

- Never write outside `~/.pi/memories/raw/`
- If permissions or path safety checks fail: abort and explain

## 6) Error Handling

Fail-safe default is required:
- Ambiguous input → ask for clarification
- Missing required tool/converter → explain missing dependency and stop
- Auth/paywall/network blockers → report and stop

Partial success is acceptable only when deterministic and transparent (e.g., main content ingested, some assets failed), with clear user-facing summary.

## 7) Testing Strategy

### Skill behavior tests
- Input classification matrix:
  - URL vs local file vs local directory vs repo-like input vs pasted blob
- Ambiguity gate:
  - verifies the skill asks clarification instead of guessing

### Naming/output tests
- Slug generation and collision suffix behavior
- Raw-path write guard (no traversal/out-of-root writes)

### Integration tests (memory extension)
- `ingest` operation can be logged via existing operation pipeline
- Existing operation types and `/memory` commands remain unaffected

## 8) Incremental Rollout Plan

1. Add packaged `memory-ingest` skill scaffolding and docs
2. Implement classifier + routing with fail-safe prompts
3. Implement core adapters for URL/docs/repo/dataset/blob using existing tools
4. Add minimal memory extension operation-type support for `ingest`
5. Add tests for classifier, naming, and path safety
6. Validate end-to-end with representative sample inputs

## 9) Open Questions (for planning stage)

1. Default dependency strategy (hard vs soft requirements for conversion tools)
2. Whether `/memory ingest` command alias should be added later to invoke `/skill:memory-ingest`

## 10) Acceptance Criteria (Design-level)

1. User can run `/skill:memory-ingest <anything>` and receive deterministic handling or explicit clarification.
2. Outputs are written exclusively under `~/.pi/memories/raw/`.
3. Filenames are human-readable and collision-safe.
4. Per source type, required outputs match the source-type output contract (including caps and confirmation behavior), and a markdown artifact is always produced.
5. Generated markdown includes a minimal inline provenance header (source, ingested_at, method).
6. Ingest outcomes can be recorded in memory operation history without disrupting existing memory workflows.
7. No additional heavy architecture introduced beyond this scope.
