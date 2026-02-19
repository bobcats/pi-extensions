---
shaping: true
---

# Beads Extension v2 — Frame

## Source

> I want to use shaping skills to make beads better and be a better extension for pi agents. Do some brave searching and thinking about how this could be the most powerful and enable really tight workflows.

> Current beads workflow context: Use beads for ALL task tracking, create issues BEFORE writing code, mark in_progress when starting, close with verification evidence.

## Problem

Beads today is a thin wrapper around `br` CLI: it detects projects, shows a status bar, primes agents with workflow rules, blocks dirty-tree closes, and warns at 85% context. The skills (storm, plan, code, create) carry the real workflow, but the extension doesn't actively participate in the agent's work loop.

**Pain points:**

1. **Context death** — After compaction, the agent gets the same generic prime message regardless of what it was doing. Rich context (which task, what approach, what files, what's left) is lost. The agent has to manually re-discover state.

2. **Passive checkpointing** — The beads-code skill *tells* agents to checkpoint, but the extension doesn't enforce or automate it. Agents forget. Context vanishes.

3. **No git↔issue linkage** — Commits and issues live in parallel universes. There's no automatic association, no branch-per-issue, no "what did I change for this issue" view.

4. **Dumb work selection** — `/beads` shows a flat list. No dependency tree visibility, no "what unblocks next" intelligence, no automatic continuation after close.

5. **Minimal recovery** — Resume context shows the in-progress issue title and last comment. That's it. No file inventory, no test state, no architectural decisions from the issue thread.

6. **Manual lifecycle** — Agent must explicitly claim, checkpoint, verify, close, and pick next. The extension could automate the mechanical parts.

## Outcome

Beads becomes the **execution backbone** for pi agents — not just a status display, but an active participant that:
- Survives context death by injecting rich, structured recovery context
- Automates the mechanical parts of the work loop (claim, checkpoint, continue)
- Links git activity to issues automatically
- Surfaces dependency-aware work selection
- Makes the agent feel like it has persistent memory across compactions and sessions
