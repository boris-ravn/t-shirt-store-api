# Decisions

One entry per settled decision: what was decided, why, and when. Append only.

---

### 2026-08-21 — `strict: true` in `tsconfig.json`, not the Nest CLI's flag set

The CLI's `--strict` sets four individual flags and leaves `strictFunctionTypes`, `strictPropertyInitialization` and `useUnknownInCatchVariables` off, which reads as strict mode without being it. Consequence to accept: DTO properties need the definite-assignment assertion (`name!: string`) because `class-transformer` populates the instance at runtime, outside the compiler's view. Disabling the flag for DTOs was rejected — the assertion is defensible in review, a weakened compiler is not.

### 2026-08-21 — The ERD and the OpenAPI contract live in the project, under `docs/`

`docs/database/` for the DBML, `docs/api/` for the contract, `docs/decisions.md` for this log. They travel with the repo a reviewer clones, rather than sitting in the module-wide notes directory one level up.

### 2026-08-21 — No dependencies beyond the Nest scaffold until a design calls for them

Prisma, Swagger, CASL, Stripe, BullMQ and the rest get proposed one at a time, with what each replaces, at the point the feature needing it is designed. Installing the full stack up front produces a `package.json` that cannot be defended line by line.

### 2026-08-21 — `docs/database/README.md` is the only place the data model is explained

Its rationale is not summarised in the project `README.md` or in `CLAUDE.md`; both point at it instead. The summary in `CLAUDE.md` was written from `erd_v2.txt` and drifted from the committed `erd.dbml` within a day — it asserted an `orders.promo_code` snapshot column that had been removed, and a payment-link stock guard on raw `stock` instead of `stock - reserved_stock`, which would oversell into cart reservations. Cost accepted: an agent has to open a ~300-line document before writing code that touches stock, payments, promos or order history. That is cheaper than a confident wrong invariant.
