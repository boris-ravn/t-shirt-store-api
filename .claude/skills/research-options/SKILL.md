---
name: research-options
description: >
  Research current, authoritative documentation before committing to a library API,
  version, or architectural approach, and produce a short cited decision brief. Use this
  whenever a design choice depends on how a third-party library or framework currently
  behaves (CASL, Stripe, NestJS, Prisma, nodemailer, BullMQ, or any other dependency)
  rather than on how it's remembered from training data — this matters most for CASL,
  Stripe, and NestJS security APIs, which are heavily represented in training data at
  versions this project doesn't run. Also use it to compare two or more candidate
  approaches before implementing one, or to verify a specific factual claim before it
  gets written into project docs (architecture.md, decisions.md, an ADR). Trigger this
  proactively whenever you're about to state an API signature, a "does X still work this
  way" claim, or a "best practice" recommendation without already having a doc URL or a
  file:line in this repo to back it up.
---

# Research Options

## Why this exists

This project's `CLAUDE.md` has a hard rule: cite the source for any claim about a
library's API — a doc URL or a `file:line` in this repo — and say so explicitly if
you're not sure an API exists rather than guessing. A plausible-but-superseded API reads
exactly like a real one, and CASL, Stripe, and NestJS security APIs are called out
specifically because they're heavily represented in training data at versions this repo
doesn't pin. This skill is that rule turned into a repeatable workflow instead of
something to remember to do each time.

## When to reach for it

- Before writing an implementation that depends on a specific third-party API shape
  (e.g. "does CASL's `can()` still take these arguments", "what does Stripe's webhook
  constructor expect now").
- Before picking between two or more real candidate approaches (e.g. "handle this
  failure inline vs. route it through the existing queue") where the right answer
  depends on current guidance, not on a coin flip.
- Before a documentation-sync pass writes a factual claim about a dependency into
  `decisions.md` or `architecture.md` — `docs-sync` calls into this skill for exactly
  that reason.
- When `investigate-task` or `observability` surface a finding whose fix depends on a
  library's actual current behavior rather than on how it's typically used.

Skip it for anything already answered by reading this repo's own code — that's a
`file:line` citation, which is cheaper and more precise than a web search.

## Workflow

1. **Pin the version first.** Check `package.json` / `package-lock.json` for the exact
   installed version of the library in question. Docs drift across major versions far
   more than this repo's training-data-shaped blind spots would suggest — searching for
   "how does BullMQ handle retries" without checking that this repo pins `bullmq@6.3.4`
   risks landing on a `7.x` or `5.x` answer that doesn't apply here.

2. **Identify the real candidates.** If the input is a bare question, name the 2-3
   approaches actually worth comparing before researching them — don't research a single
   pre-decided answer and call it a comparison.

3. **Search official sources only**, in this priority order:
   - The library's own docs site (e.g. `nestjs.com`, `casl.js.org`, `docs.stripe.com`,
     `nodemailer.com`, `prisma.io`, `docs.bullmq.io`).
   - The library's own repo — README, CHANGELOG, or release notes for the pinned
     version — when the docs site doesn't version-scope clearly.
   - The library's own installed source under `node_modules/` (types, `.d.ts` files) is
     ground truth for "does this API exist at the pinned version" and beats any web
     source when the two disagree.
   - Avoid blogs, tutorials, and Q&A sites as the cited source. They're fine for finding
     *where* the official doc lives, but the citation itself must be the primary source.

4. **For each candidate, report:**
   - **Source** — doc URL (or `node_modules` file:line), and the version it describes
     (confirm it matches step 1's pinned version, or say explicitly if it doesn't and
     what changed).
   - **Current behavior** — the API/pattern as documented now, in enough detail to act on.
   - **Verdict** — still valid for this repo's pinned version / superseded / uncertain.
     If you can't confirm an API exists at the pinned version, say that plainly instead
     of extrapolating from a newer or older version's docs.

5. **Recommend, with the trade-off named.** End with a recommendation stated against
   this project's actual constraints (from `CLAUDE.md`: no new dependency without
   asking, async/await only, DTOs at the boundary, etc.), and say what it costs — never
   a bare "do X" with no source and no downside.

## Output template

```markdown
## Question
<the decision being made>

## Candidates

### Option A: <name>
- Source: <doc URL or node_modules file:line> (describes vX.Y, pinned version here is vA.B — match / mismatch noted)
- Current behavior: <summary>
- Verdict: valid / superseded / uncertain — <why>

### Option B: <name>
...

## Recommendation
<pick one, state what it trades away, tie it to a concrete constraint from this repo>
```

## Failure mode to avoid

If a source can't be reached or the docs are ambiguous about the pinned version, say so
explicitly in the output rather than filling the gap with a remembered-but-unverified
answer. "I couldn't confirm this for the pinned version" is a valid and useful result —
a confident guess dressed up as a citation is not.
