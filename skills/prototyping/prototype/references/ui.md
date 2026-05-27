# UI Prototype

Use for visual structure, page flow, and information hierarchy.

## Prefer existing context

Prefer mounting variants inside an existing route/page so real navigation, density, data, and layout constraints are visible. Create a new throwaway route only when no existing page can host the experiment.

## Shape

- Default to 3 variants; cap at 5.
- Gate variants with a shareable URL search param such as `?variant=A`.
- Keep existing data fetching/auth/params above the variant switch when using an existing route.
- Make variants structurally different: layout, information hierarchy, primary action, or flow. Color/copy tweaks do not count.
- Add a floating switcher that cycles variants and updates the URL.
- Hide the switcher in production builds if there is any chance the branch could be deployed.

## Handoff

Give the user the URL and variant keys. Ask what to keep, combine, or discard.

## Cleanup

When a direction wins, record why, delete losing variants and the switcher, then rebuild the winning direction as production code with normal tests and verification.
