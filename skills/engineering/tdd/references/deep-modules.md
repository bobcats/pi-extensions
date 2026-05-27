# Deep Modules in TDD

Use this when a TDD cycle reveals shallow pass-through code, hard-to-test orchestration, or repeated setup across callers.

A **deep module** has a small interface with substantial behavior behind it. It gives callers and tests high leverage: learn a little interface, exercise a lot of behavior.

A **shallow module** exposes an interface nearly as complex as its implementation. It often passes parameters through, forces callers to know sequencing, or spreads rules across many call sites.

## Why this matters for tests

The interface is the test surface. Good tests cross the same seam as callers. If tests must reach past the interface to verify behavior, the module may be too shallow or the seam may be in the wrong place.

## Signals during TDD

Consider deepening when:

- every new test repeats the same setup ceremony
- callers must orchestrate many small functions in a strict order
- invariants are duplicated across tests or call sites
- private helper tests feel necessary to get confidence
- mocks expose nested collaborator structure
- a bug fix requires changing several callers to preserve one concept

## Deletion test

Imagine deleting the module:

- If complexity disappears, it was likely pass-through code.
- If complexity reappears across many callers, the module was earning its keep.

## Example

Shallow caller orchestration:

```typescript
validateOrder(order);
const tax = calculateTax(order, region, exemptions);
const discounts = applyDiscounts(order, discountRules);
const invoice = createInvoice(order, tax, discounts);
await persistInvoice(invoice);
await emitInvoiceCreated(invoice);
```

Deeper interface:

```typescript
const invoice = await invoiceGenerator.generate(orderId);
```

The deeper module can hide loading, validation, tax, discounts, numbering, persistence, and events behind one caller-facing behavior.

## TDD rule

Do not redesign while RED. Get the current behavior green first unless the missing seam prevents an honest test. Refactor only while green, then rerun the tests after each step.
