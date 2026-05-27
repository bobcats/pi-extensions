---
name: react
description: React and React-facing TypeScript guidance for components, props, events, forms, wrapper APIs, and hooks. Use when writing or reviewing React components or UI behavior.
metadata:
  bucket: languages
---

# React

Design component contracts first; keep rendering predictable and state ownership clear.

## Workflow

1. Define UI direction and type-safety constraints before editing.
2. Read nearby components for state, styling, data-fetching, and test patterns.
3. Define the component contract: props, callbacks, controlled/uncontrolled state, loading/error/empty states.
4. Keep domain data transformations outside JSX when they grow complex.
5. Test behavior through rendered UI and user interactions.
6. Use project-native type, lint, component, and browser checks as evidence when they match the risk.

## Guardrails

- Do not fabricate React synthetic events; expose callbacks with values/domain payloads instead.
- Avoid `as any`, `React.FC` by default, prop bags, and boolean-prop explosions.
- Keep hooks unconditional and dependency arrays honest.
- Do not mirror props into state unless intentionally editing a draft.
- Avoid wrapper components that merely rename a third-party API without simplifying it.

## Review checklist

- component has a clear owner for state
- async/loading/error states are explicit
- callbacks describe domain events, not DOM internals
- effects have cleanup and correct dependencies
- tests assert user-visible behavior, not implementation details

## Evidence

Before claiming completion, include evidence for rendered behavior, type safety, accessibility-critical interactions, and async/loading/error states.

## Stop and ask

Ask if ownership of state, component API, or visual behavior is ambiguous.
