---
name: playwright-cli
description: Browser automation with `playwright-cli` for navigation, screenshots, forms, UI checks, and web data extraction. Use when interacting with or testing web pages.
metadata:
  bucket: tools
---

# Playwright CLI

Use browser automation to observe real UI behavior. Prefer snapshots and stable selectors over guessing.

## Workflow

1. **Start or attach**
   ```bash
   playwright-cli open
   playwright-cli goto <url>
   playwright-cli snapshot
   ```

2. **Inspect before acting**
   - Use snapshots to find element refs and accessible names.
   - Note URL, viewport, auth state, and console/network errors when relevant.
   - For advanced workflows, use optional references: [sessions](references/session-management.md), [storage state](references/storage-state.md), [tracing](references/tracing.md), [video](references/video-recording.md), [request mocking](references/request-mocking.md), [test generation](references/test-generation.md), and [running code](references/running-code.md).

3. **Interact through user-visible controls**
   ```bash
   playwright-cli click <ref>
   playwright-cli type <ref> "text"
   playwright-cli press <ref> Enter
   playwright-cli screenshot /tmp/screen.png
   ```

4. **Verify behavior**
   - Check visible text, URL changes, DOM snapshot, screenshots, and network/console output.
   - For bugs, capture the reproduction steps and observed mismatch for `diagnose`.

## Guardrails

- Do not enter real credentials, payment details, or destructive confirmations without explicit approval.
- Do not rely on brittle coordinates when refs/selectors are available.
- Reset or isolate test data when mutating local/dev environments.

## Stop and ask

Ask when auth is required, actions are destructive, environment is production, or visual expected behavior is unclear.

## Output

Return URL, steps performed, observed result, screenshots if taken, and any console/network errors.
