---
name: prototype
description: Build throwaway prototypes to answer design questions before production work. Use when the user asks to prototype, sanity-check a state model, explore UI options, mock something up, or try designs before committing.
metadata:
  bucket: prototyping
---

# Prototype

A prototype is throwaway code that answers one question. Pick the artifact from the question, not from convenience.

## Pick the branch

- **Logic/state/data model question** → use [logic prototype](references/logic.md): a small interactive terminal app around a pure reducer, state machine, or API sketch.
- **UI/look/flow question** → use [UI prototype](references/ui.md): several structurally different variants switchable from one route.

If the branch is ambiguous and the user is unavailable, choose the one closest to the surrounding code and state the assumption at the top of the prototype.

## Rules for all prototypes

1. **Name the question**
   - Write the question in the prototype file, README, or route comment.
   - If you cannot state the question, stop and ask.

2. **Mark it throwaway**
   - Put prototype code near the relevant real code, but name it with `prototype` or another obvious marker.
   - Avoid new top-level structure unless the host project already has a place for experiments.

3. **Make it runnable in one command or URL**
   - Use the existing task runner, route convention, styling system, and runtime.
   - Do not add new infrastructure unless the prototype question requires it.

4. **Keep state visible and cheap**
   - Use in-memory state by default.
   - After each action or variant switch, show the relevant state or visible result.
   - Avoid real mutations, production services, and persistent data unless the question is specifically about persistence.

5. **Skip production polish**
   - No broad error handling, abstractions, or speculative options.
   - No tests unless the prototype is being promoted into production code.
   - Do only enough to let the user learn from it.

6. **Capture the answer**
   - Record what was learned in a note, issue, ADR, commit message, or user-facing summary.
   - Delete the prototype or deliberately fold the winning idea into production with normal `tdd` and `verify` expectations.

## Stop and ask

Ask before building if:

- the question is unclear or multiple unrelated questions are bundled together
- the user expects production-quality implementation rather than throwaway learning
- the prototype would touch real customer data, production services, billing, auth, or irreversible actions
- the project has no obvious runtime or place to host the prototype

## Red flags

- prototype code silently shipping as production
- UI variants that differ only in color or copy
- a logic prototype coupled to terminal/UI code
- adding persistence or infrastructure by default
- leaving a stale prototype without an answer or cleanup path

## Output

Return:

- question answered
- prototype branch chosen and why
- run command or URL
- where prototype code lives
- what to observe
- cleanup or promotion path
