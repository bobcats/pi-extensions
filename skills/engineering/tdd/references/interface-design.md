# Interface Design for Testability

Use this when only implementation-detail tests seem possible or when the public interface is awkward to exercise.

Good interfaces make honest tests natural. If a behavior is hard to test through the interface, treat that as design feedback before adding test-only seams.

## Patterns

### Accept dependencies, do not create them

Create infrastructure at the shell and pass capabilities into the logic that needs them.

```typescript
// Testable
function processOrder(order: Order, paymentGateway: PaymentGateway) {
  return paymentGateway.charge(order.totalCents);
}

// Harder to test honestly
function processOrder(order: Order) {
  const gateway = new StripeGateway();
  return gateway.charge(order.totalCents);
}
```

### Return values, do not hide outcomes in side effects

Prefer pure transformations or explicit result values when the behavior is computation.

```typescript
// Testable
function calculateDiscount(cart: Cart): Discount {
  return { amountCents: 500, reason: "volume" };
}

// Harder to verify without inspecting mutation
function applyDiscount(cart: Cart): void {
  cart.totalCents -= 500;
}
```

Side effects are fine at system boundaries, but the decision that determines the side effect should usually be testable as data.

### Keep the external interface small

Small interfaces reduce caller knowledge and test setup.

Prefer:

- fewer entrypoints with meaningful behavior
- parameters that represent domain concepts, not incidental plumbing
- typed input shapes over parallel primitive parameters
- explicit result types over hidden state mutation

### Put validation at boundaries

Parse and normalize external input once at ingress. Internal tests should not repeatedly validate raw external shapes unless the behavior under test is the boundary parser itself.

## If no honest seam exists

Do not write a shallow test that cannot fail for the real bug. State the seam gap and either:

- refactor to expose the behavior through a meaningful interface, then test it
- add a higher-level integration/system test through the real user path
- ask for a design decision if changing the interface is not safe within the task
