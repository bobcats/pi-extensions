# Memory Ingest Compile Acceptance Checklist

Date: 2026-04-08

## Verification evidence

### 1. Raw ingest artifact is produced

Command run:

```bash
npx tsx skills/memory-ingest/scripts/ingest-runner.ts '{"inputs":["Acceptance fixture\nMemory ingest compile workflow"],"confirm":false,"rawRoot":"<tmp>","nowIso":"2026-04-08T00:00:00.000Z"}'
```

Observed:
- `status: "ok"`
- `kind: "pasted-blob"`
- `filesWritten[0]` points at a raw markdown artifact
- `sourceSummaries[0]` includes `source`, `rawMarkdownPath`, `preservedAssets`, and `kind`

### 2. Compile-stage contract is enforced by the packaged skill

Automated contract test:

```bash
npx tsx --test skills/memory-ingest/scripts/skill-contract.test.ts
```

This verifies the skill instructions require all of:
- read the newly written raw artifact(s)
- update/create curated notes under `~/.pi/memories/`
- add backlinks/source references to the raw artifact
- call `log_operation(type="ingest", status="keep", ...)` only after compile finishes

### 3. Notes on live-vault acceptance

The compile stage is agent-orchestrated from `SKILL.md`, not a standalone TypeScript CLI. To avoid polluting the operator's real memory vault during automated test runs, acceptance is split into:
- deterministic runner verification in a temporary raw root
- explicit skill-contract verification for curated-note updates, backlinks, and log ordering

A live `/skill:memory-ingest ...` run in pi should now follow the shipped contract end-to-end.
