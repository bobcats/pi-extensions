# Beads CLI Basics

## Required commands
- `br ready --sort priority`
- `br list --status in_progress`
- `br show <id> --json`
- `br create ...`
- `br close <id> --reason "Verified: ..."`

## Dependency types
- `parent-child`: hierarchy only
- `blocks`: execution order
- `related`: non-blocking association
- `discovered-from`: traceability
