---
name: verify-fix
description: >
  Run this project's real checks (lint, build, unit tests, e2e tests, lint:openapi) and
  report exact pass/fail with the real captured output — never a claimed result that
  wasn't actually observed. Use this to reproduce a bug or a failing check before a fix
  and confirm it's resolved after, producing a before/after comparison; also use it
  anytime you're about to say a change "works", "passes", or "is fixed" in this repo —
  CLAUDE.md requires pasting real output, not a summary or an assumption. Especially
  relevant around Stripe webhooks, where a mocked constructEvent is explicitly
  disallowed and real signature verification via
  Stripe.webhooks.generateTestHeaderString must be used instead.
---

# Verify Fix

## Why this exists

This repo's `CLAUDE.md` has a hard rule: run the checks before claiming something works,
and paste the real output — never report success that wasn't observed, and show the
actual failure when something fails. This skill is that rule as a repeatable before/after
workflow, so "I fixed it" always comes with the evidence attached. It is the one skill in
this project's set whose whole job is proof, not planning — `investigate-task` and
`observability` plan and find, `docs-sync` proposes doc edits, this skill is the only one
that runs anything and reports what actually happened.

## Workflow

### 1. Scope the checks to the change

Not every change needs every gate. Pick from this repo's real scripts
(`package.json`), and say which you're skipping and why:

| Script | When it applies |
|---|---|
| `npx eslint "{src,apps,libs,test}/**/*.ts"` | any `.ts` change — **not** `npm run lint`, which runs with `--fix` and can silently repair the violation this skill exists to capture (matches CI's own lint step; see `docs/decisions.md`'s CI entry and this skill's own "Failure mode to avoid") |
| `npm run build` | any `.ts` change |
| `npm run test` | any change touching a service/controller with unit coverage |
| `npm run test:e2e` | any change to request/response behavior or persisted state — needs Docker (Testcontainers Postgres, plus Redis/Mailhog for the low-stock and checkout specs) |
| `npm run lint:openapi` | any change to `docs/api/` |

If a required check can't run in the current environment (most commonly `test:e2e`
without a Docker daemon), say so explicitly and report it as **not run**, not as passing.

### 2. Capture the BEFORE state

Before the fix lands, reach the pre-fix state mechanically — never by hand-editing files
back to an old version:

1. Find the base commit — the merge-base with `main`, or whatever SHA the task names.
2. `git worktree add <tmp-path> <base-sha>` to get a second checkout of the pre-fix code
   without touching the current working tree.
3. If the fix's evidence is a new test that doesn't exist at the base SHA (a coverage gap
   rather than a red test), copy exactly one test — the specific test file, or just the
   new test case — into the worktree: `git show <fix-sha>:<path/to/spec.ts> >
   <tmp-path>/<path/to/spec.ts>`. Never claim a gap is closed without having seen it fail
   once.
4. Run the relevant check(s) from step 1 inside `<tmp-path>`. This is the FAIL side of the
   table.
5. `git worktree remove <tmp-path>` to clean up.

Paste the actual terminal output, the exact command, and the exit status. Do not
paraphrase a failure — the exact error, stack trace, or assertion message is the evidence.

### 3. Confirm the fix is in place

This skill checks, and may author the single reproduction test a coverage gap needs — it
never writes or edits implementation code. If proving a gap needs more than one test, or
any change outside a test file, stop and hand it back to `investigate-task` instead of
expanding scope here. The fix itself should already exist (typically from
`investigate-task`'s plan, or an `observability` finding, being implemented). Confirm
you're checking the intended diff, not a stale working tree.

### 4. Capture the AFTER state

Re-run the exact same check(s) from step 1. Paste the real output again.

### 5. Report a straight before/after table

```markdown
## Checks run
| Check | Base SHA | Fix SHA | Command | Before | After |
|---|---|---|---|---|---|
| <script/test name> | <sha> | <sha> | `<exact command>` | FAIL (exit <n>) — <one-line reason> | PASS (exit 0) |
| test:e2e | — | — | — | not run — no Docker daemon available | not run — no Docker daemon available |

## Evidence
<the real pasted output for each check that actually ran, before and after>

## Notes
<anything skipped and why, anything still red, anything that needed a workaround —
never a --fix/--no-verify shortcut to force green>
```

## Failure mode to avoid

If a check fails after the fix, stop and show the real failure — do not weaken the test,
add `--no-verify`, silence a lint rule, or otherwise force green. A check that was made
to pass by narrowing what it verifies is a worse outcome than an honestly reported
failure.
