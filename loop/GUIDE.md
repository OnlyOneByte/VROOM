# LOOP GUIDE — VROOM autonomous dev (read FIRST, every cycle)

> ## 🎯 ACTIVE PRIORITY OVERRIDE (set 2026-06-21 by Angelo) — GET THE PR GREEN
> **Until this block is removed, IGNORE the balance-table category rotation. Every cycle's single
> job is: make all checks pass on the open PR (claude-loop-dev → main).** Concretely, each cycle:
> 1. **Find the actual failures.** Check the PR's CI: GitHub Actions on the OnlyOneByte/VROOM PR
>    (`gh pr checks` / `gh pr view --json statusCheckRollup` via a `/tmp/*.sh` script — gh over the
>    `env -u GIT_SSH_COMMAND` remote). If you can't reach CI, run the FULL local gate as the proxy:
>    `cd backend && mise exec -- bun run validate:local` AND `cd frontend && mise exec -- npm run validate:local`.
> 2. **Fix ONE red check per cycle**, smallest coherent fix. Real test failures, type errors, build
>    breaks, lint. Commit via the script + `bash loop/push.sh` so CI re-runs.
> 3. **CI vs local divergence is the likely gotcha** (don't be surprised by it):
>    - CI runs the **glibc** biome (`bun run check`); the loop uses the **musl** binary locally. A
>      green `validate:local` can still fail CI lint. If CI lint is red, read the exact rule from the
>      CI log and hand-fix (musl autofix is the closest local mirror but not identical).
>    - The ~44 `*.meshclaw.e2e.ts` specs are **gitignored** → they do NOT run in CI. "Tests on the PR"
>      = the committed unit / HTTP-harness / source-scan suites + whatever the GitHub workflow runs.
>      Don't chase an e2e "failure" that only exists locally.
>    - dependabot may have bumped deps on main (csv-parse 7, backend-minor-patch group) — a red check
>      could be a post-merge-of-main dep break, not loop code. Rebase/merge main if CI is testing stale.
> 4. **Do NOT start new feature/bug/arch/deep-review work** while this override stands — those are the
>    PENDING-ANGELO + eyes-on items, all parked. If the PR is fully green and nothing is red, say so and
>    HALT/stay-silent (don't manufacture a cycle); ping Angelo that it's merge-ready.
> 5. Product-call fixes still don't get auto-made (a red check that needs a $/semantics decision →
>    `send_message` Angelo, don't guess).
> Remove this block when Angelo says the PR is merged / the override is lifted.

> Distilled from C1–C338+. NORTH_STAR.md = vision + quality bar. BACKLOG.md = ranked queue.
> LEDGER.md = per-cycle log + balance table. This file = HOW to run a cycle well.
> Read order: GUIDE → NORTH_STAR → BACKLOG (open work only) → LEDGER balance table. The C1–C467
> history was archived 2026-06-16 to `loop/archive/` (LEDGER + BACKLOG) — consult it only to check
> "was X already done / certified clean?", never as part of a normal cycle. This guide is the manual.

## The one-line loop
Read balance table → pick the most-starved OVER-budget category (recompute ALL 6, every cycle) →
do ONE coherent verified increment → update LEDGER (bump last-touched + `cov:` tag) → commit via
script → `bash loop/push.sh`. Stay silent unless a blocker / product call / phase boundary.

## Execution rules (the hard-won ones — violating these wastes a cycle)
1. **Inline shell that EXECUTES is permission-denied** (node, npx, git commit, compound greps).
   The fix is ALWAYS the same: write to `/tmp/*.sh` and `bash` it. This is one mechanism, not
   many special cases — git commits, screenshots, builds, multi-step probes all use it.
2. **Commits:** write `/tmp/vroom-commit.sh` (`set -eo pipefail`, `cd` repo,
   `env -u GIT_SSH_COMMAND git -c user.name='angryang' -c user.email='22626742+OnlyOneByte@users.noreply.github.com'`,
   ONE path per `git add`, single-quoted `-m` with no `$`/backtick/`!`), run it, then `bash loop/push.sh`.
   NEVER attempt inline `git commit` — it is always declined.
3. **Verify gate before "done":** backend `bun run validate:local` (tsc + musl-biome + bun test +
   build); frontend `npm run validate:local`. Biome = the **musl** binary (the "biome broken" note
   is outdated). After edits, `bun run check:musl:fix` then re-validate. Green build is the FLOOR.
4. **`spawn_run` returns HTTP 400 every cycle here — do deep-reviews INLINE.** Don't burn a turn re-trying it.

## EYES-ON IS UNBLOCKED (the big change — stop logging "Playwright-blocked")
"Playwright sandbox-denied" was a 200-cycle MISDIAGNOSIS. chromium-1223 is installed and
`chromium.launch()` works with NO flags — the only block was inline `node` execution (rule 1).
**To capture UI:**
```
bash /tmp/<boot>.sh            # START_SERVERS=1 RESET_DB=1 bash .meshclaw-tools/regress.sh, OR
                               # clean reboot: backend self-migrates (NO manual db:init — it double-applies
                               # the latest migration and crashes the backend → 502s → /auth bounce)
bash .meshclaw-tools/shot.sh /<route> [mobile|desktop] /tmp/out.png   # then Read the PNG
```
Anonymous shot: point `AUTH_STATE` at a NONEXISTENT path (NOT `/dev/null` — that crashes the
JSON parse); shot.mjs falls back to anonymous, the `/me` 401 is expected. So the three
human-gated feature tails (maintenance T9, import-trackers T4–T6, recurring-expenses T4–T8) and
periodic deep-UI-review are now loop-closable: boot → shoot → Read → critique → fix → re-shoot.

## Category veins — where work actually is (C338 reality)
| Category | State | What still pays off |
|---|---|---|
| **feature** | was "blocked", now UNBLOCKED via shot.sh | the 3 eyes-on tails — boot+shoot+verify the round trip |
| **bug** | still surfaces REAL defects | write-path **validation asymmetry** is the gold seam (parent ownership checked, FK/config written verbatim — #80/#82/#84/#90–#100). Date/tz math (setMonth overflow, UTC slice). One fresh-surface scout, then record + pivot if dry. |
| **deep-review** | live | certify load-bearing invariants CLEAN + leave a merge-surviving guard. **VERIFY firsthand against source — agent "HIGH" findings are often false (C21/C60/C333).** |
| **guard** | live | HTTP-harness (createTestApp + s3-seam) + source-scan guards. Narrowing now (pure-logic saturated). |
| **arch** | reliably DRY | behavior-preserving, test-anchored, ONE small dedup. When no clean pick: record "no churn warranted" + pivot. Don't manufacture churn. |
| **infra** | live | ~every 10 cycles: untracked-`*.test.ts` sweep + regress + coverage re-measure + BRANCH_REVIEW refresh. |

## Standing truths (don't re-discover these)
- **Coverage 90% is NOT loop-closable** (~86% BE / ~84% FE structural ceiling). BE gaps are
  DI/singleton/OAuth-bound; FE gaps are eyes-on components (now shootable, so this can finally move).
  `cov:` tag every LEDGER entry; re-measure on bug/guard/arch cycles that touch a module.
- **Coverage theater:** a green test that RE-IMPLEMENTS a module's logic locally is NOT coverage —
  drive the REAL module (C181/C229).
- **async-tx footgun (C151):** a throw escaping an async `transaction()` after a sync INSERT does
  NOT roll back — do throwing validation BEFORE the insert.
- **Product calls don't get auto-fixed.** Anything that changes a displayed $ figure or is a
  semantics decision → file it, `send_message` Angelo, pivot. Open: #88 #94 #97 #98 #100.
- **Source-scan guards > untracked e2e** for merge survival (bun discovers tests by filesystem;
  untracked specs vanish on merge).
- **In-flight nudge:** if the next-cycle nudge arrives mid-task, finish + commit the current
  increment first, then start the next cycle (C280).

## Halt
STOP sentinel or `autonudge_stop`. No DoD — the loop improves VROOM indefinitely; branch stays
PR-ready (~147 commits ahead). Human opens the PR.
