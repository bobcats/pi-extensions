# Agent-facing REST API Checklist

Use this for full design reviews, OpenAPI reviews, or when converting REST endpoints into LLM/MCP tools.

## Contract and discovery

- Publish a complete OpenAPI 3.x/3.1 contract at a predictable URL such as `/openapi.json`.
- Keep OpenAPI synchronized with runtime behavior; prefer contract-first or spec tests when possible.
- Include `servers`, `securitySchemes`, tags, request/response schemas, examples, and all relevant error responses.
- Add a compact capability index when the full spec is large, such as `llms.txt`, `/.well-known/tools`, or a curated tool catalog.
- Make the spec parseable by common tool generators; avoid vendor-only features for core semantics.

## Operation and tool naming

- Every operation has a stable `operationId`; assume it becomes an agent function name.
- Use verb-noun names: `listCustomers`, `getCustomer`, `searchOrders`, `createRefund`, `previewDeployment`.
- Include parent context where needed: `listCustomerInvoices`, not just `listInvoices`, if scoped under a customer.
- Avoid names based on HTTP mechanics: `postRefund`, `apiV1RefundsCreate`, `callEndpoint`.
- Namespace large surfaces by service/resource when exposed as tools: `github_listPullRequests`, `stripe_createRefund`.
- Avoid near-synonyms unless their descriptions make selection deterministic.

## Descriptions and examples

- Descriptions explain what the operation does, when to use it, when not to use it, side effects, limitations, and expected result shape.
- Parameter descriptions explain provenance: “must be returned by `searchCustomers`; do not invent.”
- Include examples for:
  - minimal valid request
  - common full request
  - nested objects or optional-field combinations
  - date/time and identifier formats
  - validation errors and recovery
- Keep examples realistic; avoid `string`, `foo`, or placeholder IDs when examples teach format.

## Request schema quality

- Use concrete scalar types, `enum`, `const`, `format`, `pattern`, min/max bounds, array item schemas, and closed objects where supported.
- Prefer discriminated unions or explicit mode enums over invalid boolean combinations.
- Avoid free-form object blobs unless the endpoint is truly schema-less.
- Avoid stringified JSON.
- Mark only truly required fields as required; do not force agents to hallucinate missing context.
- Use stable, semantic IDs over internal database IDs when possible.
- Validate all inputs server-side; treat model output as untrusted.

## Resource modeling

- Use RESTful resource nouns for standard entities and collections.
- Expose relationships predictably: `/customers/{customer_id}/invoices`.
- Add task-shaped operations when they encode a real workflow step or safety gate, not just because verbs are convenient.
- Provide preview/dry-run endpoints for risky mutations.
- Return explicit handles for stateful workflows; do not depend on hidden per-connection state.
- State handle lifetime and expiry behavior.

## Response design and context efficiency

- Default responses are concise and high-signal.
- Include stable IDs, status/state, timestamps, and the fields needed for likely next actions.
- Avoid huge nested expansions by default.
- Support `fields`, `select`, `include`, or `response_format=concise|detailed` for large resources.
- Make response schemas complete, including nullable fields and state enums.
- For tool outputs, prefer structured JSON unless the target agent runtime performs better with another evaluated format.

## Pagination, filtering, sorting

- Add pagination at launch for every collection that can grow.
- Prefer opaque cursor/keyset pagination for changing collections.
- Document default limit, max limit, ordering, cursor lifetime, and end-of-list semantics.
- Require all filters/sorts except page size to remain stable across cursor pages; reject mismatches clearly.
- Whitelist filter and sort fields; document operators and value types.
- Avoid arbitrary query languages unless the agent has a safe builder or constrained grammar.

## Idempotency and retries

- Support idempotency keys for mutating operations that may be retried.
- Document key format, max length, retention TTL, parameter mismatch behavior, and whether failures are cached.
- On retries, return the original result or a clear conflict/mismatch error.
- Include request IDs and idempotency IDs in responses and logs.
- Consider domain-level duplicate detection for high-risk semantically duplicate actions with different keys.

## Long-running operations

- Use `202 Accepted` plus `Location` or a returned job/operation object for slow work.
- Provide `GET /jobs/{job_id}` or equivalent with status, progress, metadata, result, and error.
- Support cancellation for operations where cancellation is meaningful.
- Include partial failure details when batch/long operations can partly succeed.
- Offer webhooks/callbacks for orchestrators that can receive them, but keep polling available unless callbacks are mandatory.

## Error model

- Use structured errors such as Problem Details (`application/problem+json`) or a consistent equivalent.
- Include machine-readable `code`/`type`, human title/detail, HTTP status, instance/request ID, and docs link.
- Include field-level validation errors with expected format/range/enum and suggestions where possible.
- Distinguish permanent client errors from transient errors.
- For 429/503, include `Retry-After` and rate-limit reset metadata.
- Do not expose internal stack traces or secret-bearing details.

## Auth, permissions, and tenant safety

- Use OAuth scopes, service-account permissions, or API keys with least privilege.
- Document required scopes per operation in OpenAPI.
- Separate read, write, admin, billing/financial, and destructive capabilities.
- Validate tenant/resource authorization on every request, including job handles, cursor tokens, and returned links.
- Do not encode authorization into opaque cursors or handles; still authorize each call.
- Keep credentials out of URLs.

## Destructive-action safety

- Classify destructive, financial, external-message, privileged, and bulk operations explicitly.
- Require preview/dry-run for risky actions.
- Require approval tokens or human confirmation for irreversible/high-impact actions.
- Prefer soft delete, undo, staged rollout, or canary mechanisms.
- Make repeated destructive calls idempotent or clearly conflict-safe.
- Treat MCP risk annotations as hints only; enforce safety on the server side.

## Rate limits and backoff

- Return explicit limit headers: limit, remaining, reset, and relevant quota bucket.
- Return `429` with `Retry-After` and a structured error body.
- Document exponential backoff with jitter and maximum retry count.
- Distinguish global, endpoint, tenant, and concurrency limits if they behave differently.
- Provide quota/status endpoints only if they do not encourage polling; prefer response headers for normal planning.

## Observability and audit

- Emit structured logs and traces with request ID, operationId, caller, tenant, auth scope, idempotency key, status, latency, and error code.
- Audit sensitive operations with input summaries, output summaries, approval/confirmation IDs, and trace links.
- Record tool/catalog version or OpenAPI version when requests come from generated tools.
- Monitor invalid parameter errors, repeated retries, wrong-tool patterns, and oversized responses; use them to improve schemas and descriptions.

## MCP and tool-schema mapping

- Map OpenAPI `operationId` to tool name.
- Map `summary`/`description` to tool description; descriptions must stand alone when loaded without the full docs.
- Map request schemas to `inputSchema`; include output schemas where supported.
- Return deterministic tool order for prompt caching when listing tools.
- Use explicit state handles for multi-call workflows.
- Annotate trusted tools with `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, but do not depend on annotations for access control.

## Agent evaluation scenarios

Test with realistic prompts that require the agent to:

- find the right operation from names/descriptions
- ask for missing required user input instead of inventing it
- obtain an ID from one operation and use it in another
- recover from a validation error using field-level details
- paginate until completion without changing filters incorrectly
- retry a write safely with an idempotency key
- start and poll a long-running job
- stop before a destructive action without approval
- obey rate-limit retry guidance

## Source anchors

- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — tool right-sizing, namespacing, high-signal responses, evaluations.
- [Anthropic: Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) — detailed descriptions, input schemas, input examples, strict tool use.
- [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling) — tool/function schemas, descriptions, strict mode, deferred tool search, small initial tool sets.
- [Model Context Protocol: Tools](https://modelcontextprotocol.io/specification/draft/server/tools) — tool discovery, deterministic order, explicit handles, output schemas, safety considerations.
- [MCP blog: Tool annotations as risk vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/) — read-only/destructive/idempotent/open-world hints and their trust limits.
- [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests) — idempotency key behavior and retention.
- [Stripe: Pagination](https://docs.stripe.com/api/pagination) — cursor pagination and list response shape.
- [Stripe: Rate limits](https://docs.stripe.com/rate-limits) — 429 handling, rate/concurrency limits, backoff.
- [GitHub: REST API best practices](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api) — avoid polling, handle rate limits, conditional requests, do not parse URLs.
- [Google AIP-158: Pagination](https://google.aip.dev/158) — pagination from launch, page tokens, page-size semantics.
- [Google AIP-151: Long-running operations](https://google.aip.dev/151) — operation handles, progress metadata, validate-only behavior.
- [Microsoft Azure: Web API design best practices](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design) — REST design, filtering, field selection, OpenAPI.
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457.html) — structured HTTP error format.
