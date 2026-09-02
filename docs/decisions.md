# Decision log

What was decided, why, and when — kept brief on purpose.

**What earns an entry.** Something a future session (or a reviewer) would otherwise have to ask about, because it is not recoverable by reading the code: a rejected alternative, a non-obvious constraint from an external system (a library's actual behavior, not its docs), or a rule that has to hold across files the code itself doesn't connect. If the code plus its own comments already explain it, it does not belong here — that's what makes this file worth reading instead of skipping. For the current-state picture (stack, module map, what's built vs. pending), see [`architecture.md`](architecture.md); this file is only the "why," not the "what."

**Entries that meet the bar above are not rewritten — only marked.** When a decision is overturned, append a new entry and mark the old one:

> **Superseded 2026-09-04** by "Redocly replaces Spectral in CI".

This file was pruned on 2026-09-06: entries that had become fully recoverable from code (e.g. explained by a comment at the point of use) or that carried no forward relevance (doc reorganisation, a deleted planning file) were removed rather than marked, since they never met the bar above in the first place. Nothing is lost — `git log -- docs/decisions.md` has the original, unpruned file.

Binding conventions live where the work happens: [`api/CONVENTIONS.md`](api/CONVENTIONS.md) for the OpenAPI contract, the repo-root `CLAUDE.md` for code. When one of those changes, edit it there and add an entry here saying what changed and why.

---

### 2026-08-21 — Modular OpenAPI spec files over one document

`docs/api/` is `openapi.yaml` + `paths/*.yaml` + `components/*.yaml`, not a single file — pull-request reviewability across four weeks of iteration mattered more than the portability a single file would have bought. Cost: `$ref`s must be bundled (`openapi.bundled.yaml`) before Swagger UI or most generators will resolve them.

### 2026-08-21 — Spec linting: Spectral for house rules, Redocly for base OAS validity

Spectral enforces this project's own rules (every operation has a summary, every 4xx carries the error schema) but not base schema validity — its `oas3-schema` rule false-positives on every externally-`$ref`'d path/operation, which the modular-files layout above produces on literally every operation. `oas3-schema` is disabled in `.spectral.yaml`; `redocly lint` runs alongside `spectral lint` to cover base validity instead.

### 2026-08-21 — The generated Swagger spec is reconciled against the hand-written one, never allowed to replace it

`@nestjs/swagger` produces a second OpenAPI document from decorators; `docs/api/` stays authoritative, and the generated document is diffed against it with `oasdiff` — a difference is treated as a bug in the implementation until argued otherwise. Letting the generated file become the truth would turn every accidental decorator detail into a silent contract change.

### 2026-08-21 — One error catalog: RFC 9457 body, a 403-versus-404 rule, and a fixed problem-type registry

Every 4xx/5xx returns the same `Problem` shape (`components/responses.yaml`), never a per-operation schema. Rule with no exceptions: 404 when a *user-scoped* resource's ownership is what's hidden (another client's order, cart item, or like — a 403 would confirm the resource exists), 403 when a *global* resource's existence isn't the secret and the caller's role is what's blocking the action. Every distinct failure gets its own `type` slug even when several share a status code — `insufficient-stock` and `promo-code-expired` are both 409, but a consumer can still tell them apart.

### 2026-08-21 — `Money` is a `{ amount, currency }` object, never paired flat fields

Every price, total, and discount — in the contract and in service signatures — is a `Money` shape (`amount`: integer minor units, `currency`: uppercase ISO 4217), never `priceAmount`/`priceCurrency` siblings. Stripe payloads use flat, lowercase `amount`/`currency`, so a flattening step is needed at the payment boundary — not a direct pass-through.

### 2026-08-21 — Four order-transition endpoints (`cancel`/`process`/`ship`/`deliver`) instead of one `PATCH /status`

OpenAPI has no way to say "a delivery person may only write `delivered`" on a generic field update, so each transition is its own operation and its own role restriction — the authorization matrix is readable straight off the spec instead of buried in a runtime check. Not resource-oriented REST by design; each is a distinct state transition, not a field update.

### 2026-08-21 — `Discount` is a discriminated `oneOf`, diverging from `discount_value`'s single-column DB encoding

`promo_codes.discount_value` is one `int` whose meaning (a percent or minor units) depends on the sibling `discount_type` column. The contract instead exposes `PercentageDiscount`/`FixedAmountDiscount` as separate named schemas under a `oneOf` + `discriminator` — they have to be named, not inlined, because `discriminator.mapping` only resolves against `$ref` targets.

### 2026-08-21 — Stock validation belongs to `createOrder`, not the cart

`addCartItem`/`updateCartItem` accept any positive quantity with no stock check; `insufficient-stock` only appears on `createOrder`. This looks like a missing validation and is the opposite: the only check that means anything is the guarded Reserve `UPDATE` inside `createOrder`'s transaction — a soft check on the cart would guarantee nothing (the units can be gone a second later) and would give one problem `type` two different meanings. The cart's only obligation is exposing `availableQuantity` on `CartItem` so a client can render a warning before checkout.

### 2026-08-28 — Prisma pinned to `7.10.0`; several `@nestjs/*` packages pinned off their default `latest`

`npm install prisma` resolves `latest` to a release candidate (`8.0.0-rc.x`) — pinned to `7.10.0` `--save-exact`, the last stable tag. Same issue one layer in: `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport` all have majors realigned to Nest v12 that ship ESM-only, which breaks `ts-jest`'s CommonJS transform outright — pinned to their last CJS, Nest-v11-compatible releases instead. **Re-check this before adding any new `@nestjs/*` or Prisma-adjacent dependency** — `npm install <pkg>` defaulting to `latest` is not safe to assume in this repo.

### 2026-08-28 — Prisma schema modeled incrementally, not the full ERD in one migration

`schema.prisma` only carries the tables the current feature actually touches; the rest of `docs/database/erd.dbml` is added as each feature is designed. Migrations are additive, so there's no cost to deferring, and no way to validate a table's shape against real code before the feature using it exists.

### 2026-08-28 — Layering: `Controller → Service → PrismaService` directly, no repository layer

Every service injects `PrismaService` directly. Chosen alongside the next entry: a repository layer here would exist mainly to be mocked in unit tests, which is exactly the "unit test wearing a costume" the root `CLAUDE.md` warns against. Applies to every future module the same way.

### 2026-08-28 — Unit tests mock `PrismaService`; persistence correctness is an e2e concern

`*.service.spec.ts` mocks `PrismaService` with `jest.fn()`s — what's under test is branch logic (which exception fires, which fields get written, role-based visibility), not whether Postgres actually enforces a constraint. The Testcontainers-backed e2e suite covers that instead.

### 2026-08-28 — Explicit per-route guards, not a global guard with a `@Public()` opt-out

`JwtAuthGuard`/`OptionalJwtAuthGuard` are applied per-operation via `@UseGuards()`, mirroring the contract's own per-operation `security` field. Rejected a global `APP_GUARD` with an opt-out decorator because the contract has a third case beyond public/protected: `listProducts`/`getProduct` are public but shape their response by role *if* the caller happens to be authenticated.

### 2026-08-28 — `@CheckPolicies` must be applied per-method, never once at the controller class level

Found by live testing, not code review: a class-level `@CheckPolicies(...)` was invisible to `PoliciesGuard` (it only read `context.getHandler()`), and the guard's `policyHandlers ?? []` silently fell back to an empty, always-passing list — a client could create a SKU. Fixed at both ends, but the failure mode is silent rather than a compile or test error, so apply `@CheckPolicies` per-method on every future controller, not once on the class.

### 2026-08-28 — Refresh and password-reset tokens: opaque random bytes hashed with sha256, not bcrypt

Both services generate a 256-bit random token and store `sha256(token)`. bcrypt was rejected specifically because its per-call salt makes exact-match lookup (`WHERE token_hash = ?`) impossible — there's no single digest to index on. bcrypt's slow, salted hashing exists to blunt brute-forcing a low-entropy secret (a password); it buys nothing for a token that already has 256 bits of entropy.

### 2026-08-28 — `JwtStrategy` trusts the `role` embedded in the access token; it is not re-read from the database per request

Consequence accepted: if a manager's role is downgraded, their old access token still carries `role: manager` and passes `PoliciesGuard` until it expires (`JWT_ACCESS_EXPIRES_IN`) or their sessions are revoked. Re-checking against Postgres on every request would close that window but adds a DB round trip to every authenticated call. If role changes ever need to take effect immediately, the fix is revoking that user's refresh tokens (`RefreshTokenService.revokeAllForUser`) plus a short access-token TTL — not a per-request DB check.

### 2026-08-28 — SKU duplicate-constraint detection reads the Postgres index name, not `meta.target`

Classic Prisma exposes which unique constraint fired via `error.meta.target: string[]`; this project's actual Postgres + `@prisma/adapter-pg` setup carries no such array — the constraint name lives at `meta.driverAdapterError.cause.constraint.index` instead (`uniqueConstraintIndexName` in `prisma-error.util.ts`). This will recur for every future unique-constraint-guarded write (promo code, Stripe IDs on `payments`) — verify the real error shape again rather than assume classic Prisma's docs apply here.

### 2026-08-28 — Password-change email is synchronous; BullMQ arrives with the stock-notification job

`MailService` (nodemailer → local Mailhog) is called directly and awaited — no queue in front of it. BullMQ/Redis is deferred to the feature that actually needs asynchronous, retryable delivery (stock notifications); a single non-critical email didn't justify standing up the infra early.
