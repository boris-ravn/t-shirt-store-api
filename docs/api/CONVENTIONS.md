# API contract conventions

Binding rules for the OpenAPI contract in this directory. A spec that breaks one of these is wrong, not merely inconsistent.

**Scope: the contract only.** Code conventions — file naming, DTO boundaries, error handling in services, config access, async style — live in the repo-root `CLAUDE.md` and are not repeated here. Do not start a second conventions file for them.

This is a living document. When a rule changes, edit it here and add an entry to [`../decisions.md`](../decisions.md) saying what changed and why.

---

## The contract itself

Settled 2026-08-21, before the first path was written, because every one of these appears in every endpoint and none of them is cheap to change once fifty paths exist.

| Rule | Reason |
|---|---|
| **`camelCase` in JSON.** The database stays `snake_case`; Prisma `@map` bridges the two. | Either casing works. A spec that mixes them becomes a special case in every consumer's code. |
| **One error body everywhere: RFC 9457 `application/problem+json`.** Defined once in `components/responses`, referenced from every error response. Field-level validation detail rides in an `errors` extension member. | A global exception filter is required by the challenge regardless, so "Nest's default shape is free" buys almost nothing. A consumer has to render something for 400, 401, 403, 404 and 409, and one shape means one renderer. |
| **`limit` / `offset` pagination on every collection**, envelope `{ data, meta: { total, limit, offset } }`. | Mandated by the challenge. Accepted cost: `total` is a second `COUNT` per request. |
| **Money is always an integer in minor units**, with an explicit `currency` alongside it. | Matches the ERD and keeps floats out of DTOs, service signatures, Stripe payloads and fixtures alike. Field names must make the unit unmistakable. |
| **One `bearerAuth` security scheme**, applied globally, with explicit `security: []` on public paths. | Product browsing must work unauthenticated. Declaring it per path is what makes "which endpoints are public" answerable from the spec instead of from the code. |
| **`/v1` prefix in the path**, from the first endpoint. | Free now, awkward to retrofit once anything consumes it. Path versioning over header versioning because it is simpler to reason about in the spec — both are valid. |
| **Precise formats, always:** `format: uuid` on every id, `format: date-time` (UTC, ISO 8601) on every timestamp, real `enum` lists lifted from the ERD, `required` declared honestly. | This is the difference between a document a person can read and one a tool can use. Prism, `openapi-typescript` and contract tests consume the constraints, not the prose. |

---

## Authoring practices

How the document gets written. Working practices rather than trade-off decisions, but binding all the same.

**Treat the spec as code, not as documentation.** Branches, pull requests, review, version control. It is the primary artifact of this phase, not a by-product generated at the end.

**Model the domain before the endpoints.** Define `components/schemas` first — entities, not verbs. The paths follow from the schemas rather than the other way round.

**Reuse aggressively with `$ref`.** A 404 response is defined once in `components/responses` and referenced everywhere after. No copy-pasted error schemas, no copy-pasted pagination envelope.

**Be strict about `required` and types.** Spec-first lives or dies by precision. A field the contract calls optional and the implementation treats as mandatory is a broken contract, not a mismatch to reconcile later.

**Give every operation a unique `operationId`.** Generators use it as the method name; missing or duplicated ids make generation fail or produce names nobody wants to call.

**Put `examples` in the schemas.** Not cosmetic — examples feed Swagger UI, mock servers and contract tests directly.

**Split across files rather than growing one monolith.** External `$ref`s keep pull requests reviewable. Accepted cost: the document must be bundled before tools that do not resolve external references will accept it.

**Lint in CI with Spectral.** The linter is the safety net that decorators plus TypeScript used to provide: every operation has a summary, every 4xx carries the error schema, every operation has an `operationId`. A convention that is not enforced is not a convention.

**Change the contract additively, or version it — never quietly.** Adding an optional field is safe. Renaming a response field, tightening a type, adding a required request field and changing a status code are all breaks, however much they look like improvements. Deprecate and remove on a schedule, or cut a new version.

---

## Where the data model comes from

Schemas in this contract describe what the API exposes, which is not always what the database stores. `../database/README.md` is the source of truth for the data model and for which fields are historical snapshots. Read the relevant section before defining a schema that mirrors a table — the mapping is deliberate in places and deliberately lossy in others.
