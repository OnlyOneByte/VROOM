# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category.

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 22 |
| deep-review | 5 | 21 |
| guard | 6 | 20 |
| bug | 3 | 14 |
| arch | 5 | 18 |
| infra | 6 | 19 |

Current cycle: **22**

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