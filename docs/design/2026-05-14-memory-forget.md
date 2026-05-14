# Memory Topic Forget

## Status

Approved for spec review.

## Context

The memory extension maintains a git-backed Markdown vault per active brain. Users can reflect, ruminate, dream, search, undo, and manage named brains. The vault is intentionally curated by agents rather than treated as a database: notes can overlap, broad concept pages can mention project-specific facts, and `index.md` is regenerated from Markdown files.

Users need a way to stop remembering a project, client, or topic without manually finding every related note. A project can be treated as a topic, so the first version should solve topic forgetting rather than add project- or brain-destructive commands.

## Goals

- Add `/memory forget <topic>` for fuzzy, topic-based forgetting in the active brain.
- Let the agent make the deletion/rewrite decisions rather than deleting search hits automatically.
- Seed the agent with QMD search candidates when QMD is available.
- Track forgetting in operation history and the dashboard via `log_operation(type="forget")`.
- Preserve `/memory undo` as the recovery path for accidental forgetting.

## Non-goals

- No secure erasure from git history. This removes content from the working vault, but prior commits may still contain it.
- No automatic brain deletion or project mapping changes.
- No separate `forget_memory` tool in the first version.
- No destructive changes to `raw/` source artifacts unless a future command explicitly asks for raw ingest purging.

## User-facing behavior

Add one command:

```text
/memory forget <topic>
```

Behavior:

- Uses the active brain only.
- If `<topic>` is missing, notify with `Usage: /memory forget <topic>`.
- If QMD is installed, search the active brain for `<topic>` and include the top matches as candidate files in the generated agent prompt. Candidate entries should be plain data passed into the prompt builder: `{ title: string; file: string; score: number; snippet?: string }`, with `file` converted to an active-brain filesystem path before rendering.
- If QMD is unavailable or search fails, continue with a prompt that relies on `index.md` and manual vault inspection.
- Send a user message that starts an agent turn. The command itself does not delete files.

Add `forget` to `/memory` autocomplete with a description like “Forget a topic from the active brain.” Also add it to the default `/memory` status/help command list so users can discover it without autocomplete.

## Agent prompt

Add `buildForgetPrompt(vaultDir, topic, candidates)` in `memory/prompts.ts`.

The prompt should instruct the agent to:

1. Read the active vault index.
2. Inspect candidate files and related links.
3. Remove notes whose primary subject is the topic.
4. Surgically remove topic-specific sections, claims, or examples from broader notes.
5. Preserve generalized lessons by rewriting them without topic-specific or private details when possible.
6. Treat ambiguous broad terms conservatively; ask for clarification or log `noop` rather than guessing.
7. Keep `raw/` source material read-only.
8. Rebuild/update `index.md` after deletions.
9. Call `log_operation(type="forget", status="keep"|"noop", description="...", findings_count=N)` when done.

The prompt should explicitly state that this is not a secure erase because git history may retain previous content. This prompt text is the enforcement boundary for the first version: because edits happen through the normal agent file tools, the extension cannot technically sandbox writes to `raw/` without adding a separate tool-based editing workflow. The implementation must therefore test the prompt builder for both the hard `raw/` boundary and the secure-erase warning.

## Operation history

Extend operation typing so `forget` is accepted anywhere `log_operation` validates operation type:

- `OperationType`
- `LogOperationParams`
- dashboard/history parsing assumptions, if any tests or labels require enumerating types

`log_operation` should continue to commit vault changes, append to `memory-operations.jsonl`, update the widget, and trigger QMD re-indexing just like reflect/dream/ruminate/ingest.

## Data flow

1. User runs `/memory forget <topic>`.
2. Command resolves the active brain.
3. Command optionally searches QMD collection for the topic.
4. Command builds a forget prompt with vault path, topic, safety rules, and candidate file list.
5. Command sends the prompt via `pi.sendUserMessage(...)`.
6. Agent edits the vault and rebuilds `index.md`.
7. Agent calls `log_operation(type="forget", ...)`.
8. Existing git history and QMD update paths handle persistence and search refresh.

## Safety model

- Topic scope only: no brain deletion, no config mutation, no project mapping changes.
- Candidate files are hints, not deletion targets.
- Ambiguous topics should bias toward conservative removal or clarification.
- General reusable lessons should be retained after removing topic-specific details.
- `raw/` remains read-only by default.
- `/memory undo` can reverse an accidental forget because the vault remains git-backed.
- Sensitive-data users must understand that this is not a secure purge from git history.

## Testing

Add focused tests for:

- `/memory` autocomplete includes `forget`.
- Default `/memory` status/help output lists `forget`.
- `/memory forget` without a topic shows usage.
- `/memory forget <topic>` sends a forget prompt containing the topic and active brain vault path.
- `buildForgetPrompt` includes the hard `raw/` read-only boundary.
- `buildForgetPrompt` includes the “not a secure erase / git history may retain content” warning.
- The command still sends a prompt when QMD is unavailable.
- `log_operation(type="forget")` is accepted and writes history.

No integration test should require QMD to be installed. Candidate rendering should be tested at the prompt-builder level by passing plain candidate objects; command-level QMD behavior can remain a small branch that maps QMD results into that shape.

## Implementation notes

Keep the first version small:

- Put prompt construction in `memory/prompts.ts` beside reflect/dream prompt builders.
- Keep command parsing in `memory/index.ts` beside the existing search and ruminate commands.
- Reuse existing active-brain resolution and QMD collection naming.
- Do not add a new tool surface until an agent-to-agent forget workflow exists.
