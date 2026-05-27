---
name: sentry-issue
description: Investigate Sentry issues using sentry-cli or API fallback. Use when given a Sentry issue URL or asked to fetch exception, stacktrace, release, tags, request, or event context.
metadata:
  bucket: tools
---

# Sentry Issue

Fetch the real event details before proposing fixes.

## Workflow

1. **Parse the issue URL**
   - Identify organization, project, issue ID, and optional event ID.
   - Confirm auth with `sentry-cli` when available.

2. **Fetch issue and event data**
   ```bash
   sentry-cli --version
   sentry-cli info
   ```
   - Use `sentry-cli` API support when present.
   - If not, use the Sentry REST API with the same approved token source.

3. **Extract debugging evidence**
   - exception type/message
   - stacktrace frames in app code
   - release/commit/deploy info
   - tags: environment, transaction, culprit, browser/runtime
   - request/job/user breadcrumbs when safe
   - frequency and first/last seen

4. **Connect to code**
   - Map stack frames to current code and recent changes.
   - Use `diagnose` when available; otherwise reproduce the failure or create a regression loop before fixing here.

## Guardrails

- Do not expose PII, secrets, request bodies, or auth tokens in summaries.
- Do not assume latest event matches all events; inspect grouping when needed.
- Ask before resolving/assigning/commenting on Sentry issues.

## Output

Return issue URL/ID, event inspected, root clue, relevant stack frames, affected release/environment, and next action.
