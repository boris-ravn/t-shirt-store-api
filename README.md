# T-Shirt Store API

REST API for a T-shirt store: catalog with size/colour variants, cart, orders with a tracked status lifecycle, Stripe payments through two flows, a stale-pending order sweep, and queue-backed low-stock notifications.

Built on an ERD and an OpenAPI contract designed up front — both live in [`docs/`](docs/) and are the contract the implementation answers to.

All slices are implemented and merged to `main`. See [`docs/architecture.md`](docs/architecture.md) for the current module map and stack, and [`docs/decisions.md`](docs/decisions.md) for why things are the way they are.

---

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript strict mode |
| Framework | NestJS 11 |
| Database | PostgreSQL via Prisma |
| Validation | `class-validator` / `class-transformer` behind a global `ValidationPipe` |
| Docs | Hand-written OpenAPI in `docs/api/` (authoritative) + generated Swagger at `/docs` |
| Auth | Passport + JWT for authentication, CASL for authorization |
| Files | AWS S3 for product images (MinIO locally) |
| Mail | Nodemailer (Mailhog locally) |
| Async | BullMQ on Redis (stock notifications), `@nestjs/schedule` (stale-order sweep) |
| Payments | Stripe (test mode only) |
| Testing | Jest, Supertest, Testcontainers |
| CI | Not built — see [`docs/decisions.md`](docs/decisions.md) |

---

## Layout

```
t-shirt-store-api/
├── docs/
│   ├── api/            # OpenAPI contract + its conventions (Week 2 design)
│   ├── database/       # ERD in DBML + its rationale (Week 1 design)
│   ├── architecture.md # current-state snapshot: stack, modules, testing strategy
│   └── decisions.md    # why the settled decisions were settled that way
├── prisma/             # schema and migrations
├── src/                # application code, one Nest module per feature
├── test/               # end-to-end specs
├── docker-compose.yml  # local Postgres, Mailhog, MinIO, Redis
└── CLAUDE.md           # project-scoped agent instructions
```

---

## Getting started

Requires Node.js 24+, npm 11+, and Docker.

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate deploy
npm run start:dev
```

The server boots on `PORT` (default `3000`). Swagger UI is at `/docs`; Mailhog's inbox is at `http://localhost:8025`; MinIO's console is at `http://localhost:9001`.

A real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` in `.env` is only needed for the two live-Stripe-API e2e tests — everything else, including webhook signature verification, runs against Mailhog/Testcontainers/a stubbed Stripe client and needs no external account.

### Scripts

| Command | Does |
|---|---|
| `npm run start:dev` | dev server with watch |
| `npm run build` | compile to `dist/` |
| `npm run lint` | ESLint with autofix |
| `npm run format` | Prettier |
| `npm test` | unit tests |
| `npm run test:e2e` | end-to-end tests (real Postgres via Testcontainers) |
| `npm run lint:openapi` | lint `docs/api/` (Spectral house rules + Redocly base validity) |

---

## The data model

[`docs/database/`](docs/database/) holds the ERD and the reasoning behind it: `erd.dbml` for the schema, [`README.md`](docs/database/README.md) for why each table looks the way it does — soft deletes, snapshot columns, the five guarded stock transitions, and what the schema deliberately leaves to the service layer.

That document is the source of truth for the data model. Neither this file nor [`CLAUDE.md`](CLAUDE.md) summarises it, on purpose: a summary of a document that keeps changing is the copy that ends up wrong.

---

## Order status lifecycle

```
pending → paid → processing → shipped → delivered
                    ↓
                cancelled
```

`pending` on creation; `paid` on a successful payment webhook; a manager advances `paid → processing → shipped`; a delivery person sets `shipped → delivered`; cancellation is allowed at any point before `shipped`, including automatically by the stale-pending sweep if a `pending` order sits unpaid past `STALE_ORDER_MAX_AGE_MINUTES`. Every transition appends to an append-only status history.

---

## Roles

| Role | Can |
|---|---|
| **Client** | browse and like products, manage own cart, place and view own orders, cancel before `shipped`, apply promo codes |
| **Manager** | full product and SKU management including disable, upload product images, view all orders, advance order status, manage promo codes |
| **Delivery person** | view orders with status `shipped`, mark them `delivered`, view own delivery history |

Sign-up always creates a Client. Manager and delivery-person accounts are provisioned out of band. Authorization is enforced with CASL at the controller level.

---

## Configuration

Environment variables are read through `@nestjs/config` and validated at boot, so a missing variable fails on startup rather than on the first request that needs it. `.env` is gitignored; `.env.example` carries every variable with a placeholder value. No real credentials in the repo, ever — Stripe stays in test mode, Postgres stays local or on a throwaway branch database.
