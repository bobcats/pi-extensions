# AGENTS.md

Guidance for agents working in this repository.

## Start here

Before editing repository behavior, read:

1. `README.md`
2. The relevant extension, skill, or prompt source
3. Nearby skills in the same bucket when changing shared skills
4. Pi package docs when changing `package.json` `pi.*` resources

## Repository purpose

This repository is the canonical Bobcats source for Pi extensions, Pi prompt templates, shared agent skills, extension-owned skills, and the flattened skill installer used by non-Pi agents.

## Structure

- Pi extensions live in top-level extension directories such as `memory/`, `subagent/`, `exa/`, and `slop-scan/`.
- Shared skill sources live under `skills/<bucket>/<skill-name>/SKILL.md`.
- Extension-owned skills live next to their extension, currently `memory/skills/memory-ingest/`.
- Pi prompt templates live under `prompts/*.md` and stay canonical there.
- `scripts/build.py` builds the flattened `build/skills/` tree for non-Pi installs and excludes extension-owned skills from Codex targets.
- Generated prompt-skills are build artifacts only; do not commit generated `build/skills/prompt-*` files.

## Skill standards

Every authored skill must:

- have one job and a specific trigger
- keep `SKILL.md` short and operational
- include explicit stop/ask conditions
- require evidence before success claims
- move rare details into optional `references/`, `scripts/`, or `assets/`
- avoid overlap with existing skills unless the overlap is intentional and explained in the skill

Frontmatter must follow the Agent Skills spec:

- `name` is lowercase kebab-case and matches the directory basename
- `description` explains what the skill does and when to use it
- optional metadata stays minimal

## Prompt templates

Prompt templates are Pi-native slash-command snippets. Keep source in `prompts/*.md`; do not convert prompts into authored skills by hand.

`make build` generates manual-only prompt-skills named `prompt-<template-name>` for skill-only agents. The generated skills include `disable-model-invocation: true`, but only agents that honor that field will enforce manual-only use.

## Editing workflow

1. Use `write-a-skill` for new or materially changed skills.
2. Check nearby skills for overlap before adding another workflow.
3. Update docs only when repository-wide conventions or install behavior change.
4. Validate touched `SKILL.md` frontmatter, links, and support-file paths before claiming completion.
5. Prefer mocked/temp installer tests over real global installs.

## Installation safety

Use `make build` and `make test` for local validation. `make install` mutates `~/.agents/skills/` and `~/.claude/skills/`, so do not run it unless the user explicitly approves changing global agent skill directories.

The installer state namespace remains `bobcats-skills` under `$XDG_STATE_HOME` or `~/.local/state`. `pi update` handles Pi-native extensions, prompts, and authored skill roots from `package.json`; it must not mutate non-Pi global skill directories.

The Pi package exports the full authored skill tree through `pi.skills`, including extension-owned skills. Use `make install-codex` to update only `~/.codex/skills/`. Do not install the same skills into `~/.agents/skills/` while also loading this repository as a Pi package, because Pi scans both sources and reports duplicate skill names. `memory/skills` is intentionally extension-owned and is excluded from Codex installs.
