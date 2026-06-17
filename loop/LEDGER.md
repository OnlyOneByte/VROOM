# LEDGER — VROOM autonomous loop

> Append-only cycle log + the balance table. Update BOTH every cycle:
> bump the touched category's "last-touched cycle", then add a one-line log entry.
>
> **Fresh start 2026-06-16.** The C1–C467 history was archived to
> `loop/archive/LEDGER-C1-C467.md` (+ `BACKLOG-C1-C467.md`) to keep the loop's read-path lean.
> Everything still-open carried into the fresh `BACKLOG.md`; everything done lives in the archive
> (and in git). Read `GUIDE.md` first, then NORTH_STAR, then BACKLOG. Skim THIS file's balance
> table + the last ~3 entries only — never the whole log.
>
> **COVERAGE TREND (loop-improvement #4): end every cycle-log entry with a `cov:` tag** —
> `cov: be <pct>% / fe <pct>%`. Carry the prior numbers forward + mark `~` if you didn't
> re-measure this cycle; re-measure (`bun test --coverage` / vitest `--coverage`) on guard/arch/bug
> cycles that touch a module. Goal 90% both (structural ceiling ~87% BE / ~86% FE — the remaining gap
> is OAuth/DI-bound BE [auth routes, provider services, backup-orchestrator, db connection] + eyes-on FE
> components). **RE-MEASURED C7 (infra cadence): BE 87.22% line / 86.96% func (file-mean, 103 src files);
> FE 85.95% line / 87.15% func / 78.38% branch (v8 aggregate, 1138/1324 lines).** Both at the structural
> ceiling; treat as the floor. (Prior real measure C460: BE 87.09/86.60, FE 85.89/87.15/78.35 — flat-to-up.)

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category. Recompute ALL 6 every
cycle (slow-budget categories mis-forecast otherwise).

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 5 |
| deep-review | 5 | 3 |
| guard | 6 | 6 |
| bug | 3 | 6 |
| arch | 5 | 6 |
| infra | 6 | 7 |

Current cycle: **7**

> Reset to 0 (true fresh start, 2026-06-16). Nothing is over budget yet at C1, so the first few
> cycles take the highest-leverage open item; prefer spreading across categories. The branch is
> already ~150 commits deep and PR-ready — this reset is documentation hygiene, not a code reset.

## Cycle log
- **C1 (feature)** — Maintenance-schedule **T9 / eyes-on closeout**. Picked the highest-leverage open
  item (balance all-0, nothing over budget; feature has the lowest budget + eyes-on is now unblocked per
  GUIDE). Booted a fresh stack (RESET_DB reseed + START_SERVERS) and ran the untracked
  `reminder-mileage.meshclaw.e2e.ts` green: it drives the real ReminderForm → backend → DB → /reminders
  render round-trip, then clicks "Serviced" (mark-serviced 200 re-arm). **Read both captured PNGs**:
  the mileage form reveals Service-interval `5000 mi` + "Last serviced at" (unit suffix + help text) and
  hides the time fields ✓; the created reminder renders `Next: 30,850 (odometer)` (milestone, no false
  frequency badge) with a working "Serviced" button ✓. Ticked spec T7/T8/T9 → `[x]` (the ~200-cycle
  "Playwright-blocked" tail was the resolved misdiagnosis). No code changed (markup already merged via
  "Merge Monday (#112)"); doc-only — frontend type-check 0 errors. Also pruned the **stale #140**
  BACKLOG/CLAUDE.md entry: verified firsthand the LeaseMetricsCard annual-vs-total fix is ALREADY merged
  (all 3 display sites route through `leaseTotalMileageAllowance`, `#140` fix-comment present) — it was
  post-reset squash-merge doc-drift, not open work. cov: be 87.09% / fe 85.89% (~, carried from C460 —
  no module touched this cycle).
- **C2 (bug #147)** — **PUT /split/:id financing-source not re-validated against the NEW vehicle set.**
  Bug-vein scout: verified firsthand that insurance/claims/vehicles/odometer/financing/regular-expense
  write paths are all hardened (debunked an initial term-coverage-ownership hypothesis — the repo DOES
  call assertVehiclesOwned in all 3 term writes). Found the real gap in `updateSplitExpense`
  (repository.ts:792-793): it REGENERATES siblings carrying the group's existing sourceType/sourceId
  forward (the update schema doesn't expose them), but the NEW splitConfig can land them on a DIFFERENT
  vehicle set — and computeBalance sums financing payments by (sourceType,sourceId) with NO vehicle
  scope, so reallocating a financing-sourced split onto a vehicle whose active financing isn't that
  sourceId mis-attributes a loan payment → understates the displayed balance (NORTH_STAR #1). The
  #125(PUT)/#145(create-split) within-tenant financing-source class on the ONE path the per-vehicle
  check missed. FIX: extracted `assertSplitFinancingSourceValid` (DRYs the per-vehicle loop), shared by
  POST /split (new config) + PUT /split (re-checks the carried link against the new vehicles via the
  userId-scoped getSplitExpense read). GUARD: +3 HTTP-harness tests in expense-source-traceability.test.ts
  (reallocate-onto-unfinanced→400 [was 200 pre-fix]; same-financed-vehicle→200; source-less→200 free
  reallocation). Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1561 pass / 0 fail (+3),
  build bundled. Backend-only (no UI → no shot). cov: be ~87.1% / fe 85.89% (~ — BE suite +3 tests; not
  re-measured, expense routes already well-covered).
- **C3 (deep-review)** — **Certified the photo-entity-type allowlist sync CLEAN + left a C404 drift guard.**
  The set of "photographable" entity types (vehicle / expense / insurance_policy / insurance_claim /
  odometer_entry) is duplicated across THREE independent paths, held together only by code comments:
  (1) `validateEntityOwnership` switch (photos/helpers.ts, the upload gate), (2) `validatePhotoRefs`
  entityTypeToIds map (sync/backup.ts, the RESTORE validator), (3) `ENTITY_TO_CATEGORY` (storage-provider.ts,
  exported, provider routing). VERIFIED FIRSTHAND all three list the same 5 types today. The C404 failure
  was exactly this drift: insurance_claim added to the upload gate but missed in the backup map →
  a valid backup with a claim photo hit "unknown entity type" → valid:false → the WHOLE restore aborted
  (NORTH_STAR #1 crown-jewel). No existing test pinned the cross-allowlist match. GUARD: new
  `photo-entity-type-allowlist-sync.test.ts` (+12) treats ENTITY_TO_CATEGORY as the canonical source and
  asserts BOTH other sites accept exactly its keys — driving the REAL validateBackupData +
  validateEntityOwnership (not a re-impl). NON-VACUOUS: confirmed by temporarily removing insurance_claim
  from the backup map → guard goes RED with the precise "would abort the WHOLE restore" diagnostic; restored
  → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1573 pass / 0 fail (+12), build
  bundled. Backend-only (no UI → no shot). cov: be ~87.2% / fe 85.89% (~ — sync module already well-covered;
  +12 tests broaden the restore-safety net).
- **C4 (arch-scout → no-churn → guard)** — Ran a genuine ARCH dedup scout across the likely veins:
  FE date helpers (toDateInputValue/dateOnlyToISO already single-sourced in formatters.ts; the
  expense-filters local-date parse uses a DIFFERENT time anchor — midnight vs noon — so convergence is
  PROHIBITED per the calculatePayoffDateFromStart lesson), backend ownership validators (the
  validate*Ownership family is deliberately per-entity by ownership topology — not a clean merge), FE
  query builders (buildQueryString already deduped C337), the offline→backend mapper + reminder
  computeNextDueDate (both already saturated with completeness/property guards). **Recorded: no churn
  warranted** (arch is reliably DRY per the GUIDE; don't manufacture). PIVOTED to the most-starved next
  category (guard, 4/6). Found a real guard gap: the financing-balance property test drives
  `repo.computeBalance` DIRECTLY, and the C2 #147 tests assert only route STATUS — nothing pinned the
  end-to-end MONEY round-trip that a financing-sourced split actually moves the vehicle's DISPLAYED
  `computedBalance` (NORTH_STAR #1). GUARD: new `split-financing-balance-roundtrip.test.ts` (+3) drives
  POST/PUT /split → DB → GET /vehicles/:id and asserts EXACT balances (20000→19600 on a 400 split;
  →19500 after reallocating to 500, proving no double-count/orphan; source-less split leaves 20000).
  Inherently non-vacuous (exact-number assertions). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1576 pass / 0 fail (+3), build bundled. Backend-only (no UI → no shot). cov: be
  ~87.2% / fe 85.89% (~ — financing/expense routes already covered; +3 pins the observable money seam).
- **C5 (feature)** — **Recurring-expenses T7: dashboard recurring-cost widget (eyes-on DONE).** Balance:
  feature/bug/arch all sat AT budget; feature (4/4, lowest budget) had the most genuine open work →
  picked it. T7's backend (reminder-cost.ts C111 + GET /recurring-cost C116) + FE client method
  (getRecurringCost C134) were all done; only the dashboard MARKUP remained. Built `RecurringCostCard.svelte`
  (composed from the kit — Card/Button/Skeleton/EmptyState; four-states: loading/data/zero), wired into
  the dashboard page via a parallel `getRecurringCost()` fetch that degrades to {0,0} on failure (a
  reminders-service hiccup must never blank the dashboard, mirroring the reminders list's catch). Booted a
  fresh stack, seeded two monthly expense reminders ($120 insurance + $400 loan), and **Read the PNG**: the
  card renders **$520.00 / month · across 2 recurring expenses**, matching the live endpoint
  `{count:2, monthlyTotal:520}` — full FE→BE→DB→render round-trip confirmed. Ticked spec T7 → `[x]`.
  Verify: frontend validate:local GREEN — type-check 0, build OK, 715 tests pass. cov: be ~87.2% / fe
  85.89% (~ — UI-markup cycle, no vitest module touched; the widget's data path is backend-covered).
- **C6 (arch-scout → no-churn + bug-scout → dry → guard)** — Two categories were over budget (arch 6/5,
  bug 4/3). Scouted ARCH on fresh modules (C4 said "try a module the loop hasn't touched"): analytics
  builders (the `isFillup` predicate is ALREADY single-sourced — #108/#113/#146 each route through it, not
  a dup), FE chart components, and the `mean`/`groupBy` accumulation idioms (trivial idioms with DIVERGING
  empty-guards — converging risks behavior change, arch rule 2; REJECTED as churn). **Recorded: no churn
  warranted.** Scouted BUG on date/tz math (the productive vein after C2 swept write paths): analytics
  date helpers (monthsOwnedInYear, calendarYearRange, toDate, the month-iteration loop, season map) are
  all correct + well-tested; the `setMonth` overflow trap is avoided (cursor built at day 1). No fresh
  defect — **recorded dry, did NOT manufacture a finding.** DELIVERED a guard for the one real gap the
  scout surfaced: `monthsBetween` — the signed whole-calendar-months helper behind TWO money divisors
  (financing months-elapsed `Math.max(0,…)`; all-time TCO cost-per-month `Math.max(1,…)`) — was only
  IMPORTED + name-checked in a comment (per-vehicle.property.test.ts:574), never directly asserted (the
  C181/C229 "helper tested only in isolation" gap). GUARD: +6 cases in tco-months-owned.test.ts pinning
  the year×12+delta math, same-month=0, cross-year, multi-year, and the documented SIGNED negative
  contract. NON-VACUOUS: dropping `*12` from monthsBetween turns 3 cases RED; restored → green. Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean, 1582 pass / 0 fail (+6), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.2% / fe 85.89% (~ — analytics helper now directly pinned).
- **C7 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; infra was the sole
  over-budget category, 7/6).** (1) UNTRACKED-TEST SWEEP: `git status` shows ZERO untracked `.test.ts`/
  `.spec.ts` files — every committed-extension test is in git (the 45 `.meshclaw.e2e.ts` specs are
  gitignored-by-design agent-harness files, correctly excluded; the committed regression net is the
  unit + HTTP-harness suites). No specs at risk of vanishing on merge. (2) COVERAGE RE-MEASURE (replaces
  the carried `~`): **BE 87.22% line / 86.96% func** (bun --coverage file-mean across 103 src files);
  **FE 85.95% line / 87.15% func / 78.38% branch** (vitest v8 aggregate, 1138/1324 lines). Both at the
  ~87/~86 structural ceiling — flat-to-up vs the C460 baseline (BE 87.09/86.60, FE 85.89/87.15/78.35). BE
  low spots remain DI/OAuth-bound (auth/routes 18.6%, provider services, backup-orchestrator, db
  connection) — NOT clean unit picks. (3) BOTH-SIDES GREEN confirmed: BE 1582 pass / 0 fail, FE 715 pass /
  0 fail. (4) BRANCH STATE: claude-loop-dev = 6 commits ahead of fresh origin/main (C1 feature, C2 bug,
  C3 deep-review, C4 guard, C5 feature, C6 guard), PR-ready; recorded here since BRANCH_REVIEW.md is
  gitignored. Doc-only cycle — no source touched. cov: be 87.22% / fe 85.95% (MEASURED, not carried).
