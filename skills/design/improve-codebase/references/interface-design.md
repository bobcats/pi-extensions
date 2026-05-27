# Interface Design

Use this when the user selects a deepening candidate and wants to explore the shape of the new module interface. The goal is not to implement yet; it is to compare radically different seams before choosing.

Use the vocabulary in [architecture language](language.md): **module**, **interface**, **seam**, **adapter**, **depth**, **leverage**, and **locality**.

## Process

### 1. Frame the problem space

Before designing alternatives, summarize for the user:

- the current friction and evidence
- the callers and tests that cross the current seams
- the constraints the new interface must satisfy
- the dependencies and their category from [deepening](deepening.md)
- which domain terms from `CONTEXT.md` should name the module or concepts

Include a small illustrative code sketch only if it clarifies constraints. It is not a proposal.

### 2. Generate alternatives

Create at least three substantially different interface designs. Use subagents when the alternatives can be explored independently; otherwise draft the alternatives yourself.

Give each alternative a different bias:

1. **Minimal interface** — 1-3 entry points, maximum leverage per entry point.
2. **Flexible interface** — supports more cases and extension points, with explicit complexity tradeoffs.
3. **Common-case interface** — optimizes the most frequent caller path and makes defaults trivial.
4. **Ports-and-adapters interface** — use when a remote-owned or external dependency drives the seam.

Each alternative should include:

- interface shape: methods/types/parameters plus invariants, ordering, errors, config, and performance expectations
- usage example from a real caller
- what implementation details sit behind the seam
- dependency and adapter strategy
- tests that would survive implementation refactors
- tradeoffs in depth, locality, and leverage

### 3. Compare and recommend

Present alternatives sequentially, then compare them in prose. Do not leave the user with a menu and no opinion.

Contrast by:

- **Depth** — how much behavior sits behind how much interface
- **Locality** — where bugs and changes concentrate
- **Seam placement** — what varies at the seam and what stays private
- **Test surface** — what tests can prove through the interface
- **Migration risk** — how callers move from old shape to new shape

End with a recommendation. If a hybrid is strongest, say exactly which pieces to combine and why.

## Stop conditions

Stop and ask if:

- the domain concept that should name the module is unclear
- alternatives would contradict an ADR
- the user is asking for implementation before choosing an interface
- all alternatives differ only in syntax, not seam placement or leverage
