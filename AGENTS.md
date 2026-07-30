# AGENTS.md

Guidance for agents working in this repository.

## Start here

Before editing repository behavior, read:

1. `README.md`
2. The relevant extension or prompt source
3. Pi package docs when changing `package.json` `pi.*` resources

## Repository purpose

This repository is the canonical Bobcats source for Pi extensions, Pi prompt
templates, and skills owned by an extension. General shared and Pi-only skills
live in the parent `bobcats/skills` repository.

## Structure

- Pi extensions live in top-level extension directories such as `memory/`, `subagent/`, `exa/`, and `slop-scan/`.
- Extension-owned skills live next to their extension under `memory/skills/`.
- Pi prompt templates live under `prompts/*.md` and stay canonical there.

## Extension-owned skill standards

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

## Editing workflow

1. Check nearby skills for overlap before adding another extension-owned workflow.
2. Update docs only when repository-wide conventions or install behavior change.
3. Validate touched `SKILL.md` frontmatter, links, and support-file paths before claiming completion.

## Installation safety

Pi loads the listed extensions, prompt templates, and `memory/skills` through
`package.json`. This repository must not install or export a second general
skill catalog. Manage those skills through the parent `bobcats/skills`
repository.
