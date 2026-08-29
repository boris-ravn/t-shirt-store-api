# Decision log

What was decided, why, and when.

**What earns an entry.** A choice a reviewer would ask you to justify, whose reasoning is not recoverable from the code. Dependencies, layering, anything where the honest answer was "it depends". Not doc reorganisation, not naming, not anything the code already shows — a log padded with those is one nobody reads.

**Entries are never rewritten or deleted.** When a decision is overturned, append a new entry and mark the old one. That marker is the only permitted edit to an existing entry:

> **Superseded 2026-09-04** by "Redocly replaces Spectral in CI".

The reasoning that turned out wrong is usually the most useful thing in the file. Editing it away removes the reason for keeping a log at all.

This file is history, not rules. Binding conventions live where the work happens: [`api/CONVENTIONS.md`](api/CONVENTIONS.md) for the OpenAPI contract, the repo-root `CLAUDE.md` for code. When one of those changes, edit it there and add an entry here saying what changed and why.

---

### 2026-08-21 — `strict: true` in `tsconfig.json`, not the Nest CLI's flag set

The CLI's `--strict` sets four individual flags and leaves `strictFunctionTypes`, `strictPropertyInitialization` and `useUnknownInCatchVariables` off, which reads as strict mode without being it. Consequence to accept: DTO properties need the definite-assignment assertion (`name!: string`) because `class-transformer` populates the instance at runtime, outside the compiler's view. Disabling the flag for DTOs was rejected — the assertion is defensible in review, a weakened compiler is not.

### 2026-08-21 — The ERD and the OpenAPI contract live in the project, under `docs/`

`docs/database/` for the DBML, `docs/api/` for the contract, `docs/decisions.md` for this log. They travel with the repo a reviewer clones, rather than sitting in the module-wide notes directory one level up.

### 2026-08-21 — No dependencies beyond the Nest scaffold until a design calls for them

Prisma, Swagger, CASL, Stripe, BullMQ and the rest get proposed one at a time, with what each replaces, at the point the feature needing it is designed. Installing the full stack up front produces a `package.json` that cannot be defended line by line.

### 2026-08-21 — `docs/database/README.md` is the only place the data model is explained

Its rationale is not summarised in the project `README.md` or in `CLAUDE.md`; both point at it instead. The summary in `CLAUDE.md` was written from `erd_v2.txt` and drifted from the committed `erd.dbml` within a day — it asserted a payment-link stock guard on raw `stock` instead of `stock - reserved_stock`, which would oversell into cart reservations. Cost accepted: an agent has to open a roughly 300-line document before writing code that touches stock, payments, promos or order history. That is cheaper than a confident wrong invariant.

### 2026-08-21 — API contract conventions, approved as a batch

Casing, error body, pagination, money representation, security scheme, versioning and format precision. Recorded in [`api/CONVENTIONS.md`](api/CONVENTIONS.md) rather than here, because they are rules to follow rather than history to read.

### 2026-08-21 — Modular spec files over a single document

Overrides the single-file recommendation made during planning. The argument for one file was portability and trivial linting; the argument that won was pull-request reviewability, which matters more across four weeks of iteration than a bundling step does. Cost accepted: `$ref`s must be bundled before Swagger UI and some generators will resolve them, so bundling becomes part of the pipeline rather than an afterthought.

### 2026-08-21 — Spectral for spec linting, not Redocly

Both lint OpenAPI competently. Spectral was chosen for its custom rulesets: the point is not catching malformed YAML but enforcing house rules the challenge cares about, such as every operation carrying a summary and every 4xx carrying the error schema. Still open: whether it lands as a `devDependency` or stays an `npx` invocation until the CI pipeline exists.

### 2026-08-21 — The generated spec is reconciled against the hand-written one, never allowed to replace it

Week 3 requires `@nestjs/swagger`, which produces a second OpenAPI document from decorators. The hand-written contract in `docs/api/` stays authoritative; the generated document is diffed against it with `oasdiff`, and a difference is treated as a bug in the implementation until argued otherwise. The alternative — letting the generated file become the truth — turns every accidental implementation detail into a silent contract change, which is the same drift that already cost us the `CLAUDE.md` invariant list.

### 2026-08-21 — Spectral's `oas3-schema` rule disabled; Redocly lint covers base OAS validity instead

Every path in this contract is an external `$ref` from `openapi.yaml` into `paths/*.yaml`, by design (modular files). Spectral's built-in `oas3-schema` rule false-positives on exactly that shape — `"<key>" property must not have unevaluated properties"` on every externally-`$ref`'d path item or operation — verified by cross-checking the same document with `redocly lint`, which reports it valid. Left enabled, this is one guaranteed error per operation, forever, making "zero Spectral errors" unattainable regardless of how correct the contract is. `oas3-schema` is turned off in `.spectral.yaml`; `redocly lint` runs alongside `spectral lint` as the base-schema-validity check, and Spectral stays scoped to the house rules it was chosen for.

### 2026-08-21 — One error catalog: RFC 9457 body, a 403-versus-404 rule, and a fixed problem-type registry

Every 4xx/5xx in the contract returns the same `Problem` shape (`application/problem+json`), never a per-operation schema. Two things make that single shape usable instead of vague: a rule applied without exception — 404 when a *user-scoped* resource's ownership is what's hidden (another client's order, cart item, or like; returning 403 would confirm the resource exists), 403 when a *global* resource's existence isn't the secret and the caller's role is what's blocking the action — and a registry of 27 `type` slugs (`docs/api/openapi-plan.md` §3.4) that gives every distinct failure its own identifier even when several share a status code. Without the registry, `insufficient-stock` and `promo-code-expired` would both just be "409", indistinguishable to a consumer at checkout. 413 and 415 are the one approved extension to the catalog, scoped to `uploadProductImage` alone — two standard codes mean exactly those two conditions, and folding them into 400 would have cost that precision for no gain.

### 2026-08-21 — `Money` is a `{ amount, currency }` object, never paired flat fields

Every price, total, and discount in the contract is a `$ref` to one `Money` schema (`amount`: integer minor units, `currency`: uppercase ISO 4217) rather than e.g. `priceAmount` + `priceCurrency` siblings. One `$ref` means the unit is enforced by type, not by naming discipline, and amount and currency can't drift apart on a partial update. Cost accepted: consumers get one more level of nesting, and Stripe payloads (which use flat `amount`/`currency` in lowercase) need a small flattening step at the payment boundary rather than a direct pass-through.

### 2026-08-21 — Four order-transition endpoints (`cancel`/`process`/`ship`/`deliver`) instead of one `PATCH /status`

A single `PATCH /v1/orders/{id}/status { status }` would need a request schema covering the full six-value `order_status` enum on every caller, and OpenAPI has no way to say "a delivery person may only write `delivered`." Four separate operations make the authorization matrix readable straight off the spec — each operation's own role restriction *is* the state-machine edge, rather than being buried in a runtime check against a generic field update. Cost accepted: the four paths are verbs (`/cancel`, `/process`, `/ship`, `/deliver`), which is not resource-oriented REST; each is a distinct state transition, not a field update, and the contract treats it as such rather than pretending otherwise.

### 2026-08-21 — `restockSku` takes a delta; `stock` is excluded from `PATCH /v1/skus/{skuId}`

None of the five guarded stock transitions in `docs/database/README.md` §8 is "a manager sets `stock` to N" — every one is a conditional `UPDATE` relative to the current value. An absolute `PATCH stock = 5` can't be expressed as a guarded conditional update: it would silently clobber a concurrent Reserve or Fulfil, and it could drive `stock` below `reserved_stock`, violating the table's own `CHECK` constraint. `restockSku`'s `{ quantity }` is a delta added to `stock` — the Restock transition already in the table — which composes safely under concurrency. `UpdateSkuRequest` therefore has no `stock` property at all; the omission is deliberate, not an oversight to flag in review.

### 2026-08-21 — `Discount` is a discriminated `oneOf` (`percentage` | `fixedAmount`), diverging from `discount_value`'s single-column encoding

`promo_codes.discount_value` is one `int` meaning either a whole percent or minor units, depending on the sibling `discount_type` column — mirroring that as a single integer field in the contract would force every consumer to branch on a sibling field just to know what the number means. The contract instead exposes two named, `$ref`-able schemas (`PercentageDiscount`, `FixedAmountDiscount`) joined by `oneOf` with a `discriminator`, so the shape declares its own unit. This required the two branches to be separate named schemas rather than inlined directly under `oneOf` — OpenAPI's `discriminator.mapping` only resolves against `$ref` targets, so inlining would have silently broken discrimination. The mapping to the ERD column pair is mechanical and total in both directions.

### 2026-08-21 — Stock validation belongs to `createOrder`, not the cart

`addCartItem` and `updateCartItem` accept any positive quantity with no stock check; `insufficient-stock` appears on `createOrder` alone. This reads as a missing validation and is in fact the opposite: the only check that means anything is the guarded Reserve `UPDATE` inside `createOrder`'s transaction, and any earlier check is advisory at best. A soft check on the cart returning 409 when `quantity > available` was evaluated and rejected — it guarantees nothing, since the units can be gone a second later, and it would put the same problem `type` in two places meaning two different things ("you cannot add this" versus "your order failed"). The contract's only obligation on the cart side is exposing `availableQuantity` on every `CartItem`, so a client can render a warning before checkout — not enforcing it.

### 2026-08-21 — `docs/api/openapi-plan.md` deleted; its load-bearing content had already migrated into the contract

The plan was scaffolding for an execution phase, not a permanent artifact — it stayed untracked for that reason. It was committed by accident in a later commit and has now been removed. Everything a reviewer would actually need from it lives elsewhere: the 27-slug problem-type registry is fully enumerated with worked examples in `components/responses.yaml`, and the ERD-vs-contract mappings are stated in the relevant schema descriptions (e.g. `OrderItem`'s "a snapshot at purchase time — never re-resolved through products or skus"). It remains recoverable from git history if the reasoning behind an earlier decision needs re-checking. Two references to it predate this entry and are left as-is rather than edited: `.spectral.yaml`'s header comment (corrected directly, since a comment is not a decision-log entry) and this file's own "One error catalog" entry above, which cites `openapi-plan.md` §3.4 for the registry — that citation is now stale by definition, and this entry is the record of why, per the rule that an existing entry is never rewritten.

### 2026-08-21 — Product image upload stays multipart-through-the-API, not a presigned S3 URL

Two ways to get a file into S3: the client uploads to our API and the service pushes to S3 (current), or the client asks the API for a presigned URL and uploads directly to S3, then confirms. For product photos — a few MB, not user-generated video — the presigned flow buys scale this project doesn't need and costs real complexity: an S3 CORS policy, a confirm-completion step, a cleanup story for uploads that start and never confirm, and file-type/size validation that runs *after* the bytes already landed in the bucket instead of before. Multipart-through-the-API validates before anything touches S3, matching the existing 413/415 error catalog cleanly, and is one API call end to end. If upload volume or file size ever becomes a real bottleneck, moving to presigned URLs is a contained, well-understood change — but it is not one this project's scale justifies now.

### 2026-08-28 — Prisma pinned to 7.10.0, not the 8.0.0-rc npm installs by default

`npm install prisma` resolved `latest` to `8.0.0-rc.12` — a release candidate, not a stable release; `7.10.0` was the last stable tag (`prev`). Pinned to `7.10.0` with `--save-exact`: prisma.io's docs and the reference material `prisma init` itself installs both describe this as current, and a training project shouldn't be built against a pre-release's API surface. The same reasoning applied one layer further in: `@nestjs/config`, `@nestjs/jwt` and `@nestjs/passport` all resolve to majors realigned with Nest's own version numbering (v12) and shipped as ESM-only (`"type": "module"`) — which breaks ts-jest's CommonJS transform outright, surfaced by the first test file rather than by npm's peer-dependency warning. Pinned each to its last CJS, Nest-v11-compatible release instead (`4.0.4`, `11.0.2`, `11.0.5`).

### 2026-08-28 — Prisma schema modeled incrementally, not the full ERD in one migration

`schema.prisma` holds only the seven tables and two enums Week 3 actually touches (`users`, `password_reset_tokens`, `refresh_tokens`, `categories`, `products`, `product_images`, `skus`); `orders`, `payments`, `promo_codes` and the rest of `docs/database/erd.dbml` are added as each Week 4 feature is designed. Rejected modeling the complete, already-approved ERD up front — Prisma migrations are additive, so there's no cost to deferring, and there would be no way to validate those tables' shape against real code until the features that use them exist anyway.

### 2026-08-28 — Layering: `Controller → Service → PrismaService` directly, no repository layer

Settled during Week 3 planning and followed since: every service in `auth`, `users` and `catalog` injects `PrismaService` directly rather than going through a repository abstraction. Chosen alongside the unit-test-strategy decision below — a repository layer here would exist mainly to be mocked in unit tests, which is exactly the "unit test wearing a costume" the root `CLAUDE.md`'s testing section warns about.

### 2026-08-28 — Unit tests mock `PrismaService`; persistence correctness is an e2e concern

Every `*.service.spec.ts` from Week 3 mocks `PrismaService` with `jest.fn()`s rather than hitting a real database — the standard NestJS testing-module pattern. What's under test is branch logic (which exception fires, which fields get written, role-based visibility), not whether Postgres actually enforces a constraint; the Testcontainers-backed e2e suite covers that. A more literal reading of the root `CLAUDE.md`'s "mock only what genuinely cannot run locally" — hitting real Postgres even for these — was evaluated and set aside for Week 3's pace; the repository-free layering above means there's no fake abstraction being mocked either way, only Prisma's own generated client shape.

### 2026-08-28 — Password-change email is synchronous this week; BullMQ arrives in Week 4

`MailService` (nodemailer → local Mailhog in dev) is called directly and awaited from `AuthService.resetPassword`, with no queue in front of it. Rejected standing up BullMQ/Redis a week early for a single non-critical email — it lands in Week 4 alongside the stock-notification job that actually needs asynchronous, retryable delivery.

### 2026-08-28 — Refresh and password-reset tokens: opaque random bytes hashed with sha256, not bcrypt

Both `RefreshTokenService` and `PasswordResetTokenService` generate a 256-bit random token and store `sha256(token)` — never the raw value, and never a bcrypt hash. bcrypt was rejected specifically because its per-call salt makes exact-match lookup (`WHERE token_hash = ?`) impossible: there's no single digest to index on, so verifying a presented token would mean fetching every outstanding row and calling `bcrypt.compare` on each one. bcrypt's slow, salted hashing exists to blunt brute-forcing a low-entropy secret (a password); it buys nothing for a token that already has 256 bits of entropy.

### 2026-08-28 — Explicit per-route guards, not a global guard with a `@Public()` opt-out

`JwtAuthGuard`/`OptionalJwtAuthGuard` are applied per-operation via `@UseGuards()`, mirroring the contract's own per-operation `security` field, rather than a global `APP_GUARD` with public routes opting out via a decorator. Rejected the global-guard pattern because the contract has a third case beyond "public" and "protected": `listProducts`/`getProduct` are public but shape their response by role *if* the caller happens to be authenticated, which a binary public/protected split doesn't model without an awkward exception.

### 2026-08-28 — `@CheckPolicies` must be applied per-method, never once at the controller class level

Found by live testing, not code review: applying `@CheckPolicies(...)` once on `SkusController` instead of on each `@Post()`/`@Patch()`/`@Delete()` method let a client successfully create a SKU. `PoliciesGuard` originally read only `context.getHandler()` (method-level Reflector metadata) — a class-level decorator was invisible to it, and the guard's `policyHandlers ?? []` silently fell back to an empty, always-passing list. Fixed at both ends: the decorator moved back to per-method (matching `categories`/`products`), and `PoliciesGuard` itself now checks `getAllAndOverride([handler, class])`, so a class-level `@CheckPolicies` is read as a fallback instead of silently doing nothing, should this be attempted again.

### 2026-08-28 — `JwtStrategy` trusts the `role` embedded in the access token; it is not re-read from the database per request

`JwtStrategy.validate` returns `{ id: payload.sub, role: payload.role }` straight from the token — no `prisma.user.findUnique` in the hot path of every authenticated request. Consequence accepted: if a manager's role is downgraded, the old access token still carries `role: manager` and passes `PoliciesGuard` until it expires (`JWT_ACCESS_EXPIRES_IN`, currently 15m) or the user's sessions are revoked and a fresh token is issued. Re-checking the role against Postgres on every request would close that window but adds a DB round trip to every single authenticated call for a project at this scale and threat model. Revisit if role changes ever need to take effect immediately (e.g. an admin forcibly demoting a compromised account) — the fix there is revoking that user's refresh tokens (`RefreshTokenService.revokeAllForUser`, already used by `resetPassword`) plus a short access-token TTL, not a per-request DB check.

### 2026-08-28 — SKU duplicate-constraint detection reads the Postgres index name, not `meta.target`

`duplicate-sku`'s `conflictingField` needs to say which unique constraint fired — `skuCode` or `(productId, size, color)`. Classic Prisma exposes this via `error.meta.target: string[]`; verified directly against this project's actual Postgres + `@prisma/adapter-pg` setup that a P2002 error here carries no such array at all — the constraint name lives at `meta.driverAdapterError.cause.constraint.index` instead (e.g. `"skus_sku_code_key"`). `prisma-error.util.ts`'s `uniqueConstraintIndexName` reads that path instead; every `duplicate-sku` response was reporting the wrong `conflictingField` until this was found and fixed by a live test.
