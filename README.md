# T-Shirt Store API

REST API for a T-shirt store: catalog with size/colour variants, cart, orders with a tracked status lifecycle, Stripe payments through two flows, and queue-backed low-stock notifications.

Capstone project for the RAVN backend module. Built on an ERD designed in Week 1 and an OpenAPI contract designed in Week 2 — both live in [`docs/`](docs/) and are the contract the implementation answers to.

> **Status: design phase.** The Nest scaffold is in place; no feature code yet. The section [Implementation status](#implementation-status) tracks what actually exists.

---

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 24 LTS, TypeScript strict mode |
| Framework | NestJS 11 |
| Database | PostgreSQL via Prisma |
| Validation | `class-validator` / `class-transformer` behind a global `ValidationPipe` |
| Docs | OpenAPI via `@nestjs/swagger` |
| Auth | Passport + JWT for authentication, CASL for authorization |
| Files | AWS S3 for product images |
| Async | BullMQ on Redis |
| Payments | Stripe (test mode only) |
| Testing | Jest, Supertest, Testcontainers |
| CI | GitHub Actions |

Only the Nest scaffold is installed today. Everything below the framework row arrives as the feature that needs it is designed — each dependency has to be defensible on its own.

---

## Layout

```
t-shirt-store-api/
├── docs/
│   ├── api/            # OpenAPI contract (Week 2 design)
│   ├── database/       # ERD in DBML + its rationale (Week 1 design)
│   └── decisions.md    # running log of settled decisions
├── src/                # application code
├── test/               # end-to-end specs
└── CLAUDE.md           # project-scoped agent instructions
```

---

## Getting started

Requires Node.js 24+ and npm 11+. Docker, PostgreSQL, Redis and the Stripe CLI become prerequisites once the corresponding features land.

```bash
npm install
```

```bash
npm run start:dev
```

The server boots on `PORT` or 3000. It currently exposes no routes — `AppModule` is empty.

### Scripts

| Command | Does |
|---|---|
| `npm run start:dev` | dev server with watch |
| `npm run build` | compile to `dist/` |
| `npm run lint` | ESLint with autofix |
| `npm run format` | Prettier |
| `npm test` | unit tests |
| `npm run test:e2e` | end-to-end tests |

Both test scripts carry `--passWithNoTests` while the suite is empty. Drop the flag from `package.json` once the first real spec lands, so an empty run goes back to being a failure.

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

`pending` on creation; `paid` on a successful payment webhook; a manager advances `paid → processing → shipped`; a delivery person sets `shipped → delivered`; cancellation is allowed at any point before `shipped`. Every transition appends to an append-only status history.

---

## Roles

| Role | Can |
|---|---|
| **Client** | browse and like products, manage own cart, place and view own orders, cancel before `shipped`, apply promo codes |
| **Manager** | full product and SKU management including disable, upload product images, view all orders, advance order status, manage promo codes |
| **Delivery person** | view orders with status `shipped`, mark them `delivered`, view own delivery history |

Sign-up always creates a Client. Manager and delivery-person accounts are provisioned out of band. Authorization is enforced with CASL at the controller level.

---

## Implementation status

| Feature | State |
|---|---|
| Nest scaffold, lint, format, strict TS | done |
| ERD (DBML) | done, Week 1 |
| OpenAPI contract | in progress |
| Prisma schema and migrations | not started |
| Auth: sign up / in / out, forgot + reset password | not started |
| Catalog: products, SKUs, categories, images | not started |
| CASL abilities and guards | not started |
| Cart and likes | not started |
| Orders and status lifecycle | not started |
| Stripe payment links | not started |
| Stripe payment intents | not started |
| Order history with filters and pagination | not started |
| Stock notification queue | not started |
| Promo codes | not started |
| Helmet, CORS, rate limiting | not started |
| Global exception filter, env schema validation | not started |
| Unit tests | not started |
| E2E: auth, checkout, order history | not started |
| CI pipeline | not started |
| Architecture write-up | not started |

---

## Configuration

Environment variables are read through `@nestjs/config` and validated at boot, so a missing variable fails on startup rather than on the first request that needs it. `.env` is gitignored; `.env.example` carries placeholder values only. No real credentials in the repo, ever — Stripe stays in test mode, Postgres stays local or on a throwaway branch database.

`.env.example` does not exist yet; it arrives with the config module.
