# Beads skills

Skills shipped alongside the beads extension.

## Included skills

- `code` — implementation workflow with beads tracking
- `create` — issue creation guidance
- `plan` — planning workflow with beads tracking
- `storm` — brainstorming workflow with beads tracking

## Invocation mode

Beads skills support normal model invocation and can also be run explicitly.

Manual invocation remains available via `/skill:beads-*` commands.

### Workflow intent

The intended sequence is:

1. `beads-storm` — shape feature scope and create epic/features
2. `beads-plan` — decompose features into executable tasks + plan docs
3. `beads-code` — implement leaf tasks with TDD and verification

## Shared references

Shared references live in `shared/`:

- `shared/cli-basics.md`
- `shared/session-recovery.md`
- `shared/verification-close.md`
- `shared/workflow-boundary.md`

Skills reference these files to stay consistent without duplicating every rule.
