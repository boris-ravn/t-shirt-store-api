# Decision log

What was decided, why, and when — kept brief on purpose.

**What earns an entry.** Something a future session (or a reviewer) would otherwise have to ask about, because it is not recoverable by reading the code: a rejected alternative, a non-obvious constraint from an external system (a library's actual behavior, not its docs), or a rule that has to hold across files the code itself doesn't connect. If the code plus its own comments already explain it, it does not belong here — that's what makes this file worth reading instead of skipping. For the current-state picture (stack, module map, what's built vs. pending), see [`architecture.md`](architecture.md); this file is only the "why," not the "what."

**Entries that meet the bar above are not rewritten — only marked.** When a decision is overturned, append a new entry and mark the old one:

> **Superseded 2026-09-04** by "Redocly replaces Spectral in CI".

This file was pruned on 2026-09-06: entries that had become fully recoverable from code (e.g. explained by a comment at the point of use) or that carried no forward relevance (doc reorganisation, a deleted planning file) were removed rather than marked, since they never met the bar above in the first place. Nothing is lost — `git log -- docs/decisions.md` has the original, unpruned file.

Binding conventions live where the work happens: [`api/CONVENTIONS.md`](api/CONVENTIONS.md) for the OpenAPI contract, this project's standing coding conventions for code. When one of those changes, edit it there and add an entry here saying what changed and why.

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

Every service injects `PrismaService` directly. Chosen alongside the next entry: a repository layer here would exist mainly to be mocked in unit tests, which is exactly the "unit test wearing a costume" pattern this project avoids. Applies to every future module the same way.

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

### 2026-09-03 — `unlike` only requires the product to exist, not to be active; `like` requires both

Found by manual testing, not code review: an early version gated both `like` and `unlike` behind the same "visible to a client" check (active, not soft-deleted) as `ProductsService.getById`. That stranded a like permanently once a manager disabled the product — `unlike` isn't a catalog-browsing action, it's a client removing their own state, and disabling is explicitly a reversible toggle (`database/README.md` §2), not a reason to lock a client out of their own data. `unlike` now only 404s when the product is gone entirely (soft-deleted or never existed); `like` still requires `active`, since liking something a client can't even browse to find would be a bigger inconsistency than the one this fixes.

### 2026-09-03 — CASL's `'manage'` matches every action, including custom ones — a role with `manage` needs an explicit `cannot(...)` to keep a custom action off-limits

Verified directly against the installed `@casl/ability`, not assumed: granting `can('manage', X)` makes `ability.can(<any action string>, X)` return `true`, including actions invented for this project (`apply`, and later `cancel`/`process`/`ship`/`deliver` on `Order`) — `manage` is a real wildcard, not shorthand for the five CRUD-ish actions used elsewhere. Caught because `PromoCode`'s manager grant silently also passed the client-only `apply` check; fixed with `cannot('apply', 'PromoCode')` right after the `can('manage', ...)` (confirmed `cannot`-after-`can` scopes to just that action). Check for this explicitly whenever a role gets `manage` on a subject that also has a custom action meant for a different role.

### 2026-09-03 — Order status transitions use guarded `updateMany` calls, not `SELECT ... FOR UPDATE`; raw SQL is reserved for the two guards Prisma's filter language genuinely can't express

`database/README.md` §8 suggests `SELECT ... FOR UPDATE` or a CTE for reading an order's previous status without a race. Used a different, Prisma-native technique instead: `cancelOrder` runs two guarded `updateMany({where: {id, status: pending, ...}})` calls in sequence — the first to succeed atomically claims the transition and reveals which one it was (a "compare-and-swap" against the current status, not a lock-then-read). `processOrder`/`shipOrder`/`deliverOrder` reuse the same one-guard version. This needed no raw SQL, because `status = 'pending'` is a plain-value comparison Prisma's `where` already expresses — unlike the stock Reserve guard (`stock - reserved_stock >= qty`) and the promo redemption guard (`times_redeemed < usage_limit`), which compare two columns of the *same row* and Prisma's filter language cannot express at all, so those two (and only those two) use `$executeRaw`, verified directly against a live Postgres instance before relying on it: parameterized UUID values work without an explicit `::uuid` cast, and the returned row count is the correct signal for "did the guard hold." Slice 5's Fulfil/Direct-sale guards are the same shape as Reserve — reuse `$executeRaw`, don't reach for `SELECT ... FOR UPDATE` there either.

### 2026-09-03 — The initial `pending` status-history row's `changed_by` is the ordering client, not `null`

`database/README.md` §5 says `changed_by` is nullable because "transitions like `pending → paid` are triggered by a webhook, not a human" — but doesn't say what the *first* row (order creation itself, which isn't a transition from a prior state) should carry. Order creation is a direct, synchronous action by the client checking out, unlike the webhook-driven `paid` transition, so `changedBy` is set to the caller's own id here — `null` is reserved for the cases the README actually names (no human in the loop), not applied by default to every row this project didn't have explicit guidance for.

### 2026-09-03 — `createOrder` claims the cart's specific items as the first statement inside its transaction, not just at the end

Found in code review and reproduced against real Postgres (two concurrent `POST /v1/orders` for the same one-item cart, via `Promise.all`): the original version read the cart via `cartService.getOrCreate()` *before* opening `$transaction`, so two concurrent checkouts both saw the same snapshot, both passed the Reserve guard independently (each request's requested quantity was individually satisfiable), and both created a full order — one add-to-cart producing two real orders and double stock reservation. The Reserve guard only checks "is there enough physical stock right now"; nothing was checking "has this cart state already been claimed by another request," which is a different guarantee.

Fixed with the same guarded-UPDATE idiom already used for Reserve and promo redemption, applied to the cart itself: `tx.cartItem.deleteMany({ where: { id: { in: <snapshot item ids> }, cartId } })` runs first, and its affected count must equal the snapshot length or the transaction aborts with `cart-empty`. A losing concurrent request finds 0 rows left to claim. Verified with a permanent e2e regression test (`checkout.e2e-spec.ts`) that fires two concurrent checkouts of the same cart against real Postgres and asserts exactly one order and correct final `reservedStock` — a mocked-Prisma unit test cannot exercise this, since the race is between two real transactions, not two calls to the same mock.

The general lesson: any read used both to decide *what* to write and to compute values *inside* a later transaction needs its own claim if the transaction doesn't otherwise guarantee the read can only be acted on once. Slice 5's Payment Intent creation (reading an order before creating the Stripe object) is the next place this shape can recur — check whether it needs the same treatment before assuming the order's own state is enough of a guard.

### 2026-08-28 — Password-change email is synchronous; BullMQ arrives with the stock-notification job

`MailService` (nodemailer → local Mailhog) is called directly and awaited — no queue in front of it. BullMQ/Redis is deferred to the feature that actually needs asynchronous, retryable delivery (stock notifications); a single non-critical email didn't justify standing up the infra early.

### 2026-09-04 — Fulfil needs no raw-SQL guard, unlike Reserve and Direct sale

The 2026-09-03 entry on guarded `updateMany` calls predicted Fulfil would need the same `$executeRaw` treatment as Reserve. It doesn't: Fulfil only runs once Reserve has already verified availability at cart-checkout time, so there is no "compare two columns of the same row" condition left to guard — it's an unconditional `stock -= qty, reservedStock -= qty`, expressible as a plain Prisma `update`. `$executeRaw` stays reserved for Reserve and Direct sale, the two transitions that actually gate on `stock - reserved_stock >= qty`.

### 2026-09-04 — Payment Link checkout trusts the webhook's real quantity, not the request that started it

`payment_links` has no `quantity` column (`erd.dbml` — one reusable link per SKU, just `unit_amount`), but `POST /v1/checkout/payment-link` takes a `quantity` from the client. Checked against the installed Stripe SDK's own types (not assumed): a Payment Link's line item has one fixed `quantity` — reusing the same link across different buyers who want different amounts requires enabling `adjustable_quantity`, which means a buyer can change the quantity on Stripe's hosted page after our `pending` order was already created with the originally-requested one.

Rejected alternative: disable `adjustable_quantity` and key PaymentLink reuse on `(skuId, quantity)` instead of `skuId` alone, so each distinct quantity gets its own link. Dropped because it contradicts the ERD's own one-link-per-SKU shape and would multiply Stripe objects for no real benefit.

Fix: `adjustable_quantity` stays enabled, and `checkout.session.completed`'s handler calls `stripe.checkout.sessions.listLineItems` (the webhook payload itself never carries the real purchased quantity) and overwrites the order's `order_item.quantity`, `subtotal`, and `total` from that response before running the Direct-sale guard — the webhook is the only authoritative source once adjustable quantity is in play, not the request that created the order.

### 2026-09-04 — `createPaymentIntent`/`createPaymentLinkCheckout`'s first-write races, closed with guarded claim-or-reuse

The prior entry on `createOrder`'s cart-claim fix flagged this slice by name: "Payment Intent creation (reading an order before creating the Stripe object) is the next place this shape can recur." Code review confirmed it, reproduced against real Postgres with a stubbed Stripe client: two concurrent `POST /v1/orders/:id/payment-intent` both passed the payability check, both called `paymentIntents.create`, and both persisted a separate `pending` `Payment` row. `getOrCreatePaymentLinkUrl` has the identical shape for a sku's first-ever `PaymentLink`.

This is a materially different risk than the `createOrder` bug, though — `fulfil()`'s guarded order-status `updateMany` (built for Slice 4, reused here unmodified) already stops both intents from ever double-decrementing stock or double-marking the order `paid`; only one payment can win that race regardless. So the fix isn't preventing a stock/state corruption that couldn't otherwise happen — it's closing the resource leak: two live Stripe objects (a real, chargeable `PaymentIntent`; a duplicate `PaymentLink`) and two DB rows where one was intended.

Rejected fix: a hard partial-unique index on `payments (order_id) WHERE status = 'pending'` that just 409s the loser. Dropped because it would also 409 a legitimate retry (a declined card creating a second attempt) — this project never gained a `payment_intent.payment_failed` handler to free that slot, so a hard block would permanently strand a customer whose first attempt failed.

Fix, same claim-or-reuse idiom on both methods:
- `payments` gets a second partial unique index, `WHERE status = 'pending'` (alongside the existing `WHERE status = 'succeeded'` backstop); `payment_links` gets one on `WHERE deactivated_at IS NULL`.
- Before calling Stripe, look for an existing open row (pending payment / active link) and reuse it — this is also what makes a legitimate retry work at all, since Stripe payment intents are designed to be confirmed against multiple times after a decline.
- If no existing row is found, call Stripe, then attempt the guarded insert. Losing that race (another concurrent request inserted first) means cancelling the just-created Stripe object (`paymentIntents.cancel` / `paymentLinks.update({active: false})`, best-effort) and returning the winner's data instead — so both concurrent callers get an identical, usable result rather than one of them erroring.
- Verified with a real-Postgres e2e test (a second app instance sharing the same container, `STRIPE_CLIENT` overridden with a stub so no live network call is needed): two concurrent `payment-intent` requests for the same order both resolve 201 with the same `paymentId`/`clientSecret`, and exactly one `Payment` row survives. Which defense actually catches the race (the pre-check finding the winner's row, or the DB unique-constraint after both called Stripe) is a timing detail the test doesn't assert on — both are correct outcomes.

### 2026-09-04 — Stale-pending sweep: `@nestjs/schedule` cron, not a BullMQ repeatable job

`@nestjs/schedule`'s `@Cron()` runs in-process on every instance independently — no shared coordination. That's fine here specifically because the query it runs (`status = 'pending' AND created_at < cutoff`) and the cancellation it triggers (`OrdersService.releaseStalePendingOrder`, a guarded `UPDATE` on `status = 'pending'`) are both already safe under concurrency: two instances finding and "cancelling" the same order at the same tick is harmless, since only one guarded `UPDATE` can actually affect a row. BullMQ would buy retries, backoff, and cross-instance exactly-once scheduling — none of which this job needs, since a missed or doubled tick corrects itself on the next one. Reused for Slice 8's queue-decision write-up: this is the "why not a queue" half, BullMQ's actual justification is Slice 7's need for per-notification retry/failure tracking, which a cron tick can't provide.

Pinned to `6.1.3`, not `latest` (`12.0.1`) — same issue already logged for Prisma/`@nestjs/config`: `12.x` ships ESM-only (`export * from ...` with no CJS build) and fails outright under `ts-jest`'s CommonJS transform. `6.1.3` is the last release whose peer range still covers `@nestjs/core`/`common` `^11.0.0`.

`cancelOrder`'s Release-path side effects (stock release, promo release, history insert) were extracted into a private `finalizeCancellation` so the sweep doesn't reimplement them — the sweep's `releaseStalePendingOrder` runs its own guarded `UPDATE` (no ownership clause, no Restock fallback, since a sweep only ever targets orders its own query already found `pending`) and then calls the same `finalizeCancellation`, with `changedBy: null` for the history row since no human triggered it.

### 2026-09-04 — Accepted risk: the sweep can cancel an order while a payment is in flight; made observable, not prevented

Found in code review, not testing: `fulfil()`/`directSale()` already no-op silently (`claimed.count === 0`, no log) when their guard finds the order isn't `pending` — before this slice, the only way there was a deliberate `cancelOrder` call racing an in-flight payment, an edge case. This slice adds an automated actor with no awareness of in-flight payments: a slow checkout (3-D Secure, a bank redirect, a customer tabbing away) can cross `STALE_ORDER_MAX_AGE_MINUTES`, the sweep cancels the order and releases its stock, and the customer's payment then succeeds on Stripe with nothing on our side recording it — no stock decrement, no `Payment` row update, no shipping details, and `stripe_webhook_events.processed_at` gets stamped as a normal success, so nothing flags it for reconciliation.

Rejected fix: have the sweep skip any pending order with an open `Payment` row. Dropped because it trades a rare charged-but-lost bug for a guaranteed one: a customer who opens a payment and abandons the tab without ever completing it would leave that order permanently un-swept, holding its reserved stock forever — worse in the common case to fix a rare one.

Accepted instead, given this project's scope (test-mode Stripe, low expected traffic, a generous default threshold): `fulfil()`/`directSale()` now call a shared `warnIfCancelledUnderPayment` right before their existing silent `return`, which re-reads the order's status and logs a warning **only** when it's specifically `cancelled` (not the legitimate already-`paid` duplicate-webhook case) — naming the order id and the Stripe reference so an operator can find and manually reconcile it. This doesn't prevent the race, it makes it discoverable instead of invisible, which is what closes this out as "documented and observable" rather than "silently accepted."

### 2026-09-04 — Stock notifications: BullMQ + Redis, one job per notification, fan-out synchronous in the sale transaction

Three new dependencies: `bullmq` (`6.3.4`), `@nestjs/bullmq` (`11.0.5` — `12.x` ships ESM-only and fails under `ts-jest`, same trap as `@nestjs/schedule`/`@nestjs/config`, confirmed the same way: installed it, ran the build/tests, watched it fail), and `ioredis` (`6.0.0`, pinned explicitly because `bullmq` 6.x made it an optional peer dependency rather than bundling it — installing `bullmq` alone leaves `BullModule.forRootAsync`'s Redis connection with nothing to actually speak the protocol).

Job shape: fan-out (querying `likes`, excluding buyers, inserting one `pending` `stock_notifications` row per remaining recipient) runs synchronously inside the same transaction that decremented stock and opened the `low_stock_events` row — not deferred into the queue job. One BullMQ job per notification row is enqueued after that transaction commits (never from inside it, to avoid a worker racing the row's own visibility). Rejected alternative: one job per event, fan-out inside the worker. Dropped because it would need the worker to be resumable after a partial failure (crashes after emailing 30 of 50 recipients) without double-sending — real complexity this project's scale doesn't justify. The chosen shape makes each job trivial (load one row, send one email, update its status) and gets per-recipient retry/backoff for free from BullMQ's own job-level `attempts`/`backoff`, set in `NotificationsModule`'s `registerQueue` (3 attempts, exponential backoff).

`low_stock_events.resolved_at` policy: an event resolves when the *specific SKU just restocked* (manual restock, or a cancellation's Restock) ends up above the threshold — checked opportunistically inside `SkusService.restock` and `OrdersService.finalizeCancellation`'s Restock branch, never on Release (release never increases `stock`, only `reservedStock` moves). Rejected alternative: any restock resolves the event regardless of resulting level. Dropped as too eager — restocking from 2 to 3 units doesn't make a product any less low on stock, and would silently drop an alert likers are still waiting on.

Buyer exclusion (`LowStockService.detectAndOpen`'s `like.findMany` query) treats a user as having "purchased" a product only if they have an order **not** in `pending`/`cancelled` status containing an item for it — not merely *any* order with a matching `order_item` row, which the ERD note (`database/README.md` §3, "a join against `order_items`") doesn't spell out. An order_item row survives cancellation (orders aren't deleted, only their status changes), so a naive join would permanently exclude a customer whose only attempt at buying the product was cancelled by the stale-pending sweep — under-notifying someone who never actually got it.

Added a smoke e2e (`test/checkout.e2e-spec.ts`, "Low-stock notification") that drives a real sale below threshold through the real BullMQ/Redis queue and polls Mailhog's HTTP API (`/api/v2/search?kind=to`) for the delivered email, rather than relying on unit coverage alone — this is the one place in the app where a background worker, a real queue, and real SMTP delivery all have to actually wire together, and unit tests mock every one of those boundaries.

### 2026-09-04 — No CI pipeline; deferred, not built

GitHub Actions was the intended CI tool, and every slice's regression pass (`lint`, `build`, `test`, `test:e2e`) was run locally instead of in CI. No `.github/workflows` was ever added. Deferred rather than built because every one of those checks already requires local infrastructure this project's CI would also need to stand up (Postgres via Testcontainers works self-contained, but Redis, Mailhog, and MinIO are real `docker-compose` services the e2e suite and the low-stock smoke test depend on) — configuring that in Actions is a real task, not a five-line workflow file, and nothing in the current scope depends on it running automatically. If this project continues past its current scope, this is the next piece of infrastructure to add, not a gap to silently work around.

### 2026-09-04 — Catalog e2e coverage was a real gap, now closed except image upload

Week 3 shipped `auth` and `catalog` (categories, products + images, SKUs); only `auth` got e2e coverage. Unlike `cart`/`likes`/`promos` — each of which has a stated reason for skipping dedicated e2e ("exercised for real inside the Orders slice's checkout e2e") — catalog had no such note. It was simply missing, not deferred. `test/catalog.e2e-spec.ts` now covers categories/products/SKUs CRUD, role gating (manager-only writes, public reads), duplicate-constraint 409s, the disabled-vs-soft-deleted product visibility split (`ProductsController`'s own doc comment: disabled is 404-for-client/200-for-manager, soft-deleted is 404-for-everyone), and SKU restock.

Found and fixed in passing: `SkusController.restock` was missing `@HttpCode(HttpStatus.OK)` — the contract (`docs/api/paths/skus.yaml`) and its own `@ApiOkResponse` decorator both say 200, but the real response was 201 (`@Post()`'s default). Nothing else referenced the wrong status, so this was a pure bug, not a compatibility surface — fixed rather than left for the mismatch to persist.

Product image upload (`POST/PATCH/DELETE /v1/products/:productId/images`) is **not** covered — `S3Service` (`src/storage/s3.service.ts`) has no fake/override provider anywhere in the repo, and `test/env-setup.ts` sets no `AWS_S3_ENDPOINT`, so an e2e test today would hit real AWS with fake credentials. Closing this needs either an `S3Service` provider override with an in-memory fake or a MinIO Testcontainer — real new test infrastructure, its own decision, not bundled into this one.

### 2026-09-04 — Order responses now expose `paymentMethod`; picked from the succeeded payment, not the most recent one

`IMPLEMENTATION_PLAN.md:208` predicted this would land with Slice 5 and it never did — a review against the original requirements caught it as a real gap, not a documentation drift. `promoCode` had the same problem in reverse: it existed on `OrderAdminResponseDto` but not on the client's own view, so a client saw `discountAmount` with no way to know which code produced it. Both now live on the base `OrderEntity`/`OrderResponseDto`, visible to client and manager alike.

`paymentMethod` is resolved from `payments` filtered to `status = 'succeeded'` in `ORDER_INCLUDE`, not from whichever `Payment` row is newest. A failed `payment_intent` attempt followed by a successful `payment_link` retry must report `payment_link`; a naive most-recent pick would get this right by coincidence in some orderings and wrong in others. This relies on the existing hand-written partial unique index (`payments_order_id_succeeded_key`, `WHERE status = 'succeeded'`) guaranteeing at most one such row per order — without it, `payments[0]` would be an arbitrary pick among several. An order with no succeeded payment (still `pending`, or `cancelled` before ever paying) reports `null`, the same "not yet known" convention `promoCode` already used.

`payments.service.ts`'s `createPaymentLinkCheckout` has its own separate local `ORDER_INCLUDE` (not the one in `orders.service.ts`) — missed by the initial investigation, caught by `npm run build` failing once `OrderEntity` required the new fields. Extended identically; no other construction site exists.
