---
name: beads-storm
description: Brainstorm a feature area and decompose it into beads issues with hierarchy and dependencies.
disable-model-invocation: true
---

# Beads Storm

Explore the problem space through collaborative dialogue, converge on a design, and capture the result as a beads epic with user-story features.

## Shared References

- [CLI basics](../shared/cli-basics.md)
- [Workflow boundary](../shared/workflow-boundary.md)

## Philosophy

**Explore before committing.** The cheapest time to change direction is before any code exists. Ask questions, propose alternatives, and validate incrementally.

**YAGNI ruthlessly.** Every feature you add is a feature you maintain. Cut anything that isn't essential to the core goal. You can always add more later.

**One question at a time.** Don't overwhelm with a wall of questions. Ask one, wait for the answer, then ask the next.

## The Process

### Phase 1: Understand the Idea

Before proposing anything, understand what you're working with.

1. Check project state — read key files, recent commits, existing docs
2. Ask clarifying questions one at a time:
   - What is the user-facing goal?
   - Who benefits from this?
   - What does "done" look like?
   - What constraints exist? (tech stack, timeline, dependencies)

**Prefer multiple choice questions** — they're faster and surface assumptions:

```
"How should users authenticate?
A) Email/password only
B) OAuth (Google, GitHub)
C) Both
D) Something else"
```

### Phase 2: Explore Approaches

Propose 2-3 different approaches with trade-offs.

- Lead with your recommendation and explain why
- Cover: architecture, complexity, risk, what gets deferred
- Let the user pick or combine

Don't skip this phase. Even when one approach seems obvious, naming alternatives surfaces hidden assumptions.

### Phase 3: Define Features

Identify user-facing capabilities needed. Each feature answers: "What can the user do that they couldn't before?"

Present features incrementally in sections of 200-300 words. After each section, check:
- "Does this look right so far?"
- "Anything missing or unnecessary?"

**Apply YAGNI at every step.** For each proposed feature, ask: "Is this essential for the core goal, or nice-to-have?" Cut nice-to-haves.

Features must be:
- **Independent** — implementable in any order (unless blocked)
- **User-focused** — described from user's perspective, not technical
- **Testable** — clear acceptance criteria
- **Single-action** — one capability per feature

Use user-story format: `As a [role], I want [goal], so that [benefit].`

### Phase 4: Create Epic and Features in Beads

Once features are validated, create them.

**Create epic:**

```bash
br create "Epic title" --type epic --priority 1 --description "Why this epic exists"
```

**Create features** — each MUST use user-story format:

```bash
br create "As a [role], I want [goal], so that [benefit]" --type feature --priority N --description "Acceptance criteria and context"
br dep add <feature-id> <epic-id> --type parent-child
```

**Wire blocking dependencies** between features where order matters:

```bash
br dep add <later-feature> <earlier-feature> --type blocks
```

Common blocking patterns:
- Auth → features requiring auth
- Data models → features using those models
- Core functionality → features extending it

### Phase 5: Probe for Completeness

After creating all features, ask:
- "What error cases should we handle?"
- "What edge cases exist?"
- "What security considerations apply?"
- "What about [related capability]?"

Create additional features for gaps discovered. Apply YAGNI — note nice-to-haves but don't create features for them.

### Phase 6: Show Result and Hand Off

```bash
br dep tree <epic-id>
br count --by-type
```

**"Epic and features are ready. Run `@beads-plan` to break these into implementation tasks."**

## Output

Storm produces:
1. Beads epic with features wired via `parent-child`
2. Blocking dependencies where feature order matters
3. Each feature in user-story format with acceptance criteria

## Key Principles

- **One question at a time** — don't overwhelm
- **Multiple choice preferred** — surfaces assumptions
- **2-3 approaches before settling** — always explore alternatives
- **Incremental validation** — present in sections, check each
- **YAGNI ruthlessly** — cut what isn't essential
- **Features are user stories** — not technical tasks
- **Output is beads, not docs** — epic + features with acceptance criteria
