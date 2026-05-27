---
name: write-a-skill
description: Create or revise agent skills with sharp triggers, small loaded cores, progressive disclosure, and verification. Use when adding a new skill, materially changing a skill, or converting a prompt/memory/workflow into a skill.
metadata:
  bucket: productivity
---

# Write a Skill

Use this to create behavior-shaping skills, not prompt dumps.

## First read

- repo `README.md`
- latest Agent Skills specification: `https://agentskills.io/specification.md`
- nearby skills in the same bucket

## Workflow

1. **Define the failure mode**
   - What recurring mistake should this prevent?
   - Why is it a skill instead of a prompt, memory note, or doc?
   - Which existing skill would otherwise overlap?

2. **Choose the smallest operating procedure**
   - one job
   - concrete trigger
   - obvious first action
   - explicit stop/ask conditions
   - evidence required before claims

3. **Keep it standalone**
   - A skill may reference related skills, but must be usable when loaded alone.
   - Prefer: “Use `diagnose` when available; otherwise reproduce the issue, create a feedback loop, and isolate the smallest failing cause here.”
   - Avoid bare dependencies like “Use `verify`” without local evidence rules.

4. **Draft `SKILL.md`**
   - frontmatter `name` matches the directory basename
   - `description` says what it does and when to use it
   - body is short, imperative, and auditable
   - rare details go in `references/`, not the loaded core
   - scripts are only for deterministic repeated operations

5. **Source-port completeness**
   - When adapting an existing skill, compare the whole source directory: `SKILL.md`, `scripts/`, `references/`, `assets/`, executable bits, and links.
   - Before adding `references/`, check relevant memory/project guidance for contradictions. Do not copy source material that conflicts with the user's established principles, preferences, or project conventions; adapt it, omit it, or ask.
   - Classify each important source idea:
     - **Do now** — restore in `SKILL.md` as an action, stop condition, or evidence gate.
     - **Operational depth** — restore in `references/`, templates, or scripts.
     - **Broad principle or taste** — leave out of the skill unless it needs a local operational hook.
     - **Private context** — omit or generalize; never require the user's memory vault or machine-specific setup.
   - Copy useful optional depth or record why it was intentionally omitted.

6. **Review against the repo standards**
   - Remove generic advice.
   - Move command catalogs, long examples, provider details, API field lists, and syntax references into `references/` unless they prevent a known failure.
   - Merge with an existing skill if the trigger is not distinct.
   - Update `README.md` only if the change affects repository-wide conventions.

7. **Verify**
   - Validate frontmatter and directory names.
   - Check internal links and referenced files.
   - Read the final skill as if it just triggered: is the next action obvious?

## Stop and ask

Ask the user before continuing if:

- the trigger overlaps another skill
- the task is a preference rather than a repeatable workflow
- the skill needs private context that should not live in the repo
- a ported source idea seems valuable but belongs in memory/project docs rather than a portable skill
- you cannot name the failure mode it prevents

## Output

Return:

- files created or changed
- why this belongs as a skill
- validation performed
- open questions or deferred reference material
