---
name: pup
description: Use Datadog Pup CLI for logs, metrics, traces, APM, monitors, dashboards, SLOs, incidents, cost, security, and infrastructure. Discover Pup's live schema before composing commands.
metadata:
  bucket: tools
---

# Pup

Pup changes quickly. Treat the installed CLI as the source of truth.

## Workflow

1. **Discover first**
   ```bash
   command -v pup
   pup --version
   pup --help
   ```
   - For non-trivial tasks, inspect command-specific help/schema before composing flags.

2. **Scope the Datadog query**
   - service, environment, time window, tags, host, trace ID, monitor ID, dashboard ID, or incident.
   - Keep time windows narrow by default.

3. **Fetch evidence**
   - Logs: query exact service/env/error terms.
   - Metrics/APM: compare baseline vs incident window.
   - Traces: inspect slow/error traces and spans.
   - Monitors/SLOs: read state, history, and thresholds before suggesting changes.

4. **Write actions require care**
   - Ask before changing monitors, dashboards, incidents, SLOs, teams, or notifications.
   - Prefer read-only investigation unless the user requested a change.

## Stop and ask

Ask if credentials/org/site are ambiguous, queries may expose sensitive data, or any mutation is needed.

## Output

Return commands run, time window, filters, observed data, and next diagnostic/action step.
