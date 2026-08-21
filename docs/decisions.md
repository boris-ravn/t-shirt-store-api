# Decision log

What was decided, why, and when. Append only — do not rewrite history in it.

This file is history, not rules. Binding conventions live where the work happens: [`api/CONVENTIONS.md`](api/CONVENTIONS.md) for the OpenAPI contract, the repo-root `CLAUDE.md` for code. When one of those changes, edit it there and add an entry here saying what changed and why.

---

### 2026-08-21 — `strict: true` in `tsconfig.json`, not the Nest CLI's flag set

The CLI's `--strict` sets four individual flags and leaves `strictFunctionTypes`, `strictPropertyInitialization` and `useUnknownInCatchVariables` off, which reads as strict mode without being it. Consequence to accept: DTO properties need the definite-assignment assertion (`name!: string`) because `class-transformer` populates the instance at runtime, outside the compiler's view. Disabling the flag for DTOs was rejected — the assertion is defensible in review, a weakened compiler is not.

### 2026-08-21 — The ERD and the OpenAPI contract live in the project, under `docs/`

`docs/database/` for the DBML, `docs/api/` for the contract, `docs/decisions.md` for this log. They travel with the repo a reviewer clones, rather than sitting in the module-wide notes directory one level up.

### 2026-08-21 — No dependencies beyond the Nest scaffold until a design calls for them

Prisma, Swagger, CASL, Stripe, BullMQ and the rest get proposed one at a time, with what each replaces, at the point the feature needing it is designed. Installing the full stack up front produces a `package.json` that cannot be defended line by line.

### 2026-08-21 — `docs/database/README.md` is the only place the data model is explained

Its rationale is not summarised in the project `README.md` or in `CLAUDE.md`; both point at it instead. The summary in `CLAUDE.md` was written from `erd_v2.txt` and drifted from the committed `erd.dbml` within a day — it asserted a payment-link stock guard on raw `stock` instead of `stock - reserved_stock`, which would oversell into cart reservations. Cost accepted: an agent has to open a roughly 300-line document before writing code that touches stock, payments, promos or order history. That is cheaper than a confident wrong invariant.

### 2026-08-21 — API contract conventions, approved as a batch

Casing, error body, pagination, money representation, security scheme, versioning and format precision. Recorded in [`api/CONVENTIONS.md`](api/CONVENTIONS.md) rather than here, because they are rules to follow rather than history to read.

### 2026-08-21 — Modular spec files over a single document

Overrides the single-file recommendation made during planning. The argument for one file was portability and trivial linting; the argument that won was pull-request reviewability, which matters more across four weeks of iteration than a bundling step does. Cost accepted: `$ref`s must be bundled before Swagger UI and some generators will resolve them, so bundling becomes part of the pipeline rather than an afterthought.

### 2026-08-21 — Spectral for spec linting, not Redocly

Both lint OpenAPI competently. Spectral was chosen for its custom rulesets: the point is not catching malformed YAML but enforcing house rules the challenge cares about, such as every operation carrying a summary and every 4xx carrying the error schema. Still open: whether it lands as a `devDependency` or stays an `npx` invocation until the CI pipeline exists.

### 2026-08-21 — The generated spec is reconciled against the hand-written one, never allowed to replace it

Week 3 requires `@nestjs/swagger`, which produces a second OpenAPI document from decorators. The hand-written contract in `docs/api/` stays authoritative; the generated document is diffed against it with `oasdiff`, and a difference is treated as a bug in the implementation until argued otherwise. The alternative — letting the generated file become the truth — turns every accidental implementation detail into a silent contract change, which is the same drift that already cost us the `CLAUDE.md` invariant list.
