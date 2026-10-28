# LOCAL-SPRINT-VERDICT — admin sprint consolidated locally (END-31)

Date: 2026-10-27. Branch: `local/admin-sprint`. Final head: see `git log -1 local/admin-sprint`.
**Nothing in this document was pushed. No PR was opened. No remote branch was created or
deleted. `origin` was treated as read-only for the entire task** (only `git fetch --prune`
and `git ls-remote` touched it). Re-landing any of this on GitHub is Kevin's call.

## Why this branch exists

Kevin: "This is bad. Can you revoke all the branches you've made on the Github repo and just
work with the local repo before making any more PRs?" (END-28, comment d0820730). The CEO
subsequently closed PRs #45 #46 #47 #49 #50 #51 and deleted their remote heads. This branch is
the single local place where the whole admin sprint now lives, green, so that when Kevin wants
it back on GitHub there is exactly one tree to look at.

## Composition and merge order

Base: `origin/main` = `81eac6b` (local `main` fast-forwarded to it; never written).

The four approved heads were already composed, conflict-free, by the CEO on
`integration/admin-sprint-check` (`5aebe2c`, kept intact as the reference tree). This branch is
that tree plus two commits on top:

```
2d4c47b  admin guard: drop the unused admin binding from the professors route   (lint fix, cherry-pick of 9d1fc96)
a920633  PANEL: admin guard: drop the stale professors allowlist entry ...      (END-29, cherry-pick of e971b8f, -x)
5aebe2c  Merge origin/admin/guard-drift-test        -> END-27 drift test (c8afba0)
ad35721  Merge origin/junior/professors-use-guard   -> END-26 (9ef46e0)
85e9589  Merge origin/admin/edit-delete-users       -> END-22 (7c0465b + 51d3bfe)
3be43ef  Merge origin/end21/admin-view-courses      -> END-21 (853f9b4)
122faed  Merge origin/end20/edit-course-stacked     -> END-20 (actual head 95deb20, pr45-end20-head)
81eac6b  origin/main (END-19 #44)
```

The branch name `origin/end20/edit-course-stacked` in merge `122faed` is a historical ref name
from the CEO's composition run; **the integrated content is the final head `95deb20`**
(`pr45-end20-head`). Verified: `git merge-base --is-ancestor 95deb20 local/admin-sprint` ->
true; `... 5afc379` (the superseded END-20 version) -> false. The tree diff between `95deb20`
and `5afc379` is all professor/student-side files with no admin changes, so the tree is
equivalent either way, but the ancestry is unambiguous.

`e971b8f` cherry-picked cleanly onto `5aebe2c` (no conflicts), so it was cherry-picked with `-x`
rather than hand-ported. The resulting drift test file is byte-identical to what an
integration-tree entry removal + manual port would produce.

## Ticket -> commit map

| Ticket | Feature | Commit(s) in this branch |
|---|---|---|
| END-20 | Admin edits a course from the course detail page | `95deb20` (via merge `122faed`) |
| END-21 | Admin views all courses with professor + enrolled students | `853f9b4` (via merge `3be43ef`) |
| END-22 | Admin edits/deletes users from an admin user list | `7c0465b`, `51d3bfe` (via merge `85e9589`) |
| END-26 | Professors route migrated onto shared `requireAdmin` | `9ef46e0` (via merge `ad35721`) |
| END-27 | Admin guard drift test (fails CI on new inline `ADMIN_UID` auth) | `c8afba0` (via merge `5aebe2c`) |
| END-29 | Drop stale professors allowlist entry + reverse assertion | `a920633` |
| (lint) | Drop unused `admin` binding the migration exposed | `2d4c47b` |
| END-18 | `requireAdmin` helper (already in main via #43) | `7e38065` |

vs `main`: 16 files, +2692 / −36 (the +15 over the CEO's `5aebe2c` measure is the two follow-up
commits: reverse assertion +19/−4, lint fix +1/−1).

## Drift test, final state

`__tests__/lib/adminGuardDrift.test.ts` on this branch:
- allowlist = ONE entry: `app/api/users/route.ts` (the approve/reject `uid === ADMIN_UID`
  privilege-escalation stop — deliberate, must stay).
- the stale `app/api/admin/professors/route.ts` entry is **removed** (its own exit condition —
  "remove once #49 merges" — is met: the route calls `requireAdmin`, zero `ADMIN_UID` refs);
- the reverse assertion (ported from `e971b8f`) is in place: every allowlisted file must still
  contain the inline `ADMIN_UID` check it was allowlisted for, so a stale entry fails the suite
  instead of silently masking drift.

### Proof the reverse assertion fires (RED)

Bogus entry added to the allowlist (`app/api/admin/users/route.ts`, which has no inline
`ADMIN_UID` check):

```
 ❯ __tests__/lib/adminGuardDrift.test.ts (22 tests | 1 failed) 7ms
     × every allowlist entry still has the inline ADMIN_UID check it was allowlisted for 4ms
 FAIL  __tests__/lib/adminGuardDrift.test.ts > admin guard drift (END-27) > every allowlist entry still has the inline ADMIN_UID check it was allowlisted for
AssertionError: stale allowlist entries — these files no longer contain an inline ADMIN_UID check, so the exemption is masking nothing: delete app/api/admin/users/route.ts from the allowlist in __tests__/lib/adminGuardDrift.test.ts: expected [ 'app/api/admin/users/route.ts' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 21 passed (22)
RED_RUN_EXIT=1
```

### After removing the bogus entry (GREEN)

```
 Test Files  1 passed (1)
      Tests  22 passed (22)
GREEN_RUN_EXIT=0
```

## Verification on the final head (raw output)

Full raw logs also at
`/mnt/scratch/agents/hermes/profiles/senior/cache/scratch/end31/{test-final.log,build-final.log}`.

### lint — `npm run lint` -> exit 0, zero findings

Before commit `2d4c47b` (i.e. on `5aebe2c`) it was NOT clean:

```
/home/endo/panel-app/app/api/admin/professors/route.ts
  7:20  warning  'admin' is assigned a value but never used  @typescript-eslint/no-unused-vars
✖ 1 problem (0 errors, 1 warning)
```

After:

```
npm notice run my-app@0.1.0 npx
npm notice run 'eslint' .
lint exit=0
```

### tests — `npm test` (firebase emulators:exec ... vitest run) -> exit 0

```
 Test Files  19 passed (19)
      Tests  309 passed (309)
   Duration  57.67s
✔  Script exited successfully (code 0)
```

309 vs the 308 baseline: +1 is the new reverse-assertion test in
`adminGuardDrift.test.ts` (21 -> 22 in that file). No test was removed or skipped.
(The `MetadataLookupWarning ... ETIMEDOUT/ENOTFOUND` lines are the Admin SDK trying to reach
metadata for a *non-emulated* service; they appear on every run of this repo, including the
CEO's baseline, and do not affect the result.)

### build — `npm run build` (Next.js 16.3.8, Turbopack) -> exit 0

```
✓ Compiled successfully in 148ms
  Running TypeScript ...
  Finished TypeScript in 1021ms ...
✓ Generating static pages using 31 workers (23/23) in 160ms
```

23 routes, including `/admin/users`, `/admin/classes`, `/api/admin/classes/[classId]`,
`/api/admin/users/[uid]` — the new admin surfaces all build.

## Remote state — verified unchanged

`git ls-remote --heads origin` at start (after `--prune` fetch) and at end, identical:

```
81eac6b0fe139490130e66e58a7f99a94865d134  refs/heads/main
e9113d94ed4b08ccebef7d7bf353533ecdfc1630  refs/heads/professor/assignments-api
ffa8f778f5e1a043daa413b358a030122f424b01  refs/heads/professor/course-materials
2e92e52caf18efcfb0ae49c03c5d69a2a974ea48  refs/heads/professor/edit-delete-assignments
5667aff19e2381253827ea0165ced75fa5dd8a38  refs/heads/professor/edit-delete-assignments-main
648b9bb02223f6709fc98359478f47dfa906487b  refs/heads/professor/grade-submissions
3f3f62075ea92a2021b78959417c65d418dc81d9  refs/heads/professor/view-submissions
```

## What a future PR (Kevin's call) needs

- Land `local/admin-sprint` as-is on top of `81eac6b`; it's a linear-stack-of-merges over main,
  16 files, green. If the stack is re-split into per-ticket PRs instead, the cherry-pickable
  heads are `pr45-end20-head` (95deb20), `end21/admin-view-courses` (853f9b4),
  `admin/edit-delete-users` (51d3bfe), `junior/professors-use-guard` (9ef46e0),
  `admin/guard-drift-test` (c8afba0) + `a920633`/`2d4c47b` — **not** `end20/edit-course-stacked`
  (5afc379, superseded).
- `2d4c47b` (unused-binding lint fix) must travel with the END-26 migration; without it the
  repo carries a lint warning.
- If teammate `professor/*` branches merge into main first, the likely conflict zone is
  `app/api/admin/*` vs their `app/api/classes/*` — disjoint so far, expect it to stay clean.
- Do not re-add the `app/api/admin/professors/route.ts` allowlist entry; the reverse assertion
  will fail the suite if the file no longer contains an inline check.

## Local branches preserved (none deleted)

`pr45-end20-head` (95deb20), `integration/admin-sprint-check` (5aebe2c),
`end21/admin-view-courses`, `admin/edit-delete-users`, `junior/professors-use-guard`,
`admin/guard-drift-test`, `admin/guard-drift-test-followup`/`pr51-end29-followup` (e971b8f),
`end20/edit-course-stacked` (5afc379, superseded reference),
`legacy-end19-admin-delete-course`, `chore/agent-skills`, plus `admin/sprint-consolidated`
(a superseded draft of this same consolidation made by a run that was interrupted mid-task;
identical tree to this branch except it lacks nothing — kept per "do not delete any local
branch" and not referenced further).

---

## Addendum 2 — END-22 review fixes + cascade fast-forward (2026-10-27, END-22)

Approved: CEO confirmation interaction `7740a0c7` (accepted 2026-10-27T23:33:07Z) = option C,
"fast-forward `local/admin-sprint` to `72f8fe9`, re-run the consolidated suite, append the
verdict". Executed as `git merge --ff-only 72f8fe9` from `028693c`; **not** a history rewrite —
`028693c` is an ancestor of the new head, so nothing was reset and this file's prior content is
intact.

New head: `72f8fe9`. Three commits added on top of the END-31 head:

```
72f8fe9  admin: close two user-delete cascade orphans (END-22 review round 2)
6a59dd4  admin: link the user list from the admin home page (END-22)
42b8bb0  admin: fix admin user list edit semantics and token refresh (END-22 review)
```

The first two commits after `028693c` are the END-22 review round (three defects posted by the
automated review of the withdrawn `51d3bfe`: admin-row rename silently demoting to student, a
professor promotion leaving `professorStatus: "pending"`, and a once-captured ID token expiring
after ~1h) plus the missing `/admin/users` nav link. `72f8fe9` closes two orphans in the delete
cascade itself: a submission left by a user who was unenrolled before deletion, and grade docs
under `classes/{cid}/assignments/{aid}/grades/{uid}` that were never collected at all.

What landed beyond `028693c` is 8 files, +624/−39. There is still exactly **one**
`lib/adminGuard.ts` (plus its test and the END-27 drift test) — `git ls-tree -r --name-only HEAD |
grep -i adminguard` shows those three paths and no second copy; the `[uid]` route imports
`requireAdmin` from `@/lib/adminGuard`.

Verified on the new head, in `~/panel-app` itself (real, non-symlinked `node_modules`), emulators
on alternate ports 8280/9299 via gitignored scratch config so the run could not collide with the
concurrent END-38/39/40 re-verifications on 8080/9099:

- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npm run lint` → exit 0, zero findings
- full emulator suite → exit 0, `Test Files 22 passed (22) / Tests 341 passed (341)`
  (END-31's 337 plus the 4 new cascade tests), no failures
- `npm run build` → exit 0, `/admin/users` static (○), `/api/admin/users/[uid]` dynamic (ƒ)

END-22 gates, each behind a test in this tree: no self-demote (400, doc keeps `role=admin`), no
self-delete (403), `role: "admin"` rejected by PATCH (400 for admin/wrong-case/typos), professor
demotion resets `professorStatus` to `not_requested`, promotion sets `approved`, DELETE cascades
Auth account + `users/{uid}` + `users/{uid}/classes/*` mirrors + that user's submissions
(including post-unenroll leftovers) + grades with a `collectionGroup` sweep assertion, and delete
is gated by a dialog that requires typing the user's name.

Not done, deliberately: no push, no PR, no remote ref (END-28 — `origin` still exposes exactly 8
heads, `main`, `adminview` and six `professor/*`, none belonging to this ticket). Supabase storage
objects behind a deleted submission are not deleted by the cascade: no delete path in this app
removes storage objects, including the platform's own class-delete route, and adding it here only
for user deletion would need a bucket decision outside END-22. Flagged, not silently expanded.

---

## Re-anchor record + fresh green proof (run 23968aa0, 2026-10-28)

Branch drift, per CEO instruction `ec7b3cfd` on END-31: `local/admin-sprint` had been moved back to
`81eac6b` (= `main`) at 2026-10-27 18:14:27 MDT (`git reflog show local/admin-sprint`, entry
`reset: moving to main`). No content was lost — the pre-reset tip `6968f4b` was still in the object
store and contained the whole composed sprint. Fix applied was pointer-only, no rebase, no new
history, no branch deletions:

```
git checkout main
git branch -f local/admin-sprint 6968f4b
```

Post-fix shape, matching the expected numbers exactly:

- `git rev-parse local/admin-sprint` → `6968f4b`
- `git log --oneline main..local/admin-sprint | wc -l` → **19**
- `git diff --stat main..local/admin-sprint` → **21 files changed, 3514 insertions(+), 36 deletions(-)**
- Shared worktree `~/panel-app` left checked out on `main`, `git status --porcelain` empty
- Package ancestry re-checked in this run: `95deb20` (END-20), `853f9b4` (END-21), `72f8fe9` (END-22),
  `2d4c47b` (END-26), `c8afba0` (END-27) are all ancestors of `6968f4b`
- Remote stayed read-only: `git fetch --prune` + `git ls-remote` only. `origin` still exposes exactly
  8 heads (`main`, `adminview`, six `professor/*`). No push, no PR, no remote ref created or deleted.

### Fresh green numbers — this run

Run in a throwaway worktree `/mnt/scratch/panel-end31-reanchor` created detached at `6968f4b`, with a
real copied `node_modules` (741 entries, directory not symlink) and its own `.env.local`, emulators on
alternate ports via a scratch-only `firebase.test.json` (auth 9299, firestore 8280, UI off) so the run
could not collide with a concurrent sibling run on 9099/8080:

- `npx tsc --noEmit -p tsconfig.json` → exit **0**
- `npm run lint` → exit **0**, zero findings
- full emulator suite (`firebase emulators:exec --only auth,firestore "vitest run"`) → exit **0**,
  `Test Files 22 passed (22)` / `Tests 341 passed (341)`, duration 61s, **zero failed, zero skipped**
- `npm run build` → exit **0**; `/admin/classes/[classId]` and `/api/admin/classes/[classId]` both
  dynamic (ƒ) in the route manifest, `/admin/users` static

### Failing-file baselining (END-31 addendum `d39145a8`): nothing to baseline, and the cited counts
### do not correspond to any tree in this repo

The addendum asked for a solo `main`-worktree baseline run for *every* failing test file, against the
independent runs cited as `Test Files 5 failed | 21 passed (26)` / `Tests 8 failed | 337 passed (345)`.
My full-suite run on the re-anchored tree had **no failing files at all**, so step 2 had nothing to
consume and I ran zero baseline runs (the exemption went unused).

The cited counts are also not reproducible against any tree I can name, which is worth flagging before
anyone treats those 8 failures as a known-good baseline:

- `6968f4b` has **22** `*.test.ts` files under `__tests__` (plus `helpers/emulators.ts` and
  `setup.ts`, which are not test files); `main` (`81eac6b`) has **16**. Neither is 26.
- The named file `__tests__/api/admin/adminCourses.test.ts` **does not exist** — not in `main`, not in
  `6968f4b`, not in any local or remote ref (`for-each-ref` sweep across all refs), not on disk in any
  worktree under `/mnt/scratch`, and not in the teammate branch `adminview` (`24a4f5c`). The admin
  course test file in this repo is `__tests__/api/admin/classes.test.ts`, which is on both `main` and
  this branch and passed here.
- The three END-22 verification tickets the counts are attributed to are not verification reports of a
  failed suite: END-38 and END-40 are **cancelled** ("END-22 was accepted and closed at the human's
  approval (interaction 2ace3b8e, accepted 23:50Z) … its run ended with no report posted") and END-39
  is **done** with "8/8 PASS. No contradiction with the END-22 numbers" — that is 8 *claims checked*,
  not 8 *tests failed*. The "8 failed" and the "8/8 PASS" are almost certainly the same number read
  two different ways.

So the honest verdict for the branch, from this run: **341 passed / 0 failed at `6968f4b`, green in
absolute terms, not merely green relative to `main`.** No pre-existing-failure exemption was needed
because there were no failures to exempt. If a future run does produce failures, baseline it on plain
`main` in a throwaway worktree as the addendum specifies — that procedure is sound; it just had no
input this time.
