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
> components). **RE-MEASURED C42 (infra cadence): BE 87.33% line / 86.97% func (file-mean, 1616 pass); FE
> 86.35% line / 87.68% func / 78.78% branch (v8, 735 pass) — BOTH sides ticked UP vs C35: BE line +0.04 (the
> C39 consumeOAuthState + C40 #97 deactivate-vehicleless tests added covered lines), FE line/func/branch all
> up (the C37/C41 import-dialog markup + C38's NEW import-mapping-helpers.ts module/tests).** Both still at
> the ~87 BE / ~86 FE structural ceiling; treat as the floor. (C35: BE 87.29/86.97, FE 86.14/87.31/78.70.
> C28: BE 87.22/86.97, FE 86.14/87.31/78.70. C21: BE 87.22/86.96, FE
> 86.07/87.19/78.53. C14: BE 87.22/86.96, FE 86.07/87.19/78.53. C7: FE 85.95/87.15/78.38.)

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category. Recompute ALL 6 every
cycle (slow-budget categories mis-forecast otherwise).

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 41 |
| deep-review | 5 | 39 |
| guard | 6 | 38 |
| bug | 3 | 40 |
| arch | 5 | 43 |
| infra | 6 | 42 |

Current cycle: **43**

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
- **C8 (deep-review)** — **Certified the restore `stampUserId` cross-tenant-write chokepoint + broadened
  its guard.** stampUserId (restore.ts) forces the importer's userId onto every directly-owned row of an
  UNTRUSTED backup — "the single chokepoint that holds regardless of which validators run," applied to 9
  tables (vehicles/insurance/reminders/reminderNotifications/expenses/odometer/userPreferences/syncState/
  photos). VERIFIED FIRSTHAND: the only existing stamp test tampered `vehicles.csv` ONLY — a dropped stamp
  on any other insert (the C3-class structural-invariant drift) would plant a cross-tenant row with NO
  test red. KEY FINDING from doing it firsthand: validateBackupData REJECTS a foreign userId on LEAF
  tables (expenses/reminders user-check against the metadata set → belt-and-suspenders), but
  `validateInsuranceRefs` checks only `id` presence — so `insurance_policies` is a genuine STAMP-ONLY
  root table (exactly as the docstring flags; my first attempt tampering expenses.csv was REJECTED at
  validation, which is what surfaced this). GUARD: +1 case in restore-userid-stamp.test.ts tampering
  insurance_policies.csv to a victim id → asserts the restored policy is owned by the importer.
  NON-VACUOUS: dropping the insurance stamp turns ONLY the new case RED (vehicles + untampered stay
  green); restored → 3 pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1583 pass /
  0 fail, build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 85.95% (~ — sync module
  already well-covered; +1 broadens the cross-tenant security net to a stamp-only root table).
- **C9 (feature)** — **Recurring-expenses T6: "Recurring" badge on expense rows (eyes-on DONE).** feature
  + bug both sat AT budget; feature (lowest budget, shippable eyes-on tails) is higher-leverage than a
  bug re-scout. T6's backend seam (GET /reminders/:id/expenses C122) + FE client method
  (getMaterializedExpenses C134) were done; the badge's read data (sourceType on the expense list) landed
  T1/C96 — only the badge MARKUP remained. Built `RecurringExpenseBadge.svelte` (Repeat-icon inline pill
  mirroring SplitExpenseBadge + the C5 RecurringCostCard icon), rendered on standalone expense rows where
  `sourceType==='reminder'` in BOTH the desktop ExpensesTable (next to the category label) and the mobile
  card (meta row). Booted a fresh stack, created an OVERDUE monthly expense reminder ($125.50 insurance),
  triggered materialization (10 catch-up rows), and **Read the PNG**: the Feb–Dec 2024 materialized rows
  each render the "Recurring" pill next to "Financial", while non-reminder expenses (Maintenance) show NO
  badge — full FE→BE→DB→render round-trip confirmed. Ticked spec T6 → `[~]` (badge done; the
  "materialized N expenses" reminder-side view remains as a future sub-task). Verify: frontend
  validate:local GREEN — type-check 0, build OK, 715 tests pass. cov: be 87.22% / fe 85.95% (~ —
  UI-markup cycle, no vitest module touched; the badge's sourceType read is backend-covered at T1/C96).
- **C10 (bug-scout → DRY, false-positive correctly debunked)** — bug was the sole over-budget category
  (4/3). Scouted the FE store/state layer (the C6-flagged "FE store race/stale-state" vein, untouched
  this run): app/offline/sync-state/theme stores are clean immutable getter-setter holders with no logic
  to harbor a defect; app.svelte.ts notifications use UUID ids + immutable updates. Dug into sync-manager
  (the data-safety-dense module). HYPOTHESIS RAISED + DEBUNKED FIRSTHAND (the GUIDE's "agent HIGH findings
  are often false" — proven again): `checkForExistingExpense` GETs `?date=&amount=` params the backend
  SILENTLY IGNORES (not in expenseQuerySchema → Zod strips), so the finder matches on vehicle+shared-tag
  only. I drafted a fix narrowing to date+amount — but the EXISTING tests (lines 676-689) explicitly
  assert a different-date/different-amount tag-sharing row MUST classify as `'modified'`. The design is a
  DELIBERATE two-stage: broad finder (candidate) → determineConflictType classifies duplicate-vs-modified.
  Narrowing the finder would silently DROP all `'modified'` conflict detection — a regression, not a fix.
  REVERTED both files (git checkout); no bug exists. The `?date=&amount=` params are dead/misleading but
  HARMLESS (ignored) — removing them is an arch-risk not worth taking against the working two-stage flow.
  Recorded so it's not re-chased. No code shipped this cycle by design (shipping a false fix is the worst
  outcome). Verify: sync-manager suite 22/22 green on the untouched tree. cov: be 87.22% / fe 85.95% (~).
- **C11 (guard)** — **Extended the restore cross-tenant-write stamp guard to `photos` (the C8 follow-on).**
  Nothing strictly over budget (arch sat AT 5/5 but was recorded no-churn twice, C4/C6 — "don't force a
  4th scout"); took the highest-leverage open item: the concrete guard target C8 flagged
  (photos/userPreferences/syncState remain stamp-only-unguarded). VERIFIED FIRSTHAND: validatePhotoRefs
  (backup.ts) checks only entityType + entityId membership, NOT the photo's userId against the metadata
  set — so, like insurance (C8) and unlike the leaf expenses/reminders (which validation user-checks),
  `photos` is a STAMP-ONLY-defended root table; a tampered foreign userId on a photo row passes validation
  and reaches the insert where stampUserId is the sole defense (a real cross-tenant write — receipts/
  vehicle/claim docs — NORTH_STAR #2). GUARD: +1 case in restore-userid-stamp.test.ts (now covers
  vehicles + insurance + photos) — seed a photo row directly (no storage provider needed for the restore
  path, mirroring claims-roundtrip.test.ts), tamper photos.csv to a victim id, assert the restored photo
  is owned by the importer. NON-VACUOUS: dropping the photos stamp turns ONLY the new case RED; restored →
  4 pass. Remaining stamp-only-unguarded: userPreferences/syncState (PK'd by userId, so a foreign-id row
  is a PK collision not a silent cross-tenant write — lower priority; left for a future cycle). Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean, 1585 pass / 0 fail, build bundled. Backend-only
  (no UI → no shot). cov: be 87.22% / fe 85.95% (~ — sync module already well-covered; +1 security net).
- **C12 (arch-scout → no-churn → feature)** — arch was over budget (6/5; forced). Scouted FRESH modules
  (C4/C6 had cleared the rest): the FE service layer (insurance/odometer/vehicle-api etc. all delegate to
  the shared apiClient.get/post/getPaginated — thin per-domain wrappers, not dup) + api-transformer.ts
  (the to/fromBackendExpense mappers are deliberately asymmetric — create-vs-edit description, volume↔charge
  routing — no extraction). **Recorded: no churn warranted** (arch at its structural floor, 3rd confirm).
  PIVOTED to the highest-leverage open item: **recurring-expenses T5** (app-init trigger hook). The pure
  gate (shouldTriggerRecurringExpenses C128) was done; built the orchestration helper
  `maybeTriggerRecurringExpenses` (localStorage debounce around the gate, injected trigger, stamp-on-success
  only, fail-soft, corrupt-ts→never-run) + wired it into +layout.svelte's authed-init `$effect`. +5 unit
  tests. EYES-ON CONFIRMED: seeded an overdue expense reminder, loaded /dashboard WITHOUT a manual trigger
  → the backend log shows exactly ONE app-fired POST /reminders/trigger → 200 → 12 expenses materialized
  (0→12) → dashboard Recurring Costs widget shows $99/mo·1 + Upcoming Reminders shows it (Read the PNG).
  Ticked spec T5 → `[x]`. Verify: frontend validate:local GREEN — type-check 0, build OK, 721 tests pass
  (+5). cov: be 87.22% / fe 85.95% (~ — the new helper is unit-covered; eyes-on path is backend-covered).
- **C13 (deep-review)** — **Certified the replace-mode restore wipe+reinsert FK-ordering CLEAN + left a
  full-dataset guard.** deep-review was at budget (5/5, highest-leverage of the at-budget three). Audited
  `deleteUserData` + `insertBackupData` (restore.ts) against the schema FK graph — the data-safety path a
  replace-restore runs (wipe-then-reinsert; FKs enforced via PRAGMA foreign_keys=ON; bun async-tx doesn't
  roll back a throw, the C151/#127 footgun → an FK violation mid-restore corrupts the account, NORTH_STAR
  #1). Existing tests each seed ONE entity family + unified-restore replace-restores an EMPTY backup — NONE
  exercise the ordering under a complete FK-linked dataset. GUARD: new
  `restore-replace-delete-ordering.test.ts` (+2) seeds a full graph (vehicle+financing+odometer+expense+
  insurance policy/term/junction/claim+reminder/junction/notification+photo+prefs/syncState), replace-
  restores, asserts every table round-trips to its exact pre-restore count (no loss/dup) + a double-replace
  idempotency case. KEY FIRSTHAND FINDING (verified by mutation): the DELETE order is cascade-REDUNDANT
  (child FKs are onDelete:cascade → deleting a parent first just cascades, no throw) — the real load-bearing
  constraint is the INSERT order in insertBackupData (parent-before-child); relocating the financing insert
  before the vehicles insert turns the guard RED (FK violation), so it's non-vacuous on the actual
  constraint. Also surfaced: a costed insurance term auto-materializes a premium expense (so expenses=2 not
  1 — asserted against a snapshot, not a hardcoded count). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1587 pass / 0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22%
  / fe 85.95% (~ — restore module already well-covered; +2 broaden the crown-jewel round-trip net).
- **C14 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; infra was the
  most-starved of two over-budget cats: infra 7/6 > bug 4/3).** (1) UNTRACKED-TEST SWEEP: CLEAN — zero
  untracked `.test.ts`/`.spec.ts` (the 45 `.meshclaw.e2e.ts` are gitignored-by-design). (2) COVERAGE
  RE-MEASURED (6 commits since the C7 sweep): **BE 87.22% line / 86.96% func** (file-mean, 103 src files —
  UNCHANGED vs C7; C8/C11/C13 added sync tests on already-covered modules); **FE 86.07% line / 87.19% func
  / 78.53% branch** (v8, 1150/1336 lines — UP vs C7's 85.95/87.15/78.38, from the C12
  maybeTriggerRecurringExpenses unit tests). Both at/above the ~87 BE / ~86 FE structural ceiling. BE low
  spots unchanged (auth/routes 18.6%, provider services, backup-orchestrator, db connection — all
  DI/OAuth-bound). (3) BOTH-SIDES GREEN: BE 1587 / FE 721. (4) BRANCH STATE: claude-loop-dev = 7 commits
  ahead of fresh origin/main (C1-C13: 3 feature, 2 bug[1 dry], 2 deep-review, 2 guard, 1 infra, +the C7
  infra), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.22% / fe 86.07% (MEASURED, not carried). NEXT cadence ~C24.
- **C15 (bug-scout → DRY, 3rd consecutive)** — bug was the sole over-budget category (5/3). Scouted FOUR
  fresh money/unit/date surfaces firsthand (the productive vein): (1) unit-conversions.ts — convertDistance/
  Volume/Efficiency math correct (efficiency scales by distFactor/volFactor; verified 30 mi/gal_US→12.75
  km/L) + property-tested + all 3 callers gas-isolated via gasEfficiencyPoint (#119/#126 class closed);
  (2) calculations.ts calculateAverageMPG/MilesPerKwh — nearly flagged the `previous.missedFillup`
  exclusion as over-aggressive, but the existing unit test (:106) + property-test reference impl both
  ENCODE it as intended → documented, not a bug (firsthand debunk #2); (3) vehicle-stats.ts
  calculateMileageStats/calculateAverageMpg — clamp-at-0 (#46) + defensive sort (#75) correct + pinned;
  (4) getPeriodStartDate/parseClampedInt/maxOf — all correct + #70/#81-guarded. NO fresh defect — recorded
  dry, did NOT manufacture a finding (GUIDE: agent HIGH findings often false; the pure-logic bug surface is
  exhausted this run, remaining real defects are the parked product-gated #94/#30). SURFACED for a FUTURE
  ARCH cycle (not done here — arch isn't over budget, category discipline): calculateAverageMPG
  (calculations.ts) and calculateAverageMpg (vehicle-stats.ts) are near-identical pairing loops (same
  missedFillup skip + mpg>0&&<150 band) — a real C161-class drift vector; seeded the arch queue. No code
  shipped by design. Verify: targeted suites green on the untouched tree (calculations + unit-conversions).
  cov: be 87.22% / fe 86.07% (~).
- **C16 (feature)** — **Recurring-expenses T6-view: "materialized N expenses" dialog (eyes-on DONE → T6
  COMPLETE).** feature sat AT budget (4/4, highest-leverage). T6's badge shipped C9; the view sub-part
  remained, with the backend seam (GET /reminders/:id/expenses C122) + FE client method
  (getMaterializedExpenses C134) already done. Built `MaterializedExpensesDialog.svelte` (Dialog +
  four-states loading/data/empty/error-retry, composed from the kit), opened from a Receipt "View
  materialized expenses" button on every expense-type reminder card on /reminders; lists each materialized
  row (category · date · vehicle · amount) + an "N expenses · $total" summary. Booted a fresh stack, ran
  an untracked spec that creates an overdue $75 monthly reminder, triggers it (12 catch-up rows), opens the
  dialog, and screenshots it. **Read the PNG**: dialog renders "12 expenses · $900.00 total" with each
  Financial · {date} · Daily Driver · $75.00 row; backend log confirms the dialog-open fired
  GET /reminders/:id/expenses → 200. Full FE→BE→DB→render round-trip. Ticked spec T6 → `[x]` (badge+view
  both done). Verify: frontend validate:local GREEN — type-check 0, build OK, 721 tests pass. cov: be
  87.22% / fe 86.07% (~ — UI-markup cycle; the dialog's data path is backend-covered by the C122 HTTP tests).
- **C17 (arch)** — **MPG-pairing dedup (the C15-seeded pick — a real C161-class drift vector).** arch sat
  AT budget (5/5); took it because — unlike the prior 3 no-churn scouts — there was a GENUINE pre-surfaced
  pick. `calculateAverageMPG` (calculations.ts) and `calculateAverageMpg` (vehicle-stats.ts) hand-copied
  the same consecutive-fill-up loop (missedFillup skip + both-odometers-and-volume guard + mpg=miles/vol +
  the (0,150) band + mean). Extracted ONE pure `averageConsecutiveMpg(sortedExpenses)` in calculations.ts
  over a minimal structural row type; both callers now sort (each keeping its OWN contract —
  calculations via sortExpensesByDate, vehicle-stats via its defensive #75 inline date sort) then delegate.
  BEHAVIOR-PRESERVING: takes PRE-SORTED input so no sort-policy change; the (0,150) band preserved EXACTLY
  (do NOT unify with analytics' [5,100] — that's the product-gated #30 call, explicitly NOT touched);
  routed both through calculateMPG (the fuel>0-guarded form) — identical given the existing volume truthy
  guard. Arch rule 3 satisfied: both functions are property-tested (calculations.property +
  vehicle-stats.property's referenceMpg), green→green (58 pass / 1898 assertions across the 4 MPG suites).
  Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1587 pass / 0 fail (unchanged — pure
  dedup), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 86.07% (~ — same modules,
  same tests; LOC down, one source of truth for the C161-vulnerable loop).
- **C18 (guard)** — **Direct unit net for `averageConsecutiveMpg` (the C17-extracted shared MPG loop).**
  guard was over budget (7/6). The C17 dedup created a load-bearing shared helper that was only tested
  INDIRECTLY through its two callers (calculateAverageMPG + calculateVehicleStats) — the C181/C229
  "helper tested only in isolation" gap (same class as monthsBetween/C6). GUARD: +6 cases in
  calculations.test.ts pinning the helper's OWN cells: mean over consecutive pairs (miles/current.volume),
  <2-rows/empty→null, missedFillup-skip (current OR previous), both-odometer-AND-current-volume guard,
  outlier drop (negative-delta + ≥150), and the half-open band edge (149.9 kept / exactly 150 dropped).
  Surfaced + pinned a real footgun while writing it: the loop guard is `current.mileage && previous.mileage`
  (TRUTHY) so a 0-odometer reading is falsy and drops the pair — documented in the test so a future reader
  doesn't anchor a case at mileage 0. The (0,150) band is the #30-escalated divergence point — pinned
  EXACTLY, NOT unified (product call). Inherently non-vacuous (exact-number/null per branch). Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean, 1593 pass / 0 fail (+6), build bundled.
  Backend-only (no UI → no shot). cov: be 87.22% / fe 86.07% (~ — calculations module already covered;
  +6 pin the newly-shared helper directly).
- **C19 (deep-review)** — **Audited the foreign-import money/date path firsthand (all CLEAN) + eyes-on
  certified the C16 dialog's EMPTY state.** deep-review was over budget (6/5, most-starved; bug also over
  at 4 but less-starved). Scouted four fresh surfaces: Google Sheets service (header-coverage + service
  tests already saturated), csv-safety (neutralize/denormalize + round-trip tests saturated), and
  import-mapping's `normalizeDecimal` + `normalizeForeignDate`. DEBUNKED a candidate firsthand: comma-only
  `normalizeDecimal` (e.g. "1,234"→"1.234") LOOKS like a thousands bug, but the tests + #124 lesson
  establish comma-only = EU decimal BY DESIGN (the both-separator US case is the #124 fix; comma-only-
  thousands is a known single-value ambiguity resolved toward EU) — intended, not a bug. normalizeForeignDate
  is comprehensively pinned (local-time discipline / mdy-dmy swap / epoch sec-millis / 2-digit-year pivot /
  out-of-range #23 guard). No fresh defect. DELIVERED the eyes-on half of deep-review: certified the C16
  MaterializedExpensesDialog EMPTY state (shipped C16 but only its DATA state was shot) — a future-dated
  reminder (Next: Jan 2099, 0 materialized) opens the dialog → renders the "No expenses yet" Receipt
  EmptyState cleanly (Read the PNG; backend GET /reminders/:id/expenses→200 returned []), NOT a blank/broken
  panel. The dialog's data + empty four-states are now both eyes-on confirmed. Verify: frontend
  validate:local was GREEN at C16 (no FE source changed this cycle; the spec is gitignored). cov: be 87.22%
  / fe 86.07% (~ — audit + eyes-on cert, no module touched).
- **C20 (bug)** — **#30 efficiency-band unification (Angelo-APPROVED 2026-06-17).** bug was over budget
  (5/3). DISCOVERED mid-cycle that Angelo ratified the entire pending-Angelo backlog as actionable-with-
  agreed-fixes (a new BACKLOG block) — so the bug surface is NOT exhausted; there's a severity-ranked queue
  of real approved fixes. Picked the highest-leverage approved BUG that my own C17/C18 work made a near-one-
  edit: the #30/#94-adjacent (C419) divergence — per-vehicle stats used the `(0,150)`/`(0,10)` band while
  analytics charts used `[5,100]`/`[1,10]`, so the SAME car showed two different MPG/mi-kWh averages on the
  stats card vs the Analytics Fuel Stats card. FIX (Angelo's agreed approach): unify on the documented
  `[5,100]` gas / `[1,10]` electric band. Moved the 4 band constants (MIN/MAX_VALID_MPG, MIN/MAX_VALID_MI_KWH)
  into calculations.ts as ONE source of truth (the lower-level module; analytics-charts now imports them —
  correct dependency direction, no cycle), and switched `averageConsecutiveMpg` (gas) +
  `calculateAverageMilesPerKwh` (electric) to the inclusive shared bounds. Updated the band-dependent tests
  + both property-test reference impls + the analytics boundary describe (now pins INCLUSIVE 100 kept / <5
  dropped / the new MIN floor) + stale divergence comments. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1594 pass / 0 fail, build bundled. Backend-only (per-vehicle stats come from /stats →
  this band; FE has no own MPG band → no divergence). cov: be 87.22% / fe 86.07% (~ — bands unified, same
  modules). NOTE the C19 financing/TCO audit (buildAmortizationSchedule/computeTCOTotal/categorizeTCOExpenses)
  was done first this cycle + all CLEAN — folded into this entry; that vein stays dry.
- **C21 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence).** Two cats over
  budget (infra 7/6 > feature 5/4); infra is the most-starved → forced. (1) UNTRACKED-TEST SWEEP: CLEAN —
  zero untracked `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts` are by-design). (2) COVERAGE
  RE-MEASURED (6 commits since C14): **BE 87.22% line / 86.96% func; FE 86.07% line / 87.19% func / 78.53%
  branch** — BOTH UNCHANGED vs C14 (the C15-C20 arc was tests/dedups on already-covered modules + the C16
  eyes-on dialog; the C20 band-unification swapped literals, no new lines). At the ~87 BE / ~86 FE
  structural ceiling. (3) BOTH-SIDES GREEN: BE 1594 / FE 721. (4) BRANCH STATE: claude-loop-dev = 20
  commits ahead of fresh origin/main (C1-C20: 4 feature, 2 bug[1 dry]+1 dry-scout, 3 deep-review, 2 guard,
  1 arch, 2 infra), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source
  touched. cov: be 87.22% / fe 86.07% (MEASURED). NEXT cadence ~C31.
- **C43 (arch)** — **Dedup the duplicated target-vehicle picker in ImportExpensesDialog into a shared
  `{#snippet}` (the C37-created drift vector — a genuine fresh pick).** arch was the SOLE over-budget
  category (43−36=7/5, +2; bug sat AT 3/3, not over). Unlike the C4/C6/C12/C36 no-churn scouts, there was
  a REAL pick exactly where the standing lesson predicts (a feature cycle copies markup into a component →
  the NEXT arch cycle dedups it; C15→C17, C22→C23): the C31 preset-path target-vehicle picker (the
  detected-tracker banner) and the C37 manual-path target-vehicle picker were near-byte-identical ~22-line
  blocks — same bound `targetVehicleId` + `handleTargetVehicleChange`, same `Select.Root`/trigger/Content/
  `#each vehicles` + empty-state, differing ONLY in the trigger `id`, wrapper class, and empty-state copy.
  Verified firsthand there's no existing shared vehicle-picker component and `{#snippet}` is an established
  idiom here (used across ~15 components). FIX: extracted ONE local `{#snippet targetVehiclePicker(triggerId,
  emptyText)}` at the top of the dialog content + `{@render}`'d it at both sites; each KEEPS its own wrapper
  `<div>` (the manual one's `border-t pt-3` separator + the preset one's plain `space-y-1.5` legitimately
  differ — arch rule 1, converge only the truly-identical inner control). Net −17 LOC (46 del / 29 add).
  A local snippet, NOT a new shared file — the picker binds this component's `targetVehicleId`/handler, so
  lifting it out would force a prop-drilling seam for zero reuse elsewhere (rule 1/5). BEHAVIOR-PRESERVING
  confirmed eyes-on (rule 4, UI-touching): booted fresh (RESET_DB) + ran BOTH picker-path specs GREEN —
  import-mapping-detect (preset picker: Fuelly auto-detect → pick vehicle → preview) +
  import-manual-units (manual picker: km/litres log → pick vehicle → committed row converted 160.9344 km→
  100 mi end-to-end). Read the manual-editor PNG: the "Map your columns" editor + all field/date/unit
  dropdowns render pixel-identical. No characterization test needed beyond these (the snippet is pure
  markup; the 3 e2e specs ARE the merge-surviving net, and the C38 helper tests pin the logic). Verify:
  frontend validate:local GREEN — type-check 0, build OK, 735 tests pass. cov: be 87.33% / fe 86.35% (~ —
  markup-only dedup, no module logic touched; FE coverage was just MEASURED C42). Arch was NOT at its floor
  this cycle — the C37 feature created the drift; keep watching for this after eyes-on features.
- **C42 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C35).**
  TWO over budget at C42 — infra (42−35=7/6, +1) and arch (42−36=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). Warranted on substance, not just the counter: 7 cycles since C35 incl. C38's NEW
  `import-mapping-helpers.ts` vitest module + C39/C40 BE tests + C37/C41 FE markup. (1) UNTRACKED-TEST
  SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored `*.meshclaw.e2e.ts` agent-harness
  specs are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are the intentional local
  overrides that keep `.meshclaw-tools/`/`mise.local.toml`/the e2e specs ignored — NOT product changes,
  left uncommitted by design so the PR stays harness-free). (2) COVERAGE RE-MEASURED (7 commits since C35):
  **BE 87.33% line / 86.97% func** (file-mean, 1616 pass); **FE 86.35% line / 87.68% func / 78.78% branch**
  (v8, 735 pass) — BOTH sides UP vs C35 (BE line 87.29→87.33 from C39/C40's added covered lines; FE
  86.14→86.35 line / 87.31→87.68 func / 78.70→78.78 branch from the C37/C41 dialog markup + C38's new
  helper module). Both still at the ~87 BE / ~86 FE structural ceiling; treat as the floor. (3) BOTH-SIDES
  GREEN: BE 1616 / FE 735. (4) BRANCH STATE: claude-loop-dev = **42 commits ahead** of fresh origin/main
  (C1–C41: 2 features COMPLETE [maintenance C1, recurring-expenses C27] + import-trackers T4 manual path
  DONE through unit pickers C41; category spread feature 10 / bug 9 / guard 7 / deep-review 7 / infra 5 /
  arch 3), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.33% / fe 86.35% (MEASURED). NEXT cadence ~C52.
- **C41 (feature)** — **Import-trackers T4: manual-mapping unit pickers (eyes-on DONE; #NS2 fix).** Nothing
  strictly over budget (infra/arch/feature tied AT 6/6,5/5,4/4); took the highest-leverage item — feature's
  only open work (import-trackers) had a genuine UNBLOCKED correctness gap from my own C37: the manual
  column-mapping path never set the file's units, so a manually-mapped METRIC log imported raw km/litres
  into a miles/gallons vehicle (CONFIRMED FIRSTHAND: applyMapping's mapMileage/mapVolume convert ONLY when
  both the file's unit AND the target's unit are known — import-mapping.ts:245/229; manual buildMapping set
  neither). FIX: added Odometer-unit + Volume-unit pickers to the manual editor (shown only when those
  columns are mapped), defaulting to the target vehicle's units (= no-conversion baseline, re-seeded on
  vehicle change); buildMapping sends distanceUnit/volumeUnit only when the matching column is mapped → the
  server converts into the vehicle's units. EYES-ON via `import-manual-units.meshclaw.e2e.ts` + 2 shots
  (Read): a km/litres log fully mapped via the per-field dropdowns + units set to Kilometers/Liters →
  committed row CONVERTED 160.9344 km→100 mi, 37.854 L→~10 US gal (verified via API — the #NS2 proof).
  Added `data-testid`s to the manual field/unit Select triggers for deterministic e2e targeting (the
  dropdowns render all headers as options, so bits-ui listbox selectors needed a stable hook). DEBUG: the
  CSV headers first matched the Fuelio preset (odo+litres) → switched to non-preset headers; long-form unit
  labels (Kilometers/Liters) not short; row identified by converted mileage (Memo wasn't mapped to
  description). Verify: frontend validate:local GREEN — type-check 0, build OK, 735 tests. cov: be 87.29% /
  fe 86.14% (~ — UI-markup cycle; conversion path backend-covered T1). T4 REMAINING: a category-remap table
  for unknown category WORDS; the Angelo-gated preset defaultCategory; T6 round-trip e2e.
- **C40 (bug #97)** — **Auto-deactivate a reminder left vehicleless by a vehicle delete (Angelo-APPROVED
  Sev-3).** bug was the sole over-budget category (40−36=4/3). Sev-1 design-doc-gated + #94 is a class →
  took the clean approved Sev-3 orphan #97 (cleaner than its #88 sibling, which mutates the split-config
  JSON blob). CONFIRMED FIRSTHAND: `reminder_vehicles.vehicleId` is onDelete:cascade (schema:217), so a
  vehicle delete drops the junction rows but the reminder ROW survives — a reminder linked to ONLY that
  vehicle is left is_active=1 with ZERO vehicles, which processReminder skips 'no_vehicles' (trigger-service
  :441) every run forever, a silent never-firing orphan still shown active. FIX (Angelo's agreed
  deactivate): new `reminderRepository.deactivateVehicleless(userId)` — a LEFT JOIN reminders↔
  reminder_vehicles WHERE isActive AND junction isNull → bulk set isActive=false; called in the vehicle-
  delete route AFTER `vehicleRepository.delete`. GUARD: flipped the pre-existing #97 CHARACTERIZATION test
  (it pinned the buggy is_active=1/'no_vehicles' state, explicitly as a "red→green anchor for the eventual
  fix") to the fixed behavior + added a multi-vehicle case (NOT over-deactivated — keeps its remaining
  vehicle). NON-VACUOUS: removing the deactivateVehicleless call turns the single-vehicle test RED
  (is_active stays 1) while the multi-vehicle stays green. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1616 pass / 0 fail, build bundled. Backend-only (no UI → no shot; the deactivation
  surfaces via the existing reminders list). cov: be 87.29% / fe 86.14% (~ — vehicle-delete + reminder repo
  already covered; the new method + flipped test pin the orphan fix). NOTE: #88 (the SPLIT-config-blob
  sibling — prune the deleted vehicleId from a reminder's expenseSplitConfig JSON) is still OPEN; same
  family, more involved (JSON renormalize + the C151 async-tx footgun on the surviving leg).
- **C39 (deep-review)** — **Certified the OAuth-state CSRF consume CLEAN + replaced brittle source-scans
  with a behavioral guard.** deep-review was the sole over-budget category (39−33=6/5). Per the C33 note
  (TCO money path certified), picked the next UNAUDITED surface: the auth/OAuth path. Audited the
  highest-stakes invariant — the `oauthStateStore` single-use CSRF token across login/link/provider flows.
  CERTIFIED FIRSTHAND (scratch probe): the state consume is CLEAN — single-use (replay rejected),
  flow-isolated (a login state ≠ link/provider state), anti-fixation (a mismatched/unknown state is DELETED
  on the failed lookup), null-safe. BUT the only existing coverage (auth-routes.property.test.ts) was
  BRITTLE SOURCE-STRING SCANS — it asserts the validator body CONTAINS `storedData.flowType`/`'auth-link'`,
  which would pass even if the logic were inverted and pins NO actual behavior. GUARD: extracted the
  single-use+flow-isolation logic into a pure `consumeOAuthState(store, stateParam, expectedFlow)` in
  auth/utils.ts (the C38 "untestable-in-place → pure module" pattern); routed the two simplest validators
  (login/link) through it (the provider `resolveProviderState` keeps its own inline consume — it adds a
  PKCE codeVerifier assertion — same contract, left untouched to bound risk). +9 BEHAVIORAL cases
  (consume-oauth-state.test.ts: single-use/replay, 3-way flow isolation, anti-fixation delete, null-safe);
  replaced the 2 obsolete source-scans with thin wiring checks (validator delegates with the right flow
  arg). Behavior-preserving — the 3 existing auth property suites stay green. Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean, 1615 pass / 0 fail (+7 net), build bundled. Backend-only (no UI → no
  shot). cov: be 87.29% / fe 86.14% (~→UP — the CSRF consume logic is now unit-covered where it was only
  string-scanned). NOTE: #129 (OAuth login email-sync, MED, filed C433) also lives on this path — still a
  product call (don't sync / sync-if-unset / notify), NOT auto-fixed.
- **C38 (guard, arch-extract→pin in one cycle)** — **Extract + pin the C37 manual-mapping pure helpers.**
  Nothing strictly over budget (guard + deep-review tied AT 6/6 + 5/5); took the highest-leverage item via
  the standing pattern (a feature cycle that adds logic seeds the next guard cycle — C22→C23, C31→C32). C37
  buried three PURE functions inside ImportExpensesDialog.svelte where vitest can't reach them
  (`.svelte` <script>): the CSV header split+dequote, the native-export detection that gates the manual
  editor, and the auto-guess needle map. EXTRACTED them to a new pure `src/lib/utils/import-mapping-helpers
  .ts` (`parseCsvHeaders` / `isNativeImportHeaders` / `guessManualColumns`, no Svelte/DOM deps) + rewired
  the dialog to import them (the inline `NATIVE_HEADERS` const + inline `guessManualColumns` removed).
  BEHAVIOR-PRESERVING (the C37 e2e stays green — extraction moved code, didn't change rendering). GUARD: new
  import-mapping-helpers.test.ts (+9): header parse (quotes/whitespace/empty), native-superset detection
  (gates the editor), and the guess needle sets — INCLUDING the C37 eyes-on additions (spent/paid/total→
  amount, kind→category) a bespoke export needed to preview. NON-VACUOUS: dropping the spent/paid/total
  needles turns the C37-needles case RED; restored → 9 pass. Verify: frontend validate:local GREEN —
  type-check 0, build OK, 735 tests pass (+9, 65 files). cov: be 87.29% / fe 86.14% (~→UP — the extracted
  helpers are now FE-unit-covered where they were unreachable inside the component; re-measure next infra
  cadence ~C45).
- **C37 (feature)** — **Import-trackers T4: manual column-mapping path for unrecognized CSVs (eyes-on
  DONE).** feature was the sole over-budget category (37−31=6/4). The Angelo-gated fuel-preset
  `defaultCategory` piece (flagged C31) stays parked, so took the genuinely UNBLOCKED T4 work: the manual
  column-mapping editor. When detection finds no preset AND the file isn't a native VROOM export
  (headers ⊉ date/vehicle/category/amount), the dialog renders "Map your columns" — a per-field dropdown
  for each VROOM field (date*/amount* required + category/vehicle/mileage/volume/fuelType/description/tags)
  populated from the file's own headers, a date-format picker, and the target-vehicle picker (shown only
  when no vehicle column is mapped, D4). `guessManualColumns` auto-maps by header-name substring (incl.
  spent/paid/total→amount, kind→category from C37 eyes-on); `buildMapping` drops unmapped fields → the
  EXISTING preview/commit runs verbatim. A native export still imports with NO mapping (unchanged path).
  EYES-ON via `import-manual-mapping.meshclaw.e2e.ts` + 2 shots (Read): a bespoke CSV (Transaction Date/
  Spent/Kind/Notes) → editor with guessed mappings (Amount→Spent, Category→Kind, Description→Notes) →
  after picking Daily Driver, "1 ready · 1 row needs attention" (the maintenance row imports; the fuel row
  correctly errors "fuel rows require fuel amount and mileage" — I didn't map volume/mileage). DEBUG: the
  first run's "Spent" header wasn't auto-guessed (only amount/price/cost) → added spent/paid/total + kind;
  a strict-mode `/ready/` selector matched 2 nodes → scoped to the commit button + `.first()`. Verify:
  frontend validate:local GREEN — type-check 0, build OK, 726 tests. cov: be 87.29% / fe 86.14% (~ —
  UI-markup cycle; the mapping data path is backend-covered T1-T3 + C32). T4 REMAINING: unit override
  pickers + a category-remap table; the Angelo-gated preset defaultCategory; T6 round-trip e2e.
- **C36 (arch-scout → no-churn → bug #85)** — **Arch at its structural floor (4th confirm); pivoted to the
  #85 relabel (Angelo-APPROVED Sev-2).** Two cats over budget (arch 6/5, feature 5/4 — tie on over-by);
  arch wins on raw starvation (6 > 5). SCOUTED firsthand for a clean dedup: (1) my C34 `effectiveTermCost`
  vs `effectiveMonthlyPremium` are DUALS, not duplicates — inverse precedence (premium: monthlyCost wins,
  amortize totalCost DOWN; termCost: totalCost wins, multiply monthlyCost UP) + opposite direction;
  converging would distort one (arch rule 2 PROHIBITS). (2) The source dup-markers all point to
  ALREADY-deduped sites (C200 date-key, the day-offset switch). (3) Route-handler ownership+respond is the
  natural Hono idiom with shared validators. **Recorded no churn warranted (4th confirm after C4/C6/C12).**
  PIVOTED to the highest-leverage UNBLOCKED item — feature's only open item (import-trackers) has its
  highest-value piece (defaultCategory:'fuel') ANGELO-GATED (flagged C31), so took the clean approved
  Sev-2 bug #85. FIRSTHAND: getFuelStats computes "currentYear" as `fuelRows.filter(isFillup).length` over
  the ENTIRE requested range, and `prevYearAgg` queries `[range.start − rangeWidth, range.start]` (the
  prior EQUAL-LENGTH window) — so the two "year" fields are RANGE-relative (current range vs prior equal
  period), NOT calendar years; under the default 'all' range "This Year" = all-time fill-ups, mislabeled.
  FIX (Angelo's agreed cheap relabel, NOT re-implement calendar math): FuelStatsTab "This Year"/"Last Year"
  → "This Period"/"Last Period" (4 labels across the Fill-ups + Liters cards); the calendar "This/Last
  Month" rows UNCHANGED (true calendar post-#86/C262). EYES-ON via fuel-stats-period-labels.meshclaw.e2e.ts
  + shot (Read `/tmp/c36-fuel-stats-period-labels.png`): cards show This Period/Last Period, no This/Last
  Year, This Month intact. Verify: frontend validate:local GREEN — type-check 0, build OK, 726 tests. cov:
  be 87.29% / fe 86.14% (~ — label-only UI change, no vitest module touched).
- **C35 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C28).**
  infra was the sole over-budget category (35−28=7/6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked
  `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts` agent-harness specs are by-design). (2) COVERAGE
  RE-MEASURED (6 commits since C28): **BE 87.29% line / 86.97% func** (file-mean); **FE 86.14% line / 87.31%
  func / 78.70% branch** (v8, 726 tests) — BE line ticked UP vs C28's 87.22 (C29/#51 + C33/TCO-bucket +
  C34/#69 added covered lines in analytics + insurance); FE FLAT (C29-C34 were all backend cycles + the C31
  FE-dialog markup hit no new vitest module). Both at the ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES
  GREEN: BE 1608 / FE 726. (4) BRANCH STATE: claude-loop-dev = 35 commits ahead of fresh origin/main (C1-C34:
  2 features COMPLETE [maintenance C1, recurring-expenses C27] + import-trackers T4-slice, 4 bug [#147/#30/
  #36/#51/#69 minus dupes], 4 deep-review, 4 guard, 3 arch, 3 infra), PR-ready; recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.29% / fe 86.14% (MEASURED). NEXT
  cadence ~C45.
- **C34 (bug #69)** — **Materialize a monthly-only insurance term into TCO (Angelo-APPROVED Sev-2).** bug
  was the sole over-budget category (34−29=5/3). Sev-1 (#37/#127) are design-doc-gated (arch rule-6), #94
  is a 6-member class → took the clean money-facing Sev-2 #69, on fresh C33 TCO context. CONFIRMED
  FIRSTHAND: `createTermExpenses` (hooks.ts) only materialized an expense when `totalCost > 0`, so a
  monthly-only term (monthlyCost set, no totalCost) created NO `insurance_term` expense row → it showed in
  analytics (`getInsurance`→`effectiveMonthlyPremium` honours monthlyCost) but was ABSENT from TCO's
  insuranceCost bucket (which sums those rows, C33-certified). FIX (Angelo's agreed `monthlyCost ×
  term-months`): extracted `effectiveTermCost(term)` in hooks.ts — `totalCost` when present, else
  `monthlyCost × monthKeysInRange(start,end).length` (the SAME inclusive month count
  effectiveMonthlyPremium amortizes a totalCost over → symmetric). createTermExpenses/updateTermExpenses
  compute via it; the 3 route call sites now pass monthlyCost+endDate + always call the hook (it no-ops on
  0). NO DOUBLE-COUNT: analytics reads term.monthlyCost directly, never the materialized rows. GUARD: +2 in
  premium-expense-hook.test.ts (monthly-only term → rows sum to monthlyCost×13 [2024-01-01→2025-01-01 = 13
  inclusive month-keys]; explicit totalCost still wins, no costed-path regression). NON-VACUOUS: reverting
  effectiveTermCost to totalCost-only turns the monthly test RED (0 rows). Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean, 1608 pass / 0 fail (+2), build bundled. Backend-only (no UI → no shot).
  cov: be 87.22% / fe 86.14% (~ — insurance hook + the materialization path now pinned for the monthly
  shape).
- **C33 (deep-review)** — **Certified the TCO `categorizeTCOExpenses` sourceType-bucketing CLEAN + left a
  money-facing guard.** deep-review was most-starved (33−26=7/5 > bug 4/3). Per the C19/C26 note
  (backup/restore/import/analytics swept), audited the highest-stakes UNAUDITED money path: the per-vehicle
  TCO categorization (NORTH_STAR #1). The #27/#28 financing-vs-purchase-price accounting is well-pinned
  (per-vehicle.property all-time + year arms), but a subtle seam was UNPINNED: `categorizeTCOExpenses`
  buckets a `financial` row by sourceType — `'financing'`→financingInterest, `'insurance_term'`→insurance,
  and ANY OTHER `financial` row (sourceType `'reminder'` from a recurring expense [C27], or null from a
  manual financial entry) falls through to otherCosts. Recurring-expenses (C27) now materializes exactly
  `financial`+`'reminder'` rows, so this seam is live. CERTIFIED FIRSTHAND (scratch probe): reminder/null
  financial → otherCosts (150), NOT financingInterest (200 = only the financing row); insurance 75; total
  425 = sum. CLEAN. GUARD: +2 cases in per-vehicle.property.test.ts — (1) the 4-way sourceType split
  (financing/insurance_term/reminder/null → correct buckets); (2) the DANGEROUS case: a PRICED vehicle with
  a reminder financial row keeps it in otherCosts ($30100 total), because a mis-bucket to financingInterest
  would make computeTCOTotal EXCLUDE it (#27 principal-retiring) → silently dropping a real recurring cost.
  NON-VACUOUS: dropping the `sourceType==='financing'` clause (bucket by category alone) turns BOTH RED
  (the PRICED case shows otherCosts 100→0, the silent-drop). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean, 1606 pass / 0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22%
  / fe 86.14% (~ — analytics repo already covered; +2 pin the money-facing bucketing seam). The TCO money
  path (financing/purchase-price #27/#28 + sourceType bucketing) is now broadly certified — next
  deep-review should pick a genuinely different surface (an eyes-on /insurance sweep, or the auth path).
- **C32 (guard)** — **Characterize the C31 import-preset category gap end-to-end (the standing
  bug-finding→next-guard pattern).** Two cats over budget (guard 7/6, deep-review 6/5 — tie on over-by);
  guard wins on raw starvation (7 > 6). The C31 eyes-on surfaced a concrete, unguarded invariant: the
  built-in fuel presets map NO category column, so a detected fuel log maps + resolves the vehicle but
  buildImportPlan errors EVERY row "Unknown category" → readyCount 0 (the presets import nothing today).
  The EXISTING round-trip test (import-mapping.test.ts) hand-ADDS a `category:'Type'` column + categoryMap
  to its mapping, so it tests a hypothetical mapping, NOT the REAL `MAPPING_PRESETS` — the gap was
  unpinned. GUARD: +2 cases in import-mapping-presets.test.ts driving all 3 real presets through
  presetToMapping → applyMapping → buildImportPlan: (1) NONE map a category column (the root); (2) each
  currently yields readyCount 0 / errorCount 1 / message matches /category/ (the end-to-end consequence).
  Verified the exact behavior firsthand via a scratch probe first (native CSV has a blank category cell →
  `Unknown category ""`). NET-FLIPPING by design: when the flagged fix (defaultCategory:'fuel' per preset)
  lands, the category expectation flips to 'fuel' + readyCount to N — these are the tests to update, and
  they're documented as such. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1604 pass /
  0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 86.14% (~ — import-mapping
  modules already covered; +2 pin the preset gap as a characterization net).
- **C31 (feature)** — **Import-trackers T4: auto-detect + target-vehicle mapping step (eyes-on DONE;
  preset gap flagged).** Nothing strictly over budget (guard/deep-review/feature all tied AT); took the
  highest-leverage open item — import-trackers is the ONLY remaining open feature (the other two DONE), and
  its mapping step is genuine net-new product UI. Scoped ONE coherent slice (not the whole dialog): the
  AUTO-DETECT path. Added `vehicles` prop to ImportExpensesDialog (already loaded on /expenses); on
  file/paste it splits the header row + calls `detectImportSource` → if a Fuelly/Fuelio/Drivvo preset
  matches, renders a "Detected a <Tracker> fuel log" banner + a target-vehicle picker (KEY firsthand fact:
  NO preset maps a `vehicle` column — these are single-vehicle fuel logs, so D4 requires picking one;
  auto-selects the only vehicle), builds the `ImportColumnMapping` from preset+vehicle, and threads it
  through the EXISTING preview/commit verbatim. A native VROOM export detects null → unchanged path
  (backward-compatible). EYES-ON via `import-mapping-detect.meshclaw.e2e.ts` + shot (Read
  `/tmp/c31-import-mapped-preview.png`): banner + picker render, "Daily Driver" auto-selected.
  EYES-ON CAUGHT A REAL PRESET GAP (firsthand, NOT a UI defect): the fuel presets map no category column +
  `mapCategory` leaves a blank category blank (the D2 "never invent a category" rule), so a detected fuel
  log previews **0-ready / "Unknown category"** — the presets are unusable end-to-end. This is a product/
  data-contract call (default a column-less fuel import to `category:'fuel'` vs the D2 rule) → send_message'd
  Angelo recommending option (a) defaultCategory:'fuel' per preset (a backend-preset change, a future cycle),
  did NOT auto-fix. The T4 UI slice stands on its own. Verify: frontend validate:local GREEN — type-check 0,
  build OK, 726 tests. cov: be 87.22% / fe 86.14% (~ — UI-markup cycle; the detect/map data path is
  backend-covered T1-T3). T4 REMAINING: the manual per-field column editor + category-remap table + the
  flagged preset defaultCategory.
- **C30 (arch)** — **Extract the canonical `SHEET_NAMES` tab roster (a real fresh dedup, not a no-churn
  scout).** arch was the sole over-budget category (30−23=7/5). No pick was pre-seeded, so scouted firsthand
  + found a GENUINE C161-class drift vector: the 15-tab Sheets roster was hand-copied across 4 sites (the
  literal `'Reminder Notifications'` appears 4×) — `createSpreadsheet` (initial tabs) + `ensureRequiredSheets`
  (backfill) are PURE title lists, while `updateSpreadsheetWithUserData` (write fan-out) +
  `readSpreadsheetData` (read ranges) pair each title with table-specific logic. Extracted ONE exported
  `SHEET_NAMES` const (the ordered 15-tab roster) and routed the two PURE-roster sites through it
  (`create` → `SHEET_NAMES.map(...)`, `ensure` → `SHEET_NAMES.filter(...)`); left the logic-paired
  write/read lists inline (converging those is riskier — arch rule 1, ONE small reviewable refactor).
  BEHAVIOR-PRESERVING: same titles, same create order → existing spreadsheets unaffected; proven by
  strengthening the create test to assert `info.sheets === [...SHEET_NAMES]` exactly (was a loose
  contains+length-15). Arch rule 3: +2 drift guards in sheets-header-coverage.test.ts (SHEET_NAMES is 1:1
  with the SHEET_HEADERS table count; entries distinct + non-empty) — so adding a 16th table forces a
  matching roster entry, closing the drift the extraction targets. Caught a TS literal-tuple type error
  (`as const` makes `.length` the literal `15`) → widened to `number` for the comparison. Verify: backend
  validate:local GREEN — tsc 0, musl-biome clean, 1602 pass / 0 fail (+2), build bundled. Backend-only (no
  UI → no shot). cov: be 87.22% / fe 86.14% (~ — same module, LOC down, one source of truth for the tab
  roster). NOTE: #37 (Sheets atomicity) remains the top Sev-1 — still arch rule-6 (design.md + Angelo), NOT
  taken as a churn-pick this cycle since a genuine clean dedup was available.
- **C29 (bug #51)** — **Exclude term-less active policies from `activePoliciesCount` (Angelo-APPROVED Sev-2).**
  Two cats over budget (bug 5/3 +2, arch 6/5 +1); bug is most-starved → forced. Skipped the top Sev-1 #37
  (Sheets atomicity) — it's a tx-semantics change to the crown-jewel backup write path = arch rule-6
  (design.md + Angelo first, like the sibling #127), NOT a clean bug increment. Took the top CLEAN approved
  Sev-2: #51. FIRSTHAND CONFIRMED the bug in `getInsurance` (analytics/repository.ts): a TERM-LESS active
  policy contributes $0 to premium totals (`buildInsuranceDetails` does `if (!latestTerm) continue`), yet
  `activePoliciesCount = activePolicies.length` counted it → the headline showed "N active policies" beside
  premiums summed over FEWER (internal inconsistency). FIX (Angelo's agreed approach): count only active
  policies that have ≥1 term — `activePoliciesWithTerms = activePolicies.filter(p => policyIdsWithTerms
  .has(p.id))`, the SAME has-a-term predicate the premium path gates on (set built from termRows, so an
  inactive policy's terms can't leak — the filter is over activePolicies only). GUARD: +3 cases in
  insurance-details.test.ts (term-less-not-counted-beside-a-termed-one; termed-still-counted [no
  over-exclude]; lone-term-less→0+$0). NON-VACUOUS: reverting to `activePolicies.length` turns 2 of the 3
  RED; restored → 14 pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1600 pass / 0
  fail (+3), build bundled. Backend-only (analytics repo; the displayed count is pinned precisely by the
  unit test — no UI logic changed). cov: be 87.22% / fe 86.14% (~ — analytics repo already covered; +3 pin
  the count-consistency contract).
- **C28 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C21).**
  Two cats over budget (infra 7/6, bug 4/3 — tie on over-by); infra is the most-starved (7 > 4) → forced.
  (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored `.meshclaw.e2e.ts`
  agent-harness specs are by-design; the committed regression net is the unit + HTTP-harness + source-scan
  suites). (2) COVERAGE RE-MEASURED (7 commits since C21): **BE 87.22% line / 86.97% func** (file-mean);
  **FE 86.14% line / 87.31% func / 78.70% branch** (v8, 726 tests) — BE flat vs C21, FE marginally UP on
  all three (the C22 split-form types + C23 buildSplitConfig +5 tests added covered lines; C24/C25 added
  Sheets-service tests on already-covered modules; C26/C27 were eyes-on/e2e). Both at the ~87 BE / ~86 FE
  structural ceiling. (3) BOTH-SIDES GREEN: BE 1597 / FE 726. (4) BRANCH STATE: claude-loop-dev = 28
  commits ahead of fresh origin/main (C1-C27 + the C0 reset: 5 feature [2 features now COMPLETE:
  maintenance C1, recurring-expenses C27], 2 bug [1 dry] + 2 dry-scouts, 3 deep-review, 3 guard, 2 arch,
  3 infra), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.22% / fe 86.14% (MEASURED). NEXT cadence ~C38.
- **C27 (feature)** — **Recurring-expenses T8: full round-trip E2E (eyes-on DONE → FEATURE COMPLETE).**
  feature was the sole over-budget category (27−22=5/4). Picked recurring-expenses T8 (closes the whole
  feature) over the import-trackers dialog (a larger net-new arc). Wrote `recurring-expense-roundtrip
  .meshclaw.e2e.ts` (gitignored harness) exercising the full feature-DoD chain: create a SPLIT recurring
  expense (2 vehicles, even, $100, overdue Oct–Dec 2024) → `POST /reminders/trigger` → one sibling per
  vehicle per overdue month, each `sourceType:'reminder'` + `expenseAmount:50` (even split) + template tag
  → delete the source → rows SURVIVE unlinked (T3 clearSource: history kept, source nulled). EYES-ON (Read
  `/tmp/c27-roundtrip-badged-expenses.png`): /expenses renders the ⟳ Recurring badge (C9) on a
  reminder-sourced row + the ⑂ Split badge on the collapsed 2-vehicle group ($200 total). DEBUGGING (real
  firsthand findings, all harness — NOT product bugs): (1) hono/csrf (app.ts) 403s a BODYLESS
  `page.request` POST/DELETE — it Origin-checks form-submittable requests but exempts `application/json`;
  fixed by sending `content-type: application/json` on the trigger POST + reminder DELETE (the JSON-body
  create POST was always fine). (2) split siblings render COLLAPSED at the group total, so a UI `$50`
  substring never appears → assert the per-sibling share via the API. (3) 2024-dated rows paginate off
  page 1 of 150 → assert materialization via the API (tag-filtered), capture the badge eyes-on separately.
  (4) the list API row exposes the per-sibling value as `expenseAmount`, not `amount`. **Recurring-expenses
  is now COMPLETE (T1–T8).** Verify: the spec passes green; no app source touched (FE was fully built
  C5–C22); both suites were green at C26. cov: be 87.22% / fe 86.07% (~ — e2e capture, no module touched).
- **C26 (deep-review)** — **Eyes-on sweep of /analytics (the most complex shipped page) — AUDITED CLEAN;
  3 suspected defects debunked firsthand.** deep-review was the sole over-budget category (26−19=7/5).
  Per the C19 note (backup/restore/import already swept), picked the recommended UNAUDITED surface: an
  eyes-on sweep of /analytics. Booted fresh (RESET_DB) + shot desktop & mobile EMPTY state (clean
  four-states EmptyState "No fuel data yet" + Log-a-Fillup CTA; 2×2 mobile grid, no overflow, 0 console
  errors). Then seeded consecutive fuel fill-ups via API to review the POPULATED state. THREE suspected
  defects, ALL DEBUNKED firsthand (the GUIDE's "HIGH findings are often false"): (1) **"Avg km/L" on a USD
  user** — traced to `getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)`, fully unit-derived
  from the user's pref, NEVER hardcoded (the seeded user's distance/volume prefs are metric independent of
  USD currency — a valid config); no `km/L`/`mi/gal` literal exists in the analytics render path. (2)
  **blank gray chart boxes** — those are ChartCard's deliberate visibility-gated Skeletons (UIQuality "no
  blank box"), not a render defect: charts are IntersectionObserver-gated (`visibility-watch.svelte.ts`) +
  the tabs are lazy `{#await import()}` code-split with proper spinners. (3) **missing `[data-slot=chart]`
  svg** — the IO gate simply doesn't flip in headless full-page capture (no real viewport intersection),
  a HARNESS limitation, not a product bug. EYES-ON PAYOFF: the Playwright-failure screenshot captured the
  populated Fuel & Stats stat cards rendering CORRECTLY — Fill-ups 17/yr, Liters 166.5, Fuel Consumption
  Avg km/L 30.2 (Best 30.5 green / Worst 30.0 red), trend arrows + "-100%" deltas all correct (confirms
  the 30 mpg→12.75 km/L conversion + band/color semantics end-to-end). VERDICT: /analytics is
  architecturally sound (lazy tabs + IO-gated charts + correct unit-derived labels + four-states + trend/
  color semantics) — no defect, no code change. The capture spec was removed (non-deterministic against
  the IO gate; knowledge recorded here). RECORDED for future eyes-on cycles: IO-gated charts don't paint
  in headless full-page shot.sh — to capture a painted analytics chart, a real scroll/viewport-intersection
  trigger is needed (or test the stat-card layer, which renders unconditionally). Verify: no source touched
  (audit only); both suites were green at C25. cov: be 87.22% / fe 86.07% (~ — no module touched).
- **C25 (guard)** — **Tree-wide source-scan guard for the C24 #36 RAW-value-input fix.** Two cats tied
  over budget (deep-review 6/5 +1, guard 7/6 +1); guard wins the tie on raw starvation (7 > 6). The C24
  #36 fix is a HIGH data-safety fix whose regression risk is a ONE-TOKEN flip (`RAW`→`USER_ENTERED`) or a
  NEW Sheets write site added with USER_ENTERED — and the C24 fake-seam test only drives the single write
  path that exists today. GUARD: new `sheets-raw-value-input.test.ts` (+2) scans google-sheets-service.ts
  for EVERY `valueInputOption: '<x>'` assignment and asserts each is `'RAW'` (+ a non-no-op check that ≥1
  site exists). KEY design point: it matches the ASSIGNMENT, not a bare `USER_ENTERED` substring — the C24
  fix's own explanatory comment contains the word USER_ENTERED, which a naive grep would false-positive on
  (verified: 2 comment occurrences, 1 real assignment). NON-VACUOUS: flipping the source to USER_ENTERED
  turns the scan RED with the precise corruption diagnostic; restored → green (1 RAW site). Mirrors the
  established source-scan idiom (no-oldest-month-slice / no-utc-date-input). Source-scan > untracked e2e
  for merge survival (GUIDE). Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1597 pass /
  0 fail (+2), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe 86.07% (~ — pure source
  scan, no module logic touched; pins the #36 contract tree-wide).
- **C24 (bug #36)** — **Sheets backup formula-injection fix: USER_ENTERED → RAW (Angelo-APPROVED Sev-1).**
  bug was the sole over-budget category (24−20=4/3). The cold-scout vein is exhausted, so took the top
  unfinished Angelo-approved item by severity: #36 (HIGH, the Sheets-backup formula-injection / silent
  round-trip corruption). FIX: switched `updateSheet`'s `valueInputOption` from `'USER_ENTERED'` to `'RAW'`
  (google-sheets-service.ts) — USER_ENTERED makes Sheets PARSE each cell as if typed, so a value starting
  `=`/`+`/`-`/`@` becomes a LIVE formula (injection + the user's OWN data silently round-trips back as the
  formula RESULT, not their text — NORTH_STAR #1 backup corruption). RAW stores the literal string →
  byte-exact, injection-inert, NO escaping needed. GUARD (+2 in google-sheets-service.test.ts via the
  injected-fake seam): asserts every write sends `RAW` (added a `valueInputOptions` capture map to the fake
  — the grid stores identically regardless of option, so a round-trip alone is vacuous for this), and a
  `=HYPERLINK(...)` make round-trips VERBATIM through write→read. DELIBERATELY did NOT do the approved
  text's second half ("escape leading formula chars on read"): under RAW that's both unnecessary (nothing
  to un-escape) and HARMFUL (a `'`-prefix escape on this backup→restore ROUND-TRIP path reintroduces the
  C399/C401 apostrophe corruption csv-safety.ts's header explicitly warns against — the two clauses are
  ALTERNATIVE mechanisms, not complementary). send_message'd Angelo the nuance (don't auto-decide a
  data-contract divergence), shipped the unambiguously-correct half, did NOT block. CAUGHT-MY-OWN-BUG: the
  first edit accidentally dropped the `range:` line → my new RAW guard + 3 existing tests went RED (range
  undefined → fake skips the write); restored the line → green (the guard did its job). #37 (atomic
  temp-sheet+swap) is a materially larger restructure → left OPEN for its own cycle per one-coherent-
  increment. Verify: backend validate:local GREEN — tsc 0, musl-biome clean, 1595 pass / 0 fail (+2 net,
  was 1593 functional pre-cycle), build bundled. Backend-only (no UI → no shot). cov: be 87.22% / fe
  86.07% (~ — Sheets service already covered by the C-era fake-seam tests; +2 pin the injection-safety
  contract).
- **C23 (arch)** — **`buildSplitConfig` dedup (the C22-created drift vector — a genuine fresh pick, not a
  re-scout).** arch was the sole over-budget category (23−17=6/5). Unlike the C4/C6/C12 no-churn scouts,
  there was a REAL pick: my own C22 T4 work added a `buildSplitConfig()` to `ReminderForm` that was
  near-byte-identical to `ExpenseForm`'s (both build the `SplitConfig`/`ReminderSplitConfig` discriminated
  union from method/vehicleIds/allocations — `even`→vehicleIds, else map allocations with a `?? 0`
  coalesce). The two union aliases are structurally identical; `InsuranceTermForm` uses a DIFFERENT flat
  `{vehicleIds, splitMethod?, allocations?}` API shape → correctly NOT a merge target (verified firsthand).
  Extracted ONE pure `buildSplitConfig(method, vehicleIds, allocations): SplitConfig` into
  `expense-helpers.ts` — the natural pair to `resetSplitAllocations` (the C415 split-seed source of truth
  that already lives there). ExpenseForm calls it directly (dropped its now-unused `SplitConfig` type
  import); ReminderForm wraps it in a thin `reminderSplitConfig()` that keeps the `showSplitEditor`→null
  guard then delegates. Arch rule 3 satisfied: added the characterization test FIRST (buildSplitConfig was
  never directly tested — it lived locally in each component, the C181/C229 isolation gap). GUARD: +5 cases
  in reset-split-allocations.test.ts (even→vehicleIds / absolute+percentage map / the load-bearing
  cleared-input→0 coalesce on both numeric methods) — the merge-surviving net since both forms are
  eyes-on/Playwright-blocked. BEHAVIOR-PRESERVING confirmed at the API seam (rule 4): re-ran the C22
  reminder-expense-split + reminder-expense-type e2e specs GREEN — the split round-trip still persists
  `{method:'even', vehicleIds:[2]}` identically + the single-vehicle no-split path unchanged (no template
  touched, only the `<script>` call expression). Verify: frontend validate:local GREEN — type-check 0,
  build OK, 726 tests pass (+5). cov: be 87.22% / fe 86.07% (~ — same split-state module, LOC down, one
  source of truth for the union builder; the +5 pin the newly-shared helper directly).
- **C22 (feature)** — **Recurring-expenses T4: multi-vehicle split in `ReminderForm` (eyes-on DONE).**
  feature was the sole over-budget category (22−16=6/4; arch sat AT 5/5). Picked T4 over the import-trackers
  tail as the more contained, higher-leverage increment (reuses an existing kit widget). REAL gap: the form
  hard-nulled `expenseSplitConfig` (ReminderForm:52-53), so a multi-vehicle EXPENSE reminder materialized
  ONE row on `vehicleIds[0]` only (trigger-service drops to the single-row path on null config) — the other
  selected vehicles silently got nothing. FIX: exposed the shared `SplitConfigEditor` (the same widget the
  expense + insurance-term forms use — InsuranceTermForm was the copy template, incl. `resetSplitAllocations`
  the C415 shared seed) when `kind==='expense'` && ≥2 vehicles && amount>0; `buildSplitConfig()` → null for
  notification/single-vehicle/unsplit (trigger path UNCHANGED) else a `ReminderSplitConfig` union; edit-open
  reads the stored config back; client-side split validation mirrors the backend `refineSplitConfig`
  (percentages→100 / fixed-$→amount) so submit blocks before a 400. EYES-ON CONFIRMED via a new
  `reminder-expense-split.meshclaw.e2e.ts` + two PNGs (Read): 2 vehicles + $200 → the "Split across vehicles"
  editor reveals; EVEN shows Daily Driver $100.00 / Weekend Car $100.00 · Total $200.00; the % toggle reveals
  per-vehicle inputs seeded 50/50; the created reminder persists `{method:'even', vehicleIds:[2]}` (read back
  via GET — full FE→BE→DB→render round-trip). Single-vehicle no-split path unchanged (reminder-expense-type
  spec still green; the 2 full-suite reminder failures were the documented accumulated-data strict-mode-2
  flake — both pass in isolation, and the split editor can't render in either notification flow). Verify:
  frontend validate:local GREEN — type-check 0, build OK, 721 tests pass. cov: be 87.22% / fe 86.07% (~ —
  UI-markup cycle; the split materialization path is backend-covered at T2/C102). Recurring-expenses
  REMAINING: only T8 round-trip e2e (the last tail).
