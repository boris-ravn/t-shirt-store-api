# Decision log

What was decided, why, and when — kept brief on purpose. An entry earns its place only if it's *not* recoverable by reading the code: a rejected alternative, a non-obvious constraint from an external system (a library's actual behavior, not its docs), or a rule that has to hold across files the code itself doesn't connect. For the current-state picture (stack, module map, what's built vs. pending), see [`architecture.md`](architecture.md) — this file is only the "why."

Entries meeting that bar are never rewritten, only marked when overturned (e.g. `> **Superseded 2026-09-04** by "Redocly replaces Spectral in CI".`); this file is otherwise pruned periodically, removing entries that never met the bar (recoverable from code, already superseded, or no forward relevance) rather than marking them. Nothing is lost — `git log -- docs/decisions.md` has every prior version.

Binding conventions live where the work happens: [`api/CONVENTIONS.md`](api/CONVENTIONS.md) for the OpenAPI contract, this project's standing coding conventions for code — edit those, and add an entry here saying what changed and why.

---

### 2026-08-21 — Spec linting: Spectral for house rules, Redocly for base OAS validity

Spectral enforces this project's own rules (every operation has a summary, every 4xx carries the error schema) but not base schema validity — its `oas3-schema` rule false-positives on every externally-`$ref`'d path/operation, which `docs/api/`'s split-file layout (`paths/*.yaml`, `components/*.yaml`) produces on literally every operation. `oas3-schema` is disabled in `.spectral.yaml`; `redocly lint` runs alongside `spectral lint` to cover base validity instead.

### 2026-08-21 — The generated Swagger spec is reconciled by eye, never allowed to replace the hand-written one

`@nestjs/swagger`'s generated OpenAPI document is checked against the hand-written `docs/api/` each slice, never allowed to replace it — a difference is treated as a bug in the implementation until argued otherwise. Manual, not automated: `oasdiff` has no working npm distribution and this environment has no Go toolchain to build it from source.

### 2026-08-21 — One error catalog: RFC 9457 body, a 403-versus-404 rule, and a fixed problem-type registry

Every 4xx/5xx returns the same `Problem` shape (`components/responses.yaml`), never a per-operation schema. Rule with no exceptions: 404 when a *user-scoped* resource's ownership is what's hidden (another client's order, cart item, or like — a 403 would confirm the resource exists), 403 when a *global* resource's existence isn't the secret and the caller's role is what's blocking the action. Every distinct failure gets its own `type` slug even when several share a status code — `insufficient-stock` and `promo-code-expired` are both 409, but a consumer can still tell them apart.

### 2026-08-21 — `Money` values are flattened at the Stripe boundary

Stripe payloads use flat, lowercase `amount`/`currency` fields — a flattening step is needed at the payment boundary, never a direct pass-through of this project's own `Money` shape (`{ amount, currency }`, see `api/CONVENTIONS.md`).

### 2026-08-21 — Stock validation belongs to `createOrder`, not the cart

`addCartItem`/`updateCartItem` accept any positive quantity with no stock check; `insufficient-stock` only appears on `createOrder`. This looks like a missing validation and is the opposite: the only check that means anything is the guarded Reserve `UPDATE` inside `createOrder`'s transaction — a soft check on the cart would guarantee nothing (the units can be gone a second later) and would give one problem `type` two different meanings. The cart's only obligation is exposing `availableQuantity` on `CartItem` so a client can render a warning before checkout.

### 2026-08-28 — Prisma pinned to `7.10.0`; several `@nestjs/*` packages pinned off their default `latest`

`npm install prisma` resolves `latest` to a release candidate (`8.0.0-rc.x`) — pinned to `7.10.0` `--save-exact`, the last stable tag. Same issue one layer in: `@nestjs/config`, `@nestjs/jwt`, `@nestjs/passport` all have majors realigned to Nest v12 that ship ESM-only, which breaks `ts-jest`'s CommonJS transform outright — pinned to their last CJS, Nest-v11-compatible releases instead. **Re-check this before adding any new `@nestjs/*` or Prisma-adjacent dependency** — `npm install <pkg>` defaulting to `latest` is not safe to assume in this repo.

### 2026-08-28 — Prisma schema modeled incrementally, not the full ERD in one migration

`schema.prisma` only carries the tables the current feature actually touches; the rest of `erd.dbml` is added as each feature is designed — migrations are additive, so there's no cost to deferring.

### 2026-08-28 — Layering: `Controller → Service → PrismaService` directly, no repository layer

Every service injects `PrismaService` directly. Chosen alongside the next entry: a repository layer here would exist mainly to be mocked in unit tests, which is exactly the "unit test wearing a costume" pattern this project avoids. Applies to every future module the same way.

### 2026-08-28 — Unit tests mock `PrismaService`; persistence correctness is an e2e concern

`*.service.spec.ts` mocks `PrismaService` with `jest.fn()`s — what's under test is branch logic (which exception fires, which fields get written, role-based visibility), not whether Postgres actually enforces a constraint. The Testcontainers-backed e2e suite covers that instead.

### 2026-08-28 — `@CheckPolicies` must be applied per-method, never once at the controller class level

Found by live testing, not code review: a class-level `@CheckPolicies(...)` was invisible to `PoliciesGuard` (it only read `context.getHandler()`), and the guard's `policyHandlers ?? []` silently fell back to an empty, always-passing list — a client could create a SKU. Fixed at both ends, but the failure mode is silent rather than a compile or test error, so apply `@CheckPolicies` per-method on every future controller, not once on the class.

### 2026-08-28 — `JwtStrategy` trusts the `role` embedded in the access token; it is not re-read from the database per request

Consequence accepted: if a manager's role is downgraded, their old access token still carries `role: manager` and passes `PoliciesGuard` until it expires (`JWT_ACCESS_EXPIRES_IN`) or their sessions are revoked. Re-checking against Postgres on every request would close that window but adds a DB round trip to every authenticated call. If role changes ever need to take effect immediately, the fix is revoking that user's refresh tokens (`RefreshTokenService.revokeAllForUser`) plus a short access-token TTL — not a per-request DB check.

### 2026-08-28 — SKU duplicate-constraint detection reads the Postgres index name, not `meta.target`

This project's actual Postgres + `@prisma/adapter-pg` setup exposes a fired unique constraint differently than classic Prisma's docs describe — the real shape lives in `uniqueConstraintIndexName` (`prisma-error.util.ts`), which carries its own comment on why. Verify the real error shape again for every future unique-constraint-guarded write (promo code, Stripe IDs on `payments`) rather than assume classic Prisma's `meta.target` applies here.

### 2026-09-03 — CASL's `'manage'` matches every action, including custom ones — a role with `manage` needs an explicit `cannot(...)` to keep a custom action off-limits

Verified directly against the installed `@casl/ability`, not assumed: granting `can('manage', X)` makes `ability.can(<any action string>, X)` return `true`, including actions invented for this project (`apply`, and later `cancel`/`process`/`ship`/`deliver` on `Order`) — `manage` is a real wildcard, not shorthand for the five CRUD-ish actions used elsewhere. Caught because `PromoCode`'s manager grant silently also passed the client-only `apply` check; fixed with `cannot('apply', 'PromoCode')` right after the `can('manage', ...)` (confirmed `cannot`-after-`can` scopes to just that action). Check for this explicitly whenever a role gets `manage` on a subject that also has a custom action meant for a different role.

### 2026-09-03 — Order status transitions use guarded `updateMany` calls, not `SELECT ... FOR UPDATE`; raw SQL is reserved for the two guards Prisma's filter language genuinely can't express

Order status transitions (`cancel`/`process`/`ship`/`deliver`) use guarded `updateMany({ where: { id, status: pending, ... } })` — the first call to succeed atomically claims the transition, needing no raw SQL since `status = 'pending'` is a plain-value comparison. Raw SQL (`$executeRaw`) is reserved for the two guards that compare two columns of the *same row* — the stock Reserve guard (`stock - reserved_stock >= qty`) and the promo redemption guard (`times_redeemed < usage_limit`) — which Prisma's filter language cannot express at all; verified directly against live Postgres (parameterized UUIDs need no `::uuid` cast, row count is the correct guard signal). Fulfil doesn't need this treatment: it only runs once Reserve already verified availability, so an unconditional plain `update` is enough. Default to a guarded `updateMany`; reach for `$executeRaw` only when a guard actually compares two columns of the same row.

### 2026-09-03 — `createOrder` claims the cart's specific items as the first statement inside its transaction, not just at the end

Two concurrent `POST /v1/orders` for the same cart could both read the same snapshot, both pass the Reserve guard independently, and both create a full order — Reserve only checks physical stock, not whether this cart state was already claimed. Fixed with the same guarded-UPDATE idiom as Reserve/promo redemption: `tx.cartItem.deleteMany({ where: { id: { in: <snapshot ids> }, cartId } })` runs first inside the transaction, and its affected count must equal the snapshot length or the transaction aborts. Verified with a permanent e2e test firing two concurrent checkouts against real Postgres (a mocked-Prisma unit test can't exercise a race between two real transactions). General lesson: any read used both to decide *what* to write and to compute values inside a later transaction needs its own claim — this is what motivated the same treatment for Payment Intent/Payment Link creation below.

### 2026-09-04 — Payment Link checkout trusts the webhook's real quantity, not the request that started it

`payment_links` has no `quantity` column, but checkout takes a `quantity` from the client. Checked against the installed Stripe SDK's types: a Payment Link's line item has one fixed `quantity` unless `adjustable_quantity` is enabled, letting the buyer change it on Stripe's page after our `pending` order was already created with the originally-requested amount. Rejected keying `PaymentLink` reuse on `(skuId, quantity)` — would multiply Stripe objects and contradict the ERD's one-link-per-SKU shape. Fix: keep `adjustable_quantity` enabled, and `checkout.session.completed`'s handler calls `stripe.checkout.sessions.listLineItems` (the webhook payload never carries the real quantity) and overwrites `order_item.quantity`/`subtotal`/`total` before running the Direct-sale guard.

### 2026-09-04 — `createPaymentIntent`/`createPaymentLinkCheckout`'s first-write races, closed with guarded claim-or-reuse

Same race shape as the cart-claim entry above: two concurrent requests for the same order/SKU both pass the pre-check, both call Stripe, and both persist a separate row. Not a stock/state corruption — `fulfil()`'s guarded `updateMany` already stops double-decrementing regardless — but a resource leak: two live Stripe objects, two DB rows where one was intended. Rejected a hard partial-unique index that just 409s the loser: it would also 409 a legitimate retry (a declined card trying again), and this project has no `payment_intent.payment_failed` handler to free that slot. Fixed with claim-or-reuse instead: a partial unique index (`payments` `WHERE status = 'pending'`, `payment_links` `WHERE deactivated_at IS NULL`); look for an existing open row before calling Stripe and reuse it; on losing the insert race, cancel the just-created Stripe object (best-effort) and return the winner's data. Verified with a real-Postgres e2e test: two concurrent requests resolve identically, and exactly one `Payment` row survives.

### 2026-09-04 — Accepted risk: the stale-pending sweep can cancel an order while a payment is in flight; made observable, not prevented

The stale-pending sweep (a `@Cron()` job cancelling `pending` orders older than `STALE_ORDER_MAX_AGE_MINUTES`) has no awareness of in-flight payments: a slow checkout (3-D Secure, a bank redirect) can cross that age, the sweep cancels the order and releases its stock, and the payment then succeeds on Stripe with nothing on our side recording it. Rejected having the sweep skip any pending order with an open `Payment` row — trades a rare charged-but-lost bug for a guaranteed one, permanently stranding stock behind an abandoned payment attempt. Accepted instead, given this project's scope (test-mode Stripe, low traffic): `fulfil()`/`directSale()` call a shared `warnIfCancelledUnderPayment` before their existing silent return, logging only when the order is specifically `cancelled` — named with the order id and Stripe reference for manual reconciliation. Makes the race observable instead of invisible; doesn't prevent it.

### 2026-09-04 — Stock notifications: BullMQ + Redis, one job per notification, fan-out synchronous in the sale transaction

Three new pinned dependencies (`bullmq@6.3.4`, `@nestjs/bullmq@11.0.5`, `ioredis@6.0.0` — same ESM/`ts-jest` trap logged above; `ioredis` pinned explicitly since `bullmq` 6.x made it an optional peer). Fan-out (querying `likes`, excluding buyers, inserting one `pending` `stock_notifications` row per recipient) runs inside the same transaction that decremented stock; one BullMQ job per row is enqueued only after that transaction commits — rejected fan-out-inside-the-worker, since a crash mid-fan-out risks double-sending. `resolved_at` clears only when the triggering SKU itself restocks back above the threshold (resolving on any restock was rejected as too eager — 2→3 units doesn't make a product less low on stock). Buyer exclusion counts only orders **not** in `pending`/`cancelled` status — a naive any-order-with-a-matching-item join would permanently exclude someone whose only attempt was cancelled by the stale-pending sweep. The one place a worker, a real queue, and real SMTP all wire together, so it has a smoke e2e (`checkout.e2e-spec.ts`) polling Mailhog for the delivered email rather than relying on unit coverage alone.

### 2026-09-06 — GitHub Actions CI: what's covered, what isn't, and how

Only Redis and Mailhog are declared as GitHub Actions `services:` — Postgres self-provisions per e2e run via Testcontainers, and MinIO is dropped entirely since no e2e spec touches S3. No secrets are configured: `test/env-setup.ts` already defaults every required env var, and the two live-Stripe-API tests self-skip without a real key. CI runs `npx eslint` without `--fix`, so it fails on a fixable violation instead of silently repairing it. Stripe webhook e2e coverage (`checkout.e2e-spec.ts`) uses `Stripe.webhooks.generateTestHeaderString` against the app's own configured `STRIPE_WEBHOOK_SECRET`, run through the real `constructEvent` — never a mocked one, and no Stripe CLI process needed, so it runs identically in CI and locally. Product image upload (`POST/PATCH/DELETE /v1/products/:productId/images`) has **no** e2e coverage at all: `S3Service` has no fake/override provider anywhere in the repo, so a test today would hit real AWS with fake credentials — closing this needs an `S3Service` fake or a MinIO Testcontainer, its own decision. Caught in passing while wiring CI: `payments.service.ts`'s separate local `ORDER_INCLUDE` was missing fields `orders.service.ts`'s had, caught by `npm run build` failing — extended identically.

### 2026-09-11 — Auth notification emails are best-effort: a send failure doesn't fail the request

`AuthService.resetPassword`'s `sendPasswordChangedEmail` and `forgotPassword`'s `sendPasswordResetEmail` are called directly and awaited — no BullMQ queue, since a single non-critical email doesn't justify that infra. Both were originally unguarded, causing two real bugs: `resetPassword`'s password change and refresh-token revocation already commit before the mail call, so an SMTP failure reported an already-successful reset as a 500; `forgotPassword`'s early-return-on-unknown-email contract (a 404 would be a user-enumeration oracle, `api/paths/auth.yaml`) broke the same way, since only the existing-account path could then 500. Fixed by wrapping each call in try/catch and logging via `AuthService`'s own `Logger` (matching `StripeWebhookService`'s post-commit best-effort pattern), not rethrowing. Kept inline rather than centralized in `MailService`, since a service-level swallow would silently change the contract for every existing caller.
