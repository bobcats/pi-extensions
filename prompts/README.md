# Prompt Templates

Pi-native prompt templates live here when they are useful slash-command snippets but not behavior-shaping enough to become authored skills.

Pi discovers these templates through the root `package.json` manifest (`pi.prompts`). After `pi install /path/to/pi-extensions` or `pi update`, each `*.md` file is available as a slash command named after the filename, such as `/zoom-out`.

## Authoring rules

A prompt template should be short, manually invoked, and free of hidden workflow obligations. If it needs guardrails, evidence gates, tool policy, or a durable artifact, promote it to a skill through `write-a-skill`.

Frontmatter `description` is reused when `make build` generates non-Pi prompt-skills. Prompt-only fields such as `argument-hint` are preserved as generated skill metadata.

## Non-Pi skill installs

`make build` generates build-only manual prompt-skills under `build/skills/prompt-<template-name>/` so skill-only agents can invoke the same snippets. Generated prompt-skills include:

- `name: prompt-<template-name>` to avoid collisions with authored skills
- `disable-model-invocation: true`
- metadata with `source-prompt: <template-name>`
- wrapper text defining `$ARGUMENTS`, `$@`, and `$1` as the user input supplied with manual skill invocation

`disable-model-invocation` is honored only by agents that support that field. Do not commit generated prompt-skills under source `skills/` or extension-owned skill directories.
