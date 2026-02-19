# Beads skills

Skills shipped alongside the beads extension.

## Included skills

- `code` — implementation workflow with beads tracking
- `create` — issue creation guidance
- `plan` — planning workflow with beads tracking
- `storm` — brainstorming workflow with beads tracking

## Invocation mode

All beads skills are configured with:

```yaml
disable-model-invocation: true
```

That makes them manual-only:

- hidden from automatic model invocation
- available via explicit `/skill:beads-*` commands

## Shared references

Shared references live in `shared/`:

- `shared/cli-basics.md`
- `shared/session-recovery.md`
- `shared/verification-close.md`
- `shared/workflow-boundary.md`

Skills reference these files to stay consistent without duplicating every rule.
