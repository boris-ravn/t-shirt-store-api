# Architecture

Current-state snapshot: what this codebase is, how it's put together, and what's built versus pending — no history, no reasoning trail. That lives in [`decisions.md`](decisions.md); the data model lives in [`database/README.md`](database/README.md); the API contract's binding rules live in [`api/CONVENTIONS.md`](api/CONVENTIONS.md). This file only points at those — read this first, then follow a link when you need the "why" or the full detail.

Read the root [`CLAUDE.md`](../../CLAUDE.md) and this project's [`CLAUDE.md`](../CLAUDE.md) too — they're the standing instructions, not restated here.

---

## What this is

A NestJS + Prisma + PostgreSQL REST API for a T-shirt store: catalog with variants, cart, orders with a status lifecycle, two Stripe payment flows, and a queue-backed low-stock notification. Built across a 4-week training module; the ERD and OpenAPI contract were designed and frozen in weeks 1–2, implementation runs weeks 3–4.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js, TypeScript strict mode |
| Framework | NestJS |
| Database | PostgreSQL via Prisma (`@prisma/adapter-pg` driver adapter) — pinned to `7.10.0`, see `decisions.md` before bumping |
| Validation | `class-validator`/`class-transformer` behind a global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) |
| Docs | Hand-written OpenAPI in `docs/api/` (authoritative) + generated Swagger at `/docs`, reconciled with `oasdiff` |
| Auth | Passport + JWT (access + refresh), CASL for authorization |
| Storage | S3-compatible (`@aws-sdk/client-s3`); MinIO locally via `docker-compose.yml`, real AWS in prod (branches on `AWS_S3_ENDPOINT`) |
| Mail | `nodemailer` → local Mailhog in dev |
| Testing | Jest (unit), Supertest + Testcontainers (e2e, real Postgres) |
| Payments | Stripe SDK (`stripe`, pinned `22.6.1`), test mode only |
| Scheduling | `@nestjs/schedule` (pinned `6.1.3` — the next major is ESM-only and breaks `ts-jest`, same class of issue as `@nestjs/config`, see `decisions.md`), in-process `@Cron()` jobs |
| Not yet added | BullMQ + Redis — lands with notifications |

## Layering

`Controller → Service → PrismaService` directly, no repository abstraction. Every feature is one Nest module in its own folder (`src/<feature>/`), CASL abilities live with the feature they guard rather than in one global rules file. See `decisions.md` for why (repository-free layering + the testing strategy below are a paired decision).

## Error handling

Every 4xx/5xx returns the same RFC 9457 `application/problem+json` shape (`ProblemExceptionFilter`, global). Services throw typed subclasses of `AppException` (`src/common/exceptions/`); each maps to one `type` slug in the registry. Don't build raw error responses in a controller — throw from the service and let the filter shape it.

## Auth & authorization

- **Authentication**: JWT access token (short-lived, role embedded, not re-read from the DB per request — see `decisions.md`) + opaque refresh token (sha256-hashed, rotated on use, revocable). `JwtAuthGuard`/`OptionalJwtAuthGuard` applied explicitly per route via `@UseGuards()` — no global guard.
- **Roles**: `manager`, `client`, `delivery_person` (`UserRole` enum). Role never comes from a request body.
- **Authorization**: CASL, one `CaslAbilityFactory` (`src/casl/`) building an `AppAbility` per request from the authenticated user's role. `@CheckPolicies(...)` + `PoliciesGuard`, applied **per-method, never at the controller class level** (see `decisions.md` — a real bug shipped from getting this wrong once).
- Current `AppSubject` union covers `Category | Product | Sku | Cart | Like | PromoCode | Order`. `Cart` and `Like` are client-only: neither `manager` nor `delivery_person` gets any ability on either, not even read (see `decisions.md`). `PromoCode` splits differently — manager gets `manage`, client gets a custom `apply` action (validate-only, not full CRUD); CASL's `manage` matches any action by default, so the manager grant needs an explicit `cannot('apply', ...)` carve-out (see `decisions.md` — a real gap found by testing, not obvious from the code). `Order` has one custom action per transition endpoint (`cancel`/`process`/`ship`/`deliver`, plus `create`/`read`) rather than `manage`, deliberately avoiding that same wildcard trap; `delivery_person`'s `read` is service-scoped to `shipped` orders plus their own `delivered` ones, per `database/README.md` §5's flagged note. `payments` introduces no new subject — both checkout-creation endpoints reuse `Order`'s `create` ability, since creating a payment is the continuation of checkout; per-order ownership stays a service-layer 404. The `/v1/webhooks/stripe` route carries no guard at all — Stripe isn't a CASL-scoped actor, and the `Stripe-Signature` header is its authentication.

## Data layer

Prisma schema is modeled incrementally — only the tables the current feature touches (see `decisions.md`). Soft delete (`deletedAt`) is used wherever a row can be referenced by a historical order; hard delete otherwise. Money is always an integer in minor units, single currency (`STORE_CURRENCY`), enforced through a shared `Money`/`MoneyRequestDto` shape — never a float, never split flat fields. Full schema reasoning: `database/README.md`.

## API contract

`docs/api/` is the source of truth, split into `openapi.yaml` + `paths/*.yaml` + `components/*.yaml` for reviewability, bundled to `openapi.bundled.yaml` for tooling. `docs/api/CONVENTIONS.md` has the binding rules (casing, pagination, the `Money` shape, versioning, the 403-vs-404 rule). If the code and the contract disagree, that's a bug in one of them — say which one you think is wrong, don't silently pick a side.

## Testing strategy

- **Unit** (`*.service.spec.ts`): mock `PrismaService`, assert on branch logic (which exception fires, which fields get written, role-based visibility). Standard NestJS testing-module pattern.
- **E2E** (`test/*.e2e-spec.ts`): real Postgres via Testcontainers, `createNestApplication()` + `app.init()`, asserting both the HTTP response and persisted state. Covers the auth flow (sign-up → sign-in → refresh → sign-out); order history (role-scoped listing, filters, pagination, ownership 404), seeding orders directly via Prisma rather than through checkout since exercising every status doesn't need a real payment; and checkout (cart → pending order reservation, cancel-from-pending release, a concurrent-double-checkout regression test, and the `payment_intent.succeeded` webhook's Fulfil path — signature-verified for real via `Stripe.webhooks.generateTestHeaderString`/`constructEvent` against the app's own configured secret, not the Stripe CLI, so it needs no live network call or real Stripe key to run). The two live-Stripe-API tests (real `createPaymentIntent`/`createPaymentLinkCheckout` calls) run only when a real `STRIPE_SECRET_KEY` is present in `.env`; they skip cleanly otherwise (`decisions.md`).
- Root `CLAUDE.md`'s rule: don't write assertions for code written in the same session: offer the mocking setup, let the reasoning happen in review.

## Module map

| Module | Status | Owns |
|---|---|---|
| `auth` | Done | sign up/in/out, refresh rotation, forgot/reset password |
| `users` | Done | current-user profile (`GET`/`PATCH /v1/users/me`) |
| `catalog/categories` | Done | category CRUD |
| `catalog/products` | Done | product CRUD, role-scoped visibility, images (S3) |
| `catalog/skus` | Done | SKU CRUD, restock (delta-based) |
| `storage`, `mail`, `casl`, `common`, `config`, `prisma` | Done | shared infrastructure |
| `cart` | Done | cart + cart items, SKU-scoped, live pricing (client-only) |
| `likes` | Done | product likes (client-only) — feeds the notification recipient list |
| `promos` | Done | promo code CRUD (manager) + validation against the caller's cart (client). Redemption itself (`times_redeemed` reserve/release) lands with `orders` |
| `orders` | Done | checkout, status lifecycle (`pending→paid→processing→shipped→delivered`, branch to `cancelled`), status history, stock Reserve/Release/Restock |
| `payments` | Done | Stripe Payment Intent (cart) + Payment Link (single-SKU) creation, `/v1/webhooks/stripe`, stock Fulfil/Direct-sale, `order_shipping_details` |
| `notifications` | Pending | low-stock detection, BullMQ-backed email fan-out to likers who haven't bought |
| Stale-pending sweep | Done | `StaleOrderSweepService` (`src/orders/`), a `@Cron()` job cancelling `pending` orders older than `STALE_ORDER_MAX_AGE_MINUTES` through the same Release path `cancelOrder` uses |

Stock mechanics (five guarded transitions: Reserve, Fulfil, Release, Restock, Direct sale) are specified in `database/README.md` §8 — read that section before writing any stock `UPDATE`; which transition applies on cancellation depends on the order's *previous* status read under lock.

## Config surface

Read through `@nestjs/config`, validated at boot (`src/config/env.validation.ts`) — a missing var fails startup, not the first request that needs it. Current variables: see `.env.example` (DB connection, JWT secrets/expiry, SMTP, AWS/S3, throttle limits, Stripe secret + webhook signing key, stale-order sweep max age). Redis vars will be added when notifications land.

## Local infrastructure

`docker-compose.yml`: Postgres, Mailhog (SMTP catcher, UI at `:8025`), MinIO (S3-compatible, console at `:9001`). Redis (for BullMQ) is not yet added — lands with notifications.
