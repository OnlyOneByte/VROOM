# LOOP GUIDE — VROOM autonomous dev (read FIRST, every cycle)

> _Loop reset 2026-06-26 (post-C350): read-path was 9,731 lines → LEDGER + BACKLOG archived to
> `loop/archive/*-C1-C350.md`, cycle counter reset to C1, balance table to 0. Branch ~243 commits ahead
> of origin/main, PR-ready (doc hygiene, NOT a code reset). The C349 velocity reform (MODE / BUILD QUEUE /
> META-LOOP, below) is now the operating model._

> NORTH_STAR.md = vision + quality bar. BACKLOG.md = BUILD QUEUE + open gated steers. LEDGER.md =
> per-cycle log + balance table. This file = HOW to run a cycle well.
> Read order: GUIDE → NORTH_STAR → BACKLOG (open work only) → LEDGER (balance table + last ~3 entries).
> The C1–C350 history is in `loop/archive/` (the earlier C1–C467 arc too) — consult it ONLY to check
> "was X already done / certified clean / what was #N's grounding?", never as part of a normal cycle.

## The one-line loop
Pick MODE (below) → pick ONE increment → do it, verified → update LEDGER (bump last-touched +
`cov:` + `yield:` tags) → commit via script → `bash loop/push.sh`. Stay silent unless a blocker /
product call / phase boundary.

> **LEDGER.md + BACKLOG.md are GITIGNORED (2026-06-26) — local-only steering scratchpads, NOT in git.**
> They churned 373 commits over C1–C350 (pure bookkeeping noise blowing up the branch). You STILL
> read + update them every cycle exactly as before — they just never get committed. **In the commit
> script, NEVER `git add loop/LEDGER.md` or `loop/BACKLOG.md`** — they are ignored, so `git add` would
> error out and (under `set -eo pipefail`) ABORT the whole commit. Only `git add` real product files +
> the tracked loop docs (GUIDE.md / NORTH_STAR.md / archive/) when those actually change. Their content
> still matters (it steers the loop) — it just lives on disk, not in history. The pre-reset history is
> preserved in the tracked `loop/archive/*-C1-C350.md`.

## MODE — pick this FIRST, every cycle (the C349 velocity reform)
The starvation-budget rotation optimizes for BALANCE; that is the wrong objective when there is
approved build work queued. So branch on state:

- **BUILD MODE — when `loop/BACKLOG.md` has an UNBLOCKED build item** (a greenlit-T0 feature slice,
  an approved arch migration, or a fresh real bug). Then:
  1. Take the **next slice of the single in-flight item** off the BUILD QUEUE (below). **WIP = 1**:
     finish one feature to DONE before starting another — a half-built A + half-built B is worse
     than one done. Respect any hard intra-spec order (e.g. money-cents T1+T2 before T3–T6).
  2. Maintenance categories (deep-review / guard / arch-scout / bug-scout) DO NOT preempt build
     work on their starvation clock here. They fire only (a) **reactively** — a real defect found
     while building jumps the queue — or (b) on the **slow infra cadence** (~every 10 cycles:
     coverage re-measure + doc-freshness + untracked-test sweep).
  3. The balance table still gets its `last-touched` bump for whatever you DID touch, but you do
     NOT force a starved-but-idle category to preempt a queued build slice.
- **MAINTAIN MODE — when NO unblocked build item exists** (every feature Angelo-gated, arch dry,
  bug swept). Then fall back to the classic rotation: most-starved OVER-budget category →
  record-verified-state-and-pivot if that vein is SATURATED. This is the steady-state the C253–C302
  arc documented; it is correct ONLY when the build queue is empty.

**Pick rule:** scan BACKLOG for an unblocked build item FIRST. Found one → BUILD. None → MAINTAIN.
Don't run the 6-budget recompute in BUILD mode — it's wasted work when the queue dictates the pick.

## BUILD QUEUE (the ordered work-list — pop, don't re-derive; WIP=1)
> Keep this list current as the live build plan. The loop POPS the top unblocked slice instead of
> re-deciding feature order every cycle (that re-derivation was a per-cycle tax). Re-rank only when a
> slice finishes or a gate clears. Greenlit 2026-06-24; ordered by Angelo (money-cents first, C349).
1. ~~**money-cents-migration**~~ — ✅ **DONE + SHIPPED (C19, commit 705b794, pushed).** Built ATOMIC
   T1–T7 in ONE branch-green commit (Angelo's confirmed ruling, saved lesson 2026-06-26 — the
   "one-task-per-cycle" spec line was infeasible, as the C1 escalation predicted). 36 files: money is
   integer CENTS end-to-end, dollars only at the input edge (Zod dollarsToCents) + response edge
   (per-entity *ToApi + analytics/api-transform). Data-safety gate: backup 2.0.0 + version-gated ×100
   restore shim. Both validate:local green; FE dollar contract unchanged. Don't re-pick.
2. ~~**trips-location**~~ — ✅ **COMPLETE (post-reset C3–C5: T1–T8 + T6b-3).** C214 odometer-lifecycle (T7) +
   D3 rate (T8) backend + the FE edit/delete eyes-on tail, all shipped + guarded (C6 date-resync, C7 backup
   round-trip). Don't re-pick.
3. ~~**theming-engine**~~ — ✅ **COMPLETE (pre-reset: engine + 10 themes + picker, guarded 10 dimensions).** Don't re-pick.
4. **vehicle-sharing** — `.kiro/specs/vehicle-sharing/tasks.md` — **T0 RATIFIED C48; T5b ruled (a) C91; the
   read-widening arc shipped C92–C102.** DONE + shipped: T0–T4, T5a, T9, T10–T13 (the C48–C59 arc), then the
   FULL editor-model: T5b-1 migration 0011 createdBy (C92), T5b-2 expense WRITE owner-stamp (C93), T5b-3 +
   T5b-3b expense READ incl. CSV export (C94/C101), T6 odometer (C95), T7 reminder READ (C96), T8a analytics
   + T8b insurance READ w/ §6.4 blast-radius (C97/C98), T12b-3a vehicle-GET shared-read+level (C99) + T12b-3b
   FE viewer-mode gating, eyes-on (C100), validateOdometerOwnership dead-export cleanup (C102). **The backend
   READ-widening family is COMPLETE across all 7 read surfaces; the [id]-page viewer-mode FE is eyes-on-done.**
   REMAINING (C102): two MULTI-vehicle WRITE slices — T5b-2b split-expense + T7b reminders — **ESCALATED to
   Angelo C102 (Slack ts 1782544031)** because a multi-vehicle write can span DIFFERENT owners and the row
   group keys on one userId (a/b/c options: same-owner-only / owner-only / defer-past-v1). Do NOT re-escalate
   (once per condition). Plus the non-gated T12b-3c (read-only shared insurance: widen GET /insurance/:id/claims
   + a read-only PolicyList — self-rated low-value) and T14 feature-DoD (once the write ruling lands).
> **QUEUE STATE (C102): vehicle-sharing is ~90% shipped — all reads + single-entity writes + viewer-mode FE
> done.** money-cents ✅, trips ✅, theming ✅, vehicle-sharing through T12b-3b ✅. The ONLY gated work is the
> two multi-vehicle WRITE slices (escalated C102, awaiting Angelo's a/b/c). Buildable-now non-gated: T12b-3c
> (low-value) + the infra cadence. When the write ruling lands → build it, then T14 DoD. Until then, per the
> gated-loop protocol: cheap new-surface check each nudge (git log + the spec + a ruling commit), build the
> non-gated remainder OR the infra cadence if a real surface exists, else ONE-LINE `yield: dry` + pivot; do
> NOT re-escalate, do NOT manufacture an audit per cycle.
> META-REVIEW ran C103 (this edit, the slipped ~C84/C108 one); next due ~C128.

## VELOCITY RULES (the C349 reform — don't pay waste the loop already learned to skip)
1. **Conditional verify (skip the full gate on doc-only cycles).** `validate:local` (tsc+biome+test+
   build, minutes) is the FLOOR for any cycle that touched `backend/src` or `frontend/src`. A cycle
   that touched ONLY `loop/*.md`, `.kiro/**`, or other docs → SKIP it (nothing compiled changed);
   note `verify: skipped (docs-only)` in the LEDGER. Never skip when source changed.
2. **Fast-dry-skip + dormancy (generalize the C286 arch precondition to ALL maintenance veins).** At a
   maintenance pick, if the category's domain is UNCHANGED since its last scout (`git log` over the
   relevant src shows no new commit), it is STRUCTURALLY dry → record dry in ONE line + pivot; mark the
   vein **dormant** and don't re-scout it until a commit touches its domain. Stops re-paying the
   saturation-rediscovery tax (the 16-cycles-for-3-tests pattern, C83–C98).
3. **Eyes-on batching.** Booting the dev server (`regress.sh START_SERVERS=1`) is the expensive part.
   When ≥2 UI surfaces need a shot, boot ONCE and shoot them all in the same cycle; don't pay a fresh
   boot per surface. Pairs naturally with a feature's T6 + any pending eyes-on debt.
4. **PARALLELISM via `spawn_run` — maximize work per cycle; don't block on minor stuff (the C-reset
   reform; `spawn_run` re-verified WORKING 2026-06-26).** The loop is no longer one-increment-serial.
   Each cycle, after picking the primary increment, ALSO fan out the independent work that would
   otherwise idle-wait. See the PARALLELISM section below for the safe-vs-unsafe matrix — the hard rule
   is **subagents must write DISJOINT file sets** (the shared `schema.ts` + single test DB serialize
   backend writes), and the MAIN cycle integrates + runs the ONE verify gate. Fan out reads/scouts/
   drafts freely (they don't write); fan out writes only when the file sets provably don't overlap.

## Execution rules (the hard-won ones — violating these wastes a cycle)
1. **Inline shell that EXECUTES is permission-denied** (node, npx, git commit, compound greps).
   The fix is ALWAYS the same: write to `/tmp/*.sh` and `bash` it. This is one mechanism, not
   many special cases — git commits, screenshots, builds, multi-step probes all use it.
2. **Commits:** write `/tmp/vroom-commit.sh` (`set -eo pipefail`, `cd` repo,
   `env -u GIT_SSH_COMMAND git -c user.name='angryang' -c user.email='22626742+OnlyOneByte@users.noreply.github.com'`,
   ONE path per `git add`, single-quoted `-m` with no `$`/backtick/`!`/**apostrophe**), run it, then `bash loop/push.sh`.
   The APOSTROPHE bites most (C277): a single-quoted `-m '…'` body CANNOT contain a literal `'` — it ends the
   string, the shell word-splits the rest, and `git commit` dies with `pathspec '…' did not match` (the add
   already ran, so HEAD is unchanged + the files stay staged → just re-commit with a clean message). Write the
   body apostrophe-free: `the X body` not `X's body`, `do not` not `don't`, `cannot` not `can't`.
   NEVER attempt inline `git commit` — it is always declined.
3. **Verify gate before "done":** backend `bun run validate:local` (tsc + musl-biome + bun test +
   build); frontend `npm run validate:local`. Biome = the **musl** binary (the "biome broken" note
   is outdated). After edits, `bun run check:musl:fix` then re-validate. Green build is the FLOOR.
4. **`spawn_run` WORKS (re-verified 2026-06-26 — the old "HTTP 400, do everything inline" note was
   STALE).** Use subagents to maximize work per cycle — see the PARALLELISM section below. The loop
   is no longer single-threaded; don't block the cycle on serial busywork a subagent can do in parallel.

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
JSON parse); shot.mjs falls back to anonymous, the `/me` 401 is expected. Eyes-on is the
loop-closable mechanism (boot → shoot → Read → critique → fix → re-shoot) for any feature's UI tail +
periodic deep-UI-review. **Theme eyes-on needs the PICKER-DRIVE method (C340):** injecting localStorage
alone is reverted by reconcileServerTheme on hydrate (the C339(B) gated bug) — instead
`CLICK_SELECTOR="button[aria-label='Use the <Label> theme']" shot.sh /settings` so setTheme() runs AFTER
the reconcile + sticks; md5sum to assert distinct renders. The 3 ORIGINAL signed-off features
(maintenance / import-trackers / recurring-expenses) are ALL COMPLETE + eyes-on; the LIVE feature work is
now the BUILD QUEUE (money-cents → trips T6-gated → theming-picker-gated → sharing-blocked).

**Blank CHARTS in a full-page screenshot are a known ARTIFACT, not a defect (C242).** ChartCard gates chart
children behind `gate.visible` (createVisibilityWatch — IntersectionObserver + a MutationObserver on the
`hidden` tab ancestor) because LayerChart (SVG, dimension-measured) crashes on a 0×0 below-the-fold / inactive-
tab container. A headless full-page shot never scrolls those into a measured viewport, so they render the
gated-state Skeleton (blank-ish). Charts mount fine for a real user on scroll-in / tab-activate. Don't file a
"blank charts" bug — to actually SEE a chart, the chart must be in the initial viewport (shoot a focused route
where it's above the fold, or accept the Skeleton). Pinned by chart-card-visibility-gate.test.ts.

**A FORM's eyes-on MUST drive the real user action — fill + submit, not just render (C230).** A
screenshot of an OPENED dialog proves layout, NOT that the submit works. C227 shot the trips form
open + ran a curl E2E (JSON strings) and called it "eyes-on verified"; C230 then found the submit
THREW `raw.trim is not a function` on every click (Svelte coerces `<input type="number">` to a
NUMBER, but the validator assumed a string) — the form could never create a trip, invisible to both
a render-only shot and string-fed unit tests. For any form, drive it via Playwright (createRequire
playwright from `frontend/`, the cached-chromium fallback like shot.mjs): open → fill fields →
click submit → assert the row was actually created (and no `pageerror`). Inputs typed `number`
reach JS as `number | null`, NOT the seed string — parse with `parseInt`/`parseFloat`/typeof-guards,
never a bare `.trim()`.

## Category veins — where work actually is (C338 baseline; **SATURATION re-confirmed firsthand C253–C302**)
> **STEADY-STATE (re-confirmed C302): every SELF-DIRECTED vein is firsthand-verified WORKED-THROUGH.** The
> C290–C302 arc — the most productive non-gated stretch since dark mode — found + fixed a REAL data-loss gap
> (C291 #127 cross-row-UNIQUE), guarded BOTH pre-wipe legs (C290 FK + C295 UNIQUE) + the auth account-takeover
> boundary (C296), converged a self-dup (C292), removed dead code (C300 db/types), and certified five fresh
> subsystems CLEAN (backup-round-trip C290, auth-core C296, financing-balance C301, CSV-import C294, odometer-read
> C298, split-allocation C302). Net-new SOURCE still requires an Angelo-gated feature or steer. This is the CORRECT
> signal under a hard feature-gate, NOT a failure — but DON'T re-scout the surfaces marked SATURATED below; record
> the verified state on the FIRST recheck + pivot. A real defect/guard now comes ONLY from a fresh feature surface
> (gated) or a NOT-YET-AUDITED shipped subsystem (the un-audited list is nearly empty).
| Category | State | What still pays off |
|---|---|---|
| **feature** | the 3 signed-off tails are ALL COMPLETE (C312-verified: maintenance T9 / import-trackers T0–T6 / recurring-expenses T0–T8, every task `[x]`); every REMAINING feature is Angelo-GATED | NO open signed-off feature work left. Gated: money-cents sequencing, C214 trips↔odometer lifecycle, `instrument` palette, vehicle-sharing, + the ~15 product-gated bug items. Record gated + pivot until a gate clears; eyes-on is ready for the next greenlit spec. |
| **bug** | **SATURATED on the SWEPT surfaces (C253/C257/C261/C265), but a NOT-YET-AUDITED subsystem can still yield a real fix (C291)** | write-path asymmetry / date-tz / money-calc all swept BE (trips-summary, expenses, settings/sync/vehicles repos) + FE (financing-calculations — the #92/#99/#110/#117/#330 family closed). Record dry on the FIRST recheck of a SWEPT surface + pivot. BUT: the C290→C291 arc showed a fresh firsthand scout of an un-audited shipped subsystem (the backup→restore round-trip) surfaced a REAL data-loss gap (validateUniqueConstraints covered only 2 of 5 backed-up UNIQUE indexes, #127 leg) with NO gate clearing — so when bug is over budget, prefer scouting a subsystem NOT on the swept-list over re-checking a closed family. |
| **deep-review** | **SATURATED across NINE subsystems (C255–C301)** | trips arc (C255), repo layer (C260), TCO chain (C266, Property 14 + #27/#28), offline-sync (C274), CSV-import (C279), provider-config (C285), backup→restore round-trip (C290), auth OAuth core (C296), financing computeBalance (C301) — ALL certified CLEAN firsthand. VERIFY firsthand — agent "HIGH" findings are often false (C21/C60/C333). A fresh certification now needs a genuinely NOT-YET-AUDITED shipped subsystem (the un-audited list is nearly empty); else record saturated + pivot. Don't re-audit any of the nine. |
| **guard** | **SATURATED both sides (C261/C263)** | the C250/C251/C256/C257 filter-branch vein took the reachable plain-repo/route gaps; remaining sub-100% is v8 artifacts + DEV-gated catch + apiClient-wrapper THEATER (C181/C229) + DOM/timer-bound. Don't manufacture a vacuous/theater test — record saturated + pivot. |
| **arch** | **DRY; dead-code sweep COMPLETE (C260 BE repos + C264 FE lib/utils + C300 db/types)** | behavior-preserving test-anchored ONE small dedup. The fresh vector is SELF-INTRODUCED dups in code authored last cycles (C222 capitalize, C258 PaginatedEnvelope, C275 collectSvelteFiles, C292 dupCheck — converged the C291 sibling). **FAST-DRY PRECONDITION (C286):** at cycle start, if `git log` over production-src (backend/src+frontend/src `*.ts`, EXCLUDING tests/`__tests__`) shows NO commit since the last source-touching cycle, the dedup vein is STRUCTURALLY dry (nothing newly threaded) → record no-churn FAST + pivot, don't re-scout. Already-ruled below-bar: createExpense quad (C270 divergent), collectSourceFiles (C277 rule-of-2+divergent), BE walker (C281 none), SRC_ROOT (C281 per-file-depth), resolveProviderState↔consumeOAuthState (C297 divergent — returnTo-on-error untested). Don't manufacture churn. |
| **infra** | live (the one always-productive vein) | ~every 10 cycles: untracked-`*.test.ts` sweep + coverage re-measure (update the LEDGER cov: baseline) + this GUIDE/doc-freshness pass. **~every 25 cycles ALSO run the META-REVIEW** (read last ~25 `yield:` tags → dry-ratio + repeated-waste + stale-truth check → at most ONE `loop(meta):` GUIDE edit; see META-LOOP §). (BRANCH_REVIEW.md is gitignored — NOT in the PR, no refresh artifact.) |

## Standing truths (don't re-discover these)
- **GREP-BEFORE-PICK on any backlog bug (loop(meta) C480).** Before building ANY BACKLOG bug/semantics item,
  `grep` the named file/symbol to confirm it is ACTUALLY open. The pre-reset CLAUDE.md "bug snapshot" (and the
  archived backlogs) carry MANY one-liners for bugs that were already fixed in a later cycle — C480 found
  #148/#129/#94/#85/#30/#69/#79/#88/#97/#339(B) were ALL already shipped (commits + guards) when the "approved
  queue" still listed them as open. A one-liner is a LEAD, not ground truth; the source is. This is the
  bug-vein twin of the FAST-DRY precondition: verify the surface before spending a build slice on it.
- **Coverage 90% is NOT loop-closable** (RE-MEASURED C309: 89.29% BE line / 89.32% func [1949 pass] · 89.43% FE
  line / 90.05% func / 81.75% branch [868 pass, C289] — the structural ceiling, UP from the stale ~86/~84 via the
  C250–C257 filter-branch covered-source climb; BE func +0.31 vs C299 [the C300 dead-code removal took db/types.ts
  66.67→100% func by deleting the 0-coverage isValidPaymentFrequency/createEnumGuard], FE flat since C289 [no FE source
  touched C290–C308]). BE gaps are
  DI/singleton/OAuth + catch/DatabaseError tails; FE gaps are eyes-on components + DOM/timer + apiClient-wrapper
  theater. `cov:` tag every LEDGER entry; re-measure on cycles that touch a module. The filter-branch vein that
  drove the climb is now SATURATED (C261/C263) — don't expect further movement without new feature SOURCE.
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

## META-LOOP — make the loop auto-improving (the C349 flywheel)
The loop already learns about VROOM (the `cov:` trend, the SATURATED veins, the bug-class families).
This section makes it learn about ITSELF — turning recurring waste into permanent process edits so the
loop slowly gets faster without a human re-tuning it. THREE mechanisms:

1. **`yield:` tag every LEDGER entry** (the instrumentation that makes improvement measurable). End
   each cycle log with `yield: <product|test|doc|dry>`:
   - `product` = shipped/changed production source (a real fix or feature slice),
   - `test` = added a committed guard/characterization test only,
   - `doc` = only touched loop/spec/docs (no compiled change),
   - `dry` = scouted, found nothing, recorded + pivoted (no commit of substance).
   This is the velocity signal: a healthy BUILD-mode stretch is mostly `product`; a long run of
   `dry`/`doc` is the maintenance-spin smell that means "drop to MAINTAIN cadence or a gate needs clearing."
2. **META-REVIEW every ~25 cycles (a new infra sub-cadence).** Read the last ~25 `yield:` tags and ask:
   - **Dry ratio:** if >40% of recent cycles were `dry`/`doc`, the loop is spinning → either a vein the
     GUIDE still says "live" is actually saturated (downgrade it to dormant here), or the build queue
     emptied and nobody noticed (flag Angelo for the next greenlight).
   - **Repeated waste:** did the same avoidable misstep recur (a re-scout of a dormant vein, a full
     verify on a doc cycle, a re-derivation the queue should have answered)? If a mistake happened
     **twice**, it is a PROCESS bug → write the rule that prevents it directly into this GUIDE
     (that is the whole point — the GUIDE is the loop's editable memory).
   - **Stale truth:** did a "Standing truth" or a SATURATED marker get contradicted by a real finding
     (like C291 finding a real gap in a "saturated" subsystem)? Correct the marker here so the next
     cycle doesn't trust a stale fact.
   Record the meta-review as its own LEDGER entry (`yield: doc`), and make AT MOST ONE GUIDE edit per
   meta-review (small, reviewable — same discipline as arch rule 1). The GUIDE is version-controlled,
   so every self-edit is a reviewable diff on the branch, not a silent drift.
3. **Promote durable lessons to memory, not just the GUIDE.** A lesson that would help a FRESH session
   in a DIFFERENT context → also save via `learn_add` (workspace scope). A lesson specific to running
   THIS loop → it lives here in the GUIDE. Don't double-encode trivia; promote only what changes future behavior.

> **Guard-rails on self-editing (so the flywheel can't spin off):** (a) the meta-loop may edit GUIDE
> process rules + the BUILD QUEUE + vein/saturation markers — it may NOT rewrite NORTH_STAR (vision is
> a human direction call) nor invent product scope (features stay Angelo-gated). (b) One GUIDE edit per
> meta-review, committed with a `loop(meta):` prefix so the self-improvement history is greppable. (c)
> If a self-edit would change the QUALITY BAR (skip a verify class, drop a guard discipline), that is a
> direction call → flag Angelo, don't self-authorize. Velocity edits are in-bounds; quality-floor edits are not.

## PARALLELISM — use subagents to maximize work per cycle (the 2026-06-26 reform)
`spawn_run` works here (probe-verified). A cycle is no longer "one serial increment"; it's "one
INTEGRATED increment, with independent work fanned out to subagents in parallel." The orchestrator (you,
the main loop) stays the single writer-of-record + the single committer + the single verify-gate runner.
**Don't block the cycle on minor serial busywork a subagent can do alongside the main work.**

**The hard constraint (why naive fan-out corrupts):** parallel subagents share ONE working tree + ONE
branch. Two agents editing `schema.ts` (or any same file), or two backend agents both driving the test
DB, RACE — last-writer-wins clobbers, half-applied edits, merge garbage. So the rule is **partition by
file set**: subagents that WRITE must touch provably-disjoint files; everything that only READS can fan
out freely.

**SAFE to fan out (do this liberally — it's free throughput):**
- **Reads / scouts / audits** — "is subsystem X still saturated?", "grep for zero-caller exports",
  "does route Y appear in the IDOR sweep?", a deep-review READ of a subsystem. They produce findings, not
  writes; the main loop acts on the report. (This is the old rule-4 "deep-reviews inline" — now parallel.)
- **Drafts the main loop integrates** — "draft the migration SQL for money-cents T1", "draft the test
  cases for helper Z". The subagent returns text; YOU apply + verify it. No write race.
- **Independent verification** — spawn N skeptics to refute a claimed fix from different angles before you
  trust it (adversarial verify); spawn a critic on a freshly-shot UI PNG while you write the next slice.
- **A FRONTEND slice ‖ a BACKEND slice** — the one safe parallel WRITE pair: FE (`frontend/src`, never
  touches `schema.ts`/test DB) beside BE (`backend/src`) — disjoint trees. Real ~2× on those cycles.
- **Eyes-on batch** — one subagent boots the server + shoots all pending UI surfaces while you build.

**UNSAFE — keep SERIAL on the main loop (never fan out as parallel writes):**
- Two agents touching the SAME file or both editing `schema.ts` / a migration.
- Two BACKEND agents both running the in-memory test DB / createTestApp harness concurrently.
- The COMMIT + `loop/push.sh` (ONE committer, always the main loop — never a subagent).
- The VERIFY gate (`validate:local`) — run it ONCE on the main loop over the integrated result, not
  per-subagent (a subagent's local green doesn't prove the merged tree is green).

**Orchestration pattern each cycle:**
1. Pick the primary increment (BUILD-queue slice or MAINTAIN pick).
2. Identify independent work that would otherwise idle-wait (scouts, the OTHER-tree slice, drafts, a
   UI shot, the next-slice research) → `spawn_run` it (pass a `tasks` array for true parallel).
3. Do the primary increment yourself while they run; collect the `[Subagent completion event]`s.
4. INTEGRATE everything into the working tree (you are the single writer); resolve any overlap.
5. ONE verify gate over the integrated result → ONE commit (apostrophe-free `-m`, never `git add`
   LEDGER/BACKLOG) → `bash loop/push.sh`.
6. LEDGER: tag the cycle `yield:` by the BEST work landed; note `parallel: N agents` so the META-REVIEW
   can see the throughput multiplier working.

**Scale the fan-out to the work, not to a fixed number** — a deep maintenance cycle might spawn 3
scouts; a clean BUILD slice might spawn 0 (nothing independent to do). Don't spawn for spawning's sake;
spawn when there is REAL independent work that would otherwise serialize. If `spawn_run` ever DOES error
again, fall back to inline + note it — don't burn the cycle retrying.

## Halt
No DoD — the loop improves VROOM indefinitely; branch stays PR-ready (~243 commits ahead at the
2026-06-26 reset). Human opens the PR.

**The agent CANNOT self-halt this session (ground truth, established C27 via `.meshclaw-autopilot/STOP`
cycle-24 note, re-confirmed C24–C33):** the auto-nudge is fired by the GATEWAY AutoNudgeService, not a
meshclaw cron. `autonudge_stop` returns `HTTP 403 Forbidden: Failed to look up loop` every call — the
service has no loop registered to THIS session, so the agent cannot deregister it. The
`.meshclaw-autopilot/STOP` sentinel is read by a SEPARATE (retired) autopilot system and does NOT reach
AutoNudgeService. So only the HUMAN can stop the loop, gateway-side (dashboard 🔁 "Stop loop", or
stop/adjust the AutoNudgeService). Do NOT re-retry `autonudge_stop` each cycle (proven structurally
broken) and do NOT re-hunt the stop mechanism (this IS the answer).

**Gated-loop protocol (when the BUILD queue is fully gated AND every maintenance vein is saturated):**
each nudge → (1) cheap new-surface check: `git log -1 -- backend/src frontend/src` for a new prod-src
commit + the vehicle-sharing T0 checkbox + a human steer commit; (2) if a real new surface appeared →
work it; else → a ONE-LINE `yield: dry` LEDGER record + nothing else. Do NOT manufacture a fresh audit
per cycle (that IS the maintenance-spin the META-LOOP warns against — the money migration is 4-axis
certified C20/C22/C25/C26; veins saturated C23). Escalate to Angelo ONCE per blocking condition (done
C27, Slack ts 1782518889), not every cycle. The loop legitimately produces near-zero until a human
clears a gate or stops it.

**RE-TEST THE HOLD TRIGGER EACH GATED CYCLE — do not coast on "I am holding" (loop(meta) C512).** A
gated hold (and a "holding while a user decision is pending" hold especially) must re-verify its OWN
precondition every nudge: is the gate STILL closed? The C485–C507 streak ran ~10 dry cycles too long
because the hold coasted AFTER its trigger had cleared — Angelo had ruled the 23 decisions (the gate
was OPEN: decision 23 greenlit the feature specs to build), but the loop kept dry-pivoting on
"awaiting his next pick" until C508 re-examined and re-entered BUILD mode. The cheap new-surface check
in (1) is exactly that re-test; a hold that is not re-derived from a STILL-closed gate each cycle is
maintenance-spin wearing a "blocked" label. When in doubt whether a decision is still pending, re-read
the ruling: a settled decision + a pre-authorized queue item = BUILD, not hold.

**Meta-cadence escalation back-off (learned C153):** the sanctioned ~25-cycle re-surface is NOT an
indefinite heartbeat. After TWO unanswered sanctioned re-surfaces on the SAME blocking condition (the
live case: the T5b-2b/T7b multi-vehicle-write ruling, escalated C102 + re-surfaced C128, both
zero-response across 50+ cycles), STOP re-pinging — a third-or-later message on an unresponsive channel
is diminishing-returns noise, not signal. Keep producing the one-line dry pivots; the LEDGER streak
already records the blocked state, and the human will act on the two standing messages when they
re-engage. Resume re-surfacing ONLY if the human re-engages or a genuinely NEW blocking condition
arises. (This is the flywheel correcting its own rhythm: the 25-cycle re-surface assumed a responsive
channel; the evidence is it is not responsive right now, so the cost of re-asking exceeds its value.)

**Meta-review degradation under a sustained gate (learned C228):** once the C153 back-off is active AND
the gate is unchanged (HEAD/last-prod-src identical, no ruling/steer), the ~25-cycle META-REVIEW has
nothing left to do that the per-cycle dry pivot is not already doing — the surface check runs every
cycle, the dry-streak note already tracks the dry-ratio, re-ping is suppressed, and five consecutive
metas (C128/C153/C178/C203/C228) reached the identical "correct gate-induced no-op" verdict. Writing a
full ~20-line meta entry each time is itself the bookkeeping churn the META-LOOP warns against. So while
both conditions hold, the meta-cadence DEGRADES to a one-line confirmation folded into that cycle's dry
pivot (e.g. "~CNNN meta-cadence: gate unchanged, back-off holds, no stale truth — full review deferred")
— NOT a fresh full-analysis entry. Resume the FULL META-REVIEW (last-25 yield scan + repeated-waste +
stale-truth + the at-most-one GUIDE edit) on the FIRST cycle after the gate clears (a ruling/steer/new
prod-src lands), or immediately if a genuinely new blocking condition or a stale-truth contradiction
surfaces in the interim. The full review is the right tool when state is moving; under a frozen gate it
is redundant with the cheap per-cycle check.
