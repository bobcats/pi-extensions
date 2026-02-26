---
name: beads-create
description: Create and maintain beads issues with correct `br` CLI commands, flags, and dependency wiring.
---

# beads-create

Write well-structured issues and execute beads CLI commands to create them.

## Shared References

- [CLI basics](../shared/cli-basics.md)
- [Verification and close standards](../shared/verification-close.md)
- [Workflow boundary](../shared/workflow-boundary.md)

## Activation

- About to run `br create`
- Updating issue fields with `br update`
- Linking hierarchy/dependencies with `br dep add`

## Workflow Gates

1. **Feature creation belongs to storm.** If feature scope is unclear, route to `@beads-storm` first.
2. **Task decomposition belongs to plan.** If creating implementation tasks for a feature, use `@beads-plan` structure.
3. **No implementation here.** `@beads-create` only creates/updates/wires issues.

If asked to code during this phase, respond:

**"I can't implement code in `@beads-create`; this skill only manages issue structure. Use `@beads-code` after planning is complete."**

## Issue Quality

### Features use user-story format

```
As a [role], I want [goal], so that [benefit].
```

Good: "As a returning user, I can sign in with Google so that I don't need another password."

Bad: "Add OAuth integration" (implementation language, not user value)

### Tasks use technical language

Tasks describe code changes, not user outcomes. Keep them specific and small (15-60 minutes).

### INVEST check

Stories should be: **I**ndependent, **N**egotiable, **V**aluable, **E**stimable, **S**mall, **T**estable.

### Acceptance criteria are testable

Use checkboxes or Given-When-Then:

```
- [ ] User receives tracking email after purchase
- [ ] Given I am logged in, when I place an order, then I receive confirmation
```

## Core Commands

### Create Issue

```bash
br create "[title]" \
  --type [epic|feature|task|bug] \
  --priority [0-4] \
  --description "[why this exists]"
```

Common optional flags:
- `--design "..."`
- `--labels "frontend,backend,security"`
- `--external-ref "gh-123"`
- `--assignee "name"`

### Update Issue

```bash
br update <id> --acceptance-criteria "[criteria]"
br update <id> --notes "[implementation notes]"
br update <id> --description "[updated rationale]"
```

### Add Dependencies / Hierarchy

```bash
br dep add <child-id> <parent-id> --type parent-child
```

Use parent-child links to build epic → feature → task → subtask structure.

## Workflow

1. Draft issue content with user-story format (features) or technical description (tasks).
2. Run `br create` and save returned ID.
3. Run `br update` for acceptance criteria/notes as needed.
4. Run `br dep add` to wire hierarchy.

## Verification

After running commands, confirm:
- [ ] Issue ID captured
- [ ] `br create` succeeded with correct type/priority
- [ ] Required updates applied via `br update`
- [ ] Parent/child links created with `br dep add`
