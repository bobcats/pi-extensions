# Architecture Language

Use this vocabulary when presenting architecture or deepening candidates. Consistent language prevents vague refactor advice.

## Terms

**Module**
Anything with an interface and an implementation: function, class, package, subsystem, or tier-spanning slice.
_Avoid_: unit, component, service.

**Interface**
Everything a caller must know to use the module correctly: type signature, invariants, ordering constraints, error modes, required configuration, and performance characteristics.
_Avoid_: API or signature when you mean the whole caller contract.

**Implementation**
What is inside a module. Use **adapter** instead when discussing a concrete thing that satisfies an interface at a seam.

**Depth**
Leverage at the interface. A module is **deep** when much behavior sits behind a small interface. A module is **shallow** when the interface is nearly as complex as the implementation.

**Seam**
A place where behavior can be altered without editing in that place; the location where a module's interface lives.
_Avoid_: boundary, because it is overloaded with DDD bounded contexts.

**Adapter**
A concrete thing satisfying an interface at a seam. It describes the role a thing fills, not how big or complex its implementation is.

**Leverage**
What callers get from depth: more capability per unit of interface they must learn.

**Locality**
What maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place instead of spreading across callers.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module may have many internal moving parts, but callers and tests do not need to know them.
- **The deletion test.** If deleting a module makes complexity disappear, it was likely pass-through code. If complexity reappears across callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If tests must reach past the interface, the module may be the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real seam.** Do not introduce a seam unless something actually varies across it.
- **Internal seams are allowed.** A deep module can have private seams used by its implementation and tests without exposing them through the external interface.

## Relationships

- A **Module** has an **Interface** and an **Implementation**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Rejected framings

- **Depth as line-count ratio.** This rewards padded implementation. Use depth-as-leverage instead.
- **Interface as only a TypeScript `interface` or public method list.** That is too narrow; include invariants, ordering, errors, config, and performance.
- **Boundary as a synonym for seam.** Say **seam** or **interface** unless discussing DDD bounded contexts.
