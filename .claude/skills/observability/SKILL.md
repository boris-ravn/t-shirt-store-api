---
name: observability
description: >
  Proactively sweep a module, a directory, or the whole app for error-handling and
  logging gaps — unguarded calls to external services (Stripe, mail/nodemailer, S3,
  the BullMQ queue), missing Logger usage on a failure path, or a failure that doesn't
  map to this project's uniform RFC 9457 problem+json shape. Produces a ranked list of
  findings, not a fix. Use this whenever asked to review error handling, resilience,
  logging, or "what happens when X fails" in this codebase, or whenever reviewer/mentor
  feedback mentions observability, logging, or service-failure handling — trigger this
  even if the user doesn't name a specific bug, since the point of this skill is to
  surface problems nobody has reported yet.
---

# Observability Audit

## Why this exists

This repo's `CLAUDE.md` documents its error-handling contract precisely: every 4xx/5xx
returns the same RFC 9457 `application/problem+json` shape via the global
`ProblemExceptionFilter`, and services throw typed `AppException` subclasses rather than
building raw responses. That contract only holds where someone remembered to apply it.
Calls to external services — Stripe, the mail relay, S3, the BullMQ queue — are exactly
where a raw, unguarded failure is most likely to slip past it, because the failure mode
(a real network or auth error, not a validation error) doesn't look like the cases the
contract was designed around. This skill is a repeatable way to go looking for those
spots instead of waiting for one to fail in front of a user first.

## How this differs from `investigate-task`

`investigate-task` is reactive: given one reported bug or proposed change, it
investigates that one thing. This skill is proactive: given a scope (a module, or "the
whole app"), it goes looking for the class of problem on its own, with no bug report to
start from. Use this skill to generate findings; hand the highest-priority one to
`investigate-task` to turn into an actual implementation plan. Do not try to make this
skill also produce the fix — that blurs a sweep (breadth) into an investigation (depth on
one thing), and does both worse.

## Workflow

### 1. Scope the sweep

A single module (e.g. `src/notifications/`), a directory, or "the whole app." A wider
scope takes longer but nothing here is expensive to re-run — when in doubt, start
narrower and widen if the first pass comes back too thin to be useful.

### 2. Enumerate every call to something that can genuinely fail

Within scope, search for calls to:
- Stripe (`stripe.paymentIntents`, `stripe.checkout`, `stripe.webhooks`, ...)
- Mail (`MailService`, `transporter.sendMail`, `nodemailer`)
- Storage (`S3Service`, `s3Client.send`, any AWS SDK call)
- The queue (`Queue.add`, a `@Processor`'s `process()` method)
- Any other outbound network call this scope makes

A call to the local Postgres via `PrismaService` is not in scope here — that's a
different failure class (already covered by this repo's transaction/exception patterns)
and reviewing it is `investigate-task`'s job when a specific concern is raised, not this
skill's default sweep.

### 3. For each call site, check what happens on failure

- Is the call wrapped in a `try/catch`, or otherwise guaranteed not to propagate past a
  critical action that already committed (a DB write, a state transition)?
- If it throws unguarded, does it surface via `ProblemExceptionFilter`'s existing
  `Logger.error` at the HTTP boundary (still logged, just possibly the wrong status —
  note which), or does something swallow it silently first?
- If the call site is a queue processor: does the `catch` block (if any) log via
  `Logger`, or only update a database row? A DB-only failure record is invisible to
  anyone not actively polling that table — flag this even though it's "handled" in the
  sense that nothing crashes.
- Does a retry mechanism exist (BullMQ `attempts`/`backoff`), and if so, can the log
  output (if any) distinguish "will retry" from "exhausted, needs a human"? If the retry
  count matters and you're not certain which BullMQ field reflects it correctly, use the
  `research-options` skill rather than assuming — an off-by-one here produces a
  confidently wrong signal, which is worse than no signal.

### 4. Rank findings by real severity, not by file order

- **Highest**: an unguarded failure after a critical action already committed (the
  caller gets a false failure signal — e.g. a 500 for a request that actually succeeded).
- **Medium**: a failure that's handled (doesn't crash, doesn't corrupt state) but is
  operationally invisible — persisted only to a DB row nobody's watching, or logged with
  too little context to act on (no id, no recipient, no distinguishing detail).
- **Low / not a finding**: a failure that already logs with useful context and already
  returns the contract's correct shape. Don't pad the list with these just to have more
  entries.

### 5. Output — findings only, never a fix

```markdown
## Scope
<module / directory / whole app>

## Findings (highest severity first)

### 1. <short title>
- Location: `file:line`
- What's missing: <no try/catch / no logger / DB-only failure record / ambiguous retry signal>
- Why it matters: <the concrete bad outcome — a false 500, an invisible failure, etc.>
- Severity: high / medium / low, with the one-line reason from step 4

### 2. ...
```

## Failure mode to avoid

Don't write the fix here, even if it's obvious. Findings feed `investigate-task` (for a
plan) and eventually `verify-fix` (to prove the fix works) — collapsing all three into
one skill loses the "don't pick silently" checkpoint between finding a problem and
committing to one specific solution.
