---
name: memory-ingest
description: Ingest heterogeneous knowledge sources into ~/.pi/memories/raw/ and immediately compile them into curated memory notes.
---

# memory-ingest

Use this skill to run one end-to-end workflow:
1. ingest the source into `~/.pi/memories/raw/`
2. compile the new raw artifact(s) into curated notes under `~/.pi/memories/`
3. log the completed ingest operation

Raw ingest is an internal stage, not the final product.

## Rules

- Be deterministic during ingest. If the source is ambiguous, stop and ask a concise clarification question.
- Never write outside `~/.pi/memories/raw/` during the ingest stage.
- Always produce a raw markdown artifact, even if conversion tooling is missing.
- Preserve useful originals/assets when it helps future recall.
- If the runner returns `confirm`, ask the user before replaying with `confirm:true`.
- On `ok`, read the newly written raw artifact(s) before any synthesis.
- Inspect existing vault notes relevant to the topic before deciding where curated knowledge should go.
- Bias toward wiki-style curation: get the source into the brain, then extract reusable knowledge into notes.
- Prefer updating existing topic/concept/project notes over creating new notes.
- A single source may update an existing principle only when it clearly reinforces or refines that principle.
- If a useful lesson does not fit an existing principle cleanly, create or update a source-derived concept note instead of minting a new principle.
- Do not create a new principle from a single source unless the vault already contains repeated evidence that clearly supports it.
- Create a source-summary note only when there is no obvious curated destination.
- Preserve traceability with backlinks/source references to the raw note.
- Update indexes only when a genuinely new note family appears.
- Avoid whole-vault rewrites during normal ingest.
- Only then call `log_operation` with `type="ingest"` and `status="keep"` after raw ingest and compile both succeed.

## Execution

Run the canonical JSON payload through the ingest runner:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["<user input>"],"confirm":false}'
```

If the runner asks for confirmation because of caps, replay the same payload with `confirm:true`:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["<user input>"],"confirm":true}'
```

## Compile flow after runner success

When the runner returns `status: "ok"`:

1. Read the newly written raw artifact(s) from `filesWritten` / `sourceSummaries`.
2. Use the returned source kind and source label to identify the best curated destination.
3. Read existing vault notes relevant to that destination.
4. Choose the destination in this order:
   - update an existing topic/concept/project note
   - if the source clearly reinforces an existing principle, update that principle
   - otherwise create/update a source-derived concept note
   - only create a new principle when stronger prior evidence already exists in the vault
5. Update/create curated notes under `~/.pi/memories/`.
6. Add backlinks or source references to the raw artifact.
7. If a new note family is created, update the relevant index note.
8. Only after compile finishes, call `log_operation(type="ingest", status="keep", ...)`.

If compile fails after raw ingest succeeds, report the partial failure clearly and do not claim ingest success.

## Decision policy

- URL → fetch and normalize to markdown, then compile into source/concept notes.
- Local document → normalize to markdown, preserve the original if needed, then compile into curated notes.
- Local directory → summarize the corpus, preserve supported files, then compile the useful knowledge into curated notes.
- Repo → summarize structure and preserve key docs/files, then compile into project/tech notes.
- Dataset → summarize and preserve retrievable artifacts, then compile into dataset/domain notes.
- Pasted blob → normalize into a markdown note, then synthesize directly into an existing or new curated note.
- In all cases, prefer source-derived concept notes over new principles when the lesson is interesting but not yet well-proven.

## Failure policy

- Ambiguous classification → ask the user.
- Missing dependency or fetch failure → still write a markdown artifact with a clear fallback note, then compile from that artifact if possible.
- Path safety failure → abort and explain.
- Raw ingest success but compile failure → report partial success; do not call `log_operation(... status="keep")`.
