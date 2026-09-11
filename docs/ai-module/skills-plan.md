# AI Module — Skills Plan

This is a plan, not an implementation. Nothing described here has been built yet —
no `SKILL.md` files exist, no code has changed. It exists to be reviewed, argued with,
and adjusted before any of it gets built.

## Assignment mapping

The assignment (`docs/ai-module/` deliverables) needs 2+ skills of different purposes,
at least one of which runs executable checks and reports results, then uses them
together to deliver one improvement to this repo. Mentor feedback gave two themes to
work from:

1. Documentation must stay concrete, precise, and up to date.
2. Error handling (for service failures), observability, and logging need work.

Five skills are planned below — more than the required minimum, split so each mentor
theme gets a dedicated skill plus a general-purpose investigation skill, a
research/citation skill, and the required executable-checks skill.

| Skill | Invocation | Type | Mentor theme |
|---|---|---|---|
| Investigate Task | `/investigate-task` | investigation | general (any bug/change) |
| Observability Audit | `/observability` | investigation (sweep) | #2 — error handling & logging |
| Docs Sync | `/docs-sync` | investigation (diff) | #1 — documentation accuracy |
| Research Options | `/research-options` | research & citation | cross-cutting, used by the others |
| Verify Fix | `/verify-fix` | **executable checks** | satisfies the assignment's required check-running skill |

---

## 1. `/investigate-task`

**Purpose.** Given a bug report or proposed change, find the governing documentation,
the relevant implementation, and existing test coverage, then produce a plan — never
code. General-purpose: not tied to either mentor theme specifically.

**Why it's needed.** This repo's own `CLAUDE.md` has a specific table: "before writing
X, read section Y" for stock mechanics, promo redemption, webhook idempotency, order
snapshots, CASL. It also warns that a past summary of the data model drifted within a
day and asserted a removed column plus an oversell-permitting guard. A skill that
enforces "open the actual doc section, don't summarize from memory" before proposing
anything closes exactly that failure mode.

**Input:** a bug report or a proposed change, in plain language.

**Output (fixed template):**
- Task, restated with an observable definition of "done"
- Which doc sections were read and what they said (flagging any doc/code disagreement —
  named, not silently resolved, per this repo's own rule)
- `docs/decisions.md` search results — prior art, so the plan doesn't re-propose
  something already tried and reversed
- Relevant files (`file:line`)
- Findings
- Proposed implementation plan (steps, not code)
- Test plan (unit vs. e2e, what's covered vs. missing)
- Open decisions the skill explicitly refuses to pick silently (layering, testing
  strategy — anything this repo's `CLAUDE.md` says is a per-module call)

**Boundary:** stops at the plan. If asked to also implement, it says so and declines —
matches this repo's plan-then-implement workflow.

---

## 2. `/observability`

**Purpose.** Proactively sweep a module or the whole codebase for error-handling and
logging gaps — unguarded calls to external services (Stripe, mail, S3, the BullMQ
queue), missing `Logger` usage on a failure path, or a failure that doesn't map to the
project's uniform RFC 9457 `problem+json` shape. Produces a prioritized list of findings,
not a fix for one specific reported bug.

**Why it's distinct from `/investigate-task`.** `/investigate-task` is reactive — it
starts from a specific bug report and investigates that one thing. `/observability` is
proactive — it starts from "audit this area for the class of problem the mentor
flagged" and can surface a bug report before anyone files one. In practice, this is the
skill that would have found the mail-failure gap in `auth.service.ts` and the
never-logged failure in `stock-notifications.processor.ts` (see the worked example
below) without anyone reporting either first.

**Input:** a module, a directory, or "the whole app" as scope.

**Output:**
- A list of findings, each as: the call site (`file:line`), what's missing (no
  try/catch, no logger, a raw exception leaking past the `ProblemExceptionFilter`
  contract), and why it matters (what happens on a real failure — a 500 for an action
  that already committed, a silent failure invisible without querying the DB, etc.)
- Findings ranked by whether the failing side effect happens after a critical action
  already committed (worse — the user gets a false failure signal) vs. before (a
  regular error path already covered by existing exception handling)
- Explicitly out of scope: writing the fix. This skill finds and ranks; `/investigate-task`
  turns one finding into a plan; the actual fix is a separate step.

---

## 3. `/docs-sync`

**Purpose.** Compare a changed module's actual behavior against its governing
documentation (`docs/architecture.md`, `docs/decisions.md`, `docs/api/`,
`docs/database/`) and flag drift, proposing documentation updates only — never touching
code.

**Why it's needed.** This repo treats `docs/database/` and `docs/api/` as contracts
that outrank chat, and `CLAUDE.md` says explicitly: if code and docs disagree, name
which one you think is wrong and stop — don't silently pick a side. That rule needs a
repeatable way to actually catch the disagreement, not just a promise to follow it when
noticed by chance. (The worked example below is a real, current instance of this exact
problem: `architecture.md`'s Mail stack line still says "local Mailhog in dev" after
`feat/brevo-smtp` shipped real relay support — nobody caught it because nothing was
looking.)

**Input:** a module name, a merged PR/commit range, or "the whole `docs/` tree" as scope.

**Output:**
- Per doc file touched: what it currently says vs. what the code currently does
- For each mismatch: a call on which side is stale, with the reasoning, and a proposed
  doc edit (not a code edit)
- Unresolved cases — where it's genuinely unclear whether the doc or the code is
  "right" — listed explicitly rather than guessed at
- If `docs/api/` is in scope, runs `npm run lint:openapi` as one concrete check and
  reports its real output alongside the narrative diff

---

## 4. `/research-options`

**Purpose.** Before committing to a library API, version, or architectural approach,
research current official documentation (not training-data memory, not blogs) and
produce a short cited decision brief comparing real candidates.

**Why it's needed.** `CLAUDE.md`'s hard rule: cite the source for any claim about a
library's API, and say so explicitly when unsure rather than guessing — called out
specifically for CASL, Stripe, and NestJS security APIs, which are heavily represented
in training data at versions this repo doesn't pin.

**How it's used by the others.** Not invoked standalone in the improvement workflow —
`/investigate-task` and `/observability` call into it when a finding or a proposed fix
depends on a library's actual current behavior (e.g. "does BullMQ's `attemptsMade`
still work this way," "what does CASL's `manage` action still match by default").
`/docs-sync` calls into it before writing a factual claim about a dependency into
`decisions.md`.

**Input:** a specific technical question, or 2-3 candidate approaches to compare.

**Output:** for each candidate — a doc URL citation (matched against this repo's
actual pinned version in `package.json`/`package-lock.json`, not just "latest"), current
behavior, a verdict (valid / superseded / uncertain), and a recommendation stating what
it trades away.

---

## 5. `/verify-fix` — the required executable-checks skill

**Purpose.** Run this project's real checks (`lint`, `build`, `test`, `test:e2e`,
`lint:openapi`) and report exact pass/fail with the real captured output. Reproduces a
bug or a coverage gap before a fix, confirms it's resolved after, and never claims a
result that wasn't actually observed.

**Why it's needed.** `CLAUDE.md`'s hard rule: run the checks before claiming something
works, paste real output, never report success that wasn't observed. This is that rule
as a repeatable before/after workflow — the one skill in this set whose whole job is
proof, not planning.

**Input:** a change to verify, and (optionally) which checks are in scope — not every
change needs every gate (a docs-only change might only need `lint:openapi`).

**Output (fixed template):** a before/after table naming which checks ran, the real
pasted output for each, an honest "not run" entry for anything that couldn't execute in
the environment (most likely `test:e2e` without a Docker daemon) rather than a
fabricated pass, and no `--no-verify`/`--fix`-to-force-green shortcuts.

---

## How the five compose for one improvement

The assignment wants one improvement, delivered *using* the skills — not five
disconnected exercises. Planned pipeline:

1. **`/observability`** sweeps a chosen area (or the whole app) and produces a ranked
   list of error-handling/logging gaps.
2. **`/investigate-task`** takes the highest-value finding from that list and turns it
   into a concrete implementation + test plan, reading the governing docs and
   `decisions.md` for prior art.
3. **`/research-options`** gets called from inside step 2 whenever the plan depends on
   a library API's actual current behavior, not on memory.
4. The fix gets implemented by hand (this is the part that's actually yours to do and
   defend in review — not something to hand back to an agent).
5. **`/verify-fix`** proves it: real before/after check output, no claimed passes that
   weren't observed.
6. **`/docs-sync`** closes the loop — checks whether the fix (and anything it touched)
   left `architecture.md`/`decisions.md`/`docs/api/` accurate, and proposes the doc
   edits directly.

## Worked example (for scale only — not yet investigated for real)

During planning, a plausible target surfaced by inspection: `src/auth/auth.service.ts`
awaits `MailService.send...()` unguarded in `forgotPassword`/`resetPassword`, so a mail
relay failure (newly plausible now that `feat/brevo-smtp` added real authenticated-relay
support) would throw past a committed DB action; separately,
`stock-notifications.processor.ts` persists a failure to the DB but never logs it.
`docs/architecture.md`'s Mail line is also stale relative to that same relay work. This
lines up with both mentor themes and is small enough to fit the assignment's timebox —
but it was found by direct inspection this session, not by actually running
`/observability`. Confirming it (or finding something the sweep considers higher
priority) is the first real step once the skills exist, not something to assume from
this plan.

## Build approach — a recommendation, not a decision

`skill-creator` (Anthropic's own skill for building skills) exists and can scaffold
these properly, including the interview, test-prompt generation, and — if wanted — the
parallel with-skill/baseline benchmarking and eval-viewer review loop it's actually
designed around. For five skills built once and demonstrated a handful of times each,
the full benchmarking loop is likely more process than the timebox supports; a lighter
pass (draft directly against the specs above, 2-3 realistic test prompts per skill, run
each once for real and read the output) is probably the better trade. Worth deciding
deliberately rather than defaulting either way — and worth doing yourself rather than
delegating wholesale, since being able to explain why each skill is shaped the way it
is will matter more in review than how fast it got built.

## Open decisions

- Which finding from `/observability`'s sweep actually becomes "the one improvement" —
  the worked example above is a candidate, not a commitment.
- Whether `/docs-sync`'s scope for this pass is just the touched module or a wider pass
  across `docs/`.
- Branch name and starting commit — last session's `feat/mail-failure-observability`
  branch was reset back to `main` (`651d55f`); a fresh branch is a clean starting point
  whenever the actual work begins.
