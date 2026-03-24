---
description: Brainstorm a code simplification pass before implementation
---
I want to design a code simplification pass for: $@

This is a design/brainstorm step only — no edits yet.

## Simplification Rubric

**Preserve functionality.** Never change what the code does — only how it does it.

**Enhance clarity:**
- Reduce unnecessary complexity and nesting
- Eliminate redundant code and abstractions
- Improve variable and function names
- Consolidate related logic
- Remove comments that describe obvious code
- Choose clarity over brevity — three clear lines beat one clever one
- Prefer if/else or switch over nested ternaries

**Maintain balance.** Don't over-simplify:
- Don't combine too many concerns into one function
- Don't remove helpful abstractions
- Don't create "clever" code that's hard to debug

**Scope:** Only refine code recently modified or touched in the current session, unless explicitly told to go broader.

## Process

Use the `brainstorming` skill process — one question at a time, present design in sections, validate incrementally. Apply the simplification rubric above as the design constraint.

When the design is ready:
- Use the `writing-plans` skill to create an implementation plan
- Use the `executing-plans` skill to implement it
