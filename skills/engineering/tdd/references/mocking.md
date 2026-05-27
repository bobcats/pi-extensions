# Mocking

Use this when a test needs a double or when mock setup is getting large.

## Default stance

Do not mock your own internal modules by default. Prefer testing through the public behavior and real code paths.

Mocks are appropriate when they stand in for a real process boundary or when interaction itself is the behavior:

- external APIs: payment, email, partner services
- time, randomness, UUID generation
- filesystem or network edges when the real dependency is slow or unsafe
- orchestration objects where the contract is “this message/job/event is sent”

Prefer real local substitutes when practical:

- test database over mocked database when the persistence behavior matters
- in-memory filesystem over filesystem mocks when file behavior matters
- fake local adapter over deep nested mocks for owned services

## Treat deep mocks as design feedback

Long mock setup, mocks returning mocks, or tests that reconstruct collaborator traversal are coupling signals.

Ask:

- Is this mock describing a public interaction we care about?
- Or is it recreating the object's private traversal graph?
- Can the production code hide the next hop behind a meaningful interface?
- Can the interesting logic move into a pure core with a thin shell at the boundary?

Do not preserve a bad traversal graph in test doubles just to make a unit test pass.

## Boundary dependency injection

At real boundaries, pass dependencies in rather than constructing them inside the logic.

```typescript
// Testable boundary
type PaymentGateway = {
  charge(amountCents: number): Promise<ChargeResult>;
};

async function processPayment(order: Order, gateway: PaymentGateway) {
  return gateway.charge(order.totalCents);
}

// Harder to test honestly
async function processPayment(order: Order) {
  const gateway = new StripeGateway(process.env.STRIPE_KEY);
  return gateway.charge(order.totalCents);
}
```

## Specific adapters beat generic fetchers

Use named operations for external systems instead of one generic request function that forces conditional test setup.

```typescript
// Good: each operation has one shape
const billingApi = {
  getCustomer: (id: string) => fetchCustomer(id),
  createInvoice: (input: InvoiceInput) => createInvoice(input),
};

// Bad: tests must branch on endpoint/options inside the mock
const billingApi = {
  fetch: (endpoint: string, options?: RequestInit) => fetch(endpoint, options),
};
```

Specific adapters make tests easier to read, give each mock one return shape, and keep type contracts close to the external operation.

## Red flags

- mock assertions replace behavior assertions
- mock setup is longer than the behavior under test
- a mock knows about another mock's internals
- changing private method names breaks tests
- the test double has conditional logic mirroring production branching
