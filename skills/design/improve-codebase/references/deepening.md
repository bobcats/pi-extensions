# Deepening

Use this when an audit candidate is a cluster of shallow modules that may become one deeper module. Assumes the terms in [architecture language](language.md): **module**, **interface**, **seam**, and **adapter**.

## Dependency categories

Classify dependencies before recommending a seam. The category determines how the deepened module should be tested.

### 1. In-process

Pure computation, in-memory state, no I/O.

Recommendation: merge or reshape the modules and test through the new interface directly. No adapter is needed.

### 2. Local-substitutable

Dependencies with local test stand-ins, such as PGLite for Postgres or an in-memory filesystem.

Recommendation: keep the seam internal. Test the deepened module through its interface using the local stand-in. Do not expose a port at the external interface only for tests.

### 3. Remote but owned

Your own services across a network boundary: internal APIs, microservices, queues.

Recommendation: define a port at the seam. Put domain logic in the deep module; inject transport as an adapter. Production uses HTTP/gRPC/queue adapters. Tests use in-memory adapters.

Useful wording:

> Define a port at the seam, implement a production adapter and an in-memory test adapter, so logic sits in one deep module even though deployment crosses a network.

### 4. True external

Third-party services you do not control, such as Stripe, Twilio, or an external partner API.

Recommendation: inject the external dependency behind a port. Tests provide a mock or fake adapter. Keep external-specific edge cases concentrated inside the adapter or integration module.

## Seam discipline

- **One adapter means a hypothetical seam. Two adapters means a real seam.** Do not add a port unless at least two adapters are justified, usually production plus test or two real runtime variants.
- **Do not leak internal seams.** A deep module may have private seams, but callers should not learn them unless they are part of the real interface.
- **Prefer replacing shallow tests.** Once behavior is covered through the deepened module's interface, old unit tests for pass-through modules are often noise.
- **Expose variation, not structure.** A seam should represent something that varies, not just mirror the current file layout.

## Testing strategy: replace, do not layer

- Write tests at the deepened module's interface.
- Assert on observable outcomes, not internal state.
- Tests should survive internal refactors.
- Delete or rewrite tests that only lock down the old shallow structure.
- If a test must change when the implementation changes but behavior stays the same, it is testing past the interface.
