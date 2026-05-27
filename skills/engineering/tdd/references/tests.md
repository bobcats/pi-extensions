# Test Shape

Use this when choosing a test seam or reviewing whether a RED test is meaningful.

## Good tests

Good tests verify observable behavior through a public interface or user-visible path.

```typescript
// Good: behavior through the caller-facing interface
test("user can checkout with a valid cart", async () => {
  const cart = createCartWith(product);

  const result = await checkout(cart, paymentMethod);

  expect(result.status).toBe("confirmed");
});
```

Characteristics:

- names the behavior users or callers care about
- exercises real code paths where practical
- uses public entrypoints, not private helpers
- survives internal refactors when behavior stays the same
- asserts settled state, not intermediate scheduler or implementation state
- keeps setup inline enough that the test reads locally

## Bad tests

Bad tests couple to implementation structure.

```typescript
// Bad: internal collaboration, not behavior
test("checkout calls paymentService.process", async () => {
  const payment = mockPaymentService();

  await checkout(cart, payment);

  expect(payment.process).toHaveBeenCalledWith(cart.total);
});
```

Red flags:

- mocking internal collaborators you own
- testing private methods
- asserting on internal call counts or ordering when the observable outcome is what matters
- verifying through storage internals instead of the public read path
- test name describes how code works instead of what behavior exists
- test breaks on a refactor that preserves behavior

## Behavioral verification beats mechanism confirmation

For a bug, reproduce the observed symptom first. Add mechanism-level tests only after the behavioral test proves the bug. Otherwise you may confirm a plausible theory without reproducing the real failure.

```typescript
// Weak: confirms storage happened, not whether callers can observe the behavior
test("createUser inserts a row", async () => {
  await createUser({ name: "Alice" });
  const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
  expect(row).toBeDefined();
});

// Better: verifies through the system's interface
test("created user can be retrieved", async () => {
  const user = await createUser({ name: "Alice" });
  const retrieved = await getUser(user.id);
  expect(retrieved.name).toBe("Alice");
});
```

## Discovery tests

When you need to learn an output shape or rendered value, prefer a test with an intentionally wrong assertion over a throwaway REPL/script if setup is involved. The failure message becomes repeatable discovery, and the corrected assertion can stay as regression coverage.
