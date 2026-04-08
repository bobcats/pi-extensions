---
name: memory-ingest
description: Ingest heterogeneous knowledge sources into ~/.pi/memories/raw/ using deterministic routing and fail-safe clarification.
---

# memory-ingest

Use this skill to turn a URL, local path, repo, dataset, or pasted blob into a markdown artifact under `~/.pi/memories/raw/`.

## Rules

- Be deterministic. If the source is ambiguous, stop and ask a concise clarification question.
- Never write outside `~/.pi/memories/raw/`.
- Always produce a markdown artifact, even if conversion tooling is missing.
- Preserve useful originals/assets when it helps future recall.
- If the runner returns `confirm`, ask the user before replaying with `confirm:true`.
- After a successful write, call `log_operation` with `type="ingest"` and `status="keep"`.

## Execution

Run the canonical JSON payload through the ingest runner:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["<user input>"],"confirm":false}'
```

If the runner asks for confirmation because of caps, replay the same payload with `confirm:true`:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["<user input>"],"confirm":true}'
```

## Decision policy

- URL → fetch and normalize to markdown.
- Local document → normalize to markdown, preserve the original if needed.
- Local directory → summarize the corpus and preserve supported files.
- Repo → summarize structure and preserve key docs/files.
- Dataset → summarize and preserve retrievable artifacts.
- Pasted blob → normalize into a markdown note.

## Failure policy

- Ambiguous classification → ask the user.
- Missing dependency or fetch failure → still write a markdown artifact with a clear fallback note.
- Path safety failure → abort and explain.
