# `observability` — cold (fresh-session) run

Run in two fresh subagent sessions, each with no memory of this repo's prior work or of
the original write-up's claimed findings, given only the skill's own `SKILL.md`.

## Run 1 — prompt: "Sweep src/auth and src/notifications for error-handling and logging gaps around external calls (mail, the BullMQ queue)."

Findings (highest severity first):

1. **High** — `LowStockService.enqueueNotifications` (`src/notifications/low-stock.service.ts:81-91`)
   calls `this.queue.addBulk(...)` unguarded, after the payment webhook's transaction has
   already committed the paid order and decremented stock. If Redis/BullMQ is unavailable,
   the exception propagates unguarded out of the webhook handler, producing a 500 for a
   Stripe event that in fact fully succeeded.
2. **Medium** — `StockNotificationsProcessor`'s failure branch
   (`src/notifications/stock-notifications.processor.ts:43-63`) records a mail-send
   failure only as a DB row (`status: failed`); nothing is ever logged via `Logger`, and no
   `@OnWorkerEvent('failed')`/`QueueEvents` listener exists anywhere, so an exhausted retry
   is invisible outside the database.
3. **Checked, clean**: both `auth.service.ts` mail call sites — wrapped, logged with
   recipient + stack, called only after the state change commits.

## Run 2 — prompt: "Check the whole app for places where a Stripe or S3 call could throw past a committed database write."

Findings (highest severity first):

1. **High** — `PaymentsService.createPaymentLinkCheckout` (`src/payments/payments.service.ts:142-246`)
   commits a `pending` order, then calls `stripe.prices.create` /
   `stripe.paymentLinks.create` / `.retrieve` unguarded — a Stripe failure here 500s a
   request whose order row already exists.
2. **Medium** — the Stripe cleanup calls at `payments.service.ts:107` and `:231-233`
   (`.catch(() => {})`, no `Logger` at all) silently orphan a losing payment intent or
   payment link on Stripe's side with zero trace in application logs.
3. Plain `PrismaService` calls and S3 calls that run *before* their DB write (both
   `ProductImagesService` call sites) were correctly excluded as out of scope for this
   specific "throw past a committed write" framing.

## Comparison against the original write-up's claim

The original write-up (`writeup.md`, Project Results) described "8 ranked findings"
including "a dropped low-stock-notification enqueue that *looks* retryable via BullMQ but
isn't" and "a fully silent `.catch(() => {})` around Stripe cleanup calls with zero
logging anywhere." The cold runs **independently rediscovered the same two named
findings** (Run 1 finding 1 matches the enqueue claim; Run 2 finding 2 matches the silent
`.catch` claim almost verbatim) plus surfaced a third, previously-undescribed high-severity
finding (Run 2 finding 1, the unguarded Stripe calls in `createPaymentLinkCheckout`) that
the original write-up's summary did not call out by name. This is a partial, not total,
rediscovery: the cold runs did not reproduce all 8 of the original count (each run was
narrower-scoped than a full-app sweep, per the task prompts used), but every finding they
did produce checks out against the actual code, and the sweep surfaced at least one real
gap the original pass's summary omitted.

## What the skill's instructions left to judgment

- Whether to follow a call chain outside the stated scope to determine "committed before
  this call" (both runs did, and had to, to score severity correctly).
- Whether reverse-order external calls (S3 upload *before* the DB write) count as the same
  class of finding — the skill's wording assumes write-then-call, not call-then-write.
- What severity to assign a swallowed error that's contingent on a *different* request's
  commit (the Stripe cleanup-on-losing-a-race case) — the skill's three tiers assume a
  single-request causal chain.
