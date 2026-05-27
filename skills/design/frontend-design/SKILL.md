---
name: frontend-design
description: Design professional, information-dense user interfaces before frontend implementation. Use when building or changing pages, components, UI flows, dashboards, tables, forms, or interaction patterns.
metadata:
  bucket: design
---

# Frontend Design

Design for people who use the interface repeatedly. Predictable, dense, and clear beats decorative.

## Workflow

1. **Study existing UI first**
   - Read 2-3 nearby pages/components.
   - Note layout patterns, spacing scale, tokens, table/form conventions, empty states, and loading states.
   - Use the relevant framework skill before writing frontend code.

2. **Define the job of the screen**
   - Who uses it, how often, and under what pressure?
   - What decision or action must become easier?
   - What information must be scannable at a glance?

3. **Choose the information architecture**
   - Put the primary action and primary data path first.
   - Use tables for comparison and repeated records; do not use cards when scanning rows matters.
   - Use progressive disclosure for secondary detail, not for hiding required work.

4. **Match the system**
   - Use existing components, tokens, typography, spacing, and color semantics.
   - Deviate only when the existing pattern fails the workflow, and say why.
   - Keep color functional: status, priority, selected state, destructive action, primary action.

5. **Handle interaction states**
   - Specify loading, empty, error, disabled, selected, filtered, and permission-limited states.
   - For async search/filtering, keep old results visible while fetching new ones; avoid flashing full-page loaders after initial load.
   - Keep motion short and functional: feedback, continuity, or state change only.

6. **Verify the interface**
   - Check density, hierarchy, keyboard/mouse flows, responsiveness, and console errors.
   - Run typecheck/build or the relevant frontend verification.
   - If the direction is uncertain, use `prototype` before production implementation.

## Hard constraints

Do not add:

- hero/splash layouts for daily work screens
- decorative illustrations or playful motion
- marketing copy in operational UI
- hardcoded colors when tokens exist
- cards for comparable tabular data
- fabricated frontend events or type escapes to satisfy handlers

## Stop and ask

Ask before implementing if:

- there is no clear primary user action or data priority
- existing UI patterns conflict and no local convention wins
- the user is choosing between materially different layouts that need `prototype`
- accessibility, permissions, or destructive actions are underspecified
- required data is unavailable or would need backend/API changes

## Output

Return:

- design direction and rationale
- existing patterns followed or deliberately changed
- key states handled
- verification performed
- remaining UX risks or prototype questions
