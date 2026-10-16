# `verify-fix` — cold (fresh-session) run

Run in a fresh subagent session with no memory of this repo's prior work, given only the
skill's own `SKILL.md` and this prompt: *"Verify the fix for the unguarded mail-send in
auth.service.ts's forgotPassword and resetPassword methods. Show it failing before (or the
missing-coverage gap) and passing after."*

## Result

The cold run independently reproduced the same before/after result captured manually in
[`auth-mail-failure-before.txt`](auth-mail-failure-before.txt) /
[`auth-mail-failure-after.txt`](auth-mail-failure-after.txt), using the skill's new
git-worktree procedure end to end, without being told the base SHA, the fix commits, or
the exact test names:

| Check | Base SHA | Fix SHA | Command | Before | After |
|---|---|---|---|---|---|
| Unit tests (`auth.service.spec.ts`) | `11d7378` | `eaef966` | `npx jest src/auth/auth.service.spec.ts` | FAIL (exit 1) — both new regression tests reject instead of resolving | PASS (exit 0) — 16/16 tests pass |
| Lint | `11d7378` | current tip | `npx eslint "src/auth/auth.service.ts" "src/auth/auth.service.spec.ts"` | PASS (exit 0) | PASS (exit 0) |
| Build | `11d7378` | current tip | `npm run build` | PASS (exit 0) | PASS (exit 0) |
| test:e2e | — | — | — | not run — no Docker daemon available | not run — no Docker daemon available |

Before-state output:
```
FAIL src/auth/auth.service.spec.ts
  ● AuthService › forgotPassword › still resolves when sendPasswordResetEmail rejects, so an existing account is indistinguishable from an unknown one
    expect(received).resolves.toBeUndefined()
    Received promise rejected instead of resolved
    Rejected to value: [Error: SMTP unreachable]
  ● AuthService › resetPassword › still resolves and leaves the password change in place when sendPasswordChangedEmail rejects
    expect(received).resolves.toBeUndefined()
    Received promise rejected instead of resolved
    Rejected to value: [Error: SMTP unreachable]

Test Suites: 1 failed, 1 total
Tests:       2 failed, 14 passed, 16 total
```

After-state output:
```
Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

## What the skill's instructions did NOT anticipate (found only because this was cold)

- **A fix spanning more than one commit/test.** The bug was actually fixed by two atomic
  commits (`24a99ca` for `resetPassword`, `eaef966` for `forgotPassword`), each adding its
  own test — the skill's "copy exactly one test" wording doesn't say how to handle that.
  The agent resolved it by copying the whole spec file from the later fix SHA (verified by
  diff that only the two new test blocks changed) — a reasonable reading, but an
  interpretation the skill doesn't spell out.
- **No base SHA or fix SHA named in the task.** The agent had to `git log` to find both
  fix commits itself and picked the parent of the first as the base — worked, but is
  manual detective work the skill doesn't guide.
- **The worktree isn't runnable out of the box.** No `node_modules`, and this repo's
  generated Prisma client (`src/generated/prisma`, gitignored) doesn't exist in a fresh
  worktree either. The agent confirmed `package.json`/`package-lock.json`/`schema.prisma`
  were unchanged between base and fix, then junction-linked both directories from the main
  checkout rather than reinstalling. The skill's worktree procedure doesn't mention this
  at all — every non-trivial Nest/Prisma project will hit it.

These are real gaps surfaced only by running cold; they don't block the skill (the agent
worked around all three), but are worth a future follow-up pass on `verify-fix/SKILL.md`
beyond what this review cycle required.
