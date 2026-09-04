# CLAUDE.md — t-shirt-store-api

## What this is

A REST API for a T-shirt store: catalog with variants, cart, orders with a status lifecycle, Stripe payments in two flavours, and a queue-backed stock notification.

Two documents are the contract. Both outrank anything said in chat:

- `docs/database/` — the ERD: `erd.dbml` for the schema, `README.md` for the reasoning behind it (Week 1)
- `docs/api/` — the OpenAPI contract (Week 2), governed by `CONVENTIONS.md` in the same directory

If the code and one of those disagree, that is a bug in one of them. Name which one you think is wrong and stop; do not silently pick a side.

`docs/api/CONVENTIONS.md` holds the binding rules for the contract — casing, error body, pagination, money, security, versioning, format precision, and how the document is authored. Read it before adding a path or a schema. `docs/decisions.md` is history, not rules: it explains why things are the way they are. Append entries; never rewrite or delete one. A decision that gets overturned earns a new entry plus a supersession marker on the old, which is the only edit an existing entry ever takes.

---

## Current state (2026-09-04)

All 8 implementation slices are done and merged to `main`: cart, likes, promo codes, orders, payments (Stripe, both flows), the stale-pending order sweep, and stock notifications (BullMQ + Redis). The module map, stack, and what's genuinely still open are in [`docs/architecture.md`](docs/architecture.md) — that file is the current-state source of truth, not this one; it gets updated inside the same slice as the code, this section only needs a bump when the overall phase changes (design → implementation → done).

No CI pipeline exists (`.github/workflows` was never created) — an explicit, recorded deferral (`decisions.md`), not an oversight.

---

## Module shape

One Nest module per bounded feature, in its own folder (`auth`, `users`, `catalog`, `cart`, `likes`, `orders`, `payments`, `promos`, `notifications`, plus shared infrastructure — `prisma`, `config`, `common`, `mail`, `storage`, `stripe`, `casl`). The authoritative, current module list with what each one owns is `docs/architecture.md`'s Module map — not repeated here, so there is only one place for it to go stale.

CASL abilities live with the feature they guard, not in one global rules file — a single file of every rule is the shape that quietly grants a client another client's orders.

---

## The data model is documented elsewhere. Go read it.

`docs/database/README.md` is the single source of truth for the data model and the reasoning behind it. `docs/database/erd.dbml` is the schema itself; its `Note` fields carry the essentials and defer to that README with `(see docs)`.

**Do not restate either of them here, and do not write data-model code from memory.** An earlier version of this file carried a summarised invariant list. It drifted from the ERD within a day and ended up asserting a column that had been removed and a stock guard that would oversell. A summary of a document that keeps changing is a liability, not a convenience.

Open the relevant section before writing the code:

| Before writing | Read |
|---|---|
| any stock `UPDATE` | §8 *Stock mechanics* — five guarded transitions (reserve, fulfil, release, restock, direct sale), each with its own `WHERE` guard and its own reason. Which one applies on cancellation depends on the order's **previous** status, read under lock. |
| promo code apply or cancel | §4 *Promotions*, §8 *`promo_codes.times_redeemed` mechanics* |
| a Stripe webhook handler | §6 *Payments*, §9 *Gaps with a real schema-level solution* — the event-id table is not the whole idempotency story |
| order history or any order response | §5 *Ordering*, §8 *Snapshots* — which fields are snapshots and which must be joined. Do not guess; the answer has already changed once. |
| a Prisma migration | §9 *Gaps with a real schema-level solution* — three constraints cannot be expressed in Prisma and need hand-written SQL |
| a soft delete or a listing query | §8 *Soft delete vs. hard delete*, §2 *Catalog* |
| the notification job | §7 *Notifications* |

Two rules from that document shape code everywhere, so they are worth stating once here:

- **The schema protects the shape of the data; the service layer protects business behaviour.** Valid `order_status` transitions, authorization, and excluding buyers from the notification set are service-layer concerns by design, not constraints. Do not reach for a `CHECK` to enforce a state machine.
- **Money is an integer in minor units**, single currency, no floats anywhere — DTOs, service signatures, Stripe payloads, test fixtures.

If the ERD itself turns out to be wrong, that is a deliberate change to the ERD, not something a service quietly works around.

---

## Known hazards with generated code here

CASL, Stripe and the Nest security APIs are all heavily represented in training data at versions we are not running. The failure mode is not an invented API, it is a **superseded** one presented with full confidence.

- Cite a doc URL or a `file:line` for every CASL and Stripe API claim. The question is "does this API still exist with these arguments", not "does this look right".
- Never claim a webhook implementation works without running real signature verification — the Stripe CLI, or `Stripe.webhooks.generateTestHeaderString` against the app's own configured secret (what `checkout.e2e-spec.ts` actually does, `decisions.md`). Either is fine; a mocked `constructEvent` is not.
- Do not write the assertions for code written in the same session; it will assert the behaviour produced, including the wrong parts. Offer the mocking setup, let Boris write the assertions.
- Authorization is the worst place in this project to accept unexamined code. An ability that looks right and leaks another client's orders passes every test nobody thought to write.

---

## Commands

```bash
npm run start:dev        # dev server with watch
npm run build             # compile
npm run lint               # ESLint, autofix
npm run test                # unit tests
npm run test:e2e           # end-to-end tests
npm run lint:openapi      # Spectral (house rules) + Redocly (base OAS validity) against docs/api/
npx prisma migrate dev    # create and apply a migration locally
npx prisma studio          # inspect data
docker compose up -d       # Postgres, Mailhog (:8025), MinIO (:9001), Redis — all local infra
```

No Stripe CLI command is needed — webhook e2e coverage uses `Stripe.webhooks.generateTestHeaderString` instead (`decisions.md`).
