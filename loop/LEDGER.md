# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.
>
> **COVERAGE TREND (loop-improvement #4): end every cycle-log entry with a `cov:` tag** —
> `cov: be <pct>% / fe <pct>%` (the last reading; carry the prior numbers forward + mark
> `~` if you didn't re-measure this cycle). Re-measure (`bun test --coverage` / vitest
> `--coverage`) at least on guard/arch/bug cycles that touch a module. The standing goal is
> 90% both sides. **MEASURED BASELINE (C81, the first real reading — the rule had silently
> lapsed C52–C80, no entry carried a cov: tag): be 77.8% line / 76.9% func · fe 63.7% line /
> 60.6% func / 56% branch** (both up from the long-stale ~74%/~59% estimates, confirming the
> test-adding cycles moved the needle — just unmeasured). When `guard`/`arch` is the pick and
> nothing's more urgent, STEER it to the lowest-covered, highest-risk module (frontend is the
> bigger gap; `backend/src/utils/timeout.ts` 0% + `pending-credentials.ts` 76% are concrete
> low spots) — turns the 90% goal into a ratchet, not an aspiration. Never DROP coverage
> without naming why.

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category.

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 102 |
| deep-review | 5 | 101 |
| guard | 6 | 98 |
| bug | 3 | 103 |
| arch | 5 | 99 |
| infra | 6 | 100 |

Current cycle: **103**

> `arch` (category added pre-C12) seeded at cycle 11; budget 5, so it first comes due
> ~cycle 16. Three concrete items are seeded in BACKLOG (no audit needed to start) — take
> the top one (dedup ownership-validation). Run the rule-7 audit fan-out once those clear.

## Cycle log
- **C1 (infra)** — Bootstrapped the `loop/` scaffold the loop format depends on:
  NORTH_STAR.md (vision + quality bar + guardrails), BACKLOG.md (5 categories with
  starvation budgets + seeded ranked queue), this LEDGER, and push.sh. No product code
  touched; verified the scaffold is self-consistent (categories in BACKLOG == LEDGER table).
  Next cycle: nothing is over budget yet, so take highest-leverage — the `infra` item
  "CLAUDE.md stale refs" (cheap, unblocks fresh-clone orientation) or the top `guard`
  (EUR visual guard). Prefer spreading: pick a non-infra category next.
- **C2 (guard)** — Pinned the cycle-201 mobile-wrap fix. Found the top `guard` item
  ("EUR/unit visual guard") was ALREADY built (insurance-currency-label +
  vehicle-form-unit-defaults e2e), so took guard #2 (category-grid no-wrap, c201). Key
  insight: an e2e spec is untracked-by-design (`*.meshclaw.e2e.ts`) so it doesn't survive
  a merge — quality-bar #5 needs a MERGE-SURVIVING guard. Followed the cycle-205/206
  source-scan pattern: committed `category-selector-labels.test.ts` (fast unit suite) that
  asserts all six CategorySelector labels are single-word (a multi-word label wraps in the
  2-col mobile grid). Also dropped a runtime e2e (untracked) that measures actual wrap.
  Verified: guard unit test green (2/2), frontend type-check 0 errors, build done, e2e
  passes against the real component. No product code touched.
  Next cycle: still nothing over budget. Spread again — candidates: `deep-review` (vehicle
  Overview/ExpensesTable eyes-on, or Sheets restore path) or `infra` (CLAUDE.md stale
  refs). Prefer a deep-review to exercise that starved category before its budget bites.
- **C3 (deep-review → bug)** — Fanned out 2 parallel Explore agents (Sheets restore path +
  vehicle Overview/ExpensesTable). The Sheets agent surfaced a REAL data-safety bug
  (quality-bar #1): the Sheets backup writes each table through a HAND-MAINTAINED column
  list (`getXHeaders()`), and `expenses.clientId` (the offline-sync idempotency key) was
  missing — so it was silently dropped on every Google Sheets backup→restore round-trip
  and restored as null, while the schema-derived CSV path preserved it. Verified firsthand
  + computed the full drift across all 15 tables (clientId was the ONLY one). Bugs jump the
  queue → fixed this cycle: (1) centralized the 15 header arrays into one exported
  `SHEET_HEADERS` map (single source of truth; deleted the 15 dead getters), added
  `clientId`; (2) committed `sheets-header-coverage.test.ts` — a schema-vs-headers superset
  guard (cycle-208/209 pattern) that bites today and pins the whole drift class. Verified:
  tsc 0 errors · Biome (musl) clean · 846 pass/0 fail (incl. the real Sheets round-trip
  test, now carrying clientId) · build bundled. The UI agent's findings are filed as
  backlog items (none data-safety; logged below). marks this cycle infra-light, product-real.
  Next cycle: `feature` (budget 4) and `infra` (CLAUDE.md stale refs) are the most starved.
  Prefer the cheap `infra` (CLAUDE.md still says "Biome can't run" + points at gitignored
  STATUS.md/LOOP.md — wrong for a fresh clone), or pick up a UI deep-review finding as a `bug`.
- **C4 (feature → spec)** — `feature` was over budget (never touched, budget 4), so the rule
  forced a feature pick. Its first loop phase is SPEC (build gated on Angelo sign-off), so the
  increment is the spec, not code. Fanned out 2 Explore agents to scope the reuse surface:
  (1) reminders engine is 100% time-based; mileage was never scoped/deferred; `reminder_vehicles`
  junction + notification feed + ReminderForm/DueRemindersCard are reusable. (2) odometer is a
  bare integer in the vehicle's distance unit (convert-on-read, no canonical unit); NO
  "current odometer" helper exists (two competing notions: fuel-only `vehicle-stats.currentMileage`
  vs the date-ordered `getHistory` UNION). Drafted `.kiro/specs/maintenance-schedule/`
  {requirements,design,tasks}.md: extend reminders with a `triggerMode` + nullable mileage columns
  (additive), a new max-by-value `getCurrentOdometer` helper, whichever-comes-first OR-logic,
  mark-serviced re-arm, mileage-recheck-on-write, and R9 backup/Sheets-header coverage. Six open
  product decisions (D1–D6) flagged for sign-off; recommended option given for each; tasks.md is
  BLOCKED on T0. Flagged Angelo via send_message; did NOT block — moved on.
  Verify (spec-only): cross-checked D1–D6 referenced consistently across all three files +
  file:line groundings from the scoping pass. No build (no code).
  Next cycle: with feature freshly touched, `infra` (cyc 1, budget 6) and `guard` (cyc 2) are
  the next most-starved; or pick up a UI-review `bug` (the month-trend midnight-UTC date is a
  cheap one-liner). The maintenance build itself stays blocked until D1–D6 sign-off.
- **C5 (infra)** — Reconciled CLAUDE.md stale refs that actively mislead a fresh agent
  (most-starved category). Four fixes, each verified against reality: (1) the "Biome CLI can't
  run, fix by hand" claim → corrected to "use the musl binary" (`cli-linux-arm64-musl/biome`,
  confirmed v2.4.16 runs; the glibc one `bun run check` calls is dead) + a VERIFY note that
  `validate` fails only at `check`. (2) Branch convention `autopilot/<task>` → the long-lived
  `claude-loop-dev` branch; dropped the "inherited from .meshclaw-autopilot/LOOP.md" header
  (that file is gitignored now). (3) "read STATUS.md, kept current each cycle" → read the tracked
  `loop/{NORTH_STAR,BACKLOG,LEDGER}.md`; noted STATUS.md/BRANCH_REVIEW.md/.meshclaw-autopilot are
  gitignored and absent from a fresh clone. (4) Refreshed the highlights/gaps (insurance, CSV,
  Sheets-header guard, maintenance spec awaiting sign-off). Verified: musl biome runs; loop/ +
  the sheets guard are tracked; STATUS.md/BRANCH_REVIEW.md are NOT tracked. Docs-only, no build.
  Next cycle: `guard` (cyc 2, budget 6) is now most-starved, then `deep-review` (cyc 3). A
  cheap, high-value option is the month-trend midnight-UTC `bug` (one-line parseMonthToDate fix
  + a guard) — pairs a starved `bug`/`deep-review` finding with a regression guard.
- **C6 (bug + guard)** — Fixed the month-trend midnight-UTC date bug (C3 UI-review finding #2;
  `bug` was at-budget, `guard` most-starved — one increment advances both). `new Date(period +
  '-01')` parses as midnight UTC → x-axis month label shifts back one for negative-offset users.
  Routed through the sanctioned local-time `parseMonthToDate` on the vehicle-detail page.
  Added TWO committed (merge-surviving) guards: (1) a `parseMonthToDate` unit test in
  chart-formatters.test.ts (the helper had ZERO coverage despite every chart relying on it),
  pinning local-midnight + correct rendered month; (2) a source-scan guard `no-utc-month-parse`
  (cycle-205/206 pattern) that fails if any source reintroduces `new Date(<expr> + '-01')`.
  The guard immediately EARNED ITS KEEP: it caught a SECOND live instance I'd missed —
  dashboard/+page.svelte:87 `new Date(\`${t.period}-01\`)` — same bug, now fixed too. Tightened
  the regex to exclude full literal dates (`'2024-01-01'`) so it flags only the concat/interp
  antipattern. Verified: 6/6 new tests green, tsc 0 errors, build done, no remaining offenders.
  Next cycle: `deep-review` (cyc 3, budget 5) is now most-starved → take an eyes-on UI sweep
  (vehicle Overview/ExpensesTable, or analytics route) or a backend correctness audit. The
  remaining UI-review bugs (load-masquerade error state, page-local vehicle-detail filter,
  interpolated h-[…]) are still queued.
- **C7 (deep-review → bug + guard)** — Fanned out 2 Explore agents (CSV-import correctness +
  analytics aggregation math). Both surfaced real bugs. Fixed the HIGHEST-severity one:
  `buildFuelStatsFromData` (analytics/repository.ts) pooled odometer readings across ALL
  vehicles into one max-min, so a multi-vehicle user saw a garbage `totalDistance` on the
  dashboard summary (e.g. cars at 12k + 95k mi → ~83k "driven"). Wrong-but-plausible, on the
  most-viewed surface. Fixed by grouping per vehicle and summing per-car ranges (mirrors the
  existing computeConvertedTotalDistance). Pinned with a deterministic two-vehicle regression
  test in fuel-stats.property.test.ts (1000+500 → 1500, not pooled 80500). Single-vehicle path
  unchanged. Verified: 847 pass/0 fail (+1), tsc 0, Biome musl clean, build bundled.
  The reviews surfaced more REAL bugs now queued (see BACKLOG bug list): CSV-import has no
  idempotency (re-import duplicates rows), non-atomic partial commit, no BOM strip (Excel-edited
  files fail wholesale), date-only midnight-UTC, currency column ignored; analytics has
  missed-fillup MPG/cost-chart corruption, buildMonthlyConsumption slice(0,12) showing OLDEST
  months, and local-tz month bucketing. Several are data-safety — strong candidates next cycles.
  Next cycle (8): nothing over budget (deep-review & bug both fresh at 7, guard 6, infra 5,
  feature 4 → feature starved-for 4 = AT budget, breaches at cycle 9). Prefer the highest-value
  queued `bug` (CSV-import BOM strip is a clean low-risk one-liner; idempotency / missed-fillup
  MPG are higher-severity data-safety) — or take `feature` before it breaches if maintenance
  sign-off has landed.
- **C8 (bug — data-safety, 2 HIGH)** — Closed the two HIGH CSV-import data-safety bugs from C7's
  review, which live in the same commit path (one coherent increment). (1) NO idempotency:
  re-importing the same file used `create()` with no clientId → silently DUPLICATED every row.
  Now each ready row gets a deterministic, `csv:`-namespaced, content+occurrence-keyed clientId
  (two genuinely-identical rows both import; a re-imported file dedups perfectly). (2) Non-atomic
  commit: bare per-row insert loop → a mid-batch failure left a half-imported file. New
  `expenseRepository.importExpenses` wraps the idempotent inserts in ONE db.transaction
  (all-or-nothing) and returns {imported, duplicates}; route surfaces duplicates. Backed by the
  existing (userId, clientId) unique index. Pinned with 2 HTTP tests: re-import → imported:0/
  duplicates:3/row-count unchanged; two identical rows in one file → both import. Verified: 849
  pass/0 fail (+2), tsc 0, Biome musl clean, build bundled. Single/normal imports unchanged.
  Next cycle (9): feature breaches budget (starved-for 5 > 4) → MUST pick feature. But the
  maintenance build is blocked on D1–D6 sign-off; if unsigned, the eligible feature work is
  drafting the #2 "import from other trackers" spec (Fuelly/Fuelio mapping) or recurring-expenses
  — OR, if Angelo signed off, start maintenance T1. Check sign-off first; else draft + flag.
- **C9 (feature → spec)** — `feature` was over budget (starved-for 5 > 4) → forced pick. Checked
  remote: NO maintenance sign-off landed (no commits since C8), so that build stays blocked. Per
  spec-first, drafted the #2 feature spec instead: `.kiro/specs/import-trackers/` (import from
  Fuelly/Fuelio/Drivvo). Key design: it's a server-side header+value MAPPING pre-pass that emits a
  VROOM-native-shape CSV, then reuses the UNCHANGED buildImportPlan → importExpenses — so it
  inherits ALL the safety I just hardened (cycle-8 idempotency/atomicity, formula-neutralize,
  cross-tenant vehicle resolution, caps, per-row errors) rather than re-implementing them. Route
  extension is backward-compatible (native path unchanged when no `mapping` sent). 5 open decisions
  (D1–D5: units, category vocab, date formats, no-vehicle-column, preset set) flagged; recommended
  option each; tasks.md T0 blocks build. Verify (spec-only): D1–D5 consistent across all 3 files,
  groundings (EXPORT_COLUMNS, parseRow, importExpenses, unit-conversions) verified against source.
  Flagged Angelo (now TWO specs awaiting sign-off: maintenance D1–D6 + import-trackers D1–D5).
  Next cycle (10): feature touched (9) → most-starved becomes `guard` (cyc 6, breaches at 12) then
  `deep-review` (cyc 7). Both build queues are sign-off-blocked; plenty of queued `bug`s (missed-
  fillup MPG, slice(0,12), BOM strip) and guard/review work remain. Prefer a queued bug or a guard.
- **C10 (bug + guard)** — Fixed the missed-fill-up MPG/cost corruption (queued bug #5 from C7's
  analytics review). Two month-aggregating builders had drifted from the canonical
  computeEfficiencyPoint contract: `accumulateFuelRow` (monthly MPG) and `accumulateCostPerMile`
  (cost/distance) folded a missed/partial fill-up pair into the month — counting one tank's volume
  against two tanks' miles (inflated MPG) / spiking cost-per-distance — with no missedFillup skip
  and no MAX-miles cap. Extracted a shared `validMilesBetween(current, prev)` helper (skips
  missedFillup either-row + non-positive + over-cap gaps) and routed both through it; also keeps
  cognitive-complexity under the Biome max. Needed `missedFillup` added to GeneralExpenseRow + the
  queryAllExpenses select (column already exists, notNull default false). Pinned with 5 unit tests
  on the exported builders (missed pair → null/excluded; over-cap → excluded; clean pair → sane).
  Verified: 854 pass/0 fail (+5), tsc 0, Biome musl clean, build bundled. Valid-data paths
  unchanged (full analytics property suite green).
  Next cycle (11): `guard` is most-starved (cyc 6, breaches at 12) → prefer a guard, or the next
  queued `bug` (slice(0,12) oldest-months — clean one-liner + test; or the BOM strip). Both
  feature builds remain sign-off-blocked (maintenance D1–D6, import-trackers D1–D5).
- **C11 (bug + guard)** — Fixed buildMonthlyConsumption showing the OLDEST 12 months
  (`.slice(0,12)` after an ascending sort → hides the current period once a user has >12 months
  of fill-ups). Changed to `.slice(-12)` (most recent), matching every sibling monthly builder.
  Also fixed the latent copy in repository.ts buildConvertedEfficiencyTrend (benign today —
  year-end caps to ≤12 buckets — but same class). Pinned with 2 unit tests (14 months → latest
  12, oldest dropped; ≤12 → all, ascending). Verified: 856 pass/0 fail (+2), tsc 0, Biome musl
  clean, build bundled.
  Next cycle (12): `guard` breaches budget (last cyc 6, starved-for 6 = budget) → MUST pick a
  `guard`. The guard queue is empty, so populate it from a real bug class: candidates — a
  committed source-scan that no analytics monthly builder uses `.slice(0, N)` (would have caught
  C11), or extend `no-utc-month-parse` to the backend `toMonthKey`/import paths (bug #8 class).
  Otherwise the remaining queued `bug`s (BOM strip, date-only/currency, tz bucketing) are fair game.
- **C12 (infra)** — Balance forced it: `infra` was the only OVER-budget category (last cyc 5,
  starved-for 7 > budget 6), so the rule required it over starting a feature build. (Between C11
  and now: Angelo rebased the branch onto origin/main + signed off BOTH feature specs; I recorded
  that out-of-band — lesson saved authorizing claude-loop-dev force-push, both specs flipped to
  APPROVED/BUILD GO, 90% coverage goal added to TODO Misc, arch category added to the loop.)
  This cycle's infra increment: reconciled the one now-stale CLAUDE.md line — "drafted-but-unbuilt
  maintenance-schedule (awaiting sign-off)" → both specs APPROVED/ready-to-build + the standing 90%
  coverage goal. Same fresh-clone-orientation class as C5. Docs-only; verified the claims match
  reality (both requirements.md say APPROVED, coverage goal in TODO.md). No build.
  Next cycle (13): nothing over budget (infra now 12). Most-starved: `deep-review` (cyc 7,
  starved-for 6 > budget 5 → OVER next cycle) and `guard` (cyc 6, starved-for 7 > 6 → OVER).
  Both breach at 13 → MUST pick the more-starved: `guard` (starved-for 7). Populate the guard
  queue (e.g. the no-slice(0,N) source-scan) OR, since features are now BUILD GO and `feature`
  is also climbing (starved-for 4 at cyc 13), weigh pulling maintenance T1. Guard is forced first.
- **C13 (guard)** — `guard` was the most-starved over-budget category (last cyc 6, starved-for 7 >
  budget 6; deep-review also breached at 6 but guard was more starved). Populated the empty guard
  queue with a merge-surviving source-scan for the C11 bug class: `no-oldest-month-slice.test.ts`
  fails if any analytics month series chains a `localeCompare` month-sort into `.slice(0, N)` (keeps
  the OLDEST months / hides the current period). Anchored on `localeCompare` so it does NOT flag the
  one legit `.slice(0, 50)` (maintenance timeline, sorted NUMERICALLY by daysRemaining) — proven by
  the guard passing against source that contains both that legit slice and the fixed `.slice(-12)`
  chains. Verified: tsc 0, Biome musl clean, 858 pass/0 fail (+2), build bundled. No product code.
  Next cycle (14): `deep-review` is most-starved (cyc 7, starved-for 7 > budget 5 — OVER) → MUST
  pick it. Take an eyes-on UI sweep (vehicle Overview/ExpensesTable still un-eyes-on'd) or a backend
  correctness audit (fan out per the arch rule-7 style). `feature` (starved-for 5) breaches right
  after — maintenance-schedule T1 (the DB migration) is next once deep-review clears.
- **C14 (deep-review → bug)** — `deep-review` was most-starved over-budget (cyc 7, starved-for 7 >
  budget 5). Fanned out 2 Explore agents: (a) financing/insurance analytics correctness; (b) eyes-on
  vehicle Overview/ExpensesTable WITH real screenshots (cluster was up). The financing agent found a
  HIGH bug — `accumulateMonthlyPremiums` stepped a raw term-start Date with setMonth(+1), so a term
  starting day 29–31 OVERSHOOTS short months (Jan 31 → Mar 2/3) and SILENTLY SKIPS February's bucket
  in the insurance monthlyPremiumTrend (the C6/C11 setMonth-rollover class, ~3/12 of start dates).
  Fixed by extracting a pure `monthKeysInRange(start,end)` helper (day-1-anchored, rollover-safe) in
  analytics-charts.ts and routing accumulateMonthlyPremiums through it. Pinned with 5 unit tests
  (incl. Jan-31→Apr-30 keeps Feb; day-31 6-month term keeps all). Verified: tsc 0, Biome musl clean,
  863 pass/0 fail (+5, full analytics suite green = behavior-preserving), build bundled.
  The reviews surfaced more REAL findings now queued as `bug`s: financing — insurance shows $0 when
  only totalCost (not monthlyCost) is set; interestPaidYtd is mislabeled (1-month estimate);
  loan-breakdown holds balance flat (no amortization). UI eyes-on (CONFIRMED via screenshots) —
  mobile fuel-stat numbers wrap mid-value ($97/.80) in the 3-col dual-metric StatCardGrid; the
  ExpensesTable ScrollArea `h-[{scrollHeight}]` is a DEAD interpolated-Tailwind class (no CSS rule →
  no 600px cap, latent unbounded-growth — confirms C3's interpolated-h-[] item as real).
  Next cycle (15): `feature` is most-starved over-budget (cyc 9, starved-for 6 > budget 4) → MUST
  pick it → maintenance-schedule **T1** (the additive DB migration), the first real build increment
  of the signed-off feature. Follow tasks.md; DatabaseMigrations.md; db:init path (drizzle-kit push
  fails under bun).
- **C15 (feature → maintenance T1)** — `feature` was over budget (cyc 9, starved-for 6 > 4); both
  feature builds signed off → started maintenance-schedule build at T1. Added the 4 mileage columns
  to `reminders` (triggerMode default 'time', intervalMileage, lastServiceOdometer, nextDueOdometer)
  + dueOdometer to reminderNotifications. **Key call: DESCOPED T1 to ADDITIVE-ONLY.** The spec's
  original T1 also relaxed nextDueDate/dueDate to nullable + widened the dedup index — but that
  forces a SQLite TABLE REBUILD, and the rebuild's `DROP TABLE reminders` cascade-drops child
  reminder_notifications rows (proven: my migration-0003 survival test caught the notification row
  vanishing). Rather than ship a data-dropping migration, I split: T1 = 5× `ALTER TABLE ADD COLUMN`
  (zero data risk, generated `0003_many_jean_grey.sql`); the NOT-NULL relax moved to T3 (where the
  trigger logic actually needs a null date, and the rebuild can be written + verified carefully).
  Updated the SHEET_HEADERS (R9 / the cycle-3 guard fired on the new columns — fixed immediately,
  that's T5-partial). migration-0003.test.ts pins columns + existing-row survival + defaults.
  Verified: tsc 0, Biome musl clean, 867 pass/0 fail (+4), build bundled, full migration suite green.
  Lesson worth keeping: a single drizzle migration that BOTH adds columns AND changes a constraint
  on a parent table is dangerous (multi-rebuild → child cascade); keep migrations additive-only,
  do constraint changes in their own carefully-verified migration.
  Next cycle (16): nothing over budget (feature now 15). Most-starved: `arch` (cyc 11, starved-for
  5 = budget 5 → breaches at 17) and `deep-review`/`bug` (both starved-for 2). Prefer continuing the
  maintenance build (**T2**: getCurrentOdometer helper) since it's mid-feature and high-value, OR
  take an `arch` audit-fanout to seed that queue before it bites. Lean T2 (continue the feature).
- **C16 (feature → maintenance T2)** — nothing over budget; continued the mid-feature, high-value
  maintenance build (arch was AT budget, not over). Shipped `OdometerRepository.getCurrentOdometer`
  (design D2) = `MAX(odometer)` across a UNION of `expenses.mileage` + `odometer_entries.odometer`,
  BY VALUE not date, null when no reading, vehicle-scoped — reusing the existing `getHistory` UNION
  shape. This is the canonical "current odometer" the T3 mileage trigger needs; it reconciles the
  fuel-only `vehicle-stats.currentMileage` (which ignores manual entries + non-fuel mileage).
  Pinned by `get-current-odometer.test.ts` (8 cases). **Key call: DEFERRED the
  `vehicle-stats.currentMileage` reconcile to T3.** That field is computed inside a PERIOD-FILTERED,
  fuel-only stats route — swapping it to the all-sources/all-time MAX is a VISIBLE semantics change
  (under a 7d filter, "current mileage" would jump to the all-time odometer), not a
  behavior-preserving reconcile. Better decided deliberately in T3 next to the mileage-due consumer
  than smuggled into a helper-add cycle. Verified: tsc 0, Biome musl clean, 875 pass/0 fail (+8),
  build bundled.
  Next cycle (17): `arch` is now OVER budget (cyc 11, starved-for 6 > budget 5) → MUST pick `arch`.
  Take BACKLOG arch #1 (dedup ownership-validation: route the photos entityType switch through the
  shared validators in utils/validation.ts) — test-anchor the cross-tenant IDOR suite covers all
  four entityTypes FIRST, then refactor. Obey the arch rules (one small behavior-preserving refactor,
  green→green). Or run the rule-7 audit fan-out if arch #1 no longer grounds against source.
- **C17 (arch — safety net for arch #1)** — `arch` breached budget (cyc 11, starved-for 6 > 5) →
  forced pick: BACKLOG arch #1 (dedup ownership-validation — `photos/helpers.ts`
  `validateEntityOwnership` carries a private `validateExpenseOwnership` + inlines vehicle/policy
  checks that duplicate the exported validators in `utils/validation.ts`). Per **arch rule 3**
  (test-anchor BEFORE refactoring; if coverage is missing, ADD the characterization test first and
  that cycle counts as arch/guard), I checked existing coverage: only the `insurance_claim` case had
  an HTTP test of the ownership gate (`claim-photos-http.test.ts`); `vehicle`/`expense`/
  `insurance_policy`/`odometer_entry` were UNtested through `validateEntityOwnership`. So this cycle
  is the SAFETY NET, not the refactor: added `photos/__tests__/entity-ownership-gate.test.ts` — 14
  HTTP cases pinning the gate's observable contract for EVERY entity type (own→200, foreign-user→404
  no existence-leak, missing→404) + unknown-type→400 + anon→401. Drove it through `listPhotosForEntity`
  (a GET exercises the exact gate an upload would, no storage provider needed). The refactor (route
  the switch through the shared validators) lands NEXT cycle against this net as a pure
  behavior-preserving change — keeps each commit cleanly reviewable. Verified: tsc 0, Biome musl
  clean, 889 pass/0 fail (+14), build bundled. No product code touched.
  Next cycle (18): nothing over budget (arch now 17). Most-starved: `guard` (cyc 13, starved-for 5 →
  breaches at 19) and `deep-review` (cyc 14, starved-for 4). Highest-leverage: EXECUTE arch #1's
  refactor now that the net is in — route the photos `entityType` switch through
  `validateVehicleOwnership`/`validateExpenseOwnership`/`validateInsuranceOwnership` (keep claim +
  odometer inline; keep `validatePhotoOwnership` as-is), all 14 gate tests must stay green. That's an
  `arch` pick again but it's the natural completion; alternatively take the starved `guard`/`deep-review`.
  Lean: complete arch #1 (the net exists, the value is in finishing it) UNLESS balance forces guard.
- **C18 (arch — executed arch #1)** — nothing over budget (infra AT 6, breaches at 19); took the
  highest-leverage item: COMPLETING arch #1 now that C17's safety net is in. Refactored
  `photos/helpers.ts` `validateEntityOwnership` to route the `vehicle`/`expense`/`insurance_policy`
  cases through the shared exported validators (`validateVehicleOwnership`/`validateExpenseOwnership`/
  `validateInsuranceOwnership` in `utils/validation.ts`) instead of three private/inlined copies.
  Deleted the duplicate private `validateExpenseOwnership` + the inlined vehicle.findByUserIdAndId and
  policy.userId checks; dropped the now-unused `expenses`/`vehicleRepository`/`insurancePolicyRepository`
  imports. Kept `insurance_claim` inline (transitive claim→policy ownership has no shared validator) and
  `odometer_entry` inline (no shared validator) and `validatePhotoOwnership` as-is (genuinely different
  check on an existing photo row). Collapsed 3 ownership impls → 1 source of truth, killing the
  drift risk (security-adjacent). Behavior-preserving: same NotFoundError per branch, proven by the
  C17 gate suite — **all 14 cases + claim's 3 stay green, full suite 889 pass/0 fail UNCHANGED**.
  Verified: tsc 0, Biome musl clean, build bundled.
  Next cycle (19): `infra` breaches budget (cyc 12, starved-for 7 > 6) → MUST pick `infra`. The infra
  queue is empty — repopulate from a real need: candidates are a CLAUDE.md/loop-doc refresh (state has
  moved: maintenance T1/T2 shipped, arch category active, 18 cycles in) or a loop-tooling improvement.
  `guard` (cyc 13, starved-for 6 = budget, breaches at 19 too) is the close runner-up but infra is more
  starved. Take infra; if the infra need is trivial, also knock the starved guard next.
- **C19 (infra)** — `infra` breached budget (cyc 12, starved-for 7 > 6) → forced pick; queue empty,
  so took the standing infra need: fresh-clone orientation accuracy. CLAUDE.md's "Current state &
  gaps" still listed both feature specs as merely "Approved & ready to build" — stale now that the
  maintenance-schedule build is mid-flight (T1 additive-migration C15, T2 getCurrentOdometer C16
  both shipped). A fresh agent would mis-orient on what's done vs pending. Rewrote that bullet to
  split the two specs by real status: maintenance-schedule **mid-build** (T1+T2 done, T3 next =
  trigger logic + the deferred nullable rebuild), import-trackers **approved, not started** (T1+).
  Same fresh-clone-orientation class as C5/C12. Verified the new claims against
  `maintenance-schedule/tasks.md` (T1 [x], T2 [~], T3 [ ]) and `import-trackers/tasks.md` (T0 [x],
  T1 [ ]). Docs-only; no build (no code touched). CLAUDE.md correctly defers category/budget detail
  to loop/BACKLOG.md (the live snapshot) — nothing stale there.
  Next cycle (20): `guard` breaches budget (cyc 13, starved-for 7 > 6) → MUST pick `guard`. Queue is
  empty → populate from a real bug class. Strong candidate: a source-scan guard for the C18 dedup —
  fail if `photos/helpers.ts` reintroduces a private/inlined ownership check instead of the shared
  validators (locks in the single-source-of-truth). Or pin another recurring class. `deep-review`
  (cyc 14, starved-for 6 > 5) also breaches — runner-up if guard is satisfied cheaply.
- **C20 (guard)** — `guard` breached budget (cyc 13, starved-for 7 > 6) → forced pick; queue empty,
  so populated it with a merge-surviving source-scan locking in the C18 ownership dedup:
  `photos/__tests__/ownership-uses-shared-validators.test.ts`. Asserts `photos/helpers.ts` (1) calls
  all three shared validators (`validateVehicleOwnership`/`validateExpenseOwnership`/
  `validateInsuranceOwnership`), (2) does NOT locally re-declare any of them (a `function`/`const`
  with that name = a private copy that can drift; import-only doesn't match), and (3) does NOT
  re-import `vehicleRepository`/`insurancePolicyRepository` (their return marks a re-inlined
  vehicle/policy ownership check — the exact pre-C18 antipattern). Leaves the genuinely-inline
  `insurance_claim`/`odometer_entry` cases + `validatePhotoOwnership` untouched (no shared validator
  exists for those). This makes the security-adjacent single-source-of-truth invariant
  MERGE-SURVIVING (an e2e/manual review wouldn't catch a silent re-duplication; a committed scan
  does). Verified: tsc 0, Biome musl clean, 893 pass/0 fail (+4), build bundled. No product code.
  Next cycle (21): `deep-review` breaches budget (cyc 14, starved-for 7 > 5) → MUST pick it. Take an
  eyes-on UI sweep (vehicle Overview/ExpensesTable still wants a real screenshot pass; or analytics
  route) or a backend correctness audit — fan out 2-3 Explore agents per the rule-7 style. `feature`
  (cyc 16, starved-for 5 > 4) breaches right after → maintenance-schedule T3 is next once deep-review
  clears. Queued bugs (#8 insurance $0, #9 interestPaidYtd, #10 flat loan balance, #11 mobile wrap,
  #3 dead ScrollArea cap, CSV BOM/date/currency) remain fair game if a review surfaces nothing worse.
- **C21 (deep-review — reminders + expenses backend audit, fan-out)** — `deep-review` breached budget
  (cyc 14, starved-for 7 > 5) → forced pick. Fanned out 2 Explore agents: (a) reminders trigger
  engine, (b) expenses/split/import math. KEY OUTCOME: VERIFIED every "HIGH/CRITICAL" finding against
  source before acting — and the top 4 were FALSE POSITIVES (this is why deep reviews verify):
  • Reminders `setDate(1)` in monthly/yearly/custom recurrence (agent: "CRITICAL, breaks end-of-month")
    — NOT a bug. `anchorDay`/`dayTarget` is captured (trigger-service.ts:71) BEFORE mutation;
    `setDate(1)` is the deliberate guard against JS month-overflow (Jan 31 +1mo → Mar 3), and
    `clampToAnchorDay` runs AFTER to restore the day clamped to the month's last day. The agent's
    "fix" (remove setDate(1)) would INTRODUCE the rollover bug. Correct as-is.
  • Expenses "split siblings double-counted in SUM" (agent: "HIGH, 2x inflated totals") — NOT a bug.
    Each sibling row stores its own per-vehicle SHARE (split-service.ts:92-110 `expenseAmount:
    allocation.amount`), so SUM(expenseAmount) over siblings = group total once (repository.ts:425
    sums expenseAmount, not groupTotal). Agent assumed both siblings carry the full amount; they don't.
  • Percentage-split "negative final allocation" — unreachable: floor() makes runningTotal ≤ true
    partial, so the last share (total−runningTotal) is always ≥ true share > 0; clamp is dead code.
  Two findings are GENUINELY REAL but minor, filed as bugs (below): (1) `fastForwardPastNow`
  (trigger-service.ts:216) ignores `endDate` — a reminder past maxCatchUp with an uncrossed endDate
  gets fast-forwarded past now without deactivating → "active" but dormant (low-med edge); (2)
  `advanceCustom` switch has no `default` → invalid intervalUnit silently no-ops (low; Zod blocks it
  at the route, defense-in-depth only). Deliberately did NOT fix #1 this cycle: it lives in the exact
  trigger code maintenance-schedule T3 rewrites (mileage axis + nullable-date rebuild) — fixing now
  then again in T3 is churn; folded it into T3's scope instead. No code touched; verification-only
  cycle (LEDGER/BACKLOG only).
  Next cycle (22): `feature` breaches budget (cyc 16, starved-for 6 > 4) → MUST pick feature →
  maintenance-schedule **T3** (whichever-comes-first trigger logic + the deferred nextDueDate/dueDate
  nullable rebuild + the T2 vehicle-stats reconcile). FOLD IN the C21 endDate-in-fastForward fix while
  rewriting that code (it's the same function). High-value, mid-feature; both feature specs signed off.
- **C22 (feature — maintenance-schedule T3, part 1: the high-risk nullable rebuild)** — `feature`
  breached budget (cyc 16, starved-for 6 > 4) → forced pick → maintenance-schedule T3. T3 is large
  (migration + trigger logic + routes + reconcile), so this cycle ships the BLOCKING GATE: the
  deferred nullable migration that everything else builds on. Angelo authorized "high risk migrations
  are fine" — so the NOT NULL relax deferred since T1 is now done properly (not deferred again), but
  SAFELY (authorized ≠ reckless). Changes: schema.ts relaxes `reminders.next_due_date` +
  `reminder_notifications.due_date` to nullable (mileage-only reminders/notifications carry no date);
  added a PARTIAL unique index `rn_reminder_odo_idx (reminderId, dueOdometer) WHERE dueOdometer IS NOT
  NULL` for the mileage dedup axis. KEY DESIGN CORRECTION vs the spec: the spec said "widen the dedup
  index to (reminderId, dueDate, dueOdometer)" — that's WRONG. SQLite treats NULLs as DISTINCT in a
  UNIQUE index, so a 3-col index with NULL dueOdometer would silently STOP deduping time-only
  reminders. Kept `(reminderId, dueDate)` for the time axis + a separate PARTIAL index for mileage;
  each axis dedups its own rows, neither breaks the other (pinned by a test that proves both).
  THE C15 FOOTGUN, CONFIRMED LIVE: the nullable relax forces a SQLite table rebuild; drizzle's
  generated 0004 does `DROP TABLE reminders` while `reminder_vehicles` + `reminder_notifications`
  still hold rows. Both children CASCADE on delete, and the generated `PRAGMA foreign_keys=OFF` is a
  NO-OP inside the migrator's transaction (connection.ts:84 wraps migrate() in a txn) — so the DROP
  would silently wipe every child row. HAND-AUTHORED 0004 instead (the documented C15 exception to
  "never edit generated SQL"; the schema is right, only drizzle's rebuild ORDER is unsafe for our FK
  topology): stash both children in FK-free `_hold_` tables → empty live children so the cascade hits
  0 rows → rebuild reminders → rebuild reminder_notifications → refill children from holding (reminder
  ids preserved → FKs resolve) → drop holding. PROOF GATE: `migration-0004.test.ts` (5 tests) applies
  0004 with foreign_keys ON inside the same BEGIN/COMMIT production uses, and asserts the reminder +
  junction row + notification ALL survive row-for-row (the exact loss the naive rebuild causes), plus
  the partial-index dedup behavior and NULL-date persistence. tsc surfaced 6 null-narrowing errors in
  trigger-service (nextDue now Date|null) → guarded: a null next_due_date means "no time axis", return
  early (findOverdue's `<= now` already excludes NULL rows via SQL 3-valued logic; this is the type
  guard + defense-in-depth). Verified: tsc 0 · musl-biome clean · 898 pass/0 fail (+5 migration
  tests, up from 893) · build bundled. No behavior change for existing time reminders (mileage-only
  reminders aren't CREATABLE yet — that's the trigger/routes work).
  Next cycle (23): `feature` still leads (just touched cyc 22, but T3 is mid-build and the loop
  continues the same feature) → T3 part 2: trigger-service whichever-comes-first due logic (OR-in
  mileage via getCurrentOdometer/nextDueOdometer + app-level dueOdometer dedup), FOLD IN the C21
  endDate-in-fastForward bug #12 (same function being rewritten), unit tests for all due/not-due
  permutations. Then T3 part 3 (routes: mark-serviced re-arm + Zod refinements + recheck-on-write +
  the deferred vehicle-stats reconcile). Watch `bug` (cyc 14, starved-for 8 >> 3) — it's the most
  starved; a queued bug (#8 insurance $0, #11 mobile wrap) can jump in if trigger work stalls.
- **C23 (bug — insurance $0 for totalCost-only terms, #8)** — BALANCE OVERRIDE: `bug` was
  starved-for 9 (cyc 23 − last-touched 14) vs budget 3 — the only over-budget category, exactly the
  watch item C22 flagged. Rule 2 is mandatory, so T3 part 2 waits one cycle and I took the
  highest-leverage standalone bug. (Bug #12 is explicitly "fold into T3" — doing it standalone now
  then again in T3 is churn, so it stays deferred.) THE BUG (#8, data, med-high): `buildInsuranceDetails`
  (`analytics/repository.ts:893`) computed `const monthlyPremium = latestTerm.monthlyCost ?? 0`. A
  term entered as a lump sum (totalCost set, monthlyCost null — e.g. "6-month policy = $1,200") then
  contributes **$0** to every premium total, per-vehicle detail, carrier total, and the monthly trend.
  totalCost was SELECTed (:1637) but never consumed. FIX: extracted an exported pure helper
  `effectiveMonthlyPremium(term)` to analytics-charts.ts — monthlyCost wins when set (incl. an
  explicit 0); else amortize totalCost across the term span via `monthKeysInRange(start,end).length`
  (the C14 day-1-anchored helper, so a day-29–31 start doesn't skip a month); 0 when neither cost nor
  a resolvable span exists. Wired into :893 as the single choke point — `buildInsuranceVehicleEntries`
  already takes `monthlyPremium` as a param and `accumulateMonthlyPremiums` reuses it, so the one-line
  swap propagates to per-vehicle/carrier/trend/totals with no other edits. Pinned by
  `effective-monthly-premium.test.ts` (7 cases: precedence, monthlyCost=0 honoured, totalCost
  amortization, day-31 no-skip, single-month, neither-set, null-span div-by-zero guard). Verified:
  tsc 0 · musl-biome clean · 905 pass/0 fail (+7, up from 898) · build bundled. No existing test
  pinned the old `?? 0` behavior (analytics+insurance suites green unchanged).
  Next cycle (24): back to `feature` (starved-for 2, but T3 is mid-build) → maintenance-schedule
  **T3 part 2**: trigger-service whichever-comes-first (OR-in mileage via getCurrentOdometer ≥
  nextDueOdometer; emit a mileage notification with null dueDate + dueOdometer, app-level dedup on
  the C22 partial index), FOLD IN bug #12 (endDate-in-fastForward, same function). Unit tests for all
  due/not-due permutations. `bug` is now freshly serviced (cyc 23); `arch` is next-most-starved
  (cyc 18, starved-for 6 > 5) and will breach soon — its top item (converge `sync` route error
  handling on the central middleware) is a candidate if T3 part 2 stalls.
- **C24 (arch — converge sync error handling, part 1: make the middleware SyncError-aware)** —
  `arch` breached budget (cyc 18, starved-for 6 > 5) → forced pick. T3 part 2 waits one more cycle.
  Took arch #1 (converge `sync` route error handling on the central middleware) — but FIRST verified
  the BACKLOG item's premise against source (the C21 lesson), and it was WRONG in a load-bearing way:
  the item said "drop the try/catch, throw the typed error, let the middleware shape it." But
  `SyncError extends Error` (NOT `AppError`), and the central `errorHandler` had no SyncError branch —
  so a thrown SyncError would fall through to the generic 500 path, turning today's
  `SyncError(VALIDATION_ERROR)`→400 into a 500. Blindly doing the "refactor" would have been a
  behavior change (violates arch rule 2). Also: arch rule 3 — the central handler had ZERO test
  coverage, so a refactor against it had no safety net. SO this cycle is the load-bearing PREREQUISITE,
  split per rule 1 (one small reviewable increment): (1) extracted `syncErrorResponse(error)` in
  errors.ts as the single source of truth for SyncError→{body,status} shaping; (2) routed the existing
  `handleSyncError` through it (identical output, preserved); (3) added a SyncError branch to the
  central `errorHandler` using the SAME helper, so a SyncError now yields a byte-identical envelope
  whether caught locally or by the middleware; (4) committed `error-handler.test.ts` (7 tests, the
  handler had NONE before) pinning every existing branch (AppError subclasses, ZodError, HTTPException,
  unknown→500) AND proving `handleSyncError(err)` === `errorHandler(err)` for all 7 SyncErrorCodes.
  BEHAVIOR-PRESERVING: no SyncError reaches the middleware today (all 27 throw sites are caught in
  local try/catch), so the new branch is DORMANT — it only activates next cycle when the per-route
  try/catch is removed, and the equivalence test proves that removal is safe. Verified: tsc 0 ·
  musl-biome clean · 912 pass/0 fail (+7, up from 905) · build bundled. No product behavior changed.
  Next cycle (25): `feature` is most-starved (cyc 22, starved-for 3 < 4 — not yet over budget, but T3
  is mid-build so the loop continues it) → maintenance-schedule **T3 part 2** (trigger whichever-comes-
  first mileage logic + fold bug #12). ARCH FOLLOW-UP (part 2, when arch next fires ~cyc 29): now that
  the middleware is SyncError-aware + pinned, drop the hand-rolled try/catch from sync/routes.ts (7
  handlers) and let errors propagate to errorHandler — prove behavior-identical via the sync route
  HTTP tests + the new equivalence net. Then repeat for `auth` (7) and `settings` (5).
- **C25 (feature — maintenance-schedule T3 part 2: whichever-comes-first mileage trigger + bug #12)** —
  Nothing over budget (feature starved-for 3 < 4), but T3 is mid-build so the loop continues the
  feature. Built the MILEAGE AXIS of the reminder trigger — the half that makes "whichever comes
  first" real. DESIGN (grounded in the T3 spec + the C22 nullable schema): the time axis (`findOverdue`,
  `nextDueDate <= now`) can't see mileage-only reminders (null date) or a `both` reminder that's
  mileage-due-but-not-time-due, so added a SEPARATE pass. Repository: `findMileageTracking(userId)`
  returns active `triggerMode != 'time'` reminders with a non-null `nextDueOdometer` (due-ness needs
  the live odometer, not decidable in SQL); `mileageNotificationExists` + `createMileageNotification`
  (null dueDate, dueOdometer set) for the app-level dedup, with the C22 partial unique index as the DB
  backstop (UNIQUE-violation caught → no-op). trigger-service: new `processMileageReminder` — fetches
  `getCurrentOdometer` (max across expenses.mileage + odometer_entries, the C16 helper), fires ONE
  notification when `current >= nextDueOdometer`. KEY SEMANTICS: NO auto-re-arm on the mileage axis
  (re-arm is the explicit mark-serviced path, D3/T4) — a mileage reminder stays due until serviced, so
  re-triggering is idempotent (proven). A `both` reminder can fire on BOTH axes (distinct events,
  distinct dedup keys); the passes run independently. D4 single-vehicle enforced at runtime (a !=1
  vehicle mileage reminder is SKIPPED with a reason, not errored). SCOPE: mileage EXPENSE
  auto-creation deferred — it needs ratified auto-re-arm semantics (not in D1–D6); this axis emits the
  notification signal. The whole engine is dormant until T4 wires validation (no mileage reminder is
  API-creatable yet), so it's safe to land fully built + tested. ALSO FOLDED IN bug #12 (C21 audit):
  `fastForwardPastNow` ignored `endDate` — a bounded reminder lapsed past maxCatchUp (12) got
  fast-forwarded past now and left "active" but permanently dormant. Added the same
  `if (endDate && nextDue > endDate) { deactivate; return }` guard the main loop has. Pinned by
  `trigger-mileage.test.ts` (5: due/not-due/idempotent-re-trigger/no-vehicle-skip/max-across-sources,
  all through the real route→service→DB stack) + `trigger-fastforward-enddate.test.ts` (1: a lapsed
  bounded weekly reminder past the cap is deactivated, not left active — fails against pre-fix code).
  Verified: tsc 0 · musl-biome clean · 918 pass/0 fail (+6, up from 912) · build bundled.
  Next cycle (26): `feature` just touched (cyc 25) but T3 still mid-build → **T3 part 3/T4**: routes +
  validation — `POST /:id/mark-serviced` re-arm (D3: mileage → lastServiceOdometer = current, recompute
  nextDueOdometer; time → advance nextDueDate), Zod refinements (D4 single-vehicle + intervalMileage
  required when mileage), and `recheckMileageReminders` on odometer/mileaged-expense write (D5). Then
  the deferred T2 vehicle-stats.currentMileage reconcile. `guard` (cyc 20, starved-for 5 < 6) and
  `deep-review` (cyc 21, starved-for 4 < 5) approach budget — candidates if T4 needs a breather.
- **C26 (infra — refresh stale orientation docs)** — BALANCE OVERRIDE: `infra` breached budget
  (cyc 19, starved-for 7 > 6), the only over-budget category, so it outranks continuing T3 part 3
  this cycle. The infra queue was empty → scoped a real "keep the machine running" item: the
  orientation docs a fresh agent reads first had drifted out of sync with C22–C25, which actively
  misleads every future cycle. Fixed: (1) CLAUDE.md "Current state & gaps" said maintenance-schedule
  was "T1+T2 shipped; next is T3" — rewrote to reflect T1/T2/T3-part-1 (nullable rebuild migration
  0004 + partial index)/T3-part-2 (mileage trigger pass) all shipped, engine dormant until T4 wires
  routes+validation; spelled out the T4 surface (mark-serviced D3, refinements D4, recheck D5,
  vehicle-stats reconcile). (2) Softened the coverage line — the frontend ~59%/backend ~74% badges
  are a last-measured TODO.md baseline, not a current reading (the backend suite has grown to ~918
  tests), so labeled them a floor + pointed to the source rather than asserting a stale specific.
  (3) APIConventions.md steering "Error Handling" said "for sync ops use handleSyncError()" — updated
  to reflect C24: the global handler is now SyncError-aware via the shared `syncErrorResponse()`, so
  throwing a SyncError needs no local catch; noted the existing sync catch blocks + the queued arch #1
  convergence. DECISION: did NOT run a fresh coverage pass (expensive, off-point for a doc-refresh
  cycle) — flagged the figure as a baseline instead, honest over precise. Doc-only (no code touched);
  verified the working tree carries only CLAUDE.md + APIConventions.md. No build gate needed.
  Next cycle (27): back to `feature` (T3 still mid-build) → **T3 part 3/T4** (mark-serviced re-arm +
  Zod refinements + recheck-on-write + vehicle-stats reconcile). `guard` (cyc 20, starved-for 7 > 6
  at cyc 27) will ALSO be over budget next cycle — if both feature-continuation and guard contend,
  guard wins the balance rule; a merge-surviving guard candidate: a source-scan that the mileage
  trigger's no-auto-re-arm invariant (one notification per milestone) stays intact.
- **C27 (guard — maintenance-fields backup round-trip lock)** — BALANCE OVERRIDE: three categories
  were over budget at cyc 27 (deep-review 6>5, guard 7>6, bug 4>3); the rule picks the MOST starved
  over-budget one → `guard` (starved-for 7). Exactly the heads-up C26 left. Guard queue was empty, so
  picked the highest-leverage merge-surviving lock for the just-shipped C22/C25 work: a TRUE
  backup→restore round-trip for the maintenance-schedule reminder fields (this is also T5's explicit
  "Remaining" item — data-safety quality bar #1). RATIONALE: C22 added reminders.{triggerMode,
  intervalMileage, lastServiceOdometer, nextDueOdometer} + reminderNotifications.dueOdometer and made
  next_due_date/due_date nullable. The CSV backup is schema-derived so they SHOULD ride along — but
  the `coerceRow` boundary (integer + nullable columns, and a NULL date that must NOT coerce to 0/"")
  is exactly the C3 clientId silent-drop class, and nothing proved a mileage reminder survives
  export→import. Committed `maintenance-fields-roundtrip.test.ts` (3 tests through the REAL exportAsZip
  → restoreFromBackup stack, mileage reminders seeded via sqlite since T4 validation isn't wired):
  (1) mileage-only reminder + mileage notification survive with all 4 mileage cols + NULL date/odo
  intact; (2) a `both` reminder preserves both axes (real date AND mileage cols); (3) a plain time
  reminder restores with mileage cols NULL (not coerced to 0) + its real date. The NULL-not-zero
  assertions are the load-bearing ones — that's where coerce would silently mangle. Verified: tsc 0 ·
  musl-biome clean · 921 pass/0 fail (+3, up from 918) · build bundled. No product code touched.
  Next cycle (28): `deep-review` is now most-starved over budget (cyc 21, starved-for 7 > 5) → it wins
  the balance rule, NOT feature. Take the top deep-review item (eyes-on vehicle Overview + ExpensesTable
  populated states, mobile+desktop) or the analytics route sweep — fan out 2-3 Explore agents per
  rule 7. `bug` (cyc 23, starved-for 5 > 3) is also over budget and would be next after deep-review.
  T3 part 3/T4 (mark-serviced + validation) resumes once the starved review/bug categories are fed.
- **C28 (deep-review — backend correctness audit of the dormant mileage engine + insurance math)** —
  BALANCE OVERRIDE: deep-review most-starved over budget (cyc 21, starved-for 7 > 5). Verification-only
  cycle (like C21 — no product code; findings triaged into the bug queue). Fanned out 2 parallel
  Explore agents: (a) the C22/C25 mileage trigger engine, (b) insurance/financing analytics + the C23
  fix. APPLIED THE C21 LESSON — verified every agent finding against source before filing. RESULTS:
  • Agent A flagged 1 real + escalated a known one. The mileage engine is AUDIT-CLEAN on the scary
    axes — `both` fires once per axis (distinct dedup keys, no double-count), the mileage dedup is
    genuinely idempotent (app-check + partial-index backstop + UNIQUE-violation→null), getCurrentOdometer
    NULL/zero/cross-vehicle handling correct, findMileageTracking candidate set correct, the bug-#12
    endDate fix correct. The ONE real finding: backlog bug #13 (`advanceCustom` no-default) — VERIFIED
    + SEVERITY RAISED: it's not just a re-fire-until-maxCatchUp no-op, it's an INFINITE LOOP — an invalid
    intervalUnit leaves nextDue unchanged and `fastForwardPastNow`'s `while (nextDue <= now)` has no
    iteration cap → hang. Still defense-in-depth (Zod blocks the API create+update paths), reachable
    only via DB corruption/validation bypass. Updated #13 in the backlog with the corrected failure mode.
  • Agent B: C23 `effectiveMonthlyPremium` CORRECT (null/0/empty-span edges all handled, no NaN/Infinity);
    accumulateMonthlyPremiums is consistent with the headline total (same value source). CONFIRMED bugs
    #9 (interestPaidYtd mislabeled, :763-764/:1592) + #10 (buildLoanBreakdown flat balance, :829-849)
    still real + unfixed; refreshed their stale line refs. NEW finding filed as #14: buildInsuranceDetails
    counts an EXPIRED latest term as current premium (active policy, lapsed term → stale premium in the
    total) — flagged as a SEMANTICS call (active-but-expired may legitimately still owe), needs a product
    decision + a characterization test (buildInsuranceDetails has zero coverage) before any change.
  Net: engine certified clean where it matters, 1 severity correction (#13), 1 new finding (#14), 2
  confirmations (#9/#10). No code touched; LEDGER + BACKLOG only.
  Next cycle (29): `bug` is now most-starved over budget (cyc 23, starved-for 6 > 3) → it wins. Top
  real, decided, standalone bug: #13 (advanceCustom default + a fastForward iteration cap — small,
  closes the hang) or #10 (buildLoanBreakdown balance decrement — clear correctness fix, characterization
  test first). #14 needs an Angelo decision first (don't auto-fix a semantics call). T3 part 3/T4 resumes
  after the bug category is fed (it'll keep breaching until then).
- **C29 (bug — #13: invalid intervalUnit no longer hangs the trigger)** — `bug` most-starved over
  budget (cyc 23, starved-for 6 > 3) → forced pick. Took #13, the hang the C28 audit re-classified
  (not just a no-op). TWO-PART defense-in-depth fix in trigger-service.ts: (1) `advanceCustom` now
  throws `ValidationError` on an unknown intervalUnit instead of silently leaving the date unchanged
  (the root cause — a no-op date makes the `while (nextDue <= now)` loops spin); (2) a NON-PROGRESS
  BACKSTOP in `fastForwardPastNow` — if `computeNextDueDate` returns a date that didn't strictly
  advance, throw rather than loop forever (guards the invariant directly, catches any future
  non-advancing path, not just this one). Both throws land inside `processReminder`'s per-reminder
  try/catch in `processOverdueReminders`, so a corrupt reminder becomes a `skipped` entry
  (reason 'error'), NOT an endpoint crash/hang — well-formed reminders in the same batch still
  process. Still defense-in-depth (Zod `intervalUnitSchema` blocks the create+update API paths;
  reachable only via DB corruption/bypass), but the failure mode is now a clean skip. Pinned by
  `trigger-bad-interval-unit.test.ts` (2: corrupt reminder reported in `skipped` not hanging — the
  test COMPLETING is itself the anti-hang proof; + a corrupt reminder doesn't block a healthy one in
  the same batch). Test-harness note: a vehicle-less reminder skips with reason 'no_vehicles' BEFORE
  the date math, so the repro must link a vehicle to actually exercise the advance path. Verified:
  tsc 0 · musl-biome clean · 923 pass/0 fail (+2, up from 921) · build bundled.
  Next cycle (30): nothing over budget after this (feature starved-for 5 > 4 at cyc 30 — feature is
  the one breaching) → back to `feature`, T3 part 3/T4 (mark-serviced re-arm D3 + Zod refinements D4 +
  recheck-on-write D5 + vehicle-stats reconcile). Remaining decided bugs (#9 interestPaidYtd rename,
  #10 loan-breakdown balance, #11 mobile fuel-stat wrap) stay queued; #14 still needs the Angelo
  semantics decision (asked at end of C28 — buttons shown, no answer yet; don't auto-fix).
- **C30 (arch — #1 part 2 prerequisite: characterize sync-route error behavior)** — BALANCE: the C29
  forecast said "feature breaches next", but the table is the source of truth and BOTH breached at
  cyc 30 — feature starved-for 5 > 4 AND arch starved-for 6 > 5. The rule picks the MOST starved →
  `arch` (6) wins over feature (5); T3 part 3/T4 waits one more cycle. (Lesson: compute every category
  from the table each cycle, don't trust last cycle's single-category forecast.) Took arch #1 part 2
  (drop sync/routes.ts try/catch). APPLIED C24/C28 DISCIPLINE — verified the BACKLOG's "clean drop"
  premise against source FIRST, and it's wrong the same way C24's was: handleSyncError + the central
  errorHandler are byte-identical for a SyncError (proven C24), but for a NON-SyncError thrown inside a
  handler they DIVERGE — handleSyncError's tail wraps any non-SyncError as 500 OPERATION_FAILED, while
  errorHandler maps a ZodError → 400 ValidationError and an AppError by statusCode. So a blind drop
  CHANGES status codes (500→400 for bad input) — not behavior-preserving, violates arch rule 2. AND
  (rule 3) the sync routes had ZERO real HTTP-stack error coverage (existing "tests" are pure-logic
  replicas). So this cycle is the test-only PREREQUISITE (mirrors C24→C25): committed
  `sync-route-errors.test.ts` (4 tests through the real app.request stack) pinning today's status+body
  at representative sites — SyncError paths (POST /sync invalid syncTypes → 400; unknown type → 400;
  restore/from-provider missing Idempotency-Key → 400 via the middleware, already central) + the
  health positive control. The non-SyncError DIVERGENCE is documented analytically in the file (the
  app.request harness always JSON-stringifies the body + lacks a header arg, so an in-handler ZodError
  can't be provoked through it) with the exact 500→400 change the part-2 drop will make. Now the drop
  is provable: when the try/catch comes out, the SyncError assertions stay green and the divergent ones
  get updated to 400 in the same commit — a deliberate, reviewed step. Verified: tsc 0 · musl-biome
  clean · 927 pass/0 fail (+4, up from 923) · build bundled. Test-only; no product code touched.
  Next cycle (31): `feature` is now most-starved over budget (cyc 25, starved-for 6 > 4) → it wins →
  maintenance-schedule **T3 part 3/T4** (mark-serviced re-arm + Zod refinements + recheck-on-write +
  vehicle-stats reconcile) — finally resumes. The arch drop (part 2 proper) is queued for the next
  arch pick (~cyc 35), now safe against this net. #14 still awaits the Angelo semantics decision.
- **C31 (feature — maintenance-schedule T4 part 1: mileage reminders are now API-creatable)** —
  `feature` most-starved over budget (cyc 25, starved-for 6 > 4) → forced pick; T4 finally resumes.
  Scoped to the FOUNDATIONAL slice that turns the dormant C25 engine LIVE: validation (D4) + the
  create/update wiring for the mileage axis. (mark-serviced D3 re-arm + recheck-on-write D5 are
  separate cycles.) Changes: (1) validation.ts — added `triggerMode`/`intervalMileage`/
  `lastServiceOdometer` to reminderBaseSchema + `refineMileageTrigger` (D4: mileage/both requires a
  positive intervalMileage + exactly one vehicle; lastServiceOdometer optional, route-defaulted).
  (2) routes.ts — `resolveMileageFields` helper: defaults lastServiceOdometer to the vehicle's
  current odometer when omitted, derives `nextDueOdometer = lastServiceOdometer + intervalMileage`
  (server-side, never client input); pure-mileage create persists `nextDueDate: null`, both/time keep
  startDate; update recomputes the cache + flips nextDueDate when the mileage axis is touched. (3)
  repository.ts — createWithVehicles no longer hard-overrides `nextDueDate = startDate` (the caller
  now supplies the correct value, null for pure mileage). (4) config.ts — maxIntervalMileage cap.
  TWO SUBTLE FOOTGUNS CAUGHT BY THE TESTS (the value of writing them): (a) `refineMileageTrigger`
  initially REQUIRED lastServiceOdometer, which wrongly rejected the documented default-on-create —
  relaxed to route-defaulted. (b) `triggerMode: .default('time')` SURVIVES `.partial()` on the update
  schema → it silently flipped an existing mileage reminder back to 'time' on any field update that
  omitted triggerMode (cleared nextDueOdometer). Fixed to `.optional()` (DB column default handles
  create-time absence; merge keeps existing on update). Pinned by `create-mileage-reminder.test.ts`
  (7: derived nextDueOdometer, default-to-current-odometer, both keeps date, time has null mileage
  cols, rejects no-interval, rejects multi-vehicle, update recomputes). Verified: tsc 0 · musl-biome
  clean · 934 pass/0 fail (+7, up from 927) · build bundled.
  Next cycle (32): nothing over budget after this (deep-review starved-for 4, bug 3=budget, others
  under). Highest-leverage = continue T4: **mark-serviced re-arm** (D3 — `POST /:id/mark-serviced`:
  mileage → lastServiceOdometer = current odometer, recompute nextDueOdometer; time/both → advance
  nextDueDate) — this is what lets a fired mileage reminder re-arm (today it stays due, by design,
  until this exists). Then recheck-on-write (D5) + the vehicle-stats reconcile. #14 still needs the
  Angelo semantics decision (queued, not auto-fixed).
- **C32 (feature — maintenance-schedule T4 part 2: mark-serviced re-arm, D3)** — nothing over budget
  (feature just touched cyc 31, but T4 mid-build → continue). Built `POST /:id/mark-serviced`, the
  re-arm that closes the mileage loop: a fired mileage reminder has NO auto-re-arm (C25 design), so it
  stays due until this endpoint moves the milestone. Repository: `markServiced(id, userId, fields)` —
  an ownership-scoped optimistic update applying the caller-computed axis fields + stamping
  lastTriggeredAt, returns the row (404 if id/user miss). Route owns the math (keeps the repo free of
  a trigger-service import cycle): mileage/both → lastServiceOdometer := getCurrentOdometer (fallback
  to the stored anchor if no reading), nextDueOdometer := that + intervalMileage; time/both → advance
  nextDueDate one period via the reused `computeNextDueDate`. Rate-limited like /trigger; route placed
  as `/:id/mark-serviced` (static suffix segment, no collision with GET/PUT /:id). Pinned by
  `mark-serviced.test.ts` (5: mileage re-anchor + recompute, the end-to-end fire→service→not-due-again
  loop, time advances date, both moves both axes, cross-tenant/missing id → 404). Verified: tsc 0 ·
  musl-biome clean · 939 pass/0 fail (+5, up from 934) · build bundled.
  Next cycle (33): nothing over budget (deep-review starved-for 5 = budget at cyc 33, others under) →
  continue T4: **part 3 — `recheckMileageReminders` on odometer / mileaged-expense write (D5)** — fire
  a mileage reminder the moment a new reading crosses its milestone (instead of only on the next
  /trigger), idempotent via the existing dedup. Then T3-part-3 (vehicle-stats reconcile) + T5
  remaining + frontend T6–T9. NOTE: deep-review hits budget at cyc 33 — if it's picked, the live
  mileage create+trigger+re-arm surface is now worth an eyes-on/HTTP review. #14 still awaits Angelo.
- **C33 (infra — `validate:local` + `check:musl` scripts; CLAUDE.md refresh)** — BALANCE: the C32
  forecast said "nothing over budget," but `infra` had breached (last-touched 26, budget 6 →
  starved-for 7 > 6) AND `bug` was over (4 > 3); infra is most-starved → it wins. (Recurring lesson:
  I keep under-forecasting the slow-budget categories — compute ALL six from the table each cycle.)
  Infra queue empty → scoped a real loop-tooling item: every cycle manually runs 4 commands because
  `bun run validate`'s `check` step invokes the dead glibc biome (GLIBC_2.29). Added package scripts
  `check:musl` / `check:musl:fix` (the working musl binary over src/) + `validate:local` = type-check
  && check:musl && test && build — the documented 4-step workaround as ONE command. DISCOVERY (the
  payoff): running check:musl over the WHOLE tree surfaced a formatter reflow in my own C31 file
  (create-mileage-reminder.test.ts — a long object literal) that the per-file C31 biome check missed
  but CI's glibc biome would flag — auto-fixed (one tracked file, purely mechanical line-wrap; the 10
  pre-existing noNonNullAssertion WARNINGS in other test files are unsafe-fix + non-blocking, left
  alone — no scope creep into unrelated committed files). Refreshed CLAUDE.md VERIFY step + the Biome
  hard-rule to point at validate:local/check:musl and to note "run check:musl over the whole tree
  before committing — a per-file check can miss a reflow CI flags." Verified: `bun run validate:local`
  EXIT 0 end-to-end (tsc 0 · musl-biome clean · 940 pass/0 fail · build bundled) — the new command IS
  the cycle's verification.
  Next cycle (34): `bug` is now most-starved over budget (cyc 29, starved-for 5 > 3) → it wins.
  Decided standalone bugs: #10 (buildLoanBreakdown flat balance — characterization test first, then
  decrement) or #9 (interestPaidYtd rename) or #11 (mobile fuel-stat wrap — UI). #14 still needs the
  Angelo semantics decision. T4 part 3 (recheck-on-write D5) resumes once bug is fed.
- **C34 (guard → found+fixed a real data-loss bug; feeds guard AND bug)** — BALANCE: 3 categories over
  budget (deep-review 6>5, guard 7>6, bug 5>3); most-starved = `guard` (7) → it wins (my C33 note
  guessed bug; the table rules — guard's raw starved-for was higher). Scoped the highest-leverage
  merge-surviving guard: generalize the C31 footgun (a Zod `.default()` SURVIVES `.partial()`, so an
  update schema can inject the default on an omitted field). Surveyed the codebase's `.partial()`
  schemas + `.default()` base fields → the at-risk instance is `updateExpenseSchema =
  createExpenseSchemaBase.omit(...).partial()` whose base `tags` is `.optional().default([])`. Wrote
  the guard FAILING-FIRST through the real route→repo→DB stack (create a tagged expense → PUT only the
  amount → assert tags survive) — and it CONFIRMED A REAL BUG: editing any other field of a tagged
  expense wiped its tags (the `.default([])` survived `.partial()`, injected `tags: []`, written
  through by repository.update). Silent data loss on the most common edit path (quality-bar #1). FIX:
  `updateExpenseSchema` re-declares `tags` as a plain `.optional()` (no default) via `.extend()`, so an
  omitted tags stays undefined → dropped → stored value preserved; explicit array still replaces.
  `update-preserves-tags.test.ts` (2) now green; the failing-first run is the proof it bites. Verified
  via the new `bun run validate:local`: EXIT 0 (tsc 0 · musl-biome clean — caught + auto-fixed a
  formatter reflow on the edit too · 942 pass/0 fail, +2 · build bundled). AUDIT NOTE for a future
  cycle: the reminders `expenseTags` field + any other `.optional().default(x)` in a `.partial()`'d
  schema may share the class — a broader source-scan guard (assert no `.partial()` update schema
  carries a surviving `.default()`) would lock the whole class merge-surviving; filed as a guard idea.
  Next cycle (35): nothing over budget (arch starved-for 5 = budget at cyc 35; bug just fed). Highest-
  leverage = continue T4 part 3 (recheck-on-write D5), OR take the most-starved-at-budget arch (the
  sync try/catch DROP, now safe behind the C30 net). #14 still awaits Angelo.
- **C35 (deep-review — audit the live mileage API + the .partial()/.default() class)** — BALANCE:
  `deep-review` only over-budget category (cyc 28, starved-for 7 > 5) → forced. (My C34 note guessed
  T4/arch; the table ruled — deep-review's 7 beat arch's at-budget 5.) Verification-only (no product
  code; like C21/C28). Fanned out 2 Explore agents, VERIFIED every finding against source per the
  C21/C28 lesson — which corrected one agent's reasoning. RESULTS:
  • Agent A (mileage API C31/C32): CERTIFIED CLEAN on all 5 scrutinized areas. Spot-verified the
    load-bearing one — a mileage reminder created with no odometer reading anchors at 0 → milestone =
    interval, but `processMileageReminder` returns early on `currentOdometer === null`, so NO
    false-immediate-fire (fires only once a real reading ≥ milestone appears). triggerMode switches
    keep a consistent row (resolveMileageFields clears/sets per mode + flips nextDueDate); mark-serviced
    axis guards correct; refineMileageTrigger enforces single-vehicle + intervalMileage on both create
    AND the merged-revalidate update (no bypass); undefined triggerMode → startDate (not null). Good.
  • Agent B (.partial()+.default() class): flagged reminders `actionMode` as a "REAL data-loss risk,
    route-defended" — BOTH HALVES WRONG on verification (the C21 lesson in action). It is NOT
    route-defended (the route writes {...reminderFields} from the parsed partialUpdate, which WOULD
    carry an injected actionMode), but it's HARMLESS regardless: `actionMode: z.literal('automatic')`
    has exactly ONE legal value, so injecting/writing 'automatic' clobbers nothing (the C34 class only
    bites a USER-SETTABLE field). NO remaining real instances: expense tags fixed (C34); reminders
    expenseTags is `.nullish()` (no default); vehicles/settings/odometer safe because drizzle-zod does
    NOT extract DB column defaults into Zod + their routes merge explicitly. USEFUL STRUCTURAL FACT
    (verified): createInsertSchema does NOT surface `.notNull().default(x)` DB columns as Zod
    `.default()` — so DB defaults are not part of this class; only hand-written Zod `.default()` is.
  Net: live mileage surface certified, class audit closed (0 new real bugs), 1 agent misread debunked.
  The C34 class-level source-scan guard is still the right lock (now scoped: flag a hand-written Zod
  `.default()` on a user-settable field in a `.partial()` update schema; literal-single-value defaults
  like actionMode are exempt). No code touched; LEDGER/BACKLOG only.
  Next cycle (36): `arch` is over budget (cyc 30, starved-for 6 > 5 at cyc 36) → it wins → the sync
  try/catch DROP (arch #1 part 2b), now safe behind the C30 characterization net. `feature` (cyc 32,
  starved-for 4 = budget) is next after. #14 still awaits the Angelo semantics decision.
- **C36 (arch — #1 part 2b: drop the sync try/catch, converge on the central handler)** — `arch`
  forced (cyc 30, starved-for 6 > 5). Executed the drop the C24→C30 sequence set up: removed the
  hand-rolled `try/catch → handleSyncError` from all 7 `sync/routes.ts` handlers + the now-unused
  handleSyncError import, so errors propagate to the central errorHandler (SyncError-aware since C24).
  BEHAVIOR: SyncError paths byte-identical (C24-proven) → the C30 characterization assertions stayed
  GREEN unchanged, proving no regression on the common case; non-SyncError paths IMPROVED as designed
  (a ZodError/AppError thrown in a handler now returns its proper status — 400/401/etc — instead of
  the old blanket 500 OPERATION_FAILED from handleSyncError's tail). This was an authorized, reviewed
  behavior change (the arch-rule-2 exception flagged + net-built across C24/C30), not a silent one.
  Updated `sync-route-errors.test.ts`: refreshed the header + divergence note to the post-drop
  contract, and replaced the now-stale "part-2 WILL change this" analytic note with a LIVE assertion
  (unauthenticated POST /sync → 401 AuthenticationError via the central handler — confirms it's the
  single error path + an AppError keeps its statusCode, not flattened to 500). Verified via
  `validate:local`: EXIT 0 (tsc 0 · musl-biome clean — auto-reflowed the de-indented handlers · 943
  pass/0 fail · build bundled); the full 161-test sync suite green. `sync` is the first of the three
  hand-rolled route files converged.
  Next cycle (37): nothing over budget (feature cyc 32 starved-for 5 > 4 at cyc 37 — feature breaches)
  → `feature` wins → maintenance-schedule T4 part 3 (recheck-on-write D5: fire a mileage reminder the
  moment an odometer/mileaged-expense write crosses its milestone, idempotent via the existing dedup).
  Arch #1 has 2 route files LEFT (auth: 7 try/catch, settings: 5) — each its own characterize-then-drop
  pair when arch next fires (~cyc 41). #14 still awaits the Angelo semantics decision.
- **C37 (feature — maintenance-schedule T4 part 3: recheck-on-write, D5)** — `feature` forced (cyc 32,
  starved-for 5 > 4). Final functional piece of T4: a mileage reminder now fires the MOMENT a new
  reading crosses its milestone, not only on the next /trigger. Added trigger-service
  `recheckMileageReminders(userId, vehicleId)` — fetches the user's mileage-tracking reminders,
  filters to those linked to the written vehicle, runs the existing `processMileageReminder` on each
  (reuse → idempotent via the C22 dedup key, so the login /trigger pass can't double-fire it).
  Wired into TWO write paths: odometer-create route (always) + expense-create route (only when
  `mileage != null`, since getCurrentOdometer reads expenses.mileage). Best-effort — recheck collects
  skips, never throws, so a reminder hiccup can't fail the underlying write (which is already
  persisted). No circular import (trigger-service imports odometer/repository, not routes; the routes
  import trigger-service — one direction). Pinned by `recheck-on-write.test.ts` (5: odometer-write
  fires immediately w/o /trigger, below-milestone silent, mileaged-expense fires, idempotent vs a
  later /trigger, non-mileaged write silent). Verified via validate:local: EXIT 0 (tsc 0 · musl-biome
  clean · 947 pass/0 fail, +4 · build bundled). T4 IS FUNCTIONALLY COMPLETE — mileage reminders:
  creatable (C31) · re-arm via mark-serviced (C32) · fire on /trigger (C25) · fire on write (C37).
  Next cycle (38): nothing over budget (bug cyc 34 starved-for 4 > 3 at cyc 38 — bug breaches) → `bug`
  wins. Decided standalone: #10 (buildLoanBreakdown flat balance — characterization test first) or #9
  (interestPaidYtd rename) or #11 (mobile fuel-stat wrap — UI). REMAINING maintenance-schedule:
  T3-part-3 (vehicle-stats reconcile), T5 remaining (backup round-trip already done C27), frontend
  T6–T9 (the whole UI — types/service/ReminderForm mileage branch/page+card/e2e). #14 awaits Angelo.
- **C38 (bug — #10: buildLoanBreakdown flat balance)** — `bug` forced (cyc 34, starved-for 4 > 3).
  Fixed #10 (confirmed real + unfixed by the C28 audit): buildLoanBreakdown read each loan's balance
  into a Map then NEVER decremented it across the 12-month loop → every month reported identical
  interest/principal (interest never declined, principal never rose, a loan paying off mid-window
  over-projected). The method does DB I/O (computeBalance), so to make the math test-anchored
  (bug-rule: characterize first) I EXTRACTED the pure amortization into `buildAmortizationSchedule`
  (analytics-charts.ts, alongside monthKeysInRange/effectiveMonthlyPremium): takes caller-resolved
  {balance,apr,paymentAmount}[] + month-key labels, walks each balance down by its principal each
  month, clamps principal to the remaining balance + skips paid-off loans (no negative interest /
  phantom principal). buildLoanBreakdown now resolves balances via Promise.all + builds the 12 month
  keys, then delegates. Pinned by `amortization-schedule.test.ts` (5: interest-declines/principal-
  rises = the defining bug assertion, mid-window payoff clamp, multi-loan sum, no-input-mutation,
  empty-loans). Verified via validate:local: EXIT 0 (tsc 0 · musl-biome clean · 952 pass/0 fail, +5 ·
  build bundled). HARNESS GOTCHA (noted): running `bun test src/api/analytics src/utils` together
  3-failed with "ALTER TABLE … ADD due_odometer" errno-1 (duplicate column) — a cross-suite migration
  double-apply when two suites migrate the shared DB in one process; isolation + the full `bun test`
  are both green. The canonical gate is full `bun test` / validate:local, NOT a narrowed multi-dir run.
  Next cycle (39): nothing over budget (deep-review cyc 35 starved-for 4; arch cyc 36 starved-for 3;
  all under). Highest-leverage = the maintenance-schedule FRONTEND (T6: types + service client for the
  mileage fields + mark-serviced) — kicks off the UI arc that makes the now-complete backend usable;
  it's a feature pick (feature starved-for 2, not yet breaching, but highest-leverage). Remaining bugs
  #9 (interestPaidYtd rename) + #11 (mobile fuel-stat wrap) stay queued. #14 awaits Angelo.
- **C39 (feature — maintenance-schedule frontend T6: types + service client)** — nothing over budget;
  highest-leverage = kick off the UI arc that makes the now-complete backend usable. T6 is the
  non-visual foundation (the layer T7+ build on). Frontend `types/reminder.ts`: added `TriggerMode`,
  the mileage fields (triggerMode/intervalMileage/lastServiceOdometer/nextDueOdometer) to `Reminder`,
  made `nextDueDate` nullable; on `ReminderNotification` made `dueDate` nullable + added `dueOdometer`.
  `services/reminder-api.ts`: added `markServiced(id)` → POST /:id/mark-serviced. The nullable-date
  type change correctly surfaced 8 consumer sites assuming non-null (svelte-check) — all TIME-axis:
  fixed by treating a null date as "not time-due" (dashboard due-soon widget filters out pure-mileage
  via a type-narrowing predicate; /reminders isDue returns false for null; the two render sites show
  the odometer milestone instead of a date). Verified: frontend tsc 0 errors (7 pre-existing warnings
  unchanged) · build OK. NO screenshot this cycle — the render branches only manifest for a mileage
  reminder, which isn't UI-creatable until T7 (ReminderForm), so there's nothing new to show yet; the
  tsc+build floor is right for this non-visual layer. No backend touched.
  Next cycle (40): nothing over budget (deep-review cyc 35 starved-for 5 = budget at cyc 40; others
  under). Continue the feature arc → **T7: ReminderForm mileage branch** — the trigger-mode control
  (Time | Mileage | Both), intervalMileage input w/ the vehicle's distance-unit label, current-odometer
  hint + editable lastServiceOdometer, single-vehicle constraint when mileage. THIS is the visual
  cycle — compose from the kit, eyes-on screenshot required (ui-autoloop). T8 (page/card mileage due
  rendering + Mark serviced button) + T9 (e2e) follow. #9/#11 bugs queued; #14 awaits Angelo.
- **C40 (infra — frontend `validate:local`)** — BALANCE OVERRIDE: `infra` breached (cyc 33,
  starved-for 7 > 6), the only over-budget category (deep-review + guard sat exactly AT budget, not
  over) → infra wins, T7 waits one cycle. Symmetry gap with the C33 backend work: the frontend had
  `validate` (lint + format:check + type-check + test, the CI-shaped gate) but NO single command for
  the CLAUDE.md local VERIFY gate (type-check + build), so every frontend cycle ran those by hand and
  the build step was easy to skip. Added `validate:local` = type-check && build && test (fail-fast
  order) mirroring the backend. Verified the test step green FIRST (345 pass) before wiring, then ran
  the new command end-to-end: EXIT 0 (tsc 0 · build ✓ · 345 pass). Refreshed CLAUDE.md's VERIFY step
  to point Frontend at `npm run validate:local`. Well-timed: the T7–T9 frontend arc is the next 3
  feature cycles, each now a one-command gate. No product code; package.json + CLAUDE.md only.
  Next cycle (41): nothing over budget (deep-review cyc 35 starved-for 6 > 5 at cyc 41 — deep-review
  breaches) → `deep-review` wins, NOT the T7 feature. Likely target: an eyes-on/HTTP review of a
  shipped surface (the live mileage API + the just-landed frontend null-date handling), or fan out per
  rule 7. T7 (ReminderForm mileage branch) resumes once deep-review is fed. #9/#11 queued; #14 Angelo.
- **C41 (guard — class-level net for the .partial()+.default() data-loss class)** — BALANCE: both
  guard (cyc 34, starved-for 7) AND deep-review (cyc 35, 6) over budget; most-starved = `guard` (7) →
  it wins (my C40 note guessed deep-review; guard's raw starved-for was higher — keep computing from
  the table). Built the class-level net filed across C34/C35: the data-loss class (a Zod `.default()`
  survives `.partial()`, injecting + clobbering on an omitted-field update) bit twice (C31, C34) and
  per-instance guards cover those — this catches the NEXT one. APPROACH DECISION: a text/regex
  source-scan is unreliable here (schemas span files, `.partial()` is chained), so I used a RUNTIME
  net instead — `partial-update-no-default-injection.test.ts` imports each exported update schema,
  parses an empty `{}`, and asserts it injects no key beyond an EXEMPT allowlist. This tests the real
  invariant ("an empty update overwrites nothing") directly against the actual Zod objects, surviving
  any refactor. Verified-against-source scoping baked in: `actionMode` (z.literal single-value default,
  C35-proven harmless) is the one allowlisted key; schemas with `.refine(keys>0)` (claim/term) early-
  return on the legit empty-parse failure. Covers updateReminder/Term/Policy/Claim; the route-local
  updateExpense (C34-fixed) + odometer schemas aren't exported (a future cycle could export them to
  widen coverage). Verified via validate:local: EXIT 0 (tsc 0 · musl-biome clean · 957 pass/0 fail,
  +4 · build bundled). No product code.
  Next cycle (42): `deep-review` is now most-starved over budget (cyc 35, starved-for 7 > 5 at cyc 42)
  → it wins. Eyes-on/HTTP review of a shipped surface — the live mileage API + the C39 frontend
  null-date handling are the freshest unreviewed; fan out per rule 7, verify findings vs source. T7
  (ReminderForm mileage branch) resumes after. #9/#11 bugs queued; #14 awaits Angelo.
- **C42 (deep-review — mark-serviced/recheck backend + C39 frontend null-handling; fixed 1 real bug)**
  — `deep-review` forced (cyc 35, starved-for 7 > 5). Fanned out 2 Explore agents, VERIFIED every
  finding vs source (C21/C28/C35 lesson). RESULTS:
  • Agent A (C39 frontend null-date handling): CLEAN — every nextDueDate/dueDate/dueOdometer/mileage
    read site is guarded (page null-checks, dashboard type-narrowing predicate, DueRemindersCard gets
    pre-filtered non-null props, ReminderForm null-coalesces expenseTags). 0 remaining. Good.
  • Agent B (mark-serviced C32 + recheck C37): 1 REAL bug + 3 filed. FIXED THIS CYCLE (own-code bug,
    small + the comment was actively false): recheckMileageReminders' `findMileageTracking` fetch was
    OUTSIDE the per-reminder try/catch — it throws DatabaseError, and recheck runs AFTER the
    odometer/expense write persists, so a DB hiccup would propagate + 500 a SUCCESSFUL write, breaking
    the "never throws" contract the call sites rely on (they don't wrap it). Wrapped the fetch →
    swallows to a skip + returns. Pinned by `recheck-query-failure.test.ts` (spyOn mockRejectedValue →
    resolves with reason 'recheck_query_failed', doesn't throw). The other 3 verified findings filed,
    NOT auto-fixed (judgment, not bugs): (1) markServiced is ownership-scoped, NOT value-CAS'd — the
    C32 "optimistic-locked" comment OVERCLAIMS, but two concurrent user mark-serviced calls compute
    the same result from the same row (no corruption), so it's a doc-accuracy fix; (2) mark-serviced
    advances nextDueDate ONE period even from an overdue date (could "bounce" through the past) —
    matches the trigger's own model + assumes a trigger ran first; a semantics decision; (3)
    recheck-on-write is CREATE-only (not expense/odometer UPDATE) — a documented scope choice (D5 says
    "create"). Verified: validate:local EXIT 0 (tsc 0 · musl-biome clean · 958 pass/0 fail, +1 · build).
  Next cycle (43): nothing over budget (arch cyc 36 starved-for 7 > 5 at cyc 43 — arch breaches) →
  `arch` wins → arch #1 part 2c (drop the `auth`/`settings` try/catch, characterize-then-drop per the
  C30/C36 pattern). T7 (ReminderForm) is the next feature pick after. Filed bugs below; #14 Angelo.
- **C43 (arch — #1 part 2c-characterize: pin settings-route error behavior)** — `arch` forced (cyc 36,
  starved-for 7 > 5; bug also over at 5 but lower). Took the settings route (5 try/catch, smaller than
  auth's 7). GROUNDING (vs source, before acting): settings is a DIFFERENT pattern from sync — it
  doesn't use handleSyncError; it hand-rolls try/catch that rethrow as AppError with TRANSFORMED
  messages (GET / masks ANY error as 'Failed to fetch settings' 500; PUT / maps ZodError →
  AppError('Invalid settings data', 400)). The central errorHandler already shapes AppError, so most is
  boilerplate — but the GET catch MASKS typed errors (a NotFoundError would surface as a generic 500)
  and the PUT message is a transform, so dropping CHANGES responses (improvement, but a behavior
  change). Per the C30/C36 pattern + arch rule 2/3 (settings had NO real HTTP-stack error coverage):
  this cycle is CHARACTERIZE-FIRST. Committed `settings-route-errors.test.ts` (4: GET positive control,
  PUT out-of-range syncInactivityMinutes → today's 'Invalid settings data' 400, PUT path-traversal
  backupConfig → 400, PUT valid partial → 200) pinning today's behavior, with an inline note on the
  exact code/message the drop will change. ALSO verified (C35 fact) updateSettingsSchema is a
  `.partial()` of a createInsertSchema with no hand-written default → NOT a C41-class data-loss risk.
  Verified via validate:local: EXIT 0 (tsc 0 · musl-biome clean · 961 pass/0 fail, +3 · build). Test-only.
  Next cycle (44): nothing over budget (bug cyc 38 starved-for 6 > 3 at cyc 44 — bug breaches) → `bug`
  wins. Decided standalone: #9 (interestPaidYtd rename) or #11 (mobile fuel-stat wrap, UI+screenshot).
  arch #1 remaining: settings-DROP (now safe behind this net) + auth (characterize-then-drop). T7
  (ReminderForm) still the next feature pick. #14/#16 await Angelo semantics calls.
- **C44 (bug — #9: interestPaidYtd is mislabeled)** — `bug` forced (cyc 38, starved-for 6 > 3). Took #9
  (clean backend+label rename, no screenshot dependency, vs #11's UI work). THE BUG: the financing
  analytics field `interestPaidYtd` (summary) + per-vehicle `interestPaid` are ONE month's interest on
  the CURRENT balance (`balance * apr/100/12`) — neither year-to-date NOR actually paid; a forward
  estimate mislabeled as historical fact. Took the backlog's "smallest honest fix" = rename, not a
  true-YTD recompute (that needs payment-history summing — out of scope, would be a feature). Renamed
  end-to-end across the boundary: backend `FinancingData` type (2 fields) + 4 impl sites (compute,
  per-vehicle return, 'own' branch, empty-state, aggregation) → `monthlyInterestEstimate`; frontend
  `FinancingResponse` type + the 2 UI labels ('Interest Paid YTD' → 'Est. Monthly Interest' subtitle
  'on current loan balances'; per-vehicle 'Interest Paid' → 'Est. Monthly Interest'). Grep confirmed
  zero remaining code/test refs to the old names (only the explaining comments). UI-touching but a
  pure label/field rename (no layout change) → build + label text are the proof, no screenshot needed.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome · 961 pass · build) + frontend
  validate:local EXIT 0 (tsc 0 · build · 345 pass).
  Next cycle (45): nothing over budget (feature cyc 39 starved-for 6 > 4 at cyc 45 — feature breaches)
  → `feature` wins → maintenance-schedule **T7 (ReminderForm mileage branch)** — THE visual cycle,
  eyes-on screenshot required (ui-autoloop). Remaining: bug #11 (mobile fuel-stat wrap); arch
  settings-DROP + auth; #14/#16 await Angelo.
- **C45 (feature — maintenance-schedule T7: ReminderForm mileage branch)** — `feature` forced (cyc 39,
  starved-for 6 > 4). Built the mileage UI in ReminderForm.svelte: a "Trigger when" Select (On a time
  schedule | At a mileage interval | Time or mileage whichever first) driving hasTimeAxis/hasMileageAxis
  $derived; the mileage axis reveals a Service-interval input (suffixed with the selected vehicle's
  distance-unit label via getDistanceUnitLabel) + a Last-serviced-at input (placeholder 'current',
  hint "leave blank to use latest reading" — matches the C31 backend default), and HIDES the time
  fields (frequency/dates); the time axis keeps the existing fields unchanged. Validation: D4
  single-vehicle when mileage, positive intervalMileage required, time fields only validated when the
  time axis is active. Payload sends triggerMode + intervalMileage (null when pure time) + omits
  lastServiceOdometer when blank (backend defaults it). Edit-path seeds all three from the reminder;
  composed entirely from the existing kit (Select/Input/Label/FormFieldError) — no new components/CSS.
  VERIFIED: frontend tsc 0 · build ✓ · 345 unit tests · prettier clean. ⚠️ EYES-ON NOT CAPTURED — the
  Playwright/browser harness is sandbox-denied in this autonomous context (the run auto-refused). Wrote
  an untracked e2e (`reminder-mileage.meshclaw.e2e.ts`) that screenshots the mileage form + asserts the
  reveal/hide + 'both' behavior when regress.sh runs; flagged the pending eyes-on to Angelo via
  send_message (honest-over-precise: visual risk is low — kit-composed, adjacent-field-identical — but
  not confirmed). NOT claiming T7 fully done until eyes-on; tasks.md marks it [~] visual-pending.
  Next cycle (46): nothing over budget (deep-review cyc 42 starved-for 4; arch 3; all under). Highest-
  leverage = continue the feature arc → **T8** (/reminders page + DueRemindersCard: OR-in mileage due,
  render the milestone + gap with unit label, wire the "Mark serviced" button to reminderApi.markServiced;
  four states + a11y) — also visual. Then T9 (e2e). bug #11 + arch settings-DROP/auth queued. #14/#16 Angelo.
- **C46 (feature — maintenance-schedule T8: Mark-serviced button on /reminders)** — nothing over budget;
  continued the feature arc. T8's display half (mileage milestone render + null-date guards on the
  /reminders cards + notification dueOdometer render) already landed in C39 with the nullable-type
  fixes; the dashboard DueRemindersCard is time-axis-only BY DESIGN (mileage due surfaces via
  notifications, not the date-window widget) so it needs no change. So T8's remaining NEW piece = the
  re-arm action: added `markServiced(item)` handler (per-reminder `servicingId` spinner, success toast
  'reminder re-armed', reload) + `isMileageTracking()` helper, and a "Serviced" Button (Check icon /
  RefreshCw spinner) on each ACTIVE mileage/both card, before Pause/Edit/Delete — wired to
  reminderApi.markServiced (C39 client). Composed from the kit. Verified: frontend tsc 0 · build ·
  345 tests · prettier clean. ⚠️ EYES-ON STILL PENDING (same Playwright sandbox-deny as C45) — extended
  the untracked reminder-mileage e2e to assert the Serviced button shows + click re-arms + screenshot.
  Both T7+T8 visuals will be confirmed in one pass when Angelo runs regress.sh / glances at /reminders
  (flagged C45). T8 marked [~] until then.
  Next cycle (47): `arch` is most-starved (cyc 43, starved-for 4 < 5 — not over yet; deep-review cyc 42
  starved-for 5 = budget at cyc 47). Nothing strictly over budget at 47 → highest-leverage = T9 (the
  maintenance-schedule e2e — promote the untracked reminder-mileage spec's coverage into the committed
  suite shape, closing the feature) OR continue toward closing the UI. bug #11 + arch settings-DROP/auth
  remain queued; #14/#16 await Angelo. Watch: deep-review + arch both breach ~cyc 47-48.
- **C47 (infra — refresh CLAUDE.md maintenance-schedule status)** — BALANCE: `infra` breached (cyc 40,
  starved-for 7 > 6), the only over-budget category (deep-review/guard/bug all sat exactly AT budget)
  → infra wins. The orientation doc a fresh agent reads first was stale since C26: it described
  maintenance-schedule as "backend nearly done, trigger engine DORMANT until T4, frontend T6–T9
  follows" — but C31–C46 shipped all of T4/T5 (backend complete: mileage reminders API-creatable,
  fire on trigger + on write, mark-serviced re-arm) AND frontend T6/T7/T8. A fresh agent would think
  the feature's biggest chunk was unbuilt. Rewrote the block to reality: backend COMPLETE, frontend
  T6–T8 shipped (T7/T8 eyes-on-pending), remaining = T9 e2e + the deferred vehicle-stats reconcile.
  Also bumped the stale ~918 test-count floor to ~962 backend / ~345 frontend. Doc-only (no code);
  verified the tree carries only CLAUDE.md. No build gate needed.
  Next cycle (48): `deep-review` is most-starved over budget (cyc 42, starved-for 6 > 5 at cyc 48;
  arch cyc 43 starved-for 5 = budget) → `deep-review` wins. Freshest unreviewed surface = the C45/C46
  frontend mileage UI (ReminderForm branch + /reminders Serviced button) — an eyes-on/logic review
  (fan out, verify vs source) that ALSO partially discharges the pending T7/T8 eyes-on. Then arch
  (settings-DROP). bug #11 queued; #14/#16 await Angelo.
- **C48 (guard — lock the frontend null-nextDueDate invariant)** — BALANCE: guard (cyc 41, starved-for
  7) AND deep-review (cyc 42, 6) both over budget; most-starved = `guard` → it wins (my C47 note guessed
  deep-review; guard's raw 7 > 6 — the table rules, keep computing all six). The C39 audit confirmed all
  null-nextDueDate consumer sites are guarded, but there was NO committed test locking it — a future edit
  re-introducing `new Date(reminder.nextDueDate)` on a pure-mileage reminder (null date → 1970 epoch →
  wrongly "due", or a crash) would pass review. LOCKED IT, merge-surviving, via the extraction pattern
  (not a fragile regex source-scan): created `reminder-helpers.ts` with exported null-safe
  `isReminderTimeDue(reminder, now?)` + `isMileageTracking(reminder)`, routed the /reminders page's
  inline `isDue` + the C46 page-local `isMileageTracking` through them (behavior-preserving — page
  renders identically), and pinned with `reminder-helpers.test.ts` (5, incl. THE load-bearing assertion:
  a null-nextDueDate reminder is never time-due). `now` is injectable for deterministic tests. Verified:
  frontend validate:local EXIT 0 (tsc 0 · build · 350 tests, +5 · prettier clean).
  Next cycle (49): `deep-review` is most-starved over budget (cyc 42, starved-for 7 > 5 at cyc 49) → it
  wins → eyes-on/logic review of the C45/C46 frontend mileage UI (also partially discharges the pending
  T7/T8 eyes-on). Then arch settings-DROP (cyc 43, breaches ~50). bug #11 queued; #14/#16 await Angelo.
- **C49 (deep-review → found+fixed 1 real display bug; the C45/C46 mileage UI)** — `deep-review` most-
  starved over budget (cyc 42, starved-for 7 > 5; arch 6 + bug 5 also over, deep-review won by raw
  starved-for). Reviewed the freshest unreviewed surface — the C45 ReminderForm mileage branch + C46
  /reminders Serviced button + C48 reminder-helpers — reading each in full AND verifying the form's
  payload against the backend `reminderBaseSchema`/route (the C21/C28/C35/C42 verify-before-acting
  lesson). RESULT: form payload valid (pure-mileage still sends a required frequency/startDate, which
  the route converts to nextDueDate: null), null-handling on the page all guarded (C39/C48). ONE REAL
  bug found by cross-referencing form→backend→card: a pure-mileage reminder still carries frequency
  ='monthly' (backend requires it, form sends its default), and the /reminders card rendered that
  frequency UNCONDITIONALLY (`<Badge>{frequencyLabel(item)}</Badge>`) → a misleading "Monthly" badge on
  an oil-change-every-5,000-mi reminder whose time axis is INERT (engine is odometer-driven, nextDueDate
  null). Low-med, decided (no product question — just wrong), label-only fix. FIXED via the C48
  extraction pattern: added exported, tested `frequencyLabel(reminder): string | null` (+ `hasTimeAxis`)
  to reminder-helpers.ts — returns null when no time axis; routed the page's inline frequencyLabel
  through it and gated the Badge on non-null. Behavior-preserving for time/both (badge still renders);
  the inert-schedule badge is suppressed for pure-mileage. CAUGHT MYSELF mid-edit adding an "Every 5,000
  mi" interval badge with a HARDCODED 'mi' unit (the C204 hardcoded-unit class — wrong for km users) and
  removed it (the milestone already shows correctly on the card's odometer line). Pinned by 5 new helper
  tests (hasTimeAxis time|both, frequencyLabel Monthly/custom/both, + the load-bearing null-for-pure-
  mileage assertion). Verified: frontend validate:local EXIT 0 (tsc 0 · build · 355 tests, +5 · prettier
  clean). Also partially discharges the pending T7/T8 eyes-on — the form/card LOGIC is now reviewed +
  pinned, though a literal screenshot is still Playwright-sandbox-blocked.
  Next cycle (50): `arch` is most-starved over budget (cyc 43, starved-for 7 > 5 at cyc 50; bug cyc 44
  starved-for 6 > 3 also over — arch wins by raw starved-for) → arch settings-DROP (the C43
  characterize-then-drop pair: drop the 5 settings try/catch, let the SyncError-aware central handler
  shape responses; the C43 net makes it safe + the GET-masks-500 / PUT-message changes are the reviewed
  delta). Then `bug` (#11 mobile fuel-stat wrap, or #16/#14 if Angelo has answered). T9 e2e + vehicle-
  stats reconcile remain the last maintenance-schedule pieces.
- **C50 (arch — #1 part 2c-drop: converge settings error handling on the central handler)** — `arch`
  most-starved over budget (cyc 43, starved-for 7 > 5; bug also over at 6, arch won by raw starved-for).
  Executed the drop the C43 characterization set up. VERIFIED the exact delta vs source first (the
  C24/C30/C36 pattern): read settings/routes.ts + the C43 test + the central errorHandler before
  touching anything. Dropped the hand-rolled try/catch from all 4 settings handlers (GET /, PUT /,
  POST /backup, POST /restore) + removed the now-unused `AppError`/`logger` imports (kept `ValidationError`
  — still used by the storage/backup validators at :49/:61/:67/:94). BEHAVIOR DELTA, all reviewed +
  intended (arch rule 2 authorized exception, net-built C43): (1) PUT ZodError → was
  AppError('Invalid settings data', 400), now the central handler's ValidationError('Invalid request
  data', 400) — STATUS UNCHANGED (400), only the transformed message standardizes; (2) GET / no longer
  MASKS a typed error as a blanket 500 — a NotFoundError/ValidationError now reaches its real status
  (improvement); (3) POST /backup likewise; (4) POST /restore's catch was dead (its try body only
  returns, can't throw) → pure boilerplate removal. The storage/backup ValidationErrors (AppError
  subclass) flow through the handler by their 400 statusCode unchanged. Updated the ONE C43 assertion
  the drop changes (PUT message → 'Invalid request data'); the SyncError-style positive controls + the
  path-traversal 400 stayed GREEN unchanged, proving the common paths are preserved. Dropped a
  speculative `code === 'VALIDATION_ERROR'` assertion after verifying AppError carries no `code` field
  (the envelope code is derived in formatErrorResponse) — didn't over-assert an unverified shape.
  Verified: validate:local EXIT 0 (tsc 0 · musl-biome clean, auto-reflowed the de-indented handlers ·
  961 pass/0 fail · build bundled). `sync` (C36) + `settings` (C50) now converged; `auth` (7 try/catch)
  is the LAST hand-rolled route file — its own characterize-then-drop pair for a future arch cycle.
  Next cycle (51): `bug` is most-starved over budget (cyc 44, starved-for 7 > 3 at cyc 51; feature cyc
  46 starved-for 5 > 4 also over — bug wins by raw starved-for) → take a decided standalone bug. #11
  (mobile fuel-stat wrap, UI + screenshot — but Playwright is sandbox-blocked here, so a logic/source
  fix + the markup is the floor) is the main decided one; #14/#16 still await Angelo's semantics calls.
  Then `feature` → maintenance-schedule T9 e2e + the deferred vehicle-stats reconcile (the last pieces).
- **C51 (bug — #5: CSV import strips a leading UTF-8 BOM)** — `bug` most-starved over budget (cyc 44,
  starved-for 7 > 3 at cyc 51; feature also over at 5, bug won by raw starved-for). FIRST completed the
  squash-merge rebase that interrupted last cycle: `origin/main` got #107 (squash of C1–C48) + 2
  dependabot bumps, but it did NOT absorb C49/C50 source. Confirmed the divergence was only 11 files in
  TWO DISJOINT sets — 4 dependabot files (main ahead) vs 7 of my files (branch ahead, C49+C50 + loop
  docs), zero overlap — via `diff --stat` + `--diff-filter=AD` (no add/delete). Reset onto new main,
  overlaid the 7 branch-ahead files from the backup ref (one path per checkout), verified BOTH gates
  green against main's newer deps, committed `eb1c059`, force-pushed-with-lease (pinned to the observed
  remote SHA) — branch now 0/0 with remote. Then popped the C51 stash (import-csv.ts identical old-tip
  vs new-main, clean apply) and finished the fix: added `bom: true` to the csv-parse options in
  buildImportPlan. WHY: the export's first column is `date`; a BOM-prefixed re-save (Excel/Sheets/Numbers)
  keys it as "﻿date" → record.date undefined → EVERY row fails a misleading "Invalid date". Anchored
  with a real-stack HTTP regression in import-csv.test.ts (BOM-prefixed CSV imports cleanly; pre-fix it
  would be imported:0/errorCount:1). Verified: validate:local EXIT 0 (tsc 0 · musl-biome clean · 962
  pass/0 fail, +1 · build bundled). Next cycle (52): recompute all 6 from this table — `deep-review` (cyc
  49, starved-for 3) and `feature` (cyc 46, starved-for 6 > 4, OVER) lead; feature wins → maintenance T9
  e2e + the deferred vehicle-stats reconcile. #11 (mobile fuel-stat wrap) + #14/#16 (Angelo) still queued.
- **C52 (feature — maintenance-schedule T3 part 3: the deferred vehicle-stats reconcile)** — added the
  canonical all-time `currentOdometer` to GET /vehicles/:id/stats via the D2 `getCurrentOdometer(id)`
  helper (all-sources MAX: expenses ∪ manual odometer entries, period-INDEPENDENT). ADDITIVE — existing
  `currentMileage` (period-filtered + fuel-only) is untouched, so zero behavior change to current
  consumers. Frontend `VehicleStats` type gained the optional field + doc-comments distinguishing the two.
  Anchored by a NEW real-stack HTTP test (vehicle-stats-current-odometer.test.ts, 4 cases) pinning the two
  properties that separate it from currentMileage: period-independence (a 7d window that zeroes
  currentMileage leaves currentOdometer intact) + cross-source MAX (a manual 18000 entry that the fuel-only
  stat ignores). Backend property test had ZERO currentMileage assertions, so nothing pre-pinned this.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 966 pass/0 fail, +4 · build bundled);
  frontend validate:local EXIT 0 (tsc 0 · build · 355 tests). NOTE → Angelo (sent): two follow-ons surfaced
  here — (1) lease/loan miles-used CONSUME the period-scoped `currentMileage`, so a non-'all' stats period
  silently understates overage; switching those consumers to `currentOdometer` is the real fix (a bug, but
  user-visible $ change). (2) Whether the "Current Mileage" stat CARD should stay period-scoped or show the
  true odometer is a display-semantics direction call. Both deferred — not blocking. Next cycle (53):
  recompute all 6 — `deep-review` (cyc 49, starved-for 4) and `infra` (cyc 47, starved-for 6 = budget) lead;
  deep-review likely wins. T9 (e2e + eyes-on) remains Playwright-sandbox-blocked here.
- **C53 (infra — refresh stale CLAUDE.md orientation post-C52)** — recomputed all 6: nothing strictly
  OVER budget; `infra` was most-starved AT budget (6 = 6, breaches next cycle), so took the recurring
  highest-leverage infra item (the orientation-doc refresh, last done C47). VERIFIED the drift before
  acting: CLAUDE.md "Current state" listed the vehicle-stats reconcile (T3-part-3) as REMAINING, but C52
  shipped it — a fresh agent would re-do completed work. Rewrote that line to "T3-part-3 DONE (additive
  currentOdometer); remaining T9 only", noted the two Angelo-flagged follow-ons (lease/loan consumer bug +
  card display call), and bumped the stale test floors (~962→966 be / ~345→355 fe). Doc-only — working
  tree carried only CLAUDE.md, no build gate needed. Next cycle (54): `deep-review` most-starved
  (cyc 49, starved-for 5 = budget) → likely an eyes-on/logic review (T9 e2e still Playwright-blocked).
- **C54 (deep-review — CONFIRM + trace the C52-suspected lease/loan miles-used bug)** — the two top
  deep-review queue items are eyes-on screenshot passes (Playwright-sandbox-blocked), so took the
  actionable highest-leverage target: rigorously verify the bug I flagged to Angelo in C52. TRACED end
  to end against source: `FinanceTab.svelte` passes `vehicleStatsData?.currentMileage` to both
  `PaymentMetricsGrid` (loan mileageUsed, ~L151) and `LeaseMetricsCard` (→ `calculateLeaseMetrics`, ~L173);
  `vehicleStatsData` is fetched with the user-controlled `selectedStatsPeriod` (default 'all', so the
  default is correct) via the Overview PeriodSelector → `$effect` refetch (L173-185); `currentMileage` is
  period-filtered + fuel-only. CONFIRMED: choosing 7d/30d on Overview silently understates lease overage /
  loan miles-used (and ignores manual odometer entries). `calculateLeaseMetrics` itself is correct +
  well-tested (lease-metrics.test.ts) — the defect is purely the call-site source. Fix = swap to the C52
  all-time `currentOdometer`, but it's a USER-VISIBLE $ change already flagged to Angelo → did NOT execute
  (loop rule 7). Increment: behavior-preserving inline NOTE breadcrumbs at BOTH FinanceTab call sites + a
  first-class, traced, ready-to-execute bug entry in BACKLOG (promoted from a buried C52 feature-note line).
  Comment-only; frontend validate:local EXIT 0 (tsc 0 · build · 355 tests · prettier clean). Next cycle
  (55): recompute all 6 — `guard` most-starved (cyc 48, starved-for 7 > 6, OVER) → it wins.
- **C55 (guard — FE↔BE contract-drift lock on the /stats response shape)** — implements loop-improvement
  proposal #2 (the contract-drift guard Angelo flagged top-2) for the freshest surface. The /stats response
  is hand-assembled in routes.ts (`c.json({ period, ...stats, currentOdometer })`) with ZERO type binding to
  the frontend `VehicleStats` contract it must satisfy: backend `calculateVehicleStats` returns only 11
  fields, the route adds `period` + `currentOdometer` separately (C52 added the latter to BOTH sides
  independently — exactly the drift class). A refactor returning the calculator output directly, or
  dropping/renaming a field, would silently diverge and the UI reads `undefined`. Added 3 HTTP cases to
  vehicle-stats-current-odometer.test.ts asserting `Object.keys(data).sort()` EXACTLY equals
  EXPECTED_STATS_FIELDS (the 13-field frontend contract, mirrored as the pin) — bidirectional: a dropped
  key AND an unmirrored added key both fail; proven shape-stable across empty/populated and all 5 periods.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 969 pass/0 fail, +3 · build bundled).
  Next cycle (56): recompute all 6 — `bug` most-starved over budget (cyc 51, starved-for 5 > 3) → it wins;
  but the top bug (lease/loan miles-used) is PENDING ANGELO, so pick the next decided bug (#1 vehicle-detail
  load-failure-masquerades-as-empty, or #3 ExpensesTable dead h-[] class).
- **C56 (arch — #1 part 2d: VERIFIED auth already-converged → arch #1 CLOSED)** — BALANCE NOTE: recomputed
  all 6; arch (cyc 50, starved-for 6) outranked bug (cyc 51, starved-for 5) by raw starved-for — the C55
  forecast said "bug" but slow-budget arch breached higher (the standing mis-forecast lesson; always
  recompute). Took arch #1 part 2d (the last route file, `auth`). GROUNDING CORRECTION: the BACKLOG's "7
  hand-rolled try/catch, characterize-then-drop" premise was WRONG. Read every block in auth/routes.ts: the
  error-surfacing handlers (`/me`, `/refresh`, `PATCH /me`, `/providers/connect`) ALREADY throw HTTPException
  directly with NO try/catch, and the central errorHandler shapes HTTPException (error-handler.ts:43) → already
  on the canonical envelope. The 5 try/catch that exist are business-logic recovery/redirect that MUST stay
  (UNIQUE-constraint recovery L164/L206, OAuth token-exchange → specific redirect outcomes L368/L837, JSON
  guard L472) — dropping any is a behavior change. So NO drop; auth is converged. Increment = correct the
  BACKLOG premise + CLOSE arch #1 + a merge-surviving convergence guard: +4 PATCH /me cases in me-http.test.ts
  pinning the 400 paths surface through the central handler in the canonical envelope (code 'HTTPException').
  The positive control caught a real shape assumption (data.user.displayName, not data.displayName) — fixed
  before commit. Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 973 pass/0 fail, +4 ·
  build bundled). arch #1 DONE (sync C36 + settings C50 dropped; auth verified). Next cycle (57): recompute —
  `bug` most-starved over budget (cyc 51, starved-for 6 > 3) → wins; top bug PENDING ANGELO, take next decided
  (#1 load-failure-masquerade or #3 ExpensesTable dead h-[] class).
- **C57 (bug #1 — vehicle-detail load failure masquerades as empty state)** — top bug (lease/loan miles-used)
  is PENDING ANGELO, so took the next decided one. VERIFIED against source: `loadSummary` (Overview) and
  `fetchExpensesPage` (Expenses tab) in vehicles/[id]/+page.svelte only toast on failure, leaving
  `summary=null` / `expenses=[]` → the Overview renders "No expenses yet" and the Expenses tab renders the
  empty table, so a returning user whose fetch failed thinks their data vanished (NORTH_STAR four-states:
  error ≠ empty). Fix mirrors the proven dashboard/analytics idiom: added `summaryLoadError` +
  `expensesLoadError` flags (set in each catch, cleared at the top of each load), and error+retry branches
  that take PRECEDENCE over the empty states (`{#if error && !isLoading} … {:else if !hasData}`). Retry
  re-invokes the same loader; period-change/delete paths already call the loaders (which clear the flag), so
  recovery is clean. Verified: frontend validate:local EXIT 0 (tsc 0 · build · 355 tests · prettier clean).
  CAVEAT (same as T7/T8): UI-state change, eyes-on screenshot Playwright-sandbox-blocked here — but the
  error-over-empty precedence is a pure tsc-checked conditional mirroring a shipped pattern. Next cycle (58):
  recompute all 6 — `feature` most-starved over budget (cyc 52, starved-for 6 > 4) → wins; only T9 (e2e +
  eyes-on, Playwright-blocked) remains on maintenance-schedule, so likely import-trackers T1 (the other
  approved spec) OR flag T9's blocker. arch #1 is closed; #2 (frontend load-state extraction) now has C57 as
  a second concrete instance motivating it.
- **C58 (feature — import-trackers T1: the translation pre-pass)** — maintenance-schedule has only T9 left
  (Playwright-blocked), so opened the OTHER approved spec (import-trackers, backend-first per its tasks.md).
  T1 = `import-mapping.ts`: pure `ColumnMapping` type + `applyMapping(foreignCsv, mapping, target)` →
  VROOM-NATIVE CSV that the EXISTING `buildImportPlan` consumes UNCHANGED, so all downstream safety (per-row
  validation, formula denormalize, cross-tenant vehicle resolution, idempotent re-import, atomic commit) is
  inherited free. Implements rename + unit-convert INTO the target vehicle's units (D1, reuses
  unit-conversions.ts) + decimal-comma + category map (unmapped→misc + a VISIBLE `unmappedCategories` note,
  D2) + local-time date normalization across iso/mdy/dmy/epoch (D3, the cycle-6/11 discipline — never
  `new Date('YYYY-MM-DD')`) + no-vehicle-column → targetVehicle (D4). Pure (no DB/Hono), fully additive — the
  native import path is untouched and stays the default when no mapping is sent. 14 unit tests incl. the
  load-bearing applyMapping→buildImportPlan round-trip (a Fuelio-shaped metric file maps+converts into a
  plan that imports clean) + the timezone-independent local-day invariant. tsc caught an optional-chain
  arithmetic null (exp?.date.getMonth()+1) — narrowed with a guard, no non-null assertion (repo lints it).
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 987 pass/0 fail, +14 · build bundled).
  Next (59): recompute all 6 — `deep-review` most-starved (cyc 54, starved-for 5 = budget) likely wins;
  T2 (presets + detectSource) is the next import-trackers increment when feature comes due again.
- **C59 (infra — land the pre-authorized NORTH_STAR loop-improvement #3 straggler)** — BALANCE: nothing
  strictly OVER; `infra` most-starved AT budget (cyc 53, starved-for 6 = 6, breaches next), and a verified
  uncommitted doc edit was already sitting in the tree, so landing it IS the cleanest infra increment (a
  dangling pre-authorized edit risks being lost or bundled into unrelated work). Angelo ratified loop-improvements
  #2–#5 on 2026-06-09; the #3 rollout was split — its BACKLOG "FEATURE DoD" pair committed C57, but the
  NORTH_STAR quality-bar half was cut by a 503. This adds the FE→BE→DB→render E2E feature-DoD sentence to
  NORTH_STAR §3 (a green build is the FLOOR; a new capability isn't done until one round-trip E2E exercises
  the FE↔BE seam where integrated bugs hide — harness-blocked → "code-complete, eyes-on pending", not done),
  making the vision file consistent with the already-committed BACKLOG/LEDGER halves. NOT a self-authored
  vision change — it's the approved edit, verified against the #3 wording before landing. Also confirmed (the
  cheap half of the #5 cadence): zero stray untracked `*.test.ts` outside the by-design `*.meshclaw.e2e.ts`
  set, so no coverage is silently dropping on merge. Doc-only, no build gate. ALL FIVE loop-improvements now
  landed (#1 Playwright-unblock still needs live shell; #2 contract-guard shipped C55; #3 here; #4 coverage-
  trend note; #5 branch-hygiene cadence). Next (60): recompute — `deep-review` most-starved (cyc 54, starved-
  for 6 > budget 5, now OVER) → wins; a correctness/eyes-on review of a shipped surface (C58 import-mapping is
  freshly landed but self-authored — higher independent value to review the vehicle Overview/ExpensesTable).
- **C60 (deep-review — adversarial audit of C58 import-mapping.ts)** — both queued deep-reviews (#1 vehicle
  Overview, #2 analytics) are eyes-on/Playwright-blocked, so took the highest-leverage EXECUTABLE review: a
  backend correctness audit of the freshest un-reviewed surface — C58's self-authored `import-mapping.ts`
  (real edge-case logic in unit-convert/decimal/date parsing, zero independent review). VERDICT: CORRECT for
  its documented contract — no defect. Pinned two verified-but-uncovered branches with characterization
  guards (NORTH_STAR #5): (a) an ISO value with an explicit tz (Z or ±hh:mm) is honored as an absolute
  instant — the ONE date branch that must NOT use local-time construction; (b) the non-finite-mapped-value
  contract — mapVolume/mapMileage pass garbage through verbatim so it surfaces as a normal buildImportPlan
  per-row error, never a whole-file crash. Running the focused test FIRST confirmed both assumptions held
  (verify-against-source). +3 tests (987→990). Surfaced two latent T3-WIRING risks (not C58 defects, noted
  in BACKLOG): applyMapping's `target` defaults to {} (T3 must pass the vehicle's units or values store
  unconverted-but-relabeled), and normalizeDecimal treats a lone comma as decimal (a manual US-thousands
  mapping would corrupt — fine once presets cover it). Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 990 pass/0 fail · build bundled). Next (61): recompute — `guard` most-starved (cyc 55,
  starved-for 6 = budget 6, AT) likely; bug AT (cyc 57, 4>3 OVER) jumps if a real defect is queued.
- **C61 (bug #6a — CSV-import date-only midnight-UTC day-shift)** — `bug` OVER (cyc 57, starved-for 4 > 3,
  tightest budget). Top bug (lease/loan) PENDING ANGELO, so took the next decided one. VERIFIED against
  source: `parseDate` (import-csv.ts) did `new Date(raw)` — a bare `YYYY-MM-DD` (hand-edited or foreign file,
  not our own export which writes full ISO) parses as UTC midnight → the calendar day rolls BACK for any user
  west of UTC (the cycle-6/11 class, native-import twin of the C58 normalizeForeignDate fix). Fix: detect
  date-only via `^\d{4}-\d{2}-\d{2}$` and build from parts in LOCAL time; full-ISO + any other parseable
  string keep their absolute-instant semantics via `new Date`. +2 HTTP tests (date-only keeps local day in
  any CI zone via the timezone-independent local-getter invariant; full-ISO instant un-regressed). The
  bundled "#6b currency column silently ignored" half was INVESTIGATED + DISMISSED (not a bug): currencyUnit
  is a USER-SETTINGS field (schema.ts:303), not per-expense — amounts store as bare numbers in the user's
  single currency, so the export's `currency` column is informational and ignoring it on re-import is correct.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 992 pass/0 fail, +2 · build bundled).
  Next (62): recompute — `guard` most-starved (cyc 55, starved-for 7 > 6, now OVER) → wins; the queued guard
  is generalizing the FE↔BE contract-drift lock (loop-improvement #2) to another hand-assembled response.
- **C62 (guard — extend the FE↔BE contract-drift lock to GET /vehicles list)** — `guard` most-starved
  (cyc 55, starved-for 7 > 6, OVER). Continued loop-improvement #2 (C55 locked /stats). PICKED the highest-
  leverage drift surface: the /vehicles list route hand-assembles each financed vehicle (routes.ts:140-153),
  spreading the repository financing row and INJECTING two computed fields the repository never stores —
  `computedBalance` (financingRepository.computeBalances) + `eligibleForPayoff`. The frontend `VehicleFinancing`
  contract (vehicle.ts:65-66) declares both, and the FE reads `computedBalance` for payoff-date math, the
  payment planner, lease metrics, and the financing-form payoff display — yet NOTHING pinned the route still
  emits them (a refactor returning findByUserId raw would silently drop both → every consumer falls back to
  `?? 0` → payoff logic breaks with no failing test). New vehicles-list-financing-contract.test.ts (3 cases):
  computed keys present + typed + base fields survive the spread; a fresh 20k loan is NOT eligible-for-payoff
  (anchors the computed SEMANTICS, not just key presence); a no-financing vehicle omits the object. A wrong
  seed path (mounted at /api/v1/financing/vehicles/:id/financing, not /api/v1/vehicles/:id/financing) failed
  the test LOUDLY first — proof it exercises the real enrichment branch, not a vacuous pass. Verified: backend
  validate:local EXIT 0 (tsc 0 · musl-biome clean · 995 pass/0 fail, +3 · build bundled). Next (63): recompute
  — `arch` most-starved (cyc 56, starved-for 7 > 5, OVER) → wins; arch #1 closed, so it's arch #2 (frontend
  load-state extraction, now with C57 + the C3 vehicle-detail pattern as concrete instances) or an audit fan-out.
- **C63 (arch #2 step 1 — extract the frontend load-state scaffold)** — `arch` most-starved (cyc 56,
  starved-for 7 > 5, OVER). arch #1 CLOSED, so arch #2 (the ~14-page `isLoading`/`loadError`/try-catch-toast
  triad — the exact class the bug queue keeps re-finding as load-failure-masquerades-as-empty). The full
  per-page MIGRATION is UI-touching → eyes-on-blocked here, so per arch rule 3 (build the safety-net/scaffold
  FIRST, migrate next cycle against it) this cycle extracted ONLY the primitive: `createLoadState<T>()` in
  `load-state.svelte.ts` — `data`/`isLoading`/`error`/`isError` getters + `run(loader)` reproducing the
  try/catch/finally verbatim (onError side-effect, `e instanceof Error ? .message : fallback`, prior-data-kept-
  on-failure, isLoading reset in finally) + `set`/`clearError`. No page touched → behavior-preserving by
  construction (new unused module), no eyes-on needed. 10 unit tests pin the contract a later migration will
  rely on. NOTABLE: this established `.svelte.ts` rune modules ARE unit-testable here (zero prior
  `.svelte.test.ts` existed — confirmed runes compile under the `sveltekit()` vitest plugin with synchronous
  `$state` access, no `$effect`), which de-risks every future arch #2 migration step. Ran the focused test
  FIRST to prove the unproven rune-in-test path before relying on it. Verified: frontend validate:local
  EXIT 0 (tsc 0 · build · 365 tests, +10 · prettier clean). Next (64): recompute — `feature` most-starved
  (cyc 58, starved-for 6 > 4, OVER) → wins; import-trackers T2 (presets + detectSource, pure + unit-tested).
- **C64 (feature — import-trackers T2: tracker presets + detectSource)** — `feature` most-starved (cyc 58,
  starved-for 6 > 4, OVER). Built `import-mapping-presets.ts`: a static `MappingPreset` table for
  Fuelly/Fuelio/Drivvo (D5-ratified set) — each a ready ColumnMapping (columns + dateFormat + units +
  categoryMap) + a header SIGNATURE — plus `detectSource(headers)` (auto-pick the preset) and
  `presetToMapping(preset, targetVehicle)` (→ a valid T1 ColumnMapping). Detection is NORMALIZED (lower-case +
  strip non-alphanumerics) + SUBSTRING-based on a DISTINCTIVE signature subset (Fuelly odometer+fillamount,
  Fuelio odo+litres, Drivvo totalprice+typeoffuel) so real header decoration (`Odo (km)`, BOM, spacing) doesn't
  defeat it and the three don't cross-detect; unknown files → null (safe → manual mapping). GROUNDING CALL:
  D5 ratified the SET but the requirements don't pin exact header strings, and the design defers real-export
  validation to T6 — so rather than fabricate exact signatures (a wrong one = silent never-match), I built the
  MECHANISM with drift-tolerant matching + flagged real-export validation as a T6 prerequisite (mis-detect is
  the safe failure). Caught + fixed my own first-draft bug pre-test: exact-token matching would've made Fuelio
  (`Data`/`Odo (km)`) never match — switched to substring. 10 unit tests incl. the self-consistency check
  (every preset detects its OWN seeded columns), no-cross-detect, drift tolerance, and a presetToMapping→
  applyMapping round-trip. Pure module, fully additive. Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 1006 pass/0 fail, +10 · build bundled). Next (65): recompute — `infra` most-starved
  (cyc 59, starved-for 6 = budget 6, AT) likely; deep-review (cyc 60, 5=5 AT) close behind.
- **C65 (bug #3 — ExpensesTable dead interpolated `h-[{scrollHeight}]` class)** — recompute: `bug` was the
  only STRICTLY-over category (cyc 61, starved-for 4 > 3) — infra+deep-review only sat AT budget — so bug won
  by the tightest-over rule (NOT infra as the C64 forecast guessed; the standing mis-forecast lesson). Top bug
  (lease/loan) PENDING ANGELO → took #3 (decided, fully verifiable). VERIFIED against source: ExpensesTable
  line 657 `<ScrollArea class="h-[{scrollHeight}] w-full">` — Tailwind only emits arbitrary-value utilities it
  sees as STATIC literals at build time, so a runtime-interpolated `h-[{scrollHeight}]` generates NO rule →
  the 600px cap + internal scroll never engaged → a many-row vehicle grew unbounded (CONFIRMED C14 via DOM
  probe). Fix: inline `style="height: {scrollHeight}"` (ScrollArea spreads style to the DOM; the ChartCard
  idiom). MERGE-SURVIVING GUARD (quality-bar #5): `no-interpolated-arbitrary-class.test.ts` source-scans every
  `.svelte` for `<util>-[…{…]` (static `h-[600px]` never matches; comment-strip so the explanatory comment
  quoting the dead pattern doesn't self-trip). VERIFIED THE C14 "harmless charts" CLAIM against source: the
  two `h-[{CHART_HEIGHT}px]` ARE the same dead class but masked (each passes `height={CHART_HEIGHT}` to its
  ChartCard wrapper, which sets the real height) → excluded with a documented anchor, not edited (avoids a
  blocked eyes-on chart change). frontend validate:local EXIT 0 (tsc 0 · build · 367 tests, +2 · prettier
  clean). CAVEAT: eyes-on Playwright-blocked; fix is tsc/build-verified + the proven idiom. Next (66): recompute
  — `infra` (cyc 59, 7 > 6, OVER) + `deep-review` (cyc 60, 6 > 5, OVER) both over; infra most-starved → wins.
- **C66 (infra — #5 branch-hygiene sweep: BRANCH_REVIEW.md refresh)** — `infra` most-starved (cyc 59, 7 > 6,
  OVER); the standing #5 cadence (every ~10 cycles, 60+ commits deep toward one human PR) had NEVER run as a
  full sweep (C59 did only the cheap untracked-test half). Three parts: (1) stray untracked unit tests OUTSIDE
  the by-design `*.meshclaw.e2e.ts` set — ZERO (clean); (2) green baseline — regress.sh Playwright-blocked, so
  backend+frontend validate:local stand in (1006 BE + 367 FE, all green this arc); (3) BRANCH_REVIEW.md
  refresh — it was BADLY stale: described the OLD `feat/offline-entries` branch at 154 commits, but that work
  was squash-merged into origin/main and claude-loop-dev was rebased onto the squash (eb1c059), so the live
  branch is only 16 commits (C51–C65, 28 files +2339/−202) cleanly off origin/main. Rewrote the digest from
  REAL `git log origin/main..HEAD` (not memory): correct branch/scope/base, themed by feature(import T1+T2,
  stats reconcile)/bug(BOM, load-masquerade, date-only, dead-class)/guard(×3)/arch(#1 closed, #2 scaffold)/
  deep-review, with the eyes-on-pending UI fixes + the two Angelo-pending decisions called out for the
  reviewer. BRANCH_REVIEW.md is gitignored → not in the commit (only the loop docs are). Verified: doc-only,
  no build gate; git facts confirmed via rev-list/diff/log. Next (67): recompute — `deep-review` most-starved
  (cyc 60, starved-for 7 > 5, OVER) → wins; an executable backend audit or (if unblocked) an eyes-on sweep.
- **C67 (deep-review — audit the unpinned analytics-charts.ts builders)** — `deep-review` most-starved (cyc
  60, 7 > 5, OVER). Both queued eyes-on sweeps are Playwright-blocked, so took the highest-leverage EXECUTABLE
  review: the analytics pure-math layer (the richest historical defect vein — C7/C11/C14/C23). Found 6
  date/bucketing builders with ZERO test references (buildDayOfWeekPatterns, buildSeasonalEfficiency,
  buildMonthlyCostHeatmap, computeRegularityScore, computeMileageScore, computePreviousYearComparison).
  FAN-OUT: 2 parallel Explore agents on distinct subsets + I read the date-sensitive ones directly. VERDICT:
  CORRECT — no real defect. Both agents flagged `accumulateIntervalBuckets`'s in-place `vehicleRows.sort()`
  as a HIGH "cross-chart side-effect" bug; per the standing C21/C60 rule (verify agent findings against
  source — most "HIGH" ones are false positives) I checked the blast radius MYSELF: the sorted array is a
  FRESHLY-GROUPED LOCAL array inside buildFillupIntervals (byVehicle map of new arrays), NOT the caller's
  fuelRows — and the route's only other consumer of that same fuelRows (buildDayOfWeekPatterns) buckets by
  getDay(), order-independent. So NO observable bug → downgraded. Still applied a defensive `[...vehicleRows]`
  copy (behavior-identical hygiene, keeps the helper pure against a future caller) + locked all 6 with
  characterization tests (analytics-charts-unpinned.test.ts, 15 cases: empty/single-elem no-NaN, divide-by-
  zero guards, the newest-24-months slice direction = NOT the C11 oldest-bug, the no-mutation invariant).
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1021 pass/0 fail, +15 · build bundled).
  Next (68): recompute — `guard` most-starved (cyc 62, starved-for 6 = budget 6, AT) likely; arch (cyc 63,
  5=5 AT) + feature (cyc 64, 4=4 AT) also AT — recompute all 6 at cycle start (slow-budget mis-forecast risk).
- **C68 (guard — lock the single-financing GET enriched contract)** — BALANCE: four categories sat exactly
  AT budget (feature 4=4, bug 3=3, guard 6=6, arch 5=5), none STRICTLY over. Tie-break: the top decided bug
  (#2 vehicle-detail page-local filter) is UI-touching → eyes-on-blocked, and the lease/loan bug is PENDING
  ANGELO, so the highest-leverage FULLY-VERIFIABLE pick was `guard` (also most-starved at 6). Continued
  loop-improvement #2: the single-financing GET (`/financing/vehicles/:id/financing`) runs `enrichWithBalance`
  (routes.ts:82), injecting the SAME `computedBalance` + `eligibleForPayoff` as the C62 /vehicles list — but
  on a SEPARATE surface (the one FinanceTab fetches directly), with no guard. A refactor returning the raw row
  would drop both → FE payoff math falls back to `?? 0` silently. New financing-get-contract.test.ts (3 cases:
  computed keys present + typed + base fields survive the spread; fresh 20k loan NOT eligible-for-payoff =
  the computed SEMANTICS; no-financing → data:null). Used the correct `/api/v1/financing/vehicles/...` mount
  path (the C62 doubled-path lesson). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean ·
  1024 pass/0 fail, +3 · build bundled). Next (69): recompute — `arch` (cyc 63, starved-for 6 > 5, now OVER)
  + `feature` (cyc 64, 5 > 4, OVER) both over; arch most-starved → arch #2 step 2 (migrate a page onto
  createLoadState — UI-touching/eyes-on) OR an audit-fan-out arch item if a non-UI one surfaces.
- **C69 (arch — dedup the stats-period → start-date switch)** — `arch` most-starved (cyc 63, 6 > 5, OVER).
  arch #2 step 2 (page migration onto createLoadState) is UI-touching → eyes-on-blocked, so per rule 7 I
  fanned out 2 Explore agents for a NON-UI backend target. Picked DEDUP over the agents' other find: the
  identical period→Date day-offset switch was copy-pasted in vehicles/routes.ts (stats filter) +
  expenses/repository.ts (query filter). Extracted `getPeriodStartDate(period, now?)` + `StatsPeriod` to
  utils/calculations.ts ('all'→null, bounded→now−N days); wired both sites; expenses keeps its `?? new
  Date(0)` defensive fallback (behavior-identical — unreachable for the fixed enum). VERIFIED the agents'
  "subtle default divergence" worry against source (C21/C60 rule): the `new Date(0)` vs `null` defaults sit
  in never-reached branches (behind `period!=='all'` / the 'all' case), so the extraction is safe. +5 unit
  tests for the helper; both call sites' EXISTING property tests stayed green = the green→green
  behavior-preserving proof (arch rule 3). REJECTED the 2nd agent finding (delete dead handleSyncError): it's
  the byte-identical ORACLE the C24 equivalence test asserts against — deleting it is churn-for-churn (arch
  rule 5: name a payoff), not a win. Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean ·
  1029 pass/0 fail, +5 · build bundled). Next (70): recompute — `feature` (cyc 64, starved-for 6 > 4, OVER)
  + `bug` (cyc 65, 5 > 3, OVER) both over; bug has the tighter budget → likely bug, but its top items are
  PENDING ANGELO (lease/loan) / UI-eyes-on (#2 filter) — may need feature (import-trackers T3) instead.
- **C70 (feature — import-trackers T3: the backward-compatible route extension)** — BALANCE: `bug` + `feature`
  both OVER; bug is tighter (3) BUT its queue is fully blocked (lease/loan PENDING ANGELO; #2 filter is
  UI-eyes-on; #4 cosmetic) — no executable decided bug, so took the next-most-starved ACTIONABLE category,
  `feature` (the don't-force-a-blocked-pick rule). Extended `POST /import` with an optional `mapping` (new
  Zod `columnMappingSchema` in import-mapping.ts): when present → resolve the target vehicle's units from its
  unitPreferences → `applyMapping` → the EXISTING buildImportPlan/dryRun/importExpenses flow UNCHANGED (no new
  write path; idempotency/atomicity/tenant-safety all inherited). Added `unmappedCategories` to the response
  + a new `POST /import/detect` (header names → preset|null) for the client. BACKWARD-COMPAT: no mapping →
  native path byte-identical. C60 WIRING RISK HANDLED: units convert toward the resolved targetVehicle (a
  `resolveTargetUnits` helper matching nickname / "year make model"); no match → {} → conversion skipped
  (never a guessed unit). PROVE-IT-BITES PAID OFF: running the focused test FIRST caught a real schema bug —
  `z.record(z.enum(NativeField), …)` is EXHAUSTIVE in Zod v4 (rejected a partial `columns` object, 400'd
  every mapped import) → rewrote `columns` as explicit per-field optionals. 9 HTTP tests (preview/commit,
  metric→imperial conversion, idempotent re-import, unmapped-category surface, malformed-row per-row,
  unparseable→400, detect preset/null, native backward-compat). Verified: backend validate:local EXIT 0
  (tsc 0 · musl-biome clean · 1038 pass/0 fail, +9 · build bundled). NOTE: backend of import-trackers
  (T1–T3) is now COMPLETE, but the feature is NOT done until the T6 FE→BE→DB round-trip e2e runs (feature-DoD
  rule); T4–T6 are frontend/eyes-on, Playwright-blocked here. Next (71): recompute — `bug` (cyc 65, 6 > 3,
  OVER, tightest) + `deep-review` (cyc 67, 4 = budget... under) — bug most-starved but STILL blocked; if no
  executable bug, `infra` (cyc 66, 5 > ... ) / `guard` are the actionable fallbacks. Recompute all 6 live.
- **C71 (bug #15 — correct the false "optimistic-locked" mark-serviced claim)** — `bug` the ONLY over-budget
  category (cyc 65, starved-for 6 > 3) so I MUST pick it; re-examined the whole queue for an executable item
  rather than fall back. Findings: #2/#4/#11 are UI-eyes-on-blocked; #7 (analytics local-tz getMonth) is NOT
  a clean fix — VERIFIED toMonthKey AND monthKeysInRange are BOTH local-time + match the frontend's C6
  local-time intent, so "bucket on UTC" would INTRODUCE a divergence (a direction call, not a bug); #14/#16/
  #17 are PENDING DECISION. The one decided, fully-verifiable, no-eyes-on item was #15 (doc-accuracy). Took
  the lighter option (correct the claim, not add a CAS guard — no data risk: concurrent mark-serviced calls
  compute the SAME re-armed values from the same row, so CAS would only collapse a redundant write). VERIFIED
  the false claim's LOCATION against source: repository.ts markServiced comment was ALREADY accurate
  ("ownership-scoped"), the route had NO claim — the overclaim lived ONLY in design.md:83. Rewrote it to the
  real ownership-scoped single-statement update + why no CAS is needed. Doc-only, no build gate. NOTE: the
  bug queue is now structurally stuck — every remaining bug is either eyes-on-blocked, PENDING ANGELO, or a
  semantics decision; `bug` will keep coming up most-starved-but-unactionable until Angelo unblocks lease/loan
  or #14/#16. FLAGGED again this cycle. Next (72): recompute — `deep-review` (cyc 67, 5 = 5 AT) + `infra`
  (cyc 66, 6 = 6 AT) likely lead; both actionable (executable backend audit / loop-doc upkeep).
- **C72 (infra — refresh stale CLAUDE.md orientation post-C58–C71)** — BALANCE: nothing strictly OVER;
  `infra` + `deep-review` both AT budget, `infra` most-starved (breaches next). Took the recurring
  highest-leverage infra item (orientation-doc refresh, last C53/C66) since it was genuinely stale and a
  fresh agent reads CLAUDE.md first. VERIFIED the drift against source before editing: (1) import-trackers
  was listed "approved, NOT STARTED (T1+)" but T1 (C58) + T2 (C64) + T3 (C70) shipped — backend COMPLETE;
  rewrote to backend-done / T4–T6-frontend-eyes-on-remaining, mirroring the maintenance-schedule entry's
  honest DoD framing. (2) test floors cited "~966 be / ~355 fe" — now 1038/367 (+72/+12 across C52–C71);
  bumped. Doc-only, no build gate (working tree carried only CLAUDE.md). Next (73): recompute — `deep-review`
  (cyc 67, starved-for 6 > 5, now OVER) → wins; an executable backend correctness audit of a fresh surface
  (the C70 route extension is freshly-landed + self-authored — higher independent value than re-reviewing it,
  so likely the insurance/financing analytics math or another unpinned repository path).
- **C73 (deep-review — audit the unpinned insurance analytics path)** — `deep-review` most-starved (cyc 67,
  6 > 5, OVER). Both queued eyes-on sweeps Playwright-blocked → took the highest-leverage EXECUTABLE review:
  getInsurance/buildInsuranceDetails (analytics/repository.ts), which had ZERO test coverage AND carries the
  open #14 question. Read against source: cost-shape handling CORRECT (bug #8 effectiveMonthlyPremium — both
  explicit monthlyCost and amortized totalCost paths non-zero), latest-term-by-endDate + inactive-policy
  exclusion correct. CONFIRMED #14: the latest term is picked by endDate descending with NO endDate >= now
  check, so an active policy whose latest term LAPSED still adds its stale premium — a SEMANTICS call (pending
  Angelo), NOT a unilateral fix (rule 7). Increment = pin the CURRENT behavior with insurance-details.test.ts
  (6 cases through public getInsurance over a real in-memory DB: monthly + amortized cost shapes, latest-term
  wins, inactive excluded, the #14 expired-term-counted case flagged as the one to flip, empty-state) — so a
  future #14 decision is a safe change against a net. Also SPOTTED (noted, not fixed): coveredVehicleIds spans
  ALL terms' junctions, not just the latest term's. Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 1044 pass/0 fail, +6 · build bundled). Next (74): recompute — `guard` most-starved (cyc
  68, starved-for 6 = budget 6, AT) likely; arch (cyc 69, 5=5 AT) close. Recompute all 6 live.
- **C74 (guard — lock the /analytics/insurance response contract)** — BALANCE: four categories AT budget
  (guard 6=6, arch 5=5, feature 4=4, bug 3=3), none strictly over; `guard` most-starved (breaches first) AND
  fully actionable (vs bug, still blocked). Continued loop-improvement #2, riding C73's fresh knowledge of
  getInsurance: GET /analytics/insurance hand-assembles a nested `summary` + 3 derived arrays
  (vehicleDetails/monthlyPremiumTrend/costByCarrier) with NO type binding to the frontend `InsuranceResponse`
  (types/analytics.ts:180) — a dropped/renamed key silently breaks the analytics insurance tab. Extended C73's
  insurance-details.test.ts with a drift-guard describe (+2 cases): exact top-level + nested summary keys vs
  the frontend contract (empty AND populated), plus the vehicleDetails (7-key) / costByCarrier (3-key) /
  monthlyPremiumTrend (2-key) array-item shapes. Verified the vehicleDetails keys against
  buildInsuranceVehicleEntries source before asserting (matched exactly). Verified: backend validate:local
  EXIT 0 (tsc 0 · musl-biome clean · 1046 pass/0 fail, +2 · build bundled). Next (75): recompute — `arch`
  most-starved (cyc 69, starved-for 6 > 5, OVER) → wins; arch #2 step 2 (page migration onto createLoadState,
  UI-eyes-on) OR a rule-7 fan-out for a non-UI backend dedup/dead-code target (the C69 pattern).
- **C75 (arch — dedup the query-if-nonempty guard in google-sheets-service)** — `arch` most-starved (cyc 69,
  6 > 5, OVER). arch #2 step 2 is UI-eyes-on-blocked, so per rule 7 fanned out 2 Explore agents (layering +
  complexity — DIFFERENT angles than C69's dup+dead-code, to avoid re-surfacing). Picked the COMPLEXITY find:
  `updateSpreadsheetWithUserData` repeated `ids.length > 0 ? await db.select()…where(inArray(col,ids)) : []`
  4× (insurance terms/term-vehicles/claims/reminder-vehicles). Extracted a typed `queryIfNonEmpty<T>(ids,
  () => query)` private helper (closure form — simpler than the agent's db-passing signature). VERIFIED the
  pattern uniformity against source first (grep'd all `length > 0` — confirmed the financing/odometer
  innerJoins are a different shape, correctly left alone; the only non-inArray hits are unrelated). Behavior-
  identical (skips the pointless `inArray(col, [])` round-trip exactly as before). REJECTED the layering find
  (extract ONE raw db.delete from providers/routes.ts) — the agent itself noted 5 OTHER raw queries stay
  inline there, so extracting one makes the file MORE inconsistent (arch rule 5: no churn-for-churn). PROOF:
  green→green — the google-sheets-service round-trip test passed before+after (in the FULL suite; the
  single-suite run hit the known C38 cross-suite migration flake, NOT my change — canonical gate is full
  validate:local). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1046 pass/0 fail,
  unchanged count · build bundled). Next (76): recompute — `feature` (cyc 70, starved-for 6 > 4, OVER) +
  `bug` (cyc 71, 5 > 3, OVER) both over; feature's T4 is frontend-eyes-on, bug is Angelo-blocked — so likely
  fall back to the most-starved ACTIONABLE (infra cyc 72 / deep-review cyc 73). Recompute all 6 live.
- **C76 (infra — #5 branch-hygiene sweep, BRANCH_REVIEW.md refresh)** — BALANCE: `feature` (cyc 70, 6 > 4)
  + `bug` (cyc 71, 5 > 3) both OVER, but BOTH BLOCKED: re-checked the feature queue against source —
  maintenance T9 (eyes-on) + import-trackers T4 (frontend eyes-on) both Playwright-blocked, recurring-expenses
  (#3) has no spec (drafting one is a flag-Angelo action, and 2 specs are already mid-flight blocked, so a 3rd
  adds queue depth w/o throughput); bug queue Angelo-blocked. So fell back to the most-starved ACTIONABLE:
  `infra` — and the #5 branch-hygiene sweep was explicitly due ("Next sweep due ~C76" per the BACKLOG note,
  last C66, branch now 26 commits). Sweep: (1) stray untracked unit tests outside *.meshclaw.e2e.ts — ZERO;
  (2) green baseline — full validate:local (1046 BE + 367 FE, green; regress.sh Playwright-blocked); (3)
  BRANCH_REVIEW.md (gitignored) refresh — header 16→26 commits / +3589/−287, appended §16 covering C66–C75
  (import-trackers T2/T3, the 2 contract guards, 2 arch dedups, 2 characterization deep-reviews, 2 doc
  refreshes), and corrected the stale "T1+T2 inert until T3" merge note to "backend T1–T3 complete, inert
  until a client sends a mapping". Doc-only (BRANCH_REVIEW gitignored → commit carries only loop docs). NOTE:
  feature + bug remain blocked — the loop has run on guard/deep-review/arch/infra for ~10 cycles; the
  lease/loan unblock (flagged C71, no reply) is still the highest-leverage rebalance. Next (77): recompute —
  `feature` (cyc 70, starved-for 7 > 4) + `bug` (cyc 71, 6 > 3) deepening; if still blocked, deep-review
  (cyc 73, 4 < 5 under... ) / guard / arch are the actionable picks. Recompute all 6 live.
- **C77 (deep-review — trace the unpinned financing-analytics path; file the unblock)** — BALANCE: feature
  (7) + bug (6) deeply OVER but BOTH still blocked (re-verified: a feature-side T6 "extend date guard to
  import-mapping" slice turned out REDUNDANT — C58+C60 already pin normalizeForeignDate, and on this UTC CI
  host any added local-time value-assertion is VACUOUS since UTC-midnight == local-midnight; I WROTE then
  REVERTED that test rather than commit churn). Fell back to the most-starved ACTIONABLE, deep-review.
  TRACED the financing-analytics path: getFinancing → buildFinancingDetails → buildSingleFinancingDetail is
  effectively UNPINNED — its only test (cross-vehicle Property 23) is `test.skip`'d because getFinancing
  dynamically imports the financingRepository SINGLETON whose computeBalance binds to getDb() (real conn),
  not the in-memory test drizzle, so the C73 insurance harness can't reach it; and summary-route.test.ts
  MOCKS getSummary (doesn't exercise real compute). The math has bug surface (monthlyInterestEstimate, the
  C44 field; monthsRemaining clamp; unfinanced→own). Unblocking needs an ARCH DI (inject the repo / optional-
  db param) — bigger than one safe cycle + sign-off — so I FILED it as a traced, ranked deep-review backlog
  item (the C54 pattern) rather than force an awkward singleton-bound test or churn. Doc-only (BACKLOG + loop
  docs; the reverted test left the tree clean). NOTE: 3rd consecutive cycle where feature+bug are blocked and
  the loop runs on the backend-verifiable categories — the lease/loan unblock + an eyes-on/Playwright unblock
  + a branch review (26 green commits) are now the highest-leverage moves, all Angelo's. Next (78): recompute
  — `guard` (cyc 74, starved-for 4) / `arch` (cyc 75, 3) the likely actionable picks; feature/bug still gated.
- **C78 (guard — lock the /analytics/year-end response contract)** — BALANCE: bug (7) + feature (8) deeply
  OVER but still blocked (re-checked: reminders list is a CLEAN repo pass-through, not a drift surface; no
  new executable feature/bug). Took the most-starved ACTIONABLE, `guard`. Continued loop-improvement #2:
  getYearEnd hand-assembles an 11-field object literal (repository.ts:1889) with NO type binding to the
  frontend YearEndResponse (types/analytics.ts:237); the existing Property-24/25 tests pin the MATH but NOT
  the key shape. Added a drift-guard describe to year-end.property.test.ts (+2): exact top-level key set vs
  the frontend contract + the null-not-absent invariant for biggestExpense/previousYearComparison (the FE
  reads them unconditionally). Verified the key set against the YearEndResponse interface before asserting.
  WHILE HERE confirmed + documented that /reminders + /expenses-page are CLEAN repository pass-throughs (no
  route-injected fields → not drift surfaces), narrowing the guard queue to just /analytics per-vehicle.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1048 pass/0 fail, +2 · build bundled).
  Next (79): recompute — `arch` (cyc 75, starved-for 4) likely most-starved actionable; feature (cyc 70, 9) +
  bug (cyc 71, 8) still gated on Angelo. The contract-drift queue is nearly exhausted (1 surface left).
- **C79 (arch — scope arch #2 step 2; record the createLoadState misfit; ESCALATE)** — BALANCE: feature (9)
  + bug (8) extreme-OVER but blocked (5th cycle); most-starved ACTIONABLE = arch (cyc 75, 4). Rather than
  manufacture a 5th marginal guard/dedup (churn — the contract-drift vein is down to 1 surface, the C69/C75
  audit finds are spent, guard was just touched C78), I scoped arch #2 step 2 (the page migration onto the
  C63 createLoadState scaffold) PROPERLY for the first time and found WHY no page has migrated: the scaffold
  wraps ONE `data: T`, but real pages don't fit — vehicle-detail has 2 load pairs entangled with pagination
  + a shared isLoadingStats; dashboard sets ~6 separate $state vars from one fetch. A faithful migration
  would reshape working code for marginal dedup (churn, arch rule 5). RECORDED this as a step-2-blocking
  finding in BACKLOG with two direction-call paths (reshape createLoadState to a data-less {isLoading,error,
  run} pair, or don't retrofit) — a genuine behavior-preserving STRUCTURAL finding that stops a future cycle
  blindly attempting the misfit migration. Doc-only. ESCALATED to Angelo: 5 straight cycles with feature+bug
  blocked, guard/arch veins thinning — the loop has hit honest diminishing returns and the high-leverage
  moves (lease/loan approval, eyes-on/Playwright unblock, branch review, the arch-DI + scaffold-reshape
  direction calls) are all Angelo's. Next (80): if still no input, infra (cyc 76, 4) / deep-review (cyc 77,
  3) are the actionable picks — but flagging that further cycles are low-yield until something unblocks.
- **C80 (guard — lock the LAST contract-drift surface; CLOSE loop-improvement #2)** — feature (10) + bug (9)
  extreme-OVER but blocked (6th cycle). Per the C79 commitment (take a cycle only for a genuinely-clean,
  non-churn increment), found ONE: the final hand-assembled response, getVehicleHealth — a COMPLETING
  increment, not a marginal add. It hand-assembles a 6-field literal (repository.ts:1713) with no type
  binding to the frontend VehicleHealthResponse (types/analytics.ts:199); per-vehicle.property.test.ts pins
  the SCORE MATH (the 0.4/0.35/0.25 weighted formula) but NOT the key shape (the C78 year-end situation).
  Added a drift-guard describe (+2): exact top-level keys vs the frontend contract + a no-data finite-number
  invariant (no NaN escape). Verified vs the VehicleHealthResponse interface + confirmed getVehicleHealth
  queries via this.db (no financing-singleton trap, unlike C77). This CLOSES loop-improvement #2: every
  hand-assembled surface (/stats, /vehicles list, single-financing, /analytics/insurance, year-end,
  vehicle-health) is now key-shape locked; the non-targets (/reminders, /expenses page) verified as clean
  repo pass-throughs. Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1050 pass/0 fail,
  +2 · build bundled). Next (81): with #2 closed AND feature/bug/arch-#2 all blocked, the only actionable
  categories are infra (cyc 76, 5) / deep-review (cyc 77, 4) — and both are thin (sweep done C76, financing
  deep-review arch-DI-blocked). Genuinely at diminishing returns; will hold for a clean increment or re-flag.
- **C81 (infra — measure the real coverage baseline; revive lapsed loop-improvement #4)** — feature (11) +
  bug (10) blocked (7th cycle); most-starved ACTIONABLE = infra. Instead of asserting "infra is thin," I
  VERIFIED a real gap against source: loop-improvement #4 ("end every cycle-log entry with a cov: tag,
  re-measure on guard/arch/bug cycles") had SILENTLY LAPSED — NO entry C52–C80 carried a cov: tag, so the
  "90% ratchet" was tracking nothing and the cited ~74%/~59% baseline was long stale. Ran a real pass both
  sides: backend `bun test --coverage` = 77.8% line / 76.9% func; frontend `vitest --coverage` = 63.7% line
  / 60.6% func / 56% branch — BOTH up from the stale estimates (the test-adding cycles DID move the needle,
  just unmeasured). Recorded the measured baseline in the coverage-trend note + named concrete low spots to
  steer future guard/arch picks (frontend overall; backend timeout.ts 0%, pending-credentials.ts 76%), and
  re-anchored the rule with this entry's cov: tag. Doc-only (the measurement IS the work; suites unchanged at
  1050 BE / 367 FE, all green). HONEST NOTE: this is a real infra fix (a lapsed loop mechanism revived), but
  it doesn't change the broader picture — feature/bug remain Angelo-gated; the high-leverage moves are still
  the lease/loan approval + eyes-on/Playwright unblock + branch review. Next (82): deep-review (cyc 77, 5 =
  budget, most-starved actionable) — but if no clean target, will HOLD rather than churn. cov: be 77.8% / fe 63.7%
- **C82 (deep-review — characterize `withTimeout`, the 0%-coverage timeout utility)** — feature (12) + bug
  (11) blocked (8th cycle); most-starved ACTIONABLE = deep-review (cyc 77, AT budget). The C81 coverage
  baseline turned "deep-review is thin" into a GROUNDED pick: `utils/timeout.ts` was at 0% yet is LIVE in the
  sync backup path (backup-orchestrator, sync/routes) — a hung Drive/Sheets call must fail as a typed
  SyncError, not hang forever. Read it + pinned the 3 race outcomes via timeout.test.ts (+5): the promise
  value wins when it resolves first; a timeout throws SyncError(NETWORK_ERROR) with the "<op> timed out after
  <ms>ms" message; the promise's OWN rejection wins when it rejects first (a real upstream error is NOT
  masked as a timeout) + the 5 OPERATION_TIMEOUTS budgets. Small real timeouts (10ms vs 200ms), no
  fake-timer dep, deterministic. Caught + fixed my own import-path bug pre-gate (../errors → ../../errors
  from the deeper __tests__ dir). timeout.ts 0%→covered — the first concrete ratchet-move on a C81 low spot.
  Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1055 pass/0 fail, +5 · build bundled).
  NOTE: this is real (a live-but-untested utility now pinned), and the C81 baseline gives genuine runway on
  the named low spots (frontend modules, pending-credentials.ts) — so the loop has non-churn coverage work
  for a few cycles. But feature/bug stay Angelo-gated; the high-leverage moves remain the lease/loan approval
  + eyes-on unblock + branch review. Next (83): recompute — arch (cyc 79, starved-for 4) likely; or a guard
  steered to a frontend low-cov module. cov: be ~78% / fe 63.7%
- **C83 (guard — coverage-ratchet the pending-credentials OAuth store, a C81 low spot)** — feature (13) +
  bug (12) blocked (9th cycle); nothing actionable strictly OVER, so highest-LEVERAGE: continued the C82
  coverage-ratchet on a C81-named low spot — `utils/pending-credentials.ts` (76%), the in-memory OAuth
  refresh-token staging store. SECURITY-relevant: a credential must not outlive its 10-min TTL, must consume
  exactly once, and the store mustn't grow unbounded. The existing auth property test covers only the happy
  store→consume→consume-again-null path; I pinned the UNCOVERED branches via pending-credentials.test.ts (+7):
  TTL expiry (getPendingEmail fresh→email / expired→null; consumePending expired→null AND purges),
  cleanupExpired-on-store, and (userId,nonce) consume scoping. Made expiry DETERMINISTIC by back-dating an
  entry's createdAt via the test-only exposed Map (no timers, no Date mock — there's no setSystemTime idiom
  in the repo). RATCHET MOVED: 76%→100% func / 92% line (only the 1000-entry max-size eviction L53-56 left,
  not worth the seed cost — documented). Filed a NEW STANDING GUARD ANGLE in BACKLOG (coverage-ratchet the
  named low spots: logger.ts 75% next, then frontend) so the loop has grounded non-churn guard work. Verified:
  backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1062 pass/0 fail, +7 · build bundled). Next (84):
  arch (cyc 79, starved-for 5 = budget, most-starved actionable) — arch #2 scaffold-misfit-blocked, so likely
  another coverage-ratchet guard (logger.ts) or a fresh audit fan-out. feature/bug still gated. cov: be ~79% / fe 63.7%
- **C84 (guard — coverage-ratchet expenses/validation.ts, the split money-math refinements)** — feature (14)
  + bug (13) blocked (10th cycle). Most-starved ACTIONABLE was arch (cyc 79, AT budget) — but I did NOT force
  it: arch #2 (page migration) is scaffold-misfit-blocked, and the createLoadState RESHAPE is a DIRECTION
  CALL I already flagged (C79) + escalated — acting on it unilaterally would violate arch rule 6 + my own
  recorded decision. So took the next actionable, guard, via the C83 standing angle. REJECTED the named-next
  `logger.ts` (its only gaps are emoji-prefix wrappers + a level-gated singleton fixed at import — coverage
  theater + awkward) in favor of a HIGHER-VALUE low spot from the C81 list: `expenses/validation.ts` at 50%
  func — the split-expense Zod refinements, which guard real money-math. Pinned the uncovered branches via
  split-validation-schema.test.ts (+10): percentage-sum-must-be-100, absolute-allocations-must-sum-to-total,
  source-fields-both-or-neither, + the update-path skips the absolute check when totalAmount is omitted. Pure
  schema (safeParse), no harness. RATCHET MOVED: 50%/73% → 100%/100%. Updated the standing angle to prioritize
  high-risk pure logic over passthroughs + named the next real targets (reminders/validation 64%, sql-helpers
  33%, idempotency 43%). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1072 pass/0 fail,
  +10 · build bundled). Next (85): recompute — arch (cyc 79, starved-for 6 > 5, now OVER) most-starved but
  still misfit/direction-blocked; deep-review (cyc 82, 3) or another high-value coverage guard the actionable
  fallback. feature/bug Angelo-gated. cov: be ~80% / fe 63.7%
- **C85 (guard — coverage-ratchet financing/hooks.ts, the deactivation data-integrity hook)** — feature (15)
  + bug (14) blocked (11th cycle). arch most-starved + now OVER (cyc 79, 6 > 5) — but VERIFIED again it has no
  self-authorizable increment: page-migration misfit-blocked, reshape is the pending C79 direction call, AND I
  checked whether the 0%-coverage files were DEAD code (a legit arch removal) — they're all LIVE
  (financing/hooks ← routes.ts, auth/providers/* ← auth routes + a registry test), just harness-hard, so no
  dead-code win. Took the next actionable (guard) via the C83 angle. Picked `financing/hooks.ts` (0% func) —
  the onFinancingDeactivated DATA-INTEGRITY hook: on payoff (PUT /:id/payoff) or delete, it must SEVER the
  source link (clear sourceType/sourceId) on the financing's auto-generated expenses while KEEPING the rows.
  Pinned end-to-end through both real routes via financing-deactivate-hook.test.ts (+4): payoff severs +
  row survives; delete severs; no-linked-expenses payoff is a clean no-op (200); an unrelated expense is
  untouched. Used the C68 HTTP-harness pattern so the singleton-bound clearSource hits the test DB. RATCHET:
  0%→100% func / 69% line (the remaining gap is the best-effort catch block — not cleanly inducible via HTTP,
  and the never-throws contract is implicitly proven by the green happy/no-op paths; documented). Verified:
  backend validate:local EXIT 0 (tsc 0 · musl-biome clean · 1076 pass/0 fail, +4 · build bundled). Next (86):
  the #5 branch-hygiene sweep is due (~C86, last C76, branch now 34 commits) — a clean infra pick; else the
  next coverage target (reminders/validation 64%). arch stays direction-blocked; feature/bug gated. cov: be ~80% / fe 63.7%
- **C86 (infra — #5 branch-hygiene sweep, BRANCH_REVIEW.md refresh)** — feature (16) + bug (15) blocked (12th
  cycle); arch most-starved + OVER (cyc 79, 7 > 5) but still direction-blocked (page-migration misfit, reshape
  pending C79). The #5 sweep was due (~C86, last C76) and is a clean actionable infra pick. Sweep: (1) stray
  untracked unit tests outside *.meshclaw.e2e.ts — ZERO; (2) green baseline — 1076 BE + 367 FE (regress.sh
  Playwright-blocked); (3) BRANCH_REVIEW.md (gitignored) refresh — header 26→36 commits / +4355/−287, appended
  §17 (C76–C85: the contract-drift CLOSURE [year-end C78 + getVehicleHealth C80 → loop-improvement #2 done],
  the C81 coverage-baseline revival, the C82–C85 coverage-ratchet arc [timeout/pending-creds/split-validation/
  financing-hook], + the C77/C79 direction-call findings), and noted the C76–C85 arc is overwhelmingly
  test/guard hardening with ZERO product-behavior change → near-zero merge risk. Doc-only (BRANCH_REVIEW
  gitignored → commit carries only loop docs). Next sweep ~C96. Next (87): recompute — arch (cyc 79, starved-
  for 8) most-starved but direction-blocked; deep-review (cyc 82, 5 = budget) or another high-value coverage
  guard (reminders/validation 64%) the actionable pick. feature/bug Angelo-gated (12 cycles). cov: be ~80% / fe 63.7%
- **C87 (deep-review — pin the reminders/validation cross-field refinements)** — feature (17) + bug (16)
  blocked (13th cycle); arch most-starved + OVER (cyc 79, 8 > 5) but direction-blocked. Took the next
  actionable, deep-review (cyc 82, AT budget), via the C81-grounded coverage angle: `reminders/validation.ts`
  at 64% func — its uncovered branches are the 6 cross-field REFINEMENT failure paths (the correctness guards
  that reject a malformed reminder), the C29/C31 defect class. The existing update-validation test covers only
  the isActive toggle, so zero overlap. Pinned each refinement's accept+reject + exact message via
  reminder-refinements.test.ts (+11): custom-frequency (intervalValue/Unit required), expense-type
  (category/amount required), mileage-trigger D4 (intervalMileage required + exactly-one-vehicle; 'time'
  unconstrained), date-range (endDate>startDate), split-config (vehicleId-match + %-sum=100 + absolute-sum=
  expenseAmount). Pure Zod safeParse, no harness. RATCHET: 64% → 100%/100%. Verified: backend validate:local
  EXIT 0 (tsc 0 · musl-biome clean · 1087 pass/0 fail, +11 · build bundled). NEXT coverage low spots:
  sql-helpers (33%), idempotency (43%), rate-limit (75%/60%), then frontend. Next (88): recompute — guard
  (cyc 85, 3) / arch (still blocked) / another coverage guard. feature/bug Angelo-gated. cov: be ~80% / fe 63.7%
- **C88 (feature → spec — recurring-expenses, drafted + flagged)** — BALANCE: three categories over budget at
  cyc 88 — feature (cyc 70, starved-for 18 >> 4), bug (cyc 71, 17 >> 3), arch (cyc 79, 9 > 5); MOST starved =
  `feature` (18) → it wins (this is also the 14th cycle feature/bug have been Angelo-gated, and the
  coverage-ratchet escape hatch is no longer balance-legal — guard/deep-review are both UNDER budget now). Both
  feature BUILDS are eyes-on/Playwright-blocked (maintenance T9, import-trackers T4–T6), so the actionable
  feature increment is the C4/C9 spec-draft move on a NORTH_STAR horizon item: backlog feature #3,
  **recurring expenses**. KEY OUTCOME — the C21/C28/C35 verify-before-acting lesson paid off hard: fanned out
  2 Explore agents and they CONFLICTED on the crux (does the reminder engine already auto-create expenses?).
  Rather than trust either, I READ trigger-service.ts directly — and it OVERTURNED my own stale mental model:
  `processReminder:407` branches on `type==='expense'` → `processExpensePeriod:176` → `createExpenseFromReminder
  :108`, which INSERTS real expense rows (single :125-143 or multi-vehicle split via expenseSplitService
  :148-163) stamped sourceType:'reminder', on the reminder's frequency, in the same txn that advances
  nextDueDate. **The recurring-expense engine ALREADY EXISTS.** So Agent B's "new recurring_expenses table +
  scheduler" would REINVENT it (NORTH_STAR #4 violation) — rejected. A 3rd focused agent + a source grep
  confirmed the THREE real, verified gaps: (1) materialization is manual-button-ONLY (reminders/+page.svelte
  :97-114, no cron/on-open) → a self-host PWA silently under-counts TCO if the user forgets to click; (2)
  ReminderForm omits expenseSplitConfig (:52-53) → no multi-vehicle recurring cost; (3) no traceability from an
  auto-created expense back to its source. Also grounded the R4 cascade on real primitives: expenses/repository
  has deleteBySource (:483) + clearSource (:530), and sourceType:'reminder' is a live create-route enum
  (routes.ts:80) — clearSource is the keep-history verb. Drafted `.kiro/specs/recurring-expenses/`
  {requirements,design,tasks}.md: extend the existing engine (NOT a new table/scheduler), 4 decisions (D1
  materialization cadence without a cron / D2 keep-past-history on delete / D3 reuse the split widget / D4 v1
  order), recommended option each, T0 blocks build. CRUCIALLY the spec's T1–T3 are backend/non-eyes-on
  (traceability response + contract guard, split characterization, cascade-safe delete) — so this feature is
  one the loop can ADVANCE while Playwright is blocked, directly addressing why feature starved (both in-flight
  features are stuck at eyes-on tails). Flagged Angelo via send_message (now THREE specs in flight:
  maintenance T9-only, import-trackers T4–T6, recurring-expenses D1–D4). Verify (spec-only, the C4/C9 pattern):
  D1–D4 referenced consistently across all 3 files, R1–R7↔T0–T8 mapped, every file:line grounding verified
  against source I read this cycle. No build (no code). Next (89): bug is now most-starved over budget (cyc 71,
  starved-for 18 >> 3) but its top items are ALL Angelo-gated (lease/loan $ change, #14 #16 semantics calls) —
  so the actionable pick is arch (cyc 79, 10, still direction-blocked → verify) or the next coverage guard
  (sql-helpers 33%). feature/bug remain gated. cov: be ~80% / fe 63.7%
- **C89 (bug — #4: ExpensesTable sort lacks a stable id tiebreaker)** — BALANCE: bug most-starved over budget
  (cyc 71, starved-for 18 >> 3); arch also over (cyc 79, 10 > 5) but still direction-blocked. APPLIED the
  verify-against-source discipline to my OWN backlog annotation ("bug queue all gated") rather than reflexively
  pivoting — and it was stale: most of the bug queue IS gated (lease/loan $ change, #14/#16 semantics calls,
  #2/#11 eyes-on), but #4 (combined-row re-sort lacks an id tiebreaker) is UNBLOCKED, pure-logic, unit-testable.
  Read ExpensesTable.svelte + confirmed: both sort sites (the flat sortedExpenses :194, and the combined
  tableRows re-sort :268) compared only by date/amount and returned 0 on a tie → equal-key rows fell back to
  JS engine ordering / the standalone-then-group array-build order (grouping itself reorders same-key rows vs.
  the server). The server orders by `dir(sortColumn), dir(id)` (expenses/repository.ts:287 — id tiebreak
  inherits the sort DIRECTION). FIX: extracted a pure `compareExpenseRows(a,b,by,dir)` + `SortableRow` to
  expense-helpers.ts that folds the id tiebreak into the raw comparison BEFORE the asc/desc flip (so a desc
  sort breaks ties id-desc, matching the server — a naive post-flip localeCompare would always break ascending
  and diverge). Wired both sites through it; group rows use their representative date/totalAmount + the first
  child's id as the stable key. MERGE-SURVIVING GUARD (NORTH_STAR #5): compare-expense-rows.test.ts (+8) pins
  primary sort, the load-bearing tiebreak DIRECTION (date/amount × asc/desc), and input-order-independence
  (two orderings of tied rows → same output = the exact #4 invariant). Verified: frontend validate:local EXIT 0
  (tsc 0 · build ✓ · 375 pass/0 fail, +8). CAVEAT (UI-touching, NORTH_STAR #3): the fix's correctness is sort
  DETERMINISM, which a screenshot fundamentally can't show (equal-key rows render identically; only their
  relative order stabilizes) — the unit test is the right + sufficient gate here, like the C39 non-visual layer.
  No backend touched. Next (90): bug freshly fed (89); arch still most-starved over budget (cyc 79, 11 > 5) but
  direction-blocked (page-migration misfit, reshape pending the C79 call) → verify then take the next coverage
  guard (sql-helpers 33% / idempotency 43%). feature/bug remain Angelo-gated. cov: be ~80% / fe 63.7%
- **C90 (arch — dedup the `instanceof Error ? .message : fallback` idiom into extractErrorMessage)** — BALANCE:
  `arch` the only over-budget category (cyc 79, starved-for 11 > 5) → forced. KEY REFRAME: I'd been punting arch
  to coverage-guards citing "direction-blocked," but that block is SPECIFIC to arch #2 (the C79 createLoadState
  page-migration misfit — a real pending direction call). arch #1 CLOSED at C56, so per arch rule 7 the proper
  move is the AUDIT FAN-OUT to repopulate, not punt. Fanned out 2 Explore agents (backend dedup/layering +
  frontend pure-logic dedup). Backend surfaced a real 3× provider-response-formatter dup (providers/routes.ts
  :159/:309/:374) but it's UNTESTED → that's a 2-cycle safety-net-first play (C17/C24 pattern), filed not taken.
  Frontend surfaced the better one-cycle item: the `<err> instanceof Error ? <err>.message : <literal>` idiom
  hand-repeated across catch blocks. APPLIED the C21/C28/C35 verify-against-source rule and it MATTERED: the
  agent listed 5 sites, but error-handling.ts:106 is `fallbackMessage || (instanceof Error ? .message : '...')`
  — the fallback takes PRECEDENCE there (opposite ordering), so folding it in would INVERT semantics (arch
  rule 2 violation) → EXCLUDED it. Verified the other 4 read identically against source (load-state.svelte.ts
  :91, auth.svelte.ts :98 + :116, sync-manager.ts:224 — error-message-wins ordering). Extracted
  `extractErrorMessage(error, fallback)` to error-handling.ts (with a doc note on why handleApiError does NOT
  use it), routed all 4 through it. Anchored by extract-error-message.test.ts (+4): Error-message-wins, subclass
  unwrap, non-Error fallback (string/obj/undefined/null/number), and the load-bearing empty-Error-message
  returns '' (branch on TYPE not truthiness). Complete one-cycle behavior-preserving dedup — no dangling
  follow-up, no .svelte markup (pure .ts/.svelte.ts → no eyes-on needed). Verified: frontend validate:local
  EXIT 0 (tsc 0 · build ✓ · 379 pass/0 fail, +4). FILED for next arch: the provider-formatter dedup needs its
  HTTP characterization net first (providers routes are <50% covered — also a C81 low spot, so it double-counts
  as a coverage guard). Next (91): nothing over budget after this (guard cyc 85 starved-for 6 = budget at 91;
  deep-review cyc 87, 4). Highest-leverage = the providers-routes HTTP net (sets up the C91+ formatter dedup AND
  ratchets a named low spot), or another coverage guard (sql-helpers 33%). feature/bug remain Angelo-gated. cov: be ~80% / fe 63.7%
- **C91 (guard — providers-routes HTTP characterization net, the safety-net half of the C90 dedup)** — BALANCE:
  nothing over budget; `guard` AT budget (cyc 85, starved-for 6 = budget, breaches at 92) and it's ALSO the
  highest-leverage pick — the C90-filed providers-routes net feeds guard one cycle early AND sets up next arch's
  formatter dedup AND ratchets a C81 low spot (providers routes 0% HTTP coverage). Triple-win. Wrote
  providers-routes-http.test.ts (+13) through the real stack via the createTestApp harness: pins the OBSERVABLE
  CONTRACT the upcoming dedup must preserve — the exact 8-key response shape of all 3 hand-assembled formatters
  (GET list / POST create / PUT update) + the load-bearing SECURITY invariant that `credentials` is never
  echoed back — plus auth (401 anon), ownership (404 another-user, no existence leak), domain-guard (400 auth),
  zValidator (400 bad type), and DELETE 204+disappears. REAL DEBUGGING (not papered over): first run 8-failed —
  root-caused to CONFIG being a process-cached env SNAPSHOT built at the first config import, so a `fake`-provider
  create (gated on CONFIG.allowFakeStorageProvider) 400s in the full 148-file suite no matter when my file sets
  ALLOW_FAKE_STORAGE (an earlier file already froze it false). FIX: create an `s3` provider instead — the POST
  handler treats any non-google-drive type identically (encrypt→insert, no network; registry instantiation only
  on /:id/test, not called here), and s3 needs NO env gate → the net is independent of cross-file import order
  (green in isolation AND in suite). Verified: backend validate:local EXIT 0 (tsc 0 · musl-biome clean [autofixed
  an import reflow] · 1100 pass/0 fail, +13 · build bundled). The C92 formatter extraction now lands green→green
  against this net. Next (92): nothing over budget (deep-review cyc 87 starved-for 5 = budget at 92; arch cyc 90,
  2). Highest-leverage = EXECUTE the formatter dedup (arch, now safe behind this net — extract formatProvider
  response, +the :583/:599 photoRef count helper + the :466 raw delete fold in naturally), OR the starved
  deep-review. feature/bug remain Angelo-gated. cov: be ~80% (providers routes now covered) / fe 63.7%
- **C92 (arch — EXECUTE the providers dedup, green→green behind the C91 net)** — BALANCE: nothing over budget
  (four categories AT budget, breach at 93); highest-leverage = the deliberately-staged second half of the
  C91 setup (the C18/C36 net-then-refactor pattern). Two genuine "N copies → one helper" dedups in
  providers/routes.ts: (1) the 8-field provider response object hand-assembled IDENTICALLY at 3 sites
  (GET list, POST create, PUT update) → extracted `formatProviderResponse(row: UserProvider)` (credentials
  deliberately omitted — the security invariant the C91 net pins); (2) the synced-vs-failed photoRef count
  queries in /sync-status, byte-identical except the status filter → `countPhotoRefsByStatus(db, id, status,
  entityTypes)`. ~50 lines of dup → 2 named helpers. SCOPE CALL (C75 reasoning): did NOT extract the lone raw
  `db.delete(userProviders)` :466 into a repo — the WHOLE file uses raw db.* inline (no providersRepository
  exists), so extracting one op makes the file MORE inconsistent (arch rule 5 churn); the formatter+count are
  the coherent in-file set. tsc CAUGHT a real type bug (the gate earning its keep): `photoRefs.status` is a
  literal union `'active'|'pending'|'failed'`, so my first `status: string` param was too wide for eq() —
  tightened the signature to the union (the call sites pass narrowing literals). green→green PROOF: the C91
  net's 13 provider assertions (response key-shape, credentials-never-echoed, sync-status counts) stayed GREEN
  UNCHANGED through the refactor = behavior-preserving. Verified: backend validate:local EXIT 0 (tsc 0 ·
  musl-biome clean · 1100 pass/0 fail, unchanged · build bundled). Next (93): deep-review most-starved over
  budget (cyc 87, starved-for 6 > 5) → it wins. Eyes-on/backend audit of a shipped surface (fan out per rule 7,
  verify findings vs source); the C88 recurring-expenses spec premise or the C89/C90/C91 arc are fresh
  unreviewed. feature/bug remain Angelo-gated (the 3 specs + lease/loan). cov: be ~80% / fe 63.7%
- **C93 (infra — CLAUDE.md orientation refresh: correct 2 actively-misleading drifts)** — BALANCE: five
  categories AT-or-over budget; my C92 note guessed deep-review, but the TABLE ruled — `infra` had the highest
  raw starved-for (cyc 86, 7 > 6) so it WINS over deep-review (6) (the recurring "compute all six, don't trust
  last cycle's single-category forecast" lesson, again). Chose the orientation-refresh infra item over the #5
  sweep (not due till ~C96) on EVIDENCE of real drift, not speculation — read CLAUDE.md and found 2 claims that
  actively mislead a fresh agent (the C5/C47/C72 class): (1) the coverage line cited a stale "~74%/~59%, ~1038/
  ~367 tests" floor → corrected to the real C81 MEASURED baseline (be 77.8% / fe 63.7% line) + noted
  loop-improvement #4's per-cycle cov: tag + ~1100/~379 suite size; (2) the "Open gaps" line claimed "full
  in-process backend HTTP harness needs a DB-injection refactor (the new Database(...) singleton binds at
  import)" — FLATLY WRONG now: C91 proved createTestApp() exists + works (1100 tests run through it, the
  providers net added last cycle). Rewrote it to DOCUMENT the harness (createTestApp/ctx.authed, real Lucia
  session, the CONFIG-snapshot import-order caveat from C91) and NARROW the real remaining DI gap to the
  specific one — analytics computeBalance binds the real-DB singleton (the C77 Property-23 skip). VERIFIED both
  new claims against source (read http-client.ts in full C91; cross-checked the computeBalance gap against
  BACKLOG deep-review #3 — consistent). Left the maintenance/import-trackers status lines unchanged (accurate
  since the C72 refresh). Docs-only; no code, no build gate (the C5/C12/C47/C53/C72 pattern). Next (94):
  deep-review most-starved over budget (cyc 87, starved-for 7 > 5) → it wins (deferred from C93 by the infra
  breach). Fan out per rule 7, verify vs source; the C88–C92 arc is fresh-unreviewed. feature/bug Angelo-gated. cov: be ~80% / fe 63.7%
- **C94 (deep-review — certify the reminder→expense time-axis materialization engine; + record Angelo's D1–D4 sign-off)** —
  BALANCE: deep-review most-starved over budget (cyc 87, starved-for 7 > 5) → forced (deferred from C93 by the infra breach).
  Verification-only (no product code, like C21/C28/C35; findings → the bug/decision queues). Audited the reminder→expense
  AUTO-MATERIALIZATION path the C88 recurring-expenses spec depends on (`createExpenseFromReminder`/`processExpensePeriod`/the
  catch-up loop) — the TIME axis (split allocation, catch-up idempotency, endDate boundary) had never had a dedicated
  adversarial read (the mileage axis got C28/C35). Fanned out 2 Explore agents; VERIFIED every finding vs source (C21/C28/C35).
  • Agent A: AUDIT-CLEAN — CAS/dedup idempotency (no double-materialize on re-trigger), catch-up cap, per-vehicle split shares
    sum to the total ONCE (each sibling stores its own share — the C21 finding re-confirmed), endDate boundary, and
    `sourceType:'reminder'` stamping all CORRECT + well-grounded. The engine the just-approved spec EXTENDS is certified.
  • Agent B raised 2 "BUG"s + 1 "miscategorization" — verified each against source:
    – Issue #1/#5 (the two CONTRADICTED each other — a tell): `buildTCOMonthlyTrend` (analytics-charts.ts:953-961) is a
      4-bucket chart (financing/insurance/fuel/maintenance, NO "other"), so a `category='financial'` expense is omitted from
      THIS trend chart. NOT a bug + NOT reminder-specific: the financing/insurance branches require
      `sourceType==='financing'/'insurance_term'`, so a MANUALLY-entered financial expense (sourceType null) is omitted
      identically, and fuel/maintenance reminder-expenses DO show. NOT lost from TCO totals (`categorizeTCOExpenses` routes it
      to otherCosts). Filed as a #14-class NEEDS-DECISION item (chart scope), not fixed unilaterally.
    – Issue #2 (fuel fillup-count inflation): `currentYearFillups = fuelRows.length` counts split fuel SIBLING rows as N
      fillups, not 1. VERIFIED REAL + REACHABLE — `createSplitExpenseSchema` has `category: z.string().min(1)` (NO fuel
      restriction, confirmed this cycle), so a fuel expense IS splittable across vehicles. But NARROW/LOW-SEV: only the
      CROSS-FLEET fuel view (`queryFuelExpenses` with no vehicleId) over-counts; the per-vehicle path (`getFuelStats(…,
      vehicleId)`) sees 1 sibling = 1 (correct); and only COUNT-derived metrics (fillup count → $/fillup, gal/fillup
      averages) skew — the gallon/cost SUMS are right (shares sum correctly). Requires a user to split ONE fillup across
      cars (semantically unusual). Filed as a real low-sev bug (#18; fix: count distinct parent expense ids, not rows).
  Net: engine CERTIFIED clean where it matters, 1 low-sev bug filed (#18), 1 needs-decision filed (#19) — Agent A's verdict
  de-risks the just-approved spec. ALSO THIS CYCLE: Angelo SIGNED OFF recurring-expenses **D1–D4** (all recommended options) →
  flipped requirements.md to APPROVED + ticked tasks.md T0; T1–T3 are backend/non-eyes-on so the feature is finally
  ADVANCEABLE (the unlock that ends the long feature/bug Angelo-gate on this spec). No code; spec + loop docs only, no build
  gate (the C21/C28/C35 + C4/C9 pattern). Next (95): `feature` most-starved over budget (cyc 88, starved-for 7 > 4) → it wins
  AND for the first time has an UNBLOCKED backend task — recurring-expenses **T1** (surface sourceType/sourceId on the expense
  read path + the FE↔BE contract-drift guard + a reminder-materialized `sourceType` test). `bug` (cyc 89, 6 > 3) is
  next-most-starved (the new #18 is a queued candidate). cov: be ~80% / fe 63.7%
- **C96 (feature — recurring-expenses T1: lock the expense-source traceability contract on the READ path)** —
  BALANCE: `feature` most-starved over budget (cyc 88, starved-for 8 > 4) → forced; and for the first time the build is
  ACTIONABLE (T0 signed off C94). Grounded T1 first (the C56 "verify the premise before building" discipline — read-only,
  no commit): the C88 spec assumed T1 needs to "surface sourceType/sourceId if missing on the read path." VERIFIED against
  source it's a NO-OP — already surfaced: (a) all expense reads (`findByIdAndUserId`/`findPaginated`/`findAll`) use bare
  `.select()` → every column incl. sourceType/sourceId; (b) `buildPaginatedResponse(data,…)` passes rows through VERBATIM (no
  mapper/strip); (c) the frontend `Expense` type already declares `sourceType?`/`sourceId?` (expense.ts:57-58). AND a
  contract-drift guard is NOT warranted (C80 lesson — GET /expenses is a CONFIRMED clean repository pass-through, not a
  hand-assembled response; the guard pattern only applies to route-injected fields). So T1 reduced to ONE genuine, distinct
  deliverable: `trigger-expense.test.ts` already pins source_type at the DB-ROW level (reads straight off sqlite, line 65) —
  but that stays green even if a future response-mapper STRIPPED the field, silently breaking the T6 "Recurring" badge + T3
  cascade UI that key off the RESPONSE. Wrote `expense-source-traceability.test.ts` (+3) pinning the OBSERVABLE API contract
  (the C91-class positive-surfacing test): GET /expenses list echoes sourceType='reminder'/sourceId for a reminder-
  materialized expense; GET /:id echoes the source link; a manual expense reports null (value reflects reality, not a
  hardcoded literal). Mirrors the proven trigger-expense harness (createTestApp → real route→trigger→insert→GET-serialize→
  sqlite). THE GATE EARNED ITS KEEP TWICE: first run the manual-expense create 400'd (I used the response field `amount`;
  the create API wants `expenseAmount`), then 400'd again ("fuel expenses require fuel amount + mileage" — a category
  cross-field rule) → switched to `category:'misc'` (a plain manual expense, no fuel refinement). Verified: backend
  validate:local EXIT 0 — 1103 pass / 0 fail (+3) · build bundled. T1 DONE; T2 (split-materialization characterization) +
  T3 (cascade-safe delete via clearSource) are the next backend, both non-eyes-on. NOTE: the C94 + C96 commits are PENDING —
  git-commit was declined across C94/C95/C96 (3 cycles, 2 command forms), so the doc + spec + test edits are on-disk
  UNCOMMITTED on claude-loop-dev; flagged to Angelo. Next (97): `bug` most-starved over budget (cyc 89, starved-for 8 > 3)
  → its top UNBLOCKED item is the new #18 (cross-fleet fuel fillup count — pure-logic, count distinct parent ids), the
  lease/loan + #14/#16/#19 remain Angelo-gated. cov: be ~80% / fe 63.7%
- **C97 (bug — #18: cross-fleet fuel fillup COUNT inflated by split fuel siblings)** — BALANCE: `bug` most-starved over
  budget (cyc 89, starved-for 8 > 3) → forced; #18 (filed C94) is its only UNBLOCKED item (lease/loan + #14/#16/#19 stay
  Angelo-gated). VERIFY-AGAINST-SOURCE refined the fix (C21/C28/C35, applied to my own C94 finding): read
  `ExpenseSplitService.createSiblings` (split-service.ts:92-108) — a split fuel sibling sets only `expenseAmount`; `volume`/
  `mileage`/`fuelType` are absent → SQL-default NULL. So C94's "sums are correct" CONFIRMED (null volume contributes 0 to
  `sumGallons` + distance skips null mileage) and the bug is PURELY the count. That also revealed the CLEANER fix than
  dedup-on-groupId (groupId isn't even SELECTed by queryFuelExpenses): a "fillup" is a fuel PURCHASE with a volume, so count
  only volume-bearing rows — the SAME `volume != null && > 0` predicate `fillupDetails.volumes` already uses. Fixed BOTH
  count paths for year-over-year consistency: (1) `buildFuelStatsFromData` — extracted `isFillup(r)` and applied it to
  currentYear/currentMonth/prevMonth fillup counts (repository.ts:~1238); (2) `queryFuelAggregates` (the prev-year count) —
  `COUNT(*)` → `COUNT(CASE WHEN volume > 0 THEN 1 END)` to match the in-memory predicate. The volume SUM kept explicit
  (unaffected — null contributes nothing). NARROW + behavior-preserving for non-split data: a real single-vehicle fillup
  always has a volume → still counts; per-vehicle path unchanged. MERGE-SURVIVING GUARD (NORTH_STAR #5): appended a
  deterministic regression to fuel-stats.property.test.ts (mirrors the cycle-211 distance fixture) — 2 real fillups + a
  fuel expense split across 2 cars (volume-null siblings) → cross-fleet `fillups.currentYear === 2` (pre-fix 4) +
  `volume.currentYear === 19` (sum unchanged, the "sums were always right" proof). Verified: backend validate:local EXIT 0
  — 1104 pass / 0 fail (+1) · build bundled. #18 CLOSED. NOTE: commits still PENDING (git-commit declined C94–C96, treated
  as a standing session block; flagged to Angelo via Slack this cycle) — C94/C96/C97 edits are on-disk UNCOMMITTED on
  claude-loop-dev. Next (98): nothing over budget (guard cyc 91 starved-for 6 = budget at 98; arch cyc 92, 6 > 5 → arch
  breaches) → `arch` most-starved (fan-out per rule 7), or continue feature recurring-expenses T2 (split-materialization
  characterization, backend/non-eyes-on). cov: be ~80% / fe 63.7%
- **C98 (guard — characterize sql-helpers.ts, the 33%-covered dialect SQL fragments)** — BALANCE: `guard` most-starved
  over budget (cyc 91, starved-for 7 > 6); my C97 note guessed arch but the TABLE ruled — guard (7) > arch (6) (the
  recurring "compute all six" lesson). Took the C83 coverage-ratchet standing angle's top named low spot:
  `db/sql-helpers.ts` (33% func) — 3 tiny dialect-aware date helpers (extractMonth/formatYearMonth/toDateTimeString) that
  are the ONLY SQLite-specific raw SQL in the codebase, NEVER directly tested (only incidentally via analytics queries),
  and whose doc comments record TWO real past bugs from one root cause: omitting `'unixepoch'` makes SQLite read the
  seconds-epoch column as a Julian day → garbage months (extractMonth) + collapsed GROUP BY buckets → blank charts + $0
  monthly average (formatYearMonth). Wrote `sql-helpers.test.ts` (+5) executing each fragment via a real Drizzle select
  over a seeded expense (the analytics createTestDb harness — full schema, seedExpense stores date as seconds): extractMonth
  March→3 + Jan/Dec boundaries; formatYearMonth →'2024-03' + the load-bearing distinct-months-stay-distinct (the exact
  monthly-trend regression); toDateTimeString →'2024-03-15 00:00:00'. Pins the `unixepoch` invariant merge-surviving (a
  regression dropping it changes these outputs). Pure characterization, no product code. THE GATE EARNED ITS KEEP: first
  run failed on musl-biome formatting only (import reorder + a chained select reflow) — ran check:musl:fix (the documented
  CLAUDE.md autofix path), re-ran green. Verified: backend validate:local EXIT 0 — 1109 pass / 0 fail (+5) · build bundled.
  sql-helpers.ts 33%→covered. Next (99): nothing over budget (arch cyc 92 starved-for 7 > 5 at 99 → arch breaches) →
  `arch` most-starved (fan-out per rule 7), OR continue feature recurring-expenses T2 (split-materialization characterization,
  backend/non-eyes-on, the highest-leverage feature-advancing pick). cov: be ~80% / fe 63.7%
- **C99 (arch — converge analytics routes on the shared `validateVehicleOwnership`)** — BALANCE: `arch` most-starved over
  budget (cyc 92, starved-for 7 > 5). arch #2 (createLoadState reshape) is direction-blocked pending the C79 call, so per
  arch RULE 7 ran the AUDIT FAN-OUT (2 Explore agents: backend dedup/layering + frontend pure-logic) to find a fresh
  actionable item — the C90 pattern. Backend surfaced the clear winner: the inline `const vehicle = await
  vehicleRepository.findByUserIdAndId(user.id, vehicleId); if (!vehicle) throw new NotFoundError('Vehicle')` pattern
  hand-repeated at 13 sites across 4 route files, while a shared exported `validateVehicleOwnership(vehicleId, userId)`
  (utils/validation.ts:83) ALREADY EXISTS + is used by odometer/insurance/photos. (Frontend candidate — MS_PER_DAY magic-
  number consolidation — REJECTED as churn-for-churn, arch rule 5: a readability nicety, no real payoff.) VERIFIED vs
  source (C21/C28/C90): the inline pattern is byte-identical to the helper (same findByUserIdAndId arg order, same
  NotFoundError('Vehicle')); routes discard the returned vehicle (they re-query via the repository), so dropping the local
  binding is behavior-identical. SCOPE CALL (arch rule 1 — one small reviewable commit, NOT sweeping; the C36/C50 one-file-
  per-cycle convergence pattern): scoped to `analytics/routes.ts` ONLY — the densest cluster (6 of the 13 sites, all
  test-covered); filed the other 3 files as the next arch increments. Converted all 6 (3 mandatory: vehicle-health/-tco/
  -expenses; 3 optional: fuel-stats/-advanced/-efficiency, keeping their `if (vehicleId)` guards), swapped imports
  (NotFoundError + vehicleRepository now unused in the file → removed; tsc confirmed). green→green PROOF: the analytics
  route + property suites stayed GREEN UNCHANGED (1109 pass, same as C98) = behavior-preserving. Verified: backend
  validate:local EXIT 0 (tsc 0 · musl-biome clean · 1109 pass / 0 fail · build bundled). Next (100): `infra` most-starved
  (cyc 93 starved-for 7 > 6 → breaches) — the #5 branch-hygiene sweep is due (last C86, branch now ~46 commits) or a
  CLAUDE.md refresh; deep-review (cyc 94, 6 > 5) also breaches. cov: be ~80% / fe 63.7%
- **C100 (infra — #5 branch-hygiene sweep, the milestone cycle)** — BALANCE: `infra` most-starved over budget (cyc 93,
  starved-for 7 > 6), edging deep-review (6); the #5 sweep was due (last C86, ~14 cycles, branch now 46 commits) — a clean
  milestone-appropriate infra pick. All three sweep parts: (1) STRAY UNTRACKED TESTS — zero outside the by-design
  `*.meshclaw.e2e.ts` set (the other untracked entries are gitignored dirs: .meshclaw-tools/, test-results/, __screenshots__/,
  mise.local.toml); nothing would silently drop coverage on merge. (2) GREEN BASELINE — backend validate:local EXIT 0 at C99
  (1109 BE pass), unchanged since (no code this cycle); regress.sh Playwright still sandbox-blocked (the standing limit, as
  C76/C86). (3) BRANCH_REVIEW.md REFRESH — header 36→46 commits, status block 1076→1109 BE / 367→379 FE, appended §18 (C86–C99:
  recurring-expenses spec drafted+signed-off+T1 started, bugs #4/#18, the C90/C92/C99 arch dedups, the C87/C91/C98 coverage
  ratchet, the C93 doc refresh) + refreshed the Suggested-merge footer (noted recurring-expenses as the 2nd mid-build feature,
  near-zero merge risk: only 2 small verified bug fixes are user-visible). BRANCH_REVIEW.md is gitignored (the refresh IS the
  deliverable). Doc-only — no code, no build gate (the C86/C76/C66 sweep pattern). Next (101): `deep-review` most-starved over
  budget (cyc 94, starved-for 7 > 5) → it wins; fan out per rule 7, verify vs source (the C99 arch dedup + the recurring-
  expenses T1 surface are fresh-unreviewed), OR continue feature recurring-expenses T2. Next #5 sweep due ~C110. cov: be ~80% / fe 63.7%
- **C101 (deep-review — certify financing math + split/cascade primitives; pin the T3-critical source-survives-edit gap)** —
  BALANCE: `deep-review` most-starved over budget (cyc 94, starved-for 7 > 5) → forced. Verification cycle (C21/C28/C35
  pattern). Fanned out 2 Explore agents on FRESH backend-correctness surfaces that de-risk pending work: (A) financing/loan
  balance + amortization math (money-touching, feeds the pending lease/loan fix); (B) expense split edit/delete + the
  clearSource/deleteBySource cascade primitives (recurring-expenses T3 builds on these). VERIFIED every finding vs source —
  the discipline earned its keep (both "CRITICAL/MAJOR" flags were FALSE HIGHs):
  • Agent A: AUDIT-CLEAN. computeBalance is correctly payment-history-based (max(0, original − Σpayments), well-tested via
    financing-balance.property); buildAmortizationSchedule decrements properly (bug #10 fixed C38); div-by-zero guarded;
    future-startDate + apr-null + payoff-clamp all safe. One COSMETIC finding (monthsElapsed ignores day-of-month →
    monthsRemaining is a ±1-month display approximation, no $-derived value uses it) — NOT filed (no displayed-$ impact).
  • Agent B: split/cascade primitives CERTIFIED. clearSource NULLs source + KEEPS rows; deleteBySource removes rows + photos
    in a txn; BOTH correctly userId-scoped (no cross-tenant) — verified vs source (repository.ts:483-553). Its "#1 absolute-
    split unvalidated" + "#2 percentage rounding fairness" were FALSE HIGHs (Zod validates sum==total at the API layer per
    validation.ts:64-72; the penny-to-last-vehicle is standard money-split, sum exact). The ONE genuine, actionable finding
    (#3): updateSplitExpense correctly preserves sourceType/sourceId across an edit (copies from firstOld, repository.ts:739-
    740) but NOTHING pinned it — and recurring-expenses T3 (cascade-delete keys on sourceId) depends on a reminder-linked
    split STAYING linked across an edit. Closed it (the C73 audit-then-pin pattern): added a deterministic test to
    expense-repository.property.test.ts — create an even split with sourceType:'reminder', edit it (2→3 vehicles, total
    150→180), assert all new siblings + the DB rows still carry sourceType:'reminder' + the same sourceId. Net: both surfaces
    certified clean, 2 false HIGHs debunked, 1 real T3-de-risking gap closed. Verified: backend validate:local EXIT 0 — 1110
    pass / 0 fail (+1) · build bundled. Next (102): `feature` most-starved over budget (cyc 96, starved-for 6 > 4) →
    recurring-expenses **T2** (split-materialization characterization, backend/non-eyes-on) — now doubly de-risked (this cycle
    certified the split primitives). `bug` (cyc 97, 5 > 3) next. cov: be ~80% / fe 63.7%
- **C102 (feature — recurring-expenses T2: split-materialization characterization)** — BALANCE: `feature` most-starved over
  budget (cyc 96, starved-for 6 > 4) → forced; the actionable backend/non-eyes-on task is recurring-expenses T2 (now doubly
  de-risked: C101 certified the split primitives). Grounded the gap first: `expenseSplitConfig` is referenced in
  validation/trigger-service but NO trigger test FIRES a split expense reminder and checks the materialized rows — C96's
  trigger-expense.test.ts covered only the SINGLE-expense path; reminder-refinements.test.ts is schema-only. Verified the
  path vs source: a time-axis expense reminder CAN carry multiple vehicles (the D4 single-vehicle rule fires only for
  mileage/both, validation.ts:114) + an expenseSplitConfig (even/percentage/absolute, same discriminated union as manual
  splits); on trigger, createExpenseFromReminder:147-163 → computeAllocations → createSiblings → N rows each its share,
  shared groupId, sourceType:'reminder'. Extended trigger-expense.test.ts (+2) with a split-materialization describe block:
  (1) even split $100 across 2 vehicles → 2 siblings of $50 summing to 100, both source-linked, distinct vehicles, group_total
  100, split_method 'even' — grouped by groupId so the overdue catch-up months each assert independently; (2) percentage
  75/25 of $200 → v1=$150, v2=$50, summing to 200, source-linked. Pins the path recurring-expenses T4 (multi-vehicle split
  in the form) materializes through. Verified: backend validate:local EXIT 0 — 1112 pass / 0 fail (+2) · build bundled.
  T2 DONE; tasks.md ticked. Next (103): `bug` most-starved over budget (cyc 97, starved-for 6 > 3) → its top UNBLOCKED item
  (the queue is otherwise Angelo-gated: lease/loan + #14/#16/#19) — re-verify the queue against source per the C89 lesson;
  if genuinely all-gated, the actionable pick is recurring-expenses T3 (cascade-safe delete, backend, the C101-certified
  clearSource path) or a guard. cov: be ~80% / fe 63.7%
- **C103 (bug — expense-form date validation rejects TODAY for positive-UTC-offset users)** — BALANCE: `bug` most-starved
  over budget (cyc 97, starved-for 6 > 3). The known queue is genuinely Angelo-gated (lease/loan $, #14/#16/#19 semantics,
  #2/#11 eyes-on, #17 by-design), so per the C90 refinement I FANNED OUT (2 Explore agents) to find a fresh UNBLOCKED bug
  rather than force a gated one. VERIFIED both findings vs source (C21/C28/C67 — one was a false HIGH):
  • Agent A "getSummary passes a Date to gte() → seconds-vs-ms mismatch, breaks summary every request" = FALSE POSITIVE.
    expenses.date is `integer({ mode: 'timestamp' })` (schema.ts:213) — Drizzle AUTO-converts Date↔seconds at the driver, so
    `gte(expenses.date, dateObj)` is the CORRECT intended usage (the heavily-tested buildExpenseConditions list path does the
    same). The agent's "line 346 does /1000" is a different raw-SQL path. Dismissed, not filed.
  • Agent B (REAL, unblocked, the C6/C61 class): expense-form-validation.ts:36-38 did `new Date(value) > new Date()` for the
    future-date guard. `new Date('YYYY-MM-DD')` parses as UTC midnight, so for a user at a POSITIVE UTC offset today's picked
    date lands on tomorrow-morning-local and the Date-instant compare wrongly rejects TODAY as "in the future." FIX: compare
    CALENDAR-DAY strings — the picker value is already local 'YYYY-MM-DD'; today's local day via the getFullYear/getMonth/
    getDate parts idiom this same file already uses for mileage ordering (:96/:109); string compare is timezone-safe +
    host-independent (sidesteps the C77 UTC-host vacuity trap — the bug was a time-of-day mismatch, eliminated by date-only
    compare). MERGE-SURVIVING GUARD: new expense-form-validation-date.test.ts (+6) — today accepted (the regression),
    past accepted, tomorrow/far-future rejected, empty required; derives "today" from local parts exactly as the validator,
    so it holds on any host. CAVEAT (NORTH_STAR #3): UI-touching but pure .ts logic, no markup; correctness is the TZ-safe
    compare which a screenshot can't show (TZ-dependent) — the unit test is the right gate (the C89/C61 non-visual class).
    Verified: frontend validate:local EXIT 0 — 385 pass / 0 fail (+6) · tsc 0 · build OK. THE GATE EARNED ITS KEEP: caught my
    bun:test import (frontend is vitest) + a strict-null destructure; both fixed. Next (104): nothing over budget (guard cyc 98
    starved-for 6 = budget at 104; arch cyc 99, 5 = budget). Highest-leverage = recurring-expenses T3 (cascade-safe delete,
    backend, the C101-certified clearSource path) — continues the advanceable feature. cov: be ~80% / fe ~64%