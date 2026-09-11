---
name: docs-sync
description: >
  Compare a changed module's actual code against its governing documentation
  (docs/architecture.md, docs/decisions.md, docs/api/, docs/database/) and flag drift,
  proposing documentation edits only — never touching code. Use this after a feature or
  fix lands, whenever asked to check if docs are current, or whenever reviewer/mentor
  feedback mentions documentation accuracy, staleness, or "the docs don't match the
  code." Trigger this proactively after any change that touches a module with a
  documented section, even if the user only asked about the code change itself — a
  silently-stale doc is exactly the failure mode this skill exists to catch before it's
  someone else's problem to discover.
---

# Docs Sync

## Why this exists

This repo treats `docs/database/` and `docs/api/` as contracts that outrank chat, and
`CLAUDE.md` states the rule directly: if the code and a doc disagree, that's a bug in
one of them — name which one you think is wrong and stop, don't silently pick a side.
That rule only works if something is actually checking. `docs/architecture.md`'s Mail
stack line describing Mailhog-only delivery, still there after `feat/brevo-smtp` shipped
real authenticated-relay support, is a live example of exactly the gap this skill closes
— the discrepancy sat there because nothing was comparing the two.

## Workflow

### 1. Scope the comparison

A module name, a merged PR or commit range, or "the whole `docs/` tree." For a specific
change, prefer scoping to what it touched — cheaper and more precise than a full sweep,
and a full sweep is still available when asked for one.

### 2. Identify which doc sections govern the scope

Match against this repo's own map (the same one `investigate-task` uses to decide what
to *read* before writing code — this skill uses it to decide what to *check* after):

| Scope touches | Governing doc |
|---|---|
| stock, promo redemption, orders, notifications, payments data model | `docs/database/README.md`, relevant `§` |
| an OpenAPI path or schema | `docs/api/paths/*.yaml`, `docs/api/components/*.yaml`, `docs/api/CONVENTIONS.md` |
| stack choices, module ownership, layering, testing strategy | `docs/architecture.md` |
| any past trade-off, rejected alternative, or non-obvious constraint | `docs/decisions.md` |

### 3. Read the doc section and the current code side by side

Not from memory of either — open both. For prose docs (`architecture.md`,
`decisions.md`), check specific factual claims (a dependency's behavior, a stack choice,
a module's listed responsibilities) against what the code actually does today. For
`docs/api/`, check whether the contract's documented responses, error codes, and schemas
still match the controller/DTOs.

If a factual claim in a doc is about a third-party library's behavior and you're not
certain it's still accurate, use the `research-options` skill to verify it before
proposing a correction — don't replace one unverified claim with another.

### 4. For each mismatch found, decide which side is stale — or say you can't tell

Most mismatches have an obvious answer (the code shipped a change, the doc's prose
wasn't updated in the same commit — check `git log` on the doc file vs. the code file if
it's unclear which came first). When it's genuinely ambiguous whether the doc describes
intended-but-unshipped behavior or the code is a regression from documented behavior,
say so explicitly rather than guessing — this is exactly the case `CLAUDE.md` says not
to silently resolve.

### 5. Propose documentation edits only

This skill never edits code, even when the code looks like the side that's wrong —
that's a call for a human, possibly via `investigate-task`, not something to fix as a
side effect of a docs pass.

### 6. If `docs/api/` is in scope, run the real check

`npm run lint:openapi` (Spectral + Redocly) validates the OpenAPI contract's own
internal consistency — run it and paste the real output alongside the narrative diff.
This doesn't replace the manual code-vs-doc comparison (lint checks the contract is
well-formed, not that it matches the code), but it's a concrete, executable data point
worth including rather than skipping.

### 7. Output

```markdown
## Scope
<module / PR range / whole docs tree>

## Doc files checked
<each file, with the section(s) relevant to scope>

## Drift found
### <doc file>: <what it says> vs. <what the code does>
- Stale side: doc / code / unclear — <reasoning>
- Proposed edit: <the doc change, if the doc is stale — never a code change>

## Unresolved
<mismatches where it's genuinely unclear which side is right — named, not guessed at>

## lint:openapi result (if docs/api/ was in scope)
<real pasted output>
```

## Failure mode to avoid

Don't "fix" a mismatch by rewriting the doc to match whatever the code currently does
without checking whether the code is actually correct — a regression papered over by an
updated doc is worse than a stale doc, because now nothing points at the problem at all.
