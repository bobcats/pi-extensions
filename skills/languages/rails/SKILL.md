---
name: rails
description: Rails-specific guidance for models, controllers, jobs, migrations, tests, and performance. Use when working in a Rails app.
metadata:
  bucket: languages
---

# Rails

Use Rails conventions, but keep domain behavior testable and explicit.

## Workflow

1. Apply Ruby fundamentals too: clear object boundaries, explicit errors, and behavior-focused tests.
2. Follow existing app architecture before adding a new pattern.
3. Keep controllers thin: params/auth/response orchestration only.
4. Put domain behavior where it is easiest to test through public behavior.
5. Treat migrations, callbacks, jobs, and transactions as operational risk surfaces.
6. Use project-native specs/checks as evidence; broaden coverage for requests, jobs, migrations, callbacks, and authorization changes.

## Guardrails

- Avoid callbacks for surprising domain behavior; prefer explicit commands/methods when ordering matters.
- Avoid default scopes and broad concerns that hide behavior.
- Use strong params and authorization checks at boundaries.
- Preload associations deliberately; watch for N+1 queries.
- Make migrations reversible or explicitly irreversible with rationale.
- Use background jobs for slow/remote work; make jobs idempotent.

## Review checklist

- controller actions enforce auth and handle invalid input
- model validations match database constraints where needed
- transactions cover multi-write invariants
- migrations are safe for production data volume
- specs cover request/job/model behavior at the right seam

## Evidence

Before claiming completion, include evidence for affected requests/models/jobs, migration safety, authorization, and production data assumptions.

## Stop and ask

Ask before unsafe migrations, broad callback changes, auth changes, or data backfills.
