---
name: agent-api-design
description: Design and review REST/OpenAPI APIs for AI agents and LLM tool callers. Use when creating or evaluating agent-facing REST endpoints, OpenAPI specs, MCP tool mappings, function schemas, or API docs intended for autonomous tool use.
metadata:
  bucket: design
---

# Agent API Design

Design REST APIs as low-ambiguity tool contracts for non-deterministic agents. Humans can infer conventions from prose and trial-and-error; agents need those conventions encoded in names, schemas, examples, errors, permissions, and retry behavior.

For a full checklist and source anchors, read [checklist](references/checklist.md).

## Workflow

1. **Frame the agent job**
   - Identify the user goal, agent workflow, domain resources, and required side effects.
   - Classify each operation as read-only, additive, destructive, idempotent/non-idempotent, and open-world/closed-domain.
   - State which identifiers the agent may use and where each identifier must come from.

2. **Shape the tool surface**
   - Treat `operationId` as the tool/function name: use semantic verb-noun names such as `listInvoices`, `getInvoice`, `createRefund`, or `previewDeployment`.
   - Avoid overlapping tools (`findUser`, `lookupUser`, `searchUser`) unless descriptions make their selection rules non-overlapping.
   - Keep the initially exposed tool set small and coherent; split or defer large catalogs by resource, risk, or workflow.
   - Put usage triggers, non-use cases, side effects, caveats, and identifier provenance in operation descriptions.

3. **Make schemas hard to misuse**
   - Use strict OpenAPI/JSON Schema: concrete types, `enum`, `format`, `minimum`/`maximum`, `pattern`, and closed objects where supported.
   - Prefer domain-specific parameter names (`customer_id`) over ambiguous names (`user`, `id`, `data`).
   - Include realistic examples for nested objects, optional-field combinations, date formats, and ID formats.
   - Do not accept stringified JSON, unconstrained blobs, or parameter combinations that can express invalid states.

4. **Design REST resources plus task affordances**
   - Use stable resource nouns and predictable collection/item paths for normal CRUD.
   - Add task-shaped endpoints only when they reduce error-prone multi-call plans, such as `previewInvoiceUpdate` before `updateInvoice`.
   - Return explicit handles for stateful or long-running workflows; do not rely on hidden connection/session state.

5. **Protect the context window**
   - Return concise, high-signal default responses with stable semantic IDs and next useful state.
   - Support pagination from launch for every collection that can grow.
   - Provide documented filtering, sorting, field selection, or `response_format: concise|detailed` when responses can be large.

6. **Make recovery deterministic**
   - Support idempotency keys on mutating requests that agents may retry.
   - Model long-running work as jobs/operations with status, progress, result, error, and cancellation when possible.
   - Use structured, machine-readable errors with field-level details, retry guidance, and links to relevant docs.
   - Document rate-limit headers, `Retry-After`, backoff expectations, and whether retries must reuse the same idempotency key.

7. **Put safety in the API, not the prompt**
   - Use least-privilege scopes and separate credentials for read, write, admin, and destructive capabilities.
   - Require preview/dry-run plus explicit confirmation or approval tokens for irreversible, financial, bulk, or privileged actions.
   - Prefer soft deletes and reversible workflows where feasible.
   - Record audit events for sensitive operations: caller, operationId, request ID, idempotency key, approval ID, input summary, result, and trace link.
   - Treat MCP annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` as UX/risk hints only, never as authorization controls.

8. **Verify with an agent scenario**
   - Check that an agent can discover the spec, choose the right operation, fill required parameters without inventing IDs, recover from validation errors, paginate safely, and avoid unsafe writes without approval.
   - If editing code/specs, run the local OpenAPI/schema/tests/build checks available in the repo.
   - If only designing, label assumptions and unverified behavior explicitly.

## Stop and ask

Ask before continuing if:

- the agent job or primary resources are unclear
- destructive, financial, admin, or bulk operations lack approval and rollback requirements
- auth scopes or tenant boundaries are unknown
- required identifiers cannot be traced to prior API responses or user input
- pagination, retries, or async completion semantics affect correctness but are unspecified
- the requested API surface is a broad catalog rather than a focused workflow or resource set

## Output

Return:

- proposed or reviewed operations with `operationId`, method/path, side-effect class, and required scopes
- schema and description changes needed for reliable tool use
- response-size controls, pagination/filtering, idempotency, async, and error-model decisions
- safety gates and audit requirements for risky actions
- evidence checked: existing specs/routes/docs, examples, tests, or source anchors
- open assumptions and verification still needed
