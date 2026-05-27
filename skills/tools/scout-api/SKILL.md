---
name: scout-api
description: Query Scout APM via REST API for performance investigations. Use when inspecting slow endpoints, traces, error groups, N+1 insights, memory bloat, or application metrics.
metadata:
  bucket: tools
---

# Scout API

Use Scout as read-only performance evidence before optimizing code.

## Workflow

1. **Check access**
   - Confirm Scout API token and account/application identifiers are available through the approved environment.
   - If missing, ask for access or a report export.

2. **Scope the investigation**
   - application, endpoint/job, environment, time window, deployment, error group, or trace.
   - Prefer a narrow recent window plus a baseline comparison.

3. **Fetch relevant data**
   - app metrics: apdex, throughput, error rate, p95/p99
   - endpoint/job summaries
   - traces for slow examples
   - N+1, slow query, allocation, and memory insights
   - error group details and stack traces

4. **Tie evidence to code**
   - Map endpoint/job names to routes, controllers, jobs, queries, or spans.
   - Use `diagnose` when available; otherwise reproduce or build a feedback loop for the suspected bottleneck before changing code here.

## Guardrails

- Do not use Scout API for instrumentation setup or agent configuration.
- Do not optimize from aggregate metrics alone when traces are needed.
- Avoid sharing sensitive request/user data in chat.

## Stop and ask

Ask if time window/app is ambiguous, token is missing, or data includes sensitive production details.

## Output

Return API endpoints/filters used, metrics/traces observed, suspected bottleneck, and next diagnostic step.
