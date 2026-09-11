---
name: investigate-task
description: >
  Investigate a bug report or proposed change in this repo before any code gets written:
  find the governing documentation, the relevant implementation, and the existing test
  coverage, then produce a plan — never code. Use this whenever asked to look into a bug,
  a proposed feature, or "why does X behave like this" in this codebase, and especially
  for anything touching stock mechanics, promo codes, payments/webhooks, order status
  transitions, or CASL abilities — this repo's own CLAUDE.md requires reading the
  governing doc section before writing code in those areas (a past summary drifted and
  asserted a removed column plus an oversell-permitting guard within a day), and this
  skill enforces that instead of relying on memory of a prior session or of the docs.
---

# Investigate Task

## Why this exists

This repo's two contract documents — `docs/database/` (the ERD + reasoning) and
`docs/api/` (the OpenAPI contract) — outrank anything said in chat, and `CLAUDE.md`
spells out a specific table of "before writing X, read section Y" for exactly the areas
most likely to be gotten wrong from memory (stock guards, promo redemption counters,
webhook idempotency, order snapshots). This skill turns that table into an enforced first
step instead of something that's easy to skip under time pressure, and produces a plan a
human reviews before any implementation starts — matching this repo's own "plan then
implement" workflow.

## Workflow

### 1. Restate the task precisely

Write down, in one or two sentences: what's reportedly wrong or wanted, and what
"resolved" or "done" looks like as an observable, testable behavior — not just "fix the
bug."

### 2. Read the governing docs for the area touched — actually open them, don't summarize from memory

Match the task against this repo's own map and open every section that applies:

| Task touches | Read |
|---|---|
| any stock `UPDATE` | `docs/database/README.md` §8 — five guarded transitions (Reserve, Fulfil, Release, Restock, Direct sale); which one applies on cancellation depends on the order's *previous* status read under lock |
| promo code apply or cancel | §4 *Promotions*, §8 *`promo_codes.times_redeemed` mechanics* |
| a Stripe webhook handler | §6 *Payments*, §9 *Gaps with a real schema-level solution* |
| order history or any order response | §5 *Ordering*, §8 *Snapshots* |
| a Prisma migration | §9 — three constraints need hand-written SQL, not Prisma-expressible |
| a soft delete or listing query | §8 *Soft delete vs. hard delete*, §2 *Catalog* |
| the notification job | §7 *Notifications* |
| CASL / authorization | `docs/architecture.md`'s Auth & authorization section, then search `docs/decisions.md` for the subject (a wrong `manage`-wildcard grant has bitten this repo for real before) |
| anything in `docs/api/` | `docs/api/CONVENTIONS.md` — binding rules for casing, pagination, money, errors, versioning |

If the code and a doc disagree, that's a bug in one of them — name which one you think is
wrong and say so in the output. Do not silently pick a side, and do not patch around the
disagreement.

### 3. Check `docs/decisions.md` for prior art

Search it for the subject area. If an approach was already tried and reversed, or a
trade-off was already deliberately accepted, the plan needs to account for that instead
of re-proposing something already rejected.

### 4. Find the actual code and its current test coverage

Locate the controller, service, DTOs, and (if relevant) the CASL ability file for the
feature. Then check what's actually tested: the `*.service.spec.ts` unit spec and any
`test/*.e2e-spec.ts` coverage. Note explicitly what's covered, what's missing, and what a
previous `decisions.md` entry may have already flagged as a deliberately deferred gap
(don't rediscover a documented gap as if it were new).

### 5. If the plan depends on a library's current behavior, don't guess

If turning the findings into a plan requires knowing how a third-party API currently
works (CASL, Stripe, NestJS, Prisma, or anything else this repo depends on), use the
`research-options` skill instead of relying on training-data memory — this repo's
`CLAUDE.md` flags exactly this as a high-risk spot for a confidently-wrong answer.

### 6. Produce the plan — this output only, no code

```markdown
## Task
<restated in one or two sentences, with the observable definition of "done">

## Relevant docs read
<which sections, with a one-line takeaway from each — flag any doc/code disagreement here>

## Relevant files
<controller/service/DTO/CASL/test files, as file:line>

## Findings
<what's actually happening today, cited to code and docs — not assumed>

## Proposed implementation plan
<ordered steps, described, not written as code>

## Test plan
<what's already covered, what's missing, unit vs. e2e — real Postgres for e2e per this
repo's testing philosophy; mock only what genuinely can't run locally>

## Open decisions
<anything this repo's CLAUDE.md says not to assume silently — layering, testing
strategy, or any other "it depends" — named explicitly for the user to decide, not
picked here>
```

## Failure mode to avoid

Don't let this turn into an implementation. If asked to also write the code, stop and
say the investigation is done and implementation is a separate step — this repo's
workflow is plan first, wait for a go-ahead, then implement the whole agreed scope.
