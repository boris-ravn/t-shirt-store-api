# CLAUDE.md — t-shirt-store-api

The repo-root `../CLAUDE.md` is the authority on how we work: planning before implementing, layering and testing decisions, conventions, hard rules, git. It applies here in full and is deliberately **not** repeated below. This file covers only what is specific to this codebase.

---

## What this is

The capstone of the RAVN backend module: a REST API for a T-shirt store. Catalog with variants, cart, orders with a status lifecycle, Stripe payments in two flavours, and a queue-backed stock notification.

Two documents are the contract. Both outrank anything said in chat:

- `docs/database/` — the ERD: `erd.dbml` for the schema, `README.md` for the reasoning behind it (Week 1)
- `docs/api/` — the OpenAPI contract, from Week 2

If the code and one of those disagree, that is a bug in one of them. Name which one you think is wrong and stop; do not silently pick a side.

`docs/decisions.md` is the running log of settled decisions. Append to it, do not rewrite history in it.

---

## Current state (2026-08-21)

Empty Nest scaffold. No feature code, no Prisma, no database, no `.env`. Dependencies are the stock `nest new` set and nothing more.

The OpenAPI contract is being designed now. Implementation has not started, so do not propose code that assumes a module, entity or endpoint exists — open the contract and the DBML first.

---

## Intended module shape

Derived from the ERD's table groups. **None of these folders exist yet**; this is the target, not a description of what is on disk.

| Module | Owns |
|---|---|
| `auth` | sign up / in / out, refresh tokens, forgot + reset password |
| `users` | profile, role (never set from a request body) |
| `catalog` | categories, products, product images (S3), SKUs |
| `cart` | cart, cart items |
| `likes` | product likes |
| `orders` | orders, items, status transitions, status history, order history queries |
| `payments` | payment links, payment intents, Stripe webhooks |
| `promos` | promo codes, validation, reserve / release |
| `notifications` | low-stock events, stock notification jobs, email |

Plus shared infrastructure: `prisma`, `config`, `common` (filters, guards, decorators, pipes).

One Nest module per bounded feature, in its own folder. CASL abilities live with the feature they guard, not in one global rules file — a single file of every rule is the shape that quietly grants a client another client's orders.

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
- Never claim a webhook implementation works without running it against the Stripe CLI. Signature verification either verifies or it does not.
- Do not write the assertions for code written in the same session; it will assert the behaviour produced, including the wrong parts. Offer the mocking setup, let Boris write the assertions.
- Authorization is the worst place in this project to accept unexamined code. An ability that looks right and leaks another client's orders passes every test nobody thought to write.

---

## Project-specific commands

The root `CLAUDE.md` command list applies. Nothing beyond the stock Nest scripts exists yet — Prisma, Stripe CLI and Redis commands get added to `package.json` as those pieces land, not invented at the call site.
