# T-Shirt Store API — ERD Documentation

Supporting documentation for the data model (`erd.dbml`) of the T-Shirt Store API. This document explains the *why* behind each design decision; the DBML itself keeps only the *what* and the essential invariants in its `Note` fields.

## Scope

This version of the ERD covers both the **minimum required features** and all **three optional features** of the challenge.

Money is stored in minor units (cents). Single currency store-wide.

---

## Table of Contents

1. [Auth](#1-auth)
2. [Catalog](#2-catalog)
3. [Cart](#3-cart)
4. [Promotions](#4-promotions)
5. [Ordering](#5-ordering)
6. [Payments](#6-payments)
7. [Notifications](#7-notifications)
8. [Cross-cutting decisions](#8-cross-cutting-decisions)
9. [Known limitations / future work](#9-known-limitations--future-work)

---

## 1. Auth

**Tables:** `users`, `password_reset_tokens`, `refresh_tokens`

**Solves:** sign up, sign in, sign out, forgot/reset password, email notification on password change.

### `users`

- **`role` defaults to `client`, never accepted on the signup endpoint.** Public registration cannot self-grant `manager` or `delivery_person`; both roles are provisioned outside the signup flow (seed, admin panel). Closes an obvious privilege-escalation path.
- **`password_hash`**, never a plaintext password.
- **`password_changed_at`** (nullable, no default): updated only by the service after a successful reset. `NULL` means "never changed since account creation" — an honest statement, not a placeholder.

### `password_reset_tokens`

- **`token_hash`**, not the raw token — protects against a DB leak.
- **`expires_at`** limits the validity window.
- **`used_at`** (nullable) makes the token single-use without deleting the row, leaving an audit trail.

### `refresh_tokens`

Exists so "sign out" is real, not cosmetic. The access token (JWT) is stateless and never persisted; the refresh token is persisted, and **`revoked_at`** (nullable) is the mechanism that invalidates an active session before its natural expiration — without this field, logging out would only clear the token client-side, but the token would still be valid if someone had copied it beforehand.

---

## 2. Catalog

**Tables:** `categories`, `products`, `product_images`, `skus`

**Solves:** paginated listing, search by category, SKU/variant management, images visible to both logged-in and anonymous users, Manager capabilities (create/update/delete/disable, upload images).

### `categories`

Its own table, not an enum or free-text string in `products`. Adding a new category is an `INSERT`, not a migration. `slug` kept separate from `name` for clean URLs.

### `products`

- **`category_id` is mandatory** — every product must be searchable by category.
- **`status` (active/disabled) vs. `deleted_at` (soft delete) — two distinct mechanisms with different purposes:**
  - `disabled` hides the product from the client catalog but keeps it visible/manageable for the Manager. It's a reversible business toggle (e.g., "this fabric supplier is temporarily out").
  - `deleted_at` hides it in every context. It's one-directional in intent — not something that's routinely "restored."
  - Soft delete is used instead of physical deletion because `order_items.product_id` is a real FK against products that may have been sold; physically deleting would break the customer's purchase history.
- **Index `(category_id, created_at)`**: covers the real query pattern — paginated listing by category, ordered by most recent — in a single structure.

### `product_images`

- **`s3_key`, not a full URL**: decouples the stored data from infrastructure (bucket, CDN). The final URL is built at response time; switching providers doesn't require a mass `UPDATE`.
- **`position`**: allows ordering images and setting a cover image.
- Public visibility (logged-in vs. anonymous) is **not modeled here** — it's an authorization rule at the controller/CASL level, not a data attribute.

### `skus`

- **A table separate from `products`**: a product has multiple size/color combinations, each with its own price and stock. Modeling this inside `products` would force a single price/stock per product.
- **`sku_code unique` and `(product_id, size, color) unique`**: prevent duplicate variants at the data-integrity level, not just via service-layer validation.
- **Both need to become partial in the actual migration.** As written, either constraint would collide with soft delete: re-creating a variant after soft-deleting the old row (same code, or same product/size/color) would hit a unique violation against a row the application already considers gone. The DBML keeps both as regular `unique` because that's the real business rule and the diagram's job is to communicate it — the refinement to `UNIQUE ... WHERE deleted_at IS NULL` is a migration-time detail, the same class of fix as the idempotency backstop on `payments`, and isn't expressible as a partial index in DBML.
- **Design decision evaluated and rejected — generic attributes model (EAV):** a dynamic-attributes schema (to support any combination of characteristics, not just size/color) was considered and rejected on YAGNI grounds — the challenge is a single-product-type store with two stable variation dimensions. An EAV model would add real complexity in validation, constraints, and queries with no benefit in this scope.
- **`stock` + `reserved_stock`**: see [stock mechanics](#stock-mechanics-skus-table) below.

---

## 3. Cart

**Tables:** `carts`, `cart_items`, `likes`

**Solves:** managing one's own cart, "liking" products (enables the stock-notification system).

### `carts`

**1:1 user-to-cart relationship** (`user_id unique`, `ref: -`). No historical or multiple carts — the minimum necessary for the required scope. The absence of `guest_email` confirms the cart requires authentication (unlike what was evaluated, and ultimately rejected, for `orders` — see section 5).

**Cart expiration**: evaluated and deliberately left out of the schema. Handled with a periodic job over `cart_items.updated_at` (already present), avoiding baking a changeable business policy (30 days? 60?) into the data model.

### `cart_items`

- **`sku_id`, not `product_id`**: the cart always references a concrete, purchasable variant.
- **No price snapshot**: unlike `order_items`, the cart is transient state — the price shown should always reflect the SKU's current value.
- **`(cart_id, sku_id) unique`**: adding the same SKU twice results in an `UPDATE quantity`, not duplicate rows.

### `likes`

- **`product_id`, not `sku_id`**: a like applies to the product in general (the person likes the design, not one specific variant).
- **Individual index on `product_id`**: makes the core query "who liked this product?" efficient for the low-stock notification system.
- Excluding existing buyers (requirement: notify only those who *haven't* purchased) is resolved in the service layer via a join against `order_items`, not with an extra column here.

---

## 4. Promotions

**Table:** `promo_codes`

**Solves:** promo code creation by the Manager (code, discount type/value, expiration, usage limit, optional minimum purchase), application by the Client at checkout, with the validations the challenge requires.

- One-to-one coverage of every attribute the challenge asks for.
- **`times_redeemed`**: a counter with an atomic guard — see [promo_codes.times_redeemed mechanics](#promo_codestimes_redeemed-mechanics) below.
- **No `code` snapshot on `orders`**: adding `orders.promo_code` as a snapshot was considered (following the same pattern as `order_items.product_name`) and rejected. Note this is *our own* design decision, not something forced by the challenge: the brief's CASL section explicitly grants the Manager "create, update, disable" on promo codes, so `code` editing isn't actually off the table. We treat `code` as immutable after creation by convention — Manager updates are expected to touch the discount fields (value, expiration, limit), not the code string itself — so `promo_code_id` alone is enough to reconstruct history via a join. If that convention changes and `code` becomes editable in practice, a snapshot would need to be added. (The `order_items` pattern is justified there because a product *can* be renamed or deleted by design, not by convention — it's not the same case.)

---

## 5. Ordering

**Tables:** `orders`, `order_items`, `order_shipping_details`, `order_status_history`

**Solves:** purchasing, cancellation before shipped, status advancement by Manager and Delivery Person, history with filters and pagination, the full status flow including `delivered`.

### `orders`

- **`user_id` is mandatory (`not null`)**: an explicit decision **not** to support guest checkout. Allowing it was evaluated (since Payment Links are described as "quick purchase without a cart," which suggested the possibility) but rejected, because the challenge requires clients to be able to check their order's status afterward — without an account, there's no way to authenticate that check without adding a mechanism the challenge doesn't ask for (e.g., an email access token). Always requiring authentication is the simpler, more consistent option.
- **`status` defaults to `pending`**: the DB enforces "every order starts as pending" without relying on the service to remember.
- **`subtotal`, `discount_amount`, `total` as snapshots**: `total = subtotal - discount_amount`, and `payments.amount` must match `total`. These are denormalized (derivable from `order_items` + `promo_codes`) for two reasons: performance (the price-range filter in history doesn't need a `JOIN + SUM` on every page) and historical immutability (the amount paid shouldn't be recalculated if pricing rules change later).
- **`promo_code_id` and `discount_amount` only apply to Payment Intent orders** (cart checkout) — Payment Links don't support promo codes in this scope.
- **No `delivery_person_id`**: a deliberate decision. The challenge literally defines "assigned" as *"orders with status shipped"* — any user with the `delivery_person` role can view and mark as `delivered` any order in that status, with no explicit assignment needed. See the trade-off in the limitations section.
- **Three non-redundant composite indexes** (`(user_id, created_at)`, `(user_id, status, created_at)`, `(status, created_at)`): each covers a distinct, real access pattern — the customer's general view, the customer's filtered history, and *two* uses of the last one: the Manager's operational view by status, and the stale-pending sweep described below (`WHERE status = 'pending' AND created_at < cutoff`) — respecting Postgres's leftmost-prefix rule.

### `order_items`

- **Full snapshot** (`unit_price`, `product_name`, `size`, `color`): preserves the historical truth of the purchase regardless of later catalog changes.
- **`product_id` redundant alongside `sku_id`**: resilience against SKU soft-deletion, and simpler queries (e.g., best-selling products) without going through `skus`.
- **No subtotal column**: evaluated and rejected — it's a trivial single-row calculation (`quantity * unit_price`) with no direct filtering need, unlike `orders.total`.

### `order_shipping_details`

- **An inference not explicitly requested by the challenge**: necessary because, without a shipping address, the Delivery Person role has no operational meaning (deliver where?).
- Data is taken as a snapshot from the successful-payment webhook payload, not from a form of its own — that's why an order that never got paid has no row here.
- **`order_id` as PK** (instead of its own `id` plus a separate `unique` constraint): enforces the 1:1 relationship with no extra index needed. This pattern is available here specifically because nothing else in the schema references `order_shipping_details` — it's a leaf table. `carts` keeps a surrogate `id` instead, deliberately: `cart_items.cart_id` references `carts.id`, not `carts.user_id`, so if multiple/saved carts per user are ever introduced, `cart_items` doesn't need to be migrated — it already points at "a cart," not "a user." Fusing PK and FK on `carts` today would save one index but would tie `cart_items` to `user_id` in a way that's expensive to undo later.
- Realistic nullability: `phone`, `state`, `line2` are nullable because not every country has a "state/province" and Stripe doesn't always capture a phone number.

### `order_status_history`

- **Exceeds the original minimum requirement**: in the original core scope, the challenge only asked for the *current* status, not a history — the full history became an explicit requirement once the delivery-extension Optional Feature was included. The full table is kept because it also provides internal traceability/auditing independent of that requirement (who changed what, and when).
- **`changed_by` is nullable**: transitions like `pending → paid` are triggered by a webhook, not a human.
- **`created_at` uses `clock_timestamp()`, not `now()`**: preserves the real event order if several rows are inserted within the same transaction (`now()` would return the same value for all of them).
- **Index `(changed_by, status, created_at)`**: designed to resolve "view delivery history" for the Delivery Person without needing an assignment table/column — answered via `WHERE changed_by = X AND status = 'delivered'`.
- **CASL implication worth flagging now**: that history query returns *rows*, but rendering each one still means reading the underlying order — and by the time an order is `delivered`, it's no longer `shipped`. If the Delivery Person's read ability on `orders` is scoped to `status = 'shipped'` only, their own history view would fail to load the order details behind it. The ability needs to cover both `shipped` (to act on it) and `delivered` (to review it afterward) — a CASL design note for later, not a schema change.
- **Status transitions are not enforced at the schema level**: a conscious decision. The enum guarantees valid values, but the state machine (which transition is legal: `paid → processing → shipped → delivered`, with a branch to `cancelled` before `shipped`) lives in the service layer, where it's testable — consistent with the challenge's emphasis on unit tests.
- **Order creation must also insert the initial `pending` row here**, not just set `orders.status = 'pending'`. Otherwise the history has a gap at the front — the first visible transition would be `pending → paid`, with no record of when or how the order itself came into existence.

---

## 6. Payments

**Tables:** `payment_links`, `payments`, `stripe_webhook_events`

**Solves:** the two required payment methods — Payment Links (single-product purchase) and Payment Intents (cart checkout) — with webhook handling.

### Relevant Stripe concepts

- **Payment Intent**: a Stripe API object created *on-demand* by your backend for each payment attempt, with an amount you calculate and control (useful for carts, where the total varies per order).
- **Payment Link**: a reusable, Stripe-hosted URL tied to a specific Price/SKU. Created once, reused on every click.
- **Webhook**: the mechanism by which Stripe calls your backend (HTTP POST) when an event occurs — the payment actually happens on Stripe's servers, and your backend finds out asynchronously.
- Stripe guarantees **"at least once delivery"** for webhooks: it may resend the same event more than once. The system must be idempotent against this.

### `payment_links`

- Tied to `sku_id`: a link is created once per variant and reused on every quick purchase.
- **Buyer is not stored in this table**: identified at purchase time via `client_reference_id` (a parameter appended to the URL per request, returned by Stripe in the webhook). This implies **the order must be created in the backend before redirecting the customer to the link**, so there's an `order_id` to append.
- **`deactivated_at`**: set when available stock reaches zero, to shrink (not fully close) the oversell window.

### `payments`

- **A unified model for both methods**: `method` records which one was used; the Stripe-specific columns (`payment_link_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`) are nullable because they only apply depending on the method. Coherence between `method` and which columns are populated is not enforced at the schema level (a "conditionally relevant column" pattern) — left as service-layer validation or a conditional `CHECK` in the actual migration.
- **Stripe IDs as `unique`**: key to per-event idempotency.
- **`order_id` is non-unique**: allows payment retries (e.g., a declined card followed by a successful retry) to each get their own row, without overwriting the previous attempt.
- **Additional idempotency backstop**: `stripe_webhook_events` only prevents reprocessing the *same* Stripe event — it doesn't prevent two different events (two different Payment Intents) from both marking the same order as paid. A partial unique index `UNIQUE (order_id) WHERE status = 'succeeded'` is required (not expressible in DBML, goes in the actual SQL migration) as the guarantee that only one payment can be `succeeded` per order at a time. A refund releases that index.
- **`payment_status` as an enum separate from `order_status`**: related but not identical concepts — a payment attempt's status isn't 1:1 with the overall order's status.

### `stripe_webhook_events`

- **`id` = Stripe event id as PK**: an atomic idempotency mechanism — the `INSERT` only fails if the event was already received, with no race-condition window (unlike a `SELECT` followed by a conditional `INSERT`).
- **`payload jsonb`**: `jsonb` (not `json`) is used for read/query performance and indexability. The full event is stored for auditing and manual reprocessing after partial failures, without depending on fixed columns per event type (Stripe has dozens of distinct event types).
- **`processed_at` nullable**: distinguishes "received" from "successfully processed," allowing partially failed processing to be identified and retried.

---

## 7. Notifications

**Tables:** `low_stock_events`, `stock_notifications`

**Solves:** notifying, via a background job, users who liked a product and haven't purchased it, by email, when its stock reaches 3.

### Why two tables instead of one

They separate two concepts with different cardinality: **the triggering event** (occurs once per threshold crossing) and **the individual delivery** (occurs once per recipient user). A single table would mix both, repeating the event's data on every notification row.

### `low_stock_events`

- **`product_id`** (not `sku_id`) as the primary value, consistent with `likes`: the requirement notifies about the product in general.
- **`triggered_by_sku_id`**: records which specific variant crossed the threshold, since stock lives on `skus`.
- **`stock_at_trigger`**: an immutable snapshot of stock at the moment of the event.
- **`resolved_at`**: prevents the same event from firing repeatedly as stock fluctuates around the threshold. The exact rule for "when it's resolved" (above 3 again? a full restock?) is left as an open business decision for implementation.
- **Concurrency gap, independent of that policy**: nothing currently stops two concurrent stock decrements on the same product from each checking "is there an open event?", both finding none, and both inserting a `low_stock_events` row — which would double-email the same likers. Same class of problem as the `payments` idempotency backstop, and the same class of fix: a partial unique index, `UNIQUE (product_id) WHERE resolved_at IS NULL`, guarantees at most one open event per product regardless of which "resolved" policy is eventually chosen.
- **Fires on `stock` post-sale, not on availability (`stock - reserved_stock`)**: a cart reservation is not a confirmed sale, so it shouldn't trigger the low-stock alert on its own.

### `stock_notifications`

- **`status` (pending/sent/failed)** models the queue pattern: `pending` rows are created instantly upon detecting the event; an asynchronous worker (e.g., BullMQ) processes them and updates the real delivery outcome. This decouples detection (fast, inside a critical transaction) from delivery (slow, prone to external email-provider failures).
- **`(low_stock_event_id, user_id) unique`**: protects against duplicate notifications to the same user for the same event, in case of retries or double-triggered jobs.

---

## 8. Cross-cutting decisions

Patterns that repeat across multiple tables, documented once here:

### Soft delete vs. hard delete

Used on `products` and `skus` (`deleted_at`). General rule applied: **any entity that could be referenced by a historical order is never physically deleted.** Physical deletion would either break the FK or, worse, cascade-delete the customer's purchase history.

### Snapshots (intentional denormalization)

Appears in `order_items` (price, name, size, color), `orders` (subtotal/discount/total), and `order_shipping_details` (full address). Decision rule applied consistently: **denormalize when (a) the value is queried/filtered directly and frequently, or (b) it represents a historical fact that must not retroactively change if the source data changes.** Denormalization was avoided where neither condition applied (subtotal in `order_items`, a `promo_code` snapshot on `orders`, price in `cart_items`).

### Stock mechanics (`skus` table)

Stock moves through five atomic conditional `UPDATE`s, each with its own guard, to prevent overselling under concurrent purchases:

| Transition | When it happens | Operation | Guard | Why |
|---|---|---|---|---|
| **Reserve** | A cart order is created | `reserved_stock + qty` | `WHERE stock - reserved_stock >= qty`; 0 rows = insufficient stock | Availability must cover the new reservation before it's granted |
| **Fulfil** | Payment succeeds (webhook) | `stock - qty` and `reserved_stock - qty` together | Gated on the payment webhook's own idempotency (see Payments) | The reservation converts into a real, final sale |
| **Release** | Cancellation while the order is `pending` | `reserved_stock - qty` | Gated on the order's status `UPDATE` itself affecting a row | The reservation never became a sale — nothing to restore to `stock` |
| **Restock** | Cancellation with the order already `paid`/`processing` | `stock + qty` | Gated on the order's status `UPDATE` itself affecting a row | Fulfil already discharged the reservation by decrementing both columns together; the units had fully left inventory, so restoring them only means adding back to `stock` |
| **Direct sale** | Payment Link webhook | `stock - qty` | `WHERE stock - reserved_stock >= qty`; 0 rows = refund | Payment Links never reserve ahead of the charge — the guard runs only at the webhook, and it must still respect stock already held by cart reservations, not just raw `stock` |

Deactivating a Payment Link once available stock (`stock - reserved_stock`) hits zero shrinks the oversell window, but doesn't fully close it — two simultaneous clicks on the same link right before deactivation remain theoretically possible.

`CHECK (stock >= 0 AND reserved_stock BETWEEN 0 AND stock)` holds at all times for two reasons, one per direction: `stock` can only drop — via Fulfil or Direct sale — while it still exceeds `reserved_stock` at that moment (both share the same guard, `stock - reserved_stock >= qty`), and `reserved_stock` can only rise (Reserve) under that same guard, which independently ensures `reserved_stock + qty <= stock` before the increment is allowed.

**Determining which transition applies on cancellation** requires reading the order's *previous* status before the `UPDATE` (via `SELECT ... FOR UPDATE` or a CTE returning the prior value) to decide between Release and Restock without a race condition.

**The Reserve/Release cycle is incomplete without a stale-pending sweep.** As described, `reserved_stock` and `promo_codes.times_redeemed` are only released on an *explicit* cancellation. A customer who simply abandons checkout never cancels anything — the order stays `pending` forever, and both the stock reservation and the promo code usage slot are held indefinitely. A periodic job is required: cancel `pending` orders past some age threshold (querying `orders` via `(status, created_at)`), triggering the normal Release path for both stock and promo codes. Without this job, the reservation model is correct under concurrency but leaks under abandonment.

### `promo_codes.times_redeemed` mechanics

- **Reserve** (order created): `times_redeemed + 1 WHERE is_active AND expires_at > now() AND times_redeemed < usage_limit`. 0 rows = code unavailable.
- **Release** (any cancellation, whether `pending` or already `paid`/`processing`): `times_redeemed - 1`, gated on the order's status `UPDATE` itself having affected a row — so a double cancellation can't decrement twice.

### Indexes: search vs. integrity

Every index in Postgres speeds up lookups; the `[unique]` modifier additionally layers an integrity constraint on top of that same structure. Rule applied: if a column combination *shouldn't* be able to repeat in real life, declare it `unique`; if it can repeat (or it doesn't matter), it's a plain performance index.

### Business rules vs. data integrity

Principle applied consistently: **the schema protects the shape of the data** (types, uniqueness, FKs, `CHECK`); **the service layer protects business behavior** (state machines, valid transitions, authorization rules). Examples: valid `order_status` transitions aren't in the schema; excluding buyers in the notification flow isn't a column, it's a service-layer join.

---

## 9. Known limitations / future work

Grouped by *why* each one is left open, since not all "limitations" are the same kind of thing — some are closeable gaps deferred to the migration, one is a structural limit of the payment method itself, and others are intentional design decisions.

### Gaps with a real schema-level solution (DBML can't express them; must land in the actual migration)

- **`method` ↔ Stripe-specific columns coherence in `payments`.** Nothing at the DB level prevents inserting a row with `method = 'payment_intent'` but `payment_link_id` populated. Fully closeable with a conditional `CHECK` constraint validating the right columns are populated per `method`.
- **Idempotency backstop on `payments`.** A partial unique index, `UNIQUE (order_id) WHERE status = 'succeeded'`, is required so two different Stripe events can never both mark the same order as paid (see Payments section). Not a documentation gap — a required migration step.
- **Uniqueness on `skus` must become partial in the migration.** `sku_code` and `(product_id, size, color)` are kept as regular `unique` in the DBML — that's the real business rule — but a straight `UNIQUE` would block re-creating a soft-deleted variant. Both need `UNIQUE ... WHERE deleted_at IS NULL` in the actual migration (see Catalog section).

### Structural limitation (mitigated, not fully closeable, by design of the payment method)

- **Payment Links: a paid-for unit can exist without stock.** Two separate problems live under "oversell," and only one of them is solved:
  - *Data consistency* (stock going negative or double-decrementing) — **solved.** The **Direct sale** guard (`stock - reserved_stock >= qty`, see [stock mechanics](#stock-mechanics-skus-table)) guarantees this even under two webhooks arriving concurrently — the second `UPDATE` simply affects 0 rows. It deliberately checks *availability* (`stock - reserved_stock`), not raw `stock`, so a Payment Link sale can't undercut units already held by cart reservations.
  - *A sale completing for a unit that's no longer available* — **not solvable within this design**, and not a gap to close later. A Payment Link is a Stripe-hosted checkout page with no real-time inventory check before charging the card — your backend only learns about the payment *after* it happened, via webhook. There is no point in the flow where you could block the charge itself. `deactivated_at` shrinks the exposure window (the link stops being usable once available stock hits zero) but cannot close it to zero, since some latency always exists between "stock hit zero" and "the link is deactivated." The only remedy for this case is a post-hoc refund, not prevention — this is an inherent trade-off of choosing Payment Links over building a custom checkout with a synchronous stock check.
- **The stale-pending sweep can cancel an order while its payment is in flight.** Same shape as the Payment Links gap above: the sweep has no way to know a payment attempt is in progress before it cancels an old `pending` order, and a slow checkout (3-D Secure, a bank redirect) can outlast the sweep's age threshold. Mitigated, not prevented — see `decisions.md`, 2026-09-04, for why prevention was rejected and what's done instead (a warning log for manual reconciliation).

### Business-rule decisions correctly left to the service layer

These aren't gaps — the schema already provides what's needed (a column, a flag); what's missing is a *policy*, which is deliberately kept out of the schema so it can change without a migration:

- **Exact "resolved" rule for `low_stock_events.resolved_at`.** The column exists; the trigger condition (stock rises above the threshold? full restock?) is a business decision to make before implementing the notification service.
- **Reset-token invalidation policy.** `used_at` already supports single-use tokens; whether issuing a new reset token should also invalidate previous unused ones is a policy decision for the service, not the schema.

### Intentional design decisions (not gaps)

- **No real assignment of a Delivery Person to an order.** "Assigned" is defined, following the challenge's own definition, as any order in `shipped` — any user with that role can view and mark it `delivered`. There's no control ensuring an order "belongs" to a specific delivery person; two delivery people could compete for the same order (the first `UPDATE` wins). Acceptable trade-off given the challenge's literal definition of "assigned."