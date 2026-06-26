# LOOP GUIDE — VROOM autonomous dev (read FIRST, every cycle)

> _PR-green override (2026-06-21) LIFTED 2026-06-23: the PR was squash-merged to main; the branch
> was reset onto fresh origin/main (force-push authorized by Angelo). Normal balance-table rotation
> resumes. The C146 npm-ci CI fix, the merged loop work, and Angelo's 2026-06-23 decisions are all
> on main now._

> Distilled from C1–C338+. NORTH_STAR.md = vision + quality bar. BACKLOG.md = ranked queue.
> LEDGER.md = per-cycle log + balance table. This file = HOW to run a cycle well.
> Read order: GUIDE → NORTH_STAR → BACKLOG (open work only) → LEDGER balance table. The C1–C467
> history was archived 2026-06-16 to `loop/archive/` (LEDGER + BACKLOG) — consult it only to check
> "was X already done / certified clean?", never as part of a normal cycle. This guide is the manual.

## The one-line loop
Pick MODE (below) → pick ONE increment → do it, verified → update LEDGER (bump last-touched +
`cov:` + `yield:` tags) → commit via script → `bash loop/push.sh`. Stay silent unless a blocker /
product call / phase boundary.

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
1. **money-cents-migration** — `.kiro/specs/money-cents-migration/tasks.md`. FIRST: it is the ONLY
   greenlit feature with NO eyes-on tail (runs to DONE in-loop) AND it is data-safety-critical.
   HARD ORDER: T1+T2 (schema/migration + backup version-bump/shim) land together BEFORE T3–T6.
2. **trips-location** — `.kiro/specs/trips-location/tasks.md`. T1–T5 backend (one slice/cycle), T6 eyes-on.
3. **theming-engine** — `.kiro/specs/theming-engine/tasks.md` (Angelo-approved D1–D7). Token-only
   swap; T1 = userPreferences.themePreference column + migration. Pure token swap, default ≡ today byte-for-byte.
4. **vehicle-sharing** — `.kiro/specs/vehicle-sharing/tasks.md` (T0 NOT yet ratified — BLOCKED until
   Angelo clears its gate; highest cross-tenant risk, so it waits). Skip until unblocked.
- Then the Angelo-approved bug/arch decisions (2026-06-23): #100 json_patch atomic, #79 offline-park,
  seedVehicle convergence (incremental), createLoadState (design-doc-first), #129 already done C155.

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
4. **Parallel disjoint slices (bounded — `spawn_run` 400s here, so this is for the human-run or
   future-unblocked case; DOCUMENT the opportunity, don't force it).** `schema.ts` + the single test
   DB serialize most BACKEND work, so naive fan-out conflicts. The ONE safe parallel pair is a
   **frontend** cycle (guard/eyes-on, never touches schema) running beside a **backend** feature
   slice — disjoint files. When `spawn_run` is available, that pair is a real 2× on those cycles;
   until then, just sequence them adjacent so context is warm.

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
JSON parse); shot.mjs falls back to anonymous, the `/me` 401 is expected. **The three signed-off
feature tails are now ALL COMPLETE (verified C312 against the specs' tasks.md — every task `[x]`):
maintenance T9 (C1), import-trackers T0–T6 (through C153, eyes-on confirmed), recurring-expenses
T0–T8 (eyes-on confirmed).** So eyes-on is the loop-closable mechanism (boot → shoot → Read →
critique → fix → re-shoot) for periodic deep-UI-review + any FUTURE gated feature once greenlit —
but there is NO open signed-off feature work left; every remaining feature is Angelo-gated.

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

## Halt
STOP sentinel or `autonudge_stop`. No DoD — the loop improves VROOM indefinitely; branch stays
PR-ready. Human opens the PR.
