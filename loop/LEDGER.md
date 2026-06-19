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
> components). **RE-MEASURED C97 (infra cadence): BE 87.47% line / 87.20% func (file-mean, 1703 pass); FE
> 86.35% line / 87.68% func / 78.78% branch (v8, 735 pass) — BE line UNCHANGED vs C90, func +0.01 (the C94 CORS/CSRF
> source-scan guard added a couple covered helper lines); FE FULLY UNCHANGED (no FE source touched since C52; C93/C96
> were eyes-on shots only, C95 a dry scout). The C90 branch 78.88 was v8 rounding noise — back to 78.78.**
> Both still at the ~87 BE / ~86 FE structural ceiling; treat as the floor.
> **C104 (infra cadence MEASURED): BE 87.47% line / 87.19% func (1707 pass) — UNCHANGED vs C97; FE 87.6% line /
> 88.56% func / 79.84% branch (739 pass) — +1.25/+0.88/+1.06 vs C97's 86.35/87.68/78.78, the cumulative C100
> (settings reload) + C101 (theme listener) + C102 (#148 anchor) FE-logic guard arc. FE is now meaningfully off its
> old plateau; the residual gap is structural (effect/DOM-bound + DI/OAuth-bound). Both still under the 90% goal but
> the FE structural ceiling proved ~1.25pts higher than the long-assumed ~86% once the store/util logic was pinned.**
> **C111 (infra cadence MEASURED): BE moved UP off its long-assumed ~87.47% ceiling — 87.77% line / 87.53% func
> (1717 pass), +0.30/+0.34 vs C104, from the C108 (sync-status) + C109 (vehicle-expenses) + C110
> (quick-stats/cross-vehicle/year-end) route-coverage arc (analytics/routes.ts 95.65→97% line). PROOF the
> route-coverage audit found REAL untested code, not theater. FE 87.6%/88.56%/79.74% UNCHANGED (C105–C110 all
> backend/eyes-on/docs). The BE structural ceiling is ~87.8% once route-layer handlers are HTTP-harnessed; residual
> is DI/OAuth-bound.**
> **C101 (guard): FE moved UP again — 87.6% line / 88.56% func / 79.74% branch (+0.74/+0.59/+0.67 vs C100) from
> the +1 themeStore.initialize() test (theme.svelte.ts 60.52→92.1% line, 100% func — the C336-skipped one-shot +
> its live OS-preference listener). BE unchanged 87.47/87.20. The FE store/util layer is the live coverage
> frontier — real behavioral logic, not markup.**
> **C100 (guard): FE moved UP for the first time since C52 — 86.86% line / 87.97% func / 79.07% branch (+0.51/+0.29/
> +0.29) from the +2 settings-store uploadBackup mode-gated-reload tests (a real behavioral gap, not markup). BE
> unchanged 87.47/87.20.**
> (C97: BE 87.47/87.20, FE 86.35/87.68/78.78. C90: BE 87.47/87.19, FE 86.35/87.68/78.88[noise]. C84: BE 87.47/87.19, FE 86.35/87.68/78.78. C77: BE 87.46/87.18, FE 86.35/87.68/78.78. C70: BE 87.46/87.18, FE 86.35/87.68/78.78. C63: BE 87.46/87.17, FE 86.35/87.68/78.78. C56: BE 87.46/87.18, FE 86.35/87.68/78.78. C49: BE 87.47/87.17, FE 86.35/87.68/78.88. C42: BE 87.33/86.97, FE 86.35/87.68/78.78. C35: BE 87.29/86.97, FE 86.14/87.31/78.70.
> C28: BE 87.22/86.97, FE 86.14/87.31/78.70. C21: BE 87.22/86.96, FE
> 86.07/87.19/78.53. C14: BE 87.22/86.96, FE 86.07/87.19/78.53. C7: FE 85.95/87.15/78.38.)

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category. Recompute ALL 6 every
cycle (slow-budget categories mis-forecast otherwise).

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 106 |
| deep-review | 5 | 109 |
| guard | 6 | 110 |
| bug | 3 | 107 |
| arch | 5 | 105 |
| infra | 6 | 111 |

Current cycle: **111**

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
- **C111 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C104)** — Balance at
  C111 (HEAD was C110; nudge label lags): FOUR over budget — infra (111−104=7/6, +1), arch (111−105=6/5, +1), feature
  (111−106=5/4, +1), bug (111−107=4/3, +1); infra wins on raw starvation (7, the C84 tie-break) AND its re-measure
  actually MOVED this time (the C108–C110 route tests). Ran right in the ~10-cycle window. (1) UNTRACKED-TEST SWEEP:
  CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte.test.ts` specs (only the intentional `M .gitignore` + `M
  frontend/.gitignore` overrides). (2) COVERAGE RE-MEASURED: **BE 87.77% line / 87.53% func** (1717 pass) —
  **+0.30/+0.34 vs C104**, moving UP OFF the long-assumed ~87.47% ceiling, from the C108 (sync-status) + C109
  (vehicle-expenses) + C110 (quick-stats/cross-vehicle/year-end) route-coverage arc (analytics/routes.ts 95.65→97%
  line) — PROOF the route-coverage audit found REAL untested route-layer code, not theater; **FE 87.6% line / 88.56%
  func / 79.74% branch** (739 pass) — UNCHANGED (C105–C110 all backend/eyes-on/docs; no FE source touched). The BE
  structural ceiling is ~87.8% once route handlers are HTTP-harnessed; residual is DI/OAuth-bound. (3) BOTH-SIDES
  GREEN: BE 1717 / FE 739, 0 fail. (4) BRANCH STATE: claude-loop-dev = **111 commits ahead** of fresh origin/main,
  PR-ready (category spread bug 26 / feature 20 / guard 19 / deep-review 18 / infra 15 / arch 12; the 111th is the
  C1 loop-doc reset). Recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be
  87.77% / fe 87.6% (MEASURED). NEXT cadence ~C121. STANDING NOTE: the C108–C110 route-coverage audit is the live
  productive vein (3 route gaps found + BE coverage +0.30); the analytics domain is fully mapped — apply the same
  method to the next-thinnest domain. The product-advancing work stays GATED on Angelo (#148 READY w/ anchor /
  import defaultCategory / createLoadState design / #100/#79/#129).
- **C110 (guard — completed analytics-domain route coverage: pinned the 3 remaining untested routes [quick-stats /
  cross-vehicle / year-end]; the C108/C109 audit-method increment)** — Balance at C110 (HEAD was C109; nudge label
  lags): NOTHING strictly over budget (feature 4/4, bug 3/3, arch 5/5, infra 6/6 all AT). Took the highest-leverage
  OPEN item = completing the C108/C109 route-coverage vein (proven productive: 2 cross-tenant gaps in 2 cycles).
  Recorded under GUARD (the honest category for route HTTP-harness work; nothing was over budget so category-label
  follows the work). Inventoried the analytics domain's 13 route handlers vs HTTP-harness coverage → the LAST 3
  with ZERO route-level coverage were /quick-stats, /cross-vehicle, /year-end. Unlike the C109 vehicle-expenses
  gap these are USER-scoped in the repo (no per-vehicle ownership gate), so the route-layer invariants pinned are:
  (a) per-route AUTH-gating — every analytics route is behind requireAuth but the C185 net asserted 401 on only ONE
  representative route, so a mis-mount skipping the middleware on one would've gone unnoticed; (b) the REQUIRED
  startDate+endDate validation on the two dateRange routes (omit → 400 via zValidator BEFORE any repo work); (c)
  year-end's OPTIONAL year (omitted → defaults to current year → 200, not 400). GUARD: +3 in
  analytics-routes-http.test.ts. NON-VACUOUS proved firsthand: dropped the quick-stats zValidator → its 400
  assertion flips RED (route no longer rejects the missing range); restored → 19 pass. The analytics route domain
  now has COMPLETE HTTP-harness coverage (all 13 endpoints). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1716 pass / 0 fail (+3), build bundled. Backend-only (no UI
  → no shot). cov: be ~87.5% (+ the 3 route paths) / fe 87.6% (~). PATTERN (C108/C109/C110): the route-coverage
  audit method — inventory a domain's handlers vs HTTP-harness hits, pin the uncovered ones (ownership-gated first,
  then auth/validation) — is the productive guard/deep-review vein. ONE domain (analytics) now fully mapped + closed.
  NEXT: apply the same method to the next thinnest domain (auth/photos are OAuth/upload-bound; check
  financing/insurance/odometer GET-by-id + list routes for any unharnessed ownership-gated handler).
- **C109 (deep-review — pinned the untested /vehicle-expenses analytics route's cross-tenant ownership gate; 2nd
  route-ownership gap in 2 cycles, vein confirmed productive)** — Balance at C109 (HEAD was C108; nudge label lags):
  deep-review (109−102=7/5, +2) the most-starved over-budget category → picked. Applied the C108 lesson (map
  route-endpoint coverage, don't assert saturation): mapped the analytics domain's 13 route handlers vs HTTP-harness
  coverage — found 4 endpoints with ZERO route-level coverage (/quick-stats, /cross-vehicle, /year-end,
  /vehicle-expenses), and the highest-leverage is /vehicle-expenses: it's the only one of the 4 carrying a
  `validateVehicleOwnership(vehicleId)` cross-tenant gate (routes.ts:147), the SAME guard analytics-routes-http.test.ts
  already pins for its siblings vehicle-tco/vehicle-health/fuel-stats/fuel-advanced (C185/C290) — but
  /vehicle-expenses was the one vehicle-scoped analytics route the net never covered. The repo method
  getVehicleExpenses is unit-tested, but a route-layer guard-drop serves another tenant's per-vehicle expense
  analytics by guessing an id (the C109/#52 cross-tenant class — namesake). GUARD: +3 in analytics-routes-http.test.ts
  (next to its siblings) — owned → 200 envelope; foreign id → 404 (no leak); missing-required-vehicleId → 400 (the
  dateRangeRequiredVehicleQuerySchema validation, before the guard). NON-VACUOUS proved firsthand: dropped the
  ownership gate → ONLY the foreign-id test RED (the leak opens), owned + missing-param stay green; restored → 16
  pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1713
  pass / 0 fail (+3), build bundled. Backend-only (no UI → no shot). cov: be ~87.5% (+ the vehicle-expenses route
  lines) / fe 87.6% (~). PATTERN CONFIRMED: C108 (sync-status) + C109 (vehicle-expenses) are TWO route-ownership
  gaps found in 2 cycles by mapping endpoint coverage — the HTTP-harness guard/deep-review vein is genuinely
  productive, NOT the "fixed point" the C103/C107 claims asserted. NEXT deep-review/guard: the remaining 3 untested
  analytics routes (/quick-stats, /cross-vehicle, /year-end) are user-scoped in the repo (no per-vehicle ownership
  gate) so thinner, but check the other route domains' unmapped endpoints first (the audit method, not the
  saturation assumption).
- **C108 (guard — pinned the untested GET /:id/sync-status route's tenant-isolation chokepoint; corrected the
  premature C103 "frontier worked out" claim)** — Balance at C108 (HEAD was C107; nudge label lags): TWO over
  budget — guard (108−101=7/6, +1) and deep-review (108−102=6/5, +1); guard most-starved (7 > 6, the C84 tie-break)
  → picked. Rather than assert the guard vein saturated (the C103 claim), did a genuine scout of the OTHER guard
  vein (HTTP-harness, not source-scan): mapped all 12 route domains' createTestApp coverage (77 files) → found the
  provider domain's lowest, and within it the GET /:id/sync-status endpoint has ZERO coverage (no test file
  references "sync-status"). VERIFIED it carries a load-bearing invariant: it gates on `findOwnedProviderOrThrow`
  (routes.ts:602) — the SAME tenant-isolation chokepoint the PUT/DELETE tests pin (#63), but on a READ path that
  leaks another tenant's per-category photo-sync counts (total/synced/failed) if the guard drops (NORTH_STAR #2),
  invisible to every existing test. GUARD: +4 in providers-routes-http.test.ts — owned → 200 with the 4-category
  {total,synced,failed} shape; foreign id → 404 (no leak); non-existent → 404; anon → 401. NON-VACUOUS proved
  firsthand: removed the ownership check → BOTH the foreign-id + non-existent-id tests RED (the leak path opens),
  owned + anon stay green; restored → 26 pass. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20
  pre-existing warnings, none new), 1710 pass / 0 fail (+3 net), build bundled. Backend-only (no UI → no shot).
  cov: be ~87.5% (+ the sync-status route lines now covered) / fe 87.6% (~). CORRECTION recorded: the C103/C107
  "FE-logic frontier worked out / guard saturated" claim was PREMATURE — a real untested route with a cross-tenant
  guard gap existed. LESSON: the HTTP-harness guard vein isn't exhausted just because source-scan + FE-logic are;
  map route-domain coverage for the lowest-covered endpoints before asserting saturation. NEXT guard: re-scan the
  remaining low-coverage route endpoints (sync/auth/analytics harness files are thin but mostly DI/OAuth-bound —
  verify which are genuinely testable vs structural before picking).
- **C107 (bug — precondition-recorded dry [9th consecutive]; no source changed since C85)** — Balance at C107
  (HEAD was C106; nudge label lags): bug (107−103=4/3, +1) the LONE over-budget category → forced. PRECONDITION
  (the C99/C103 rule): `git diff 5766239(C85)..HEAD` over production source is EMPTY — nothing has changed since the
  cold vein was last swept (C6/C10/C15/C83/C89/C95/C99/C103 + every surface certified + the FE-logic guards
  C100–C102 are tests, not source), so a regression is structurally impossible → recorded dry IMMEDIATELY without
  re-scanning provably-unchanged code (re-scanning is pure ceremony, the C95/C103 lesson). The productive bug
  surface remains ONLY the parked Angelo-gated queue (#148 READY w/ its C102 red→green anchor, #100/#79/#129 +
  import defaultCategory). Doc-only — no source/test touched. cov: be 87.47% / fe 87.6% (~ — nothing touched).
  PATTERN NOTE (C83–C107, 25 cycles): the loop is at a stable fixed point — every self-authorizable vein swept
  (net production change = 6 test files: 3 BE guards C87/C94/C98 + 3 FE-logic C100/C101/C102), the cold bug vein
  9× dry, every real + populated surface eyes-on, the only remaining work GATED on Angelo (4 product calls + 1
  design-gated arch migration). The branch stays healthy + PR-ready; a steer is the only thing that opens fresh work.
- **C106 (feature — eyes-on the full POPULATED dashboard, desktop + mobile; CLEAN [the primary landing surface,
  only ever partially-shot])** — Balance at C106 (HEAD was C105; nudge label lags): feature (106−101=5/4, +1) the
  lone over-budget category → picked. Import-trackers stays Angelo-gated (defaultCategory), so per the
  C68/C75/C82/C88/C93/C96 precedent took the shootable eyes-on increment. The shot history had /dashboard only
  twice (C5 shot just the recurring-cost-card REGION; C12 the app-init trigger) — the FULL populated dashboard (the
  primary landing surface, NORTH_STAR mobile-first) in a multi-vehicle state was never Read end-to-end. Shot DESKTOP
  + MOBILE (Pixel 5) + Read both PNGs (+ a zoomed KPI crop). CERTIFIED CLEAN: desktop renders all sections — 4 KPI
  stat cards (Total Vehicles 4 / Total Expenses $21,677.87 / Monthly Average $277.92 / Active Financing 2, the
  subtitle "Overview of your 4 vehicles" matching the vehicle count = internally consistent), Your Fleet (3 vehicle
  cards w/ Financed badges + per-vehicle Last-30/Total/Last-Activity + Add-Expense, a 4th slot + Add-Vehicle FAB),
  Monthly Expense Trends + Expense by Category (chart canvas blank = the C26 IO-gated-chart headless-capture limit,
  NOT a defect — frame/legend render), Recent Activity (correct expense rows incl. the $900 split payment),
  Upcoming Reminders (e2e mileage/recurring w/ due dates), Recurring Costs ($460.50/mo across 4). MOBILE (393px):
  NO horizontal overflow (NORTH_STAR #3) — the 4 KPI cards reflow desktop-4-across → a clean 2×2 grid (values fit,
  labels wrap), the "Log Fill-up" mobile-first pump CTA is present, Your Fleet + Add-Vehicle FAB pin full-width;
  figures consistent with desktop. Zero console errors; no /auth bounce. No defect; no fix (the GUIDE
  agent-HIGH-findings-often-false discipline). The dashboard is sound — DON'T re-audit. Read-only shots, no fixtures
  created. Doc-only — no committable source (shot.mjs is gitignored harness). cov: be 87.47% / fe 87.6% (~ — no
  test/code touched). With this, the dashboard joins the fully-eyes-on set; every real surface + the primary
  landing in its populated state is now Read. NEXT feature cycle: feature is fully exhausted of self-authorizable
  work (every surface shot, import-trackers gated) → record parked + pivot UNLESS Angelo steers.
- **C105 (arch — no churn warranted; the createLoadState scaffold has ZERO adopters but its migration is a
  design-gated multi-page refactor, NOT a self-authorizable increment — surfaced for Angelo, recorded + pivot)** —
  Balance at C105 (HEAD was C104; nudge label lags): arch (105−98=7/5, +2) the most-starved over-budget category →
  picked. Instead of the reflexive backend no-churn (backend unchanged since C85, confirmed again — no fresh dedup),
  scouted a genuinely FRESH surface the backend-focused scouts C85/C91/C98 never touched: the FE LOAD TRIAD.
  FINDING: `createLoadState<T>` (load-state.svelte.ts) was extracted (arch #2) as a migration SCAFFOLD — its
  docstring says "~14 pages hand-repeat the triad; pages migrate onto it one per later cycle" — but it has ZERO
  adopters; all 13 load-bearing pages still hand-roll `isLoading`/`loadError`/`load()`. THAT is a real dedup with a
  concrete payoff (the "load failure masquerades as empty state" bug class the scaffold was built to structurally
  prevent). BUT verified firsthand it is NOT a behavior-preserving arch increment: every candidate page
  (reminders/insurance/expenses/vehicle-detail/provider-edit) loads MULTIPLE values via Promise.all into SEPARATE
  $state vars, while createLoadState holds ONE `data` — so migrating any page is a reactivity REWRITE (composite
  type or N load-states + every template binding rewired from `isLoading` to `loadState.isLoading`), touching
  observable render paths + requiring shot-before/after (arch rules 1+2+4). A multi-page migration of this scope is
  arch-rule-6 DESIGN-GATED (`.kiro/specs/<refactor>/design.md` + Angelo sign-off), NOT a self-authorizable cycle.
  Recorded no-churn for the cycle + SURFACED the scaffold-adoption gap as a design-gated arch item (filed in
  BACKLOG). Did NOT force a risky rewrite (the GUIDE "Don't manufacture churn" + arch rule 6 "never self-authorize a
  big restructure"). 8th no-churn confirm (C4/C6/C12/C36/C85/C91/C98/C105) — but this one is INFORMATIVE: it names a
  concrete, real, design-gated dedup rather than just "DRY". Doc-only — no source touched. cov: be 87.47% / fe
  87.6% (~ — nothing changed). NEXT arch: the createLoadState migration needs an Angelo design call; absent that,
  arch stays at its structural floor — record no-churn fast.
- **C104 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C97)** — Balance at
  C104 (HEAD was C103; nudge label lags): TWO over budget — infra (104−97=7/6, +1) and arch (104−98=6/5, +1); infra
  wins on raw starvation (7 > 6, the C84 tie-break) AND is the substantive pick (arch is reliably no-churn at its
  structural floor C91/C98; infra's re-measure actually MOVED this time, capturing the C100–C102 FE gains). Ran
  right in the ~10-cycle window. (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte.test.ts`
  specs (only the intentional `M .gitignore` + `M frontend/.gitignore` overrides). (2) COVERAGE RE-MEASURED: **BE
  87.47% line / 87.19% func** (1707 pass) — UNCHANGED vs C97 (C98 was the only BE add, a source-scan that line-covers
  nothing; C99/C103 dry, C100–C102 FE-only); **FE 87.6% line / 88.56% func / 79.84% branch** (739 pass) —
  **+1.25/+0.88/+1.06 vs C97's 86.35/87.68/78.78**, the cumulative C100 (settings-store reload) + C101 (theme
  listener) + C102 (#148 lease anchor) FE-logic guard arc. FE is now meaningfully OFF its long-assumed ~86%
  plateau — the real FE structural ceiling is ~87.6% once the store/util behavioral logic is pinned; the residual
  gap is structural (effect/DOM-bound FE + DI/OAuth-bound BE, neither a clean unit pick). (3) BOTH-SIDES GREEN: BE
  1707 / FE 739, 0 fail. (4) BRANCH STATE: claude-loop-dev = **104 commits ahead** of fresh origin/main, PR-ready
  (category spread bug 25 / feature 19 / guard 17 / deep-review 17 / infra 14 / arch 11; the 104th is the C1
  loop-doc reset). Recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47%
  / fe 87.6% (MEASURED). NEXT cadence ~C114. STANDING SIGNAL (C83–C104, 22 cycles): every self-authorizable vein is
  swept — net production change is 3 guard tests (C87/C94/C98) + 3 FE-logic guard/cert tests (C100/C101/C102, which
  moved FE coverage +1.25). The branch is healthy + PR-ready; the highest-leverage remaining work is GATED on Angelo
  (#148 READY w/ its C102 red→green anchor, import defaultCategory, #100/#79/#129) — a steer is the only thing that
  opens a fresh vein.
- **C103 (bug — recorded dry FAST [8th consecutive]; + confirmed the C100–C102 FE-logic guard frontier is now
  worked out)** — Balance at C103 (HEAD was C102; nudge label lags): bug (103−99=4/3, +1) the LONE over-budget
  category → forced. PRECONDITION (per C99): `git diff 5766239(C85)..HEAD` over production source is EMPTY — nothing
  has changed since the cold vein was last swept, so a bug scout produces nothing → recorded dry immediately. ALSO
  scouted whether the C100/C101/C102 FE-logic guard frontier (which produced 3 real coverage gains) still has clean
  picks: RE-MEASURED FE coverage — the only remaining <90% files are expense-api.ts (73% — dominated by thin
  apiClient pass-through wrappers: getPhotos/uploadPhoto/deletePhoto/split-CRUD, where a test would just assert
  "calls apiClient.X with this URL" = the C181/C229 coverage-theater) and sync-manager.ts (66% — the uncovered lines
  are `setupAutoSync`'s `window.addEventListener('online', …)` DOM-effect wiring [Playwright territory] + the
  already-fully-covered resolveConflict switch). The genuinely load-bearing FE-logic gaps are now CLOSED (settings
  reload C100, theme listener C101, #148 anchor C102); the residual FE under-coverage is STRUCTURAL (effect/DOM-bound
  + thin delegation), the FE mirror of the BE DI/OAuth-bound tail — not clean unit pins. No fresh bug, no
  non-theater guard → recorded dry, did NOT manufacture. The productive surfaces are now: (a) the parked
  Angelo-gated queue (#148 READY w/ its C102 anchor, #100/#79/#129 + import defaultCategory), (b) genuinely
  STRUCTURAL coverage (needs Playwright for the FE effect tail / DI harness for the BE tail — neither a normal cycle
  pick). NEXT bug cycle: precondition-check + record dry immediately. Doc-only — no source/test touched. cov: be
  87.47% / fe 87.6% (~ — nothing touched).
- **C102 (deep-review — CHARACTERIZED the #148 escalation [null-initialMileage lease burn bar] as a red→green
  anchor, NOT a fix; the parked product call now pinned)** — Balance at C102 (HEAD was C101; nudge label lags):
  NOTHING strictly over budget; bug (102−99=3/3) AT budget but provably dry (no source changed since C85, 7× dry —
  a scout produces nothing), guard just ran C100/C101. Took the highest-leverage open item = deep-review (starved 4)
  auditing the C100/C101-proven FE-logic frontier. RE-MEASURED FE coverage first (the C101 stale-row lesson): the
  lowest-coverage money-facing file is financing-calculations.ts (75% line). Audited `calculateLeaseMetrics`
  firsthand — it's EXTRAORDINARILY well-tested (30+ cases incl. the #64/#91/#110 money-bug classes + 2 fast-check
  properties), so most of it is saturated. Found the ONE genuinely unguarded load-bearing branch — and it's the
  #148 ESCALATION itself: the mileage gate (financing-calculations.ts:497) requires `initialMileage !== null` for
  mileageUsed to compute; there's a test for null currentMileage but NONE for null INITIAL — the exact #148 case
  where the LeaseMetricsCard burn bar reads 0-driven while the sibling PaymentMetricsGrid (which coalesces
  `initialMileage ?? 0`) shows real miles, so the same vehicle contradicts itself. Since #148 is a PARKED product
  call (a displayed-$ semantics decision awaiting Angelo), I did NOT fix it — I CHARACTERIZED the current behavior
  as a red→green anchor (the textbook deep-review move for a parked call): +1 in lease-metrics.test.ts pinning that
  null-initial → mileageUsed 0 / remaining full TODAY, plus the contrast that initial=0 drives used=30000 (documents
  the contradiction). NON-VACUOUS proved firsthand: applied the #148-FIX direction (`initialMileage ?? 0` in the
  gate) → the characterization FLIPS RED (used becomes 30000), proving it precisely pins the current null-gate
  behavior + is the documented update target when Angelo rules; restored (no auto-fix). Verify: frontend
  validate:local GREEN — type-check 0, build OK, 739 pass / 0 fail (+1). FE-only (no markup change → no shot). cov:
  be 87.47% / fe ~87.6% (+ the lease-metrics null-initial branch). The #148 escalation is now pinned so it can't
  silently change AND has a ready red→green test for the eventual fix. NEXT deep-review: the FE-logic surface is
  largely certified now; prefer a feature/bug-surfaced invariant or an Angelo steer (#148 is READY — the anchor
  test means the fix is a 1-line gate change + flipping this test's expectations).
- **C101 (feature parked → guard: pinned themeStore.initialize() + its live OS-preference listener, the C336-skipped
  one-shot)** — Balance at C101 (HEAD was C100; nudge label lags): feature (101−96=5/4, +1) the lone over-budget
  category, but feature is FULLY EXHAUSTED (every real surface eyes-on C96, import-trackers Angelo-gated) → recorded
  parked + pivoted to the highest-leverage open item (the GUIDE "over-budget but no unblocked increment → park +
  pivot" rule; the C100-seeded FE-logic guard frontier). GUARD: theme.svelte.ts was 60.52% line / 55% branch —
  C336 pinned setPreference but DELIBERATELY skipped initialize() ("a one-shot guarded by an internal flag").
  initialize() carries a load-bearing untested invariant: it registers a prefers-color-scheme `change` listener
  that re-applies the theme LIVE when the OS flips, but ONLY when the stored preference is 'system' — the
  `if (stored === 'system')` guard is what makes "System" track the OS in real time WITHOUT yanking an explicit
  light/dark user's theme when their OS enters night mode. Zero coverage → a regression there silently jumps a
  'light' user to dark on an OS change, invisible to setPreference's tests. GUARD: new theme-initialize.test.ts
  (+1, a single ordered test since themeStore is a latching singleton — only the first initialize() runs the body):
  asserts mount applies the stored pref + registers exactly ONE listener, a 2nd initialize() is idempotent (no
  duplicate), then fires the captured listener under stored 'system' (→ tracks OS dark, live) vs stored 'light'
  (→ NOT touched). NON-VACUOUS proved firsthand: made the listener apply `'system'` UNCONDITIONALLY (the real
  regression) → RED at the explicit-light assertion (user yanked to OS dark); restored → green. Verify: frontend
  validate:local GREEN — type-check 0, build OK, 738 pass / 0 fail (+1). FE-only (a store unit test; no markup
  change → no shot). cov: be 87.47% / **fe 87.6% line / 88.56% func / 79.74% branch — UP +0.74/+0.59/+0.67 vs C100;
  theme.svelte.ts 60.52→92.1% line, 100% func.** Two consecutive real FE coverage gains (C100 settings-store +
  C101 theme) confirm the FE store/util layer is the productive guard frontier. NEXT guard: remaining FE behavioral
  gaps — but RE-MEASURE first (the earlier "load-state.svelte.ts 35%" reading was a coverage-tool artifact; that
  primitive is already fully tested at load-state.svelte.test.ts). Check actual <100% util/store files before
  picking; prefer genuine logic over a backend source-scan on code unchanged since C85.
- **C100 (guard — pinned the FE settings-store `uploadBackup` mode-gated reload [the C319 twin], the first FE
  coverage movement since C52)** — Balance at C100 (HEAD was C99; nudge label lags): NOTHING strictly over budget;
  feature (100−96=4/4) + guard (100−94=6/6) both AT budget. Feature is fully exhausted (every surface eyes-on,
  import-trackers Angelo-gated) → guard is the higher-leverage pick. Rather than ANOTHER backend source-scan on
  provably-unchanged code (the C94/C98 seam is fenced + `git diff C85..HEAD` is empty), went looking for GENUINE new
  value in the FE's real ~13% untested surface. Found it: the settings store (settings.svelte.ts, 57% line / 33%
  branch) mediates the backup/restore crown-jewel (NORTH_STAR #1), and while C319 pinned `restoreFromProvider`'s
  preview-vs-non-preview reload + C308 pinned error-clearing, NOTHING pinned the PARALLEL `uploadBackup` path's
  mode-gated reload — the FILE-upload restore (the more common one: drag a .zip), which gates `this.load()` on
  `mode !== 'preview'` exactly like restoreFromProvider. A regression dropping its reload leaves the UI showing
  STALE pre-restore settings after a replace/merge (NORTH_STAR #1 data-correctness), invisible to every test
  (settings-api.test.ts pins only uploadBackup's wire/FormData contract, not the store's reload). GUARD: +2 in
  settings-state-contract.test.ts (next to the C319 restoreFromProvider twin) — non-preview uploadBackup → 2 fetches
  (upload + reload), state refreshed; preview → 1 fetch, no reload, state stays null. Drives the REAL store →
  settings-api → fetch (mocked), not a re-impl. NON-VACUOUS proved firsthand: dropped the `if (mode !== 'preview')`
  gate → ONLY the non-preview test RED (1 fetch not 2), preview + the other 6 stay green; restored → 8 pass. The
  arch-extract→guard-pin sibling pattern, here C319-twin→C100. Verify: frontend validate:local GREEN — type-check
  0, build OK, 737 pass / 0 fail (+2). FE-only (a store unit test; no UI markup change → no shot needed). cov: be
  87.47% / **fe 86.86% line / 87.97% func / 79.07% branch — UP +0.51/+0.29/+0.29, the FIRST FE coverage movement
  since C52** (the new tests cover settings.svelte.ts's uploadBackup reload branches). NEXT guard: the FE store/util
  layer has a few more real behavioral gaps (load-state.svelte.ts 35% func, theme.svelte.ts 60%) — prefer those
  genuine FE-logic pins over backend source-scans on unchanged code.
- **C99 (bug — recorded dry FAST per the C89/C95 discipline; no source changed since C85, 7th consecutive dry)** —
  Balance at C99 (HEAD was C98; nudge label lags): bug (99−95=4/3, +1) the LONE over-budget category → forced by
  category discipline. KEY STRUCTURAL FACT: `git diff 5766239(C85)..HEAD` over production source is EMPTY — NOTHING
  has changed since the cold bug vein was last swept (the C6/C10/C15/C83/C89/C95 dry scouts + every surface
  certified), so a regression is structurally impossible. Per the loop's OWN explicit C89/C95 recommendation
  ("record dry on the FIRST recheck + pivot — the budget is forcing ceremony, not finding work"), did ONE quick
  firsthand spot-check to stay non-vacuous rather than re-running the full cold sweep on provably-unchanged code:
  `buildAmortizationSchedule` (analytics-charts.ts:244, the #92/#117/#139 0%-APR money class) — CLEAN: 0%-APR →
  interest=0 (the bare `balance * apr/100/12` handles it, no special-case), principal clamped
  `Math.min(Math.max(0, payment − interest), balance)` (never negative, never over-pays the final month),
  paid-off loans skipped, no caller-input mutation; pinned by amortization-schedule.test.ts. No fresh defect —
  recorded DRY. The productive bug surface remains ONLY the parked Angelo-gated queue (#148/#100/#79/#129). NEXT
  bug cycle: with source unchanged since C85, record dry IMMEDIATELY (a 1-line precondition check: if
  `git diff C85..HEAD` over src is empty, nothing can have regressed) + pivot — re-scanning is pure ceremony.
  Doc-only — no source/test touched. cov: be 87.47% / fe 86.35% (~ — nothing touched).
- **C98 (arch no-churn [recorded fast per C91] → deep-review: pinned the session-cookie SECURITY-ATTRIBUTE
  contract via a source-scan)** — Balance at C98 (HEAD was C97; nudge label lags): TWO over budget — arch
  (98−91=7/5, +2, most-starved) and deep-review (98−92=6/5, +1, co-starved). ARCH: per the C91 standing
  recommendation, checked the precondition FIRST — `git diff 5766239(C85)..HEAD` over production source is EMPTY
  (no source threaded since the last arch scout: C86 saturated/C87 test/C88 eyes-on/C89 dry/C90 infra/C92 cert/C93
  eyes-on/C94 test/C95 dry/C96 eyes-on/C97 infra), so there is structurally nothing to converge → recorded no-churn
  IMMEDIATELY without re-scouting (the C12/C91 discipline; don't force ceremony). The substantive work PIVOTED to
  the co-starved deep-review (the C4 arch-scout→pivot precedent). DEEP-REVIEW: the C92/C97 notes flagged the
  session/cookie lifecycle as unaudited. Scouted Lucia firsthand: the session CONFIG (lucia.ts: secure-gates-prod,
  sameSite lax, httpOnly default) + the REFRESH chokepoint `validateAndRefreshSession` (utils.ts: validate→
  fresh-as-is→rotate-create-before-invalidate→fail-open-on-throw) are sound, and the refresh LOGIC is already
  guarded (validate-and-refresh-session.test.ts pins all 4 branches incl. the NORTH_STAR #1 fail-open). Found the
  genuine GAP: the session-cookie SECURITY ATTRIBUTES (secure: CONFIG.env==='production' / httpOnly: true /
  sameSite: 'Lax') are hand-duplicated across 5 manual sites — 2 setCookie (routes.ts login + utils.ts rotation) +
  3 deleteCookie (logout + 2 callback cleanups) — coupled only by copy-paste, and NO test asserted ANY of them
  (the refresh test mocks Lucia + checks the return value, never the `c` cookie attrs). A drift on one site (a
  refactor hardcoding `secure: true` → breaks local-http dev; `secure: false`/dropped httpOnly → ships an insecure
  / JS-readable session cookie in prod, an XSS-exfil + network-theft regression; a drifted deleteCookie silently
  fails to clear the cookie → logout doesn't log out) is invisible to every happy-path behavioral test. GUARD: new
  session-cookie-security-attributes.test.ts (+4) — source-scans both auth files, asserts every
  set/deleteCookie(c, lucia.sessionCookieName, …) block carries all 3 attributes. NON-VACUOUS proved firsthand:
  dropped httpOnly from the refresh-path cookie → ONLY the httpOnly test RED (named the utils.ts offender); restored
  → 4 pass. The one-edit→source-scan pattern (C25/C45/C59/C67/C80/C87/C94) applied to the session-cookie security
  contract. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new),
  1707 pass / 0 fail (+4), build bundled. Backend-only (no UI → no shot). cov: be 87.47% / fe 86.35% (~ —
  guard-only source-scan; pins a multi-site security contract a happy-path test can't). The auth-security surface
  (rate-limit/client-IP C92, CORS/CSRF C94, session-cookie attrs C98) + the config-coupling seam
  (C67/C80/C81/C87/C94/C98) are now broadly fenced. NEXT deep-review: genuinely thin — every audited surface is
  certified; prefer a feature/bug-surfaced invariant or an Angelo steer over another cold audit.
- **C97 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C90)** — Balance at
  C97 (HEAD was C96; nudge label lags): TWO over budget — infra (97−90=7/6, +1) and arch (97−91=6/5, +1); infra wins
  on raw starvation (7 > 6, the C84 tie-break) AND is the higher-leverage pick (arch is reliably no-churn at its
  structural floor, C91; infra's cadence is genuinely non-dry). Ran right in the ~10-cycle window (7 since C90).
  (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.test.svelte` specs (bun/vitest discover by
  filesystem; an untracked spec vanishes on merge). Only the intentional `M .gitignore` + `M frontend/.gitignore`
  local overrides remain. (2) COVERAGE RE-MEASURED: **BE 87.47% line / 87.20% func** (file-mean, 1703 pass) — line
  UNCHANGED vs C90, func +0.01 (the C94 CORS/CSRF source-scan guard added a couple covered helper lines); **FE
  86.35% line / 87.68% func / 78.78% branch** (v8, 735 pass) — FULLY UNCHANGED (no FE source touched since C52;
  C93/C96 were eyes-on shots, C95 a dry scout; the C90 branch 78.88 was v8 rounding noise, back to 78.78). Both at
  the ~87 BE / ~86 FE structural ceiling — the 90% goal stays structurally gated (BE tail OAuth/DI-bound; FE tail
  eyes-on components now ALL shot but not unit-covered). (3) BOTH-SIDES GREEN: BE 1703 / FE 735, 0 fail. (4) BRANCH
  STATE: claude-loop-dev = **97 commits ahead** of fresh origin/main, PR-ready (category spread bug 23 / feature 19
  / guard 15 / deep-review 15 / infra 13 / arch 11; the 97th is the C1 loop-doc reset). Recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47% / fe 86.35% (MEASURED). NEXT cadence
  ~C107. STANDING SIGNAL (C83–C97, 15 cycles): every self-authorizable vein is swept — net production change across
  all 15 is 2 guard tests (C87/C94). The branch is healthy + PR-ready; the highest-leverage remaining work is GATED
  on Angelo (#148 lease burn bar / import defaultCategory / #100 / #79 / #129) — a steer is the only thing that
  opens a fresh vein.
- **C96 (feature — eyes-on the LAST never-shot real surface /profile, desktop + mobile; CLEAN → every real surface
  now eyes-on)** — Balance at C96 (HEAD was C95; nudge label lags): NOTHING strictly over budget; arch (96−91=5/5) +
  infra (96−90=6/6) both AT budget. Arch is reliably no-churn (C91 confirmed, no source changed since C85) and infra
  ran C90 (cadence due ~C100), so both are weak picks → took the highest-leverage OPEN item: /profile, the last
  never-shot REAL surface (the C93 note teed this up — /trips is a Coming-Soon placeholder, /privacypolicy +
  /termsofservice are static legal copy). Shot DESKTOP + MOBILE (Pixel 5) + Read both PNGs. CERTIFIED CLEAN: desktop
  renders every section — Identity (DU avatar, Demo User/email, editable Display Name w/ pencil, Email, Member Since
  "June 2026" = correct vs today 2026-06-18), Connected Accounts (Google provider w/ unlink + "Link GitHub"),
  Sessions (Coming Soon, dashed fields), Data & Privacy (Export-all-data w/ working Export button + the honest
  "Images and photos are not included" disclosure; Delete account = Coming soon), Sharing + Notifications (Coming
  Soon). The Coming-Soon cards are clean intentional placeholders, NOT broken states. MOBILE (393px): NO horizontal
  overflow (NORTH_STAR #3) — title/subtitle wrap, the Identity label↔value rows reflow with right-aligned values
  (even the longest, demo@example.com, fits), Connected Accounts row reflows. Zero console errors; no /auth bounce.
  No defect; no fix (the GUIDE agent-HIGH-findings-often-false discipline). /profile is sound — DON'T re-audit.
  Read-only shots, no fixtures created. Doc-only — no committable source (shot.mjs is gitignored harness). cov: be
  87.47% / fe 86.35% (~ — no test/code touched). **MILESTONE: every REAL surface is now eyes-on
  (dashboard/analytics/insurance/financing-loan+lease/maintenance/recurring-dialog/settings/profile + the
  vehicles/expenses/reminders lists).** NEXT feature cycle: feature is FULLY exhausted of self-authorizable work —
  the only open feature (import-trackers) is Angelo-gated on defaultCategory, and every surface is shot → record
  parked + pivot to the co-starved category UNLESS Angelo steers (import defaultCategory unblocks the detect→commit
  round-trip + its 4-state shot; #148 the lease burn bar).
- **C95 (bug — offline-outbox field-dropout scout, DRY [6th consecutive]; recorded + pivot)** — Balance at C95
  (HEAD was C94; nudge label lags): bug (95−89=6/3, +3) the LONE over-budget category → picked (category discipline
  forces it). Cold scouts long exhausted (C6/C10/C15/C83/C89) + NO production source changed since C85, but ran one
  genuine firsthand scout of the freshest un-rechecked vein — the GUIDE-flagged offline-outbox→backend field-dropout
  family (#66/#101/#111). ALL CLEAN: (1) `api-transformer.ts` toBackendExpense/fromBackendExpense — symmetric +
  complete: volume/charge routed by isElectricFuelType, the create-vs-edit description null-clear asymmetry is
  deliberate (isEdit option, documented), every optional field (mileage/fuelType/description/sourceType/sourceId/
  missedFillup/groupId/groupTotal/splitMethod) round-trips. (2) the CALL-SITE dropout class (the real #66/#101/#111
  bug — the mapper can't carry a field the call site never put in the object) is pinned by
  offline-save-carries-fuel-fields.test.ts, which SOURCE-SCANS every `addOfflineExpense({...})` call for
  `missedFillup` (#101/#111 MPG-pairing) + `fuelType` (#66 electric charge survives sync) — exactly the GUIDE-flagged
  classes; plus api-transformer.property.test.ts pins the round-trip. The offline mapper + its call sites are
  SATURATED (10 test files). No fresh defect — recorded DRY, did NOT manufacture (the GUIDE bug-vein discipline + the
  C89 "record dry immediately + pivot"). The productive bug surface remains ONLY the parked Angelo-gated queue
  (#148/#100/#79/#129). NEXT bug cycle: with the cold vein 6× dry + no source churning, record dry on the FIRST
  recheck + pivot — the budget is forcing ceremony, not finding work; real defects now come only from a deep-review/
  feature cycle surfacing a concrete invariant, or an Angelo steer. Doc-only — no source/test touched (a dry scout).
  cov: be 87.47% / fe 86.35% (~ — nothing touched).
- **C94 (guard — pinned the CORS↔CSRF origin-allowlist coupling in app.ts via a source-scan; the C92-flagged
  unaudited surface)** — Balance at C94 (HEAD was C93; nudge label lags): TWO over budget — guard (94−87=7/6, +1)
  and bug (94−89=5/3, +2); guard most-starved (7 > 5) → picked (the C84 tie-break: raw starvation wins, not overage).
  Guard is narrowing + NO production source changed since C85, so I needed a genuine unguarded load-bearing
  invariant. The C92 deep-review flagged CORS/CSRF origin config as unaudited — verified the gap firsthand: app.ts
  wires `cors({ origin: CONFIG.cors.origins, ... })` AND `csrf({ origin: CONFIG.cors.origins })` from the SAME
  allowlist, coupled ONLY by both literally referencing that const — and NO test pinned it (the 2 files mentioning
  "csrf" assert the application-layer OAuth-state userId match, NOT the middleware origin allowlist). If a future
  edit drifts them (hands csrf a hardcoded/narrower/wider list, or an env var cors doesn't use), the two trust
  boundaries SPLIT: CSRF trusting an origin CORS rejects (or vice versa) → either a CSRF-protection gap on an
  unintended origin or legit cross-origin state-changing requests wrongly rejected as forgery (NORTH_STAR #2
  isolation), and a happy-path same-origin behavioral test stays GREEN, blind to it. GUARD: new
  `src/__tests__/cors-csrf-origin-coupling.test.ts` (+4) — source-scans app.ts: both `cors({...})` and `csrf({...})`
  must pass `origin: CONFIG.cors.origins`, AND both must reference the IDENTICAL origin source (drift detector).
  NON-VACUOUS proved firsthand: drifting csrf to a hardcoded `['http://localhost:5173']` → 2 of 4 RED (the csrf
  source assertion + the identical-source check); restored → 4 pass. The one-edit→source-scan pattern (C25/C45/C59/
  C67/C80/C87) applied to a security middleware-config coupling. Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1703 pass / 0 fail (+5: the +4 here + a prior-uncounted
  delta), build bundled. Backend-only (no UI → no shot). cov: be 87.47% / fe 86.35% (~ — guard-only source-scan;
  pins a cross-middleware config coupling a single-request test can't). NEXT guard: thin — prefer a fresh
  deep-review/feature-surfaced invariant over a cold guard scout; the config-coupling seam (retry-ceiling C67,
  export-import C80, OPTIONAL-files C81, prev-period C87, CORS/CSRF C94) is now broadly fenced.
- **C93 (feature — eyes-on the never-shot /settings surface [backup/restore + provider config], desktop + mobile;
  CLEAN)** — Balance at C93 (HEAD was C92; nudge label lags): TWO over budget — feature (93−88=5/4, +1) and bug
  (93−89=4/3, +1); feature most-starved (5 > 4) → picked. Import-trackers stays Angelo-gated (defaultCategory), so
  per the C68/C75/C82/C88 precedent took the shootable feature increment. The C88 "every populated surface eyes-on"
  claim was scoped to the DATA-feature surfaces (dashboard/insurance/financing/maintenance/recurring) — checked the
  shot history firsthand: /settings had ZERO prior eyes-on cycles (vs /reminders ×12, /insurance ×12, /financing
  ×10, /expenses ×10, /analytics ×5, /vehicles ×2, /dashboard ×1). /settings is the backup/restore + storage-provider
  + unit-preferences surface — a NORTH_STAR #1 (data-safety sacred) + #3 (mobile-first) crown-jewel that had never
  been visually verified. Shot it DESKTOP + MOBILE (Pixel 5) + Read both PNGs. CERTIFIED CLEAN: desktop renders every
  section — Profile card (Demo User/email/chevron), Appearance (Light/Dark/System toggle, System active), Unit
  Preferences (Distance=Kilometers / Fuel=Liters / Charge=kWh / Currency=USD with help text), Install App (PWA),
  Storage Providers (Download Backup + Restore buttons, Default Photo Source picker, an "e2e fake provider …
  Connected" card with edit/delete + ZIP-backup toggle). MOBILE (393px): NO horizontal overflow (NORTH_STAR #3) —
  the highest-risk elements (the 3-col theme grid, the wide unit selects, the Save-Settings FAB) all reflow within
  the Pixel-5 width; FAB pins bottom full-width. Zero console errors; no /auth bounce (auth valid). The mid-page dark
  Save-Settings button in the desktop full-page shot is the known fixed-FAB capture artifact (same as prior eyes-on
  cycles), not a render defect. No defect; no fix (the GUIDE agent-HIGH-findings-often-false discipline). /settings is
  sound — DON'T re-audit. Cleanup: none needed (read-only shots, no fixtures created). Doc-only — no committable
  source (shot.mjs is gitignored harness). cov: be 87.47% / fe 86.35% (~ — no test/code touched). NEXT feature cycle:
  the remaining never-shot routes are /profile + /trips (a "Coming Soon" placeholder, not a real surface) +
  /privacypolicy + /termsofservice (static legal copy) — only /profile is a real un-shot surface; after that, every
  real surface is eyes-on and feature is fully Angelo-gated (import defaultCategory + #148) → record parked + pivot.
- **C92 (deep-review — certified the rate-limit / client-IP abuse-prevention surface CLEAN + already comprehensively
  guarded firsthand; a NEW area, recorded + pivot)** — Balance at C92 (HEAD was C91; nudge label lags): deep-review
  (92−86=6/5, +1) the LONE over-budget category → picked. The eyes-on vein closed C88 + the C86 note pointed the next
  deep-review at "a backend correctness audit of a genuinely UNAUDITED surface." Picked the rate-limiting / client-IP
  resolution chokepoint — security-load-bearing (a spoofed-XFF bypass lets an attacker get a fresh per-request bucket
  → defeat the auth brute-force limiter, NORTH_STAR #2 isolation/abuse) and NOT in the prior audited set
  (backup/restore/import/TCO/sync/notification). Audited THREE layers firsthand, ALL certified clean + already
  guarded — DON'T re-audit: (1) `getClientIp` (utils/client-ip.ts) — derives the IP from the REAL socket
  (getConnInfo) and honors X-Forwarded-For ONLY when the socket is a configured trusted proxy; default (no trusted
  proxies) ignores XFF entirely. client-ip.test.ts (C265) pins all 4 trust branches (default→ignore-XFF,
  trusted-socket→honor-leftmost-XFF, untrusted-socket→ignore-XFF, no-socket→fallback) + the empty/whitespace-XFF +
  multi-hop edges + the explicit "two different-XFF requests from one socket share a bucket" bypass-closed assertion.
  (2) the rate-limit middleware (middleware/rate-limit.ts) — a clean fixed-window limiter; rate-limit.test.ts (C112)
  pins window-open / up-to-limit-pass / over-limit-429-with-the-documented-headers / body contract / per-key caller
  isolation / window-reset, PLUS a vacuity guard asserting CONFIG.disableRateLimit===false in the test process (the
  C77/C91 silent-vacuity trap). (3) the WIRING — the auth limiter keys on `auth:${getClientIp(c)}` (the trusted IP,
  not the raw header); the sync/backup/restore/trigger limiters key on the authenticated `user.id`. The keyGenerator
  closures are trivial one-liners — pinning them directly would be coverage theater (the C181/C229 lesson). No fresh
  defect; the bypass is closed + pinned. Recorded clean; did NOT manufacture a redundant cert (the GUIDE
  agent-HIGH-often-false + the C86 saturation discipline). Doc-only — no source/test touched. cov: be 87.47% / fe
  86.35% (~ — nothing changed). NEXT deep-review: another genuinely UNAUDITED backend surface (e.g. the CORS/CSRF
  origin config, the bodyLimit/zip-bomb upload guards, or the session/cookie lifecycle) — the eyes-on + the
  data-safety (backup/restore/import) veins are both exhausted.
- **C91 (arch — no churn warranted; pagination/route idioms already single-sourced + NO source changed since C85,
  recorded + pivot)** — Balance at C91 (HEAD was C90; nudge label lags): arch (91−85=6/5, +1) the LONE over-budget
  category → picked (category discipline). Per the C85/C12 "record no-churn FAST when arch next goes over budget"
  recommendation, but ran one genuine scout first. KEY STRUCTURAL FACT: `git diff 5766239(C85)..HEAD` over
  backend/src (excluding __tests__) is EMPTY — NO production source changed since the C85 arch scout (C86 saturated
  / C87 test-only / C88 eyes-on / C89 dry / C90 docs), so there is structurally no freshly-threaded duplication to
  converge (the exact precondition the C85/C12 notes describe). Scouted the freshest un-recorded candidate anyway —
  the pagination parsing across odometer/photos/expenses routes — and found it ALREADY well-factored: `clampPagination`
  + `buildPaginatedResponse` are both single-sourced in src/utils/pagination.ts (a prior arch cycle); all 3 routes
  delegate; the per-endpoint query schemas (odometer/expenses carry search/tags coercion, photos uses the generic
  commonSchemas.pagination) are deliberately divergent — merging would couple endpoint-specific contracts (arch
  rule 2). The ownership-validate+respond idiom is the C36-recorded "natural Hono idiom with shared validators"
  (not mergeable). Recorded no-churn; did NOT manufacture (the C4/C12/C36/C85 precedent + the GUIDE "Don't
  manufacture churn"). The convert family stays single-sourced (C64/C71/C78). RECOMMENDATION (now 6th confirm,
  C4/C6/C12/C36/C85/C91): arch is firmly at its structural floor — next time it goes over budget, record no-churn
  IMMEDIATELY without re-scouting unless a bug/feature cycle has threaded a NEW dup since the last arch scout (check
  the git diff first — if backend/src is unchanged, there's nothing to find). Doc-only — no source touched. cov: be
  87.47% / fe 86.35% (~ — nothing changed).
- **C90 (infra — branch-hygiene sweep + coverage re-measure, the ~10-cycle cadence; last ran C84)** — Balance at
  C90 (HEAD was C89; nudge label lags): NOTHING strictly over budget; arch (90−85=5/5) + infra (90−84=6/6) both AT
  budget. Infra wins on raw starvation (6 > 5) AND is the higher-leverage pick — its cadence task is inherently
  NON-dry (a real coverage re-measure + merge-safety sweep + green check + branch refresh), whereas arch is reliably
  no-churn at its structural floor (C4/C12/C36/C85) and bug/deep-review just recorded dry/saturated (C86/C89). Ran ~4
  cycles early vs the ~C94 target, but every alternative this cycle produces a dry/no-churn record, so the
  non-dry pick is correct. (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.test.svelte` specs
  (bun/vitest discover by filesystem; an untracked spec vanishes on merge). Only the intentional `M .gitignore` +
  `M frontend/.gitignore` local overrides remain (keep `.meshclaw-tools/` + `*.meshclaw.e2e.ts` ignored by design;
  the C68 shot.mjs CLICK harness is correctly gitignored). (2) COVERAGE RE-MEASURED: **BE 87.47% line / 87.19% func**
  (file-mean, 1698 pass) — UNCHANGED vs C84 (C85 no-churn + C86 saturated + C87 prev-period source-scan guard [scans
  a string, line-covers nothing new] + C88 eyes-on + C89 dry scout); **FE 86.35% line / 87.68% func / 78.88% branch**
  (v8, 735 pass) — line/func UNCHANGED, branch +0.10 vs C84's 78.78 = v8 instrumenter rounding noise (NO FE source
  touched since C52). Both at the ~87 BE / ~86 FE structural ceiling — the 90% goal stays structurally gated (BE
  tail = OAuth/DI-bound auth-routes/provider-services/backup-orchestrator/db-connection; FE tail = eyes-on
  components now all shot but not unit-covered). (3) BOTH-SIDES GREEN: BE 1698 / FE 735, 0 fail. (4) BRANCH STATE:
  claude-loop-dev = **90 commits ahead** of fresh origin/main, PR-ready (category spread bug 22 / feature 17 /
  guard 14 / deep-review 14 / infra 12 / arch 10; the 90th is the C1 loop-doc reset). Recorded here since
  BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47% / fe 86.35% (MEASURED). NEXT cadence
  ~C100. The branch is healthy + PR-ready; the loop has swept every self-authorizable vein (C83–C89), so the
  highest-leverage remaining work is GATED on Angelo (#148/#100/#79/#129 + import defaultCategory) — a steer
  unblocks a fresh vein.
- **C89 (bug — date/tz + materialization scout, DRY [5th consecutive]; recorded + pivot per the GUIDE discipline)**
  — Balance at C89 (HEAD was C88; nudge label lags): bug (89−83=6/3, +3) the LONE over-budget category → picked.
  The cold pure-logic vein is long exhausted (C6/C10/C15/C83), so per the GUIDE bug seam ("date/tz math — setMonth
  overflow, UTC slice") + the fact C88 just exercised the reminder trigger/materialization path, ran a fresh scout
  of the date-advance + cost + materialization surfaces. ALL verified CLEAN firsthand: (1) the reminder
  date-advance (`computeNextDueDate` / `advanceCustom` / `clampToAnchorDay`) — the Jan-31→Feb overshoot is dodged
  by `setDate(1)` BEFORE the `setMonth`/`setFullYear` bump, then month-end clamp via `clampToAnchorDay` anchored to
  `startDate.getDate()` (getAnchorDay); the bug-#12/#13/#107/#114/#116 family (corrupt-frequency throw,
  non-positive-interval throw, endDate-boundary `hasReminderEndedBy`, fast-forward non-progress backstop) is all
  closed + guarded. (2) `monthKeysInRange` (analytics-charts.ts:185, the GUIDE-flagged setMonth site) — cursor is
  anchored to day-1 via the 3-arg `Date(y, m, 1)` constructor (NOT setMonth on a day-29..31 date), so it's
  rollover-safe, not just commented. (3) `reminder-cost.ts` annualization (occurrencesPerYear ÷ 12, the C5/C88
  dashboard run-rate) — consistent with computeNextDueDate, un-fireable shapes (non-positive/unknown interval) →
  0, no divide-by-zero. (4) the split-materialization path (`createExpenseFromReminder`) delegates to the shared
  `expenseSplitService.computeAllocations` + `createSiblings` — the SAME code the regular split flow uses, already
  saturated (C2/C4/#88/#98). No fresh defect — recorded DRY, did NOT manufacture (the GUIDE agent-HIGH-often-false
  discipline + the C15/C83 "record dry FAST + pivot" recommendation). The productive bug surface is now the parked
  Angelo-gated queue (#148 lease burn bar / #100 json_patch / #79 stuck-offline / #129 OAuth email-sync); cold
  scouts are spent. NEXT bug cycle: record dry immediately + let the budget pull elsewhere UNLESS a deep-review/
  feature cycle surfaces a concrete invariant or Angelo steers. Doc-only — no source/test touched (a dry scout).
  cov: be 87.47% / fe 86.35% (~ — nothing touched).
- **C88 (feature — eyes-on the never-shot recurring-expenses MaterializedExpensesDialog POPULATED; CLEAN)** —
  Balance at C88 (HEAD was C87; nudge label lags): TWO over budget — feature (88−82=6/4, +2) and bug (88−83=5/3,
  +2); feature most-starved (6 > 5) → picked. Import-trackers (the only open feature SPEC work) stays Angelo-gated
  (defaultCategory), so per the C68/C75/C82 precedent I took the shootable feature increment: an eyes-on of the
  ONE surface the C82/C86 notes flagged as still-unshot — the recurring-expenses MaterializedExpensesDialog in a
  POPULATED state (C5 shot the dashboard RecurringCostCard, C9 shot the ⟳ badge, C19 certified the dialog EMPTY
  state, C27 verified the round-trip via API, but the dialog's DATA markup itself was never eyes-on — the C68
  "E2E can't catch never-rendered fields" lesson). Stack already up (:5173/:3001). Minted auth, created an OVERDUE
  monthly expense reminder ("C88 eyes-on insurance", $150/mo, startDate 2025-12-15, financial category on Daily
  Driver), POST /trigger materialized 7 catch-up rows (Dec 2025→Jun 2026, $1,050 total — confirmed via GET
  /reminders/:id/expenses), opened the dialog via the per-card `[data-testid="reminder-card-<id>"]
  button[aria-label="View materialized expenses"]` (scoped past the 4 pre-existing e2e expense reminders) +
  **Read the PNG** (zoomed crop). CERTIFIED CLEAN: header (Receipt icon + "Materialized expenses" + ×), subtitle
  "Expenses auto-created by "C88 eyes-on insurance"." (reminder name interpolated, smart quotes), summary
  "**7 expenses · $1,050.00 total**" (matches the API exactly), each row = Financial · {date asc Dec 15 2025→May
  15 2026} · car-icon Daily Driver · **$150.00** right-aligned. Zero console errors; full FE→BE→DB→render
  round-trip. The dialog markup is sound — DON'T re-shoot it. CSRF NOTE for future API-seeded eyes-on: POST routes
  (/trigger, DELETE) need an `Origin: http://localhost:5173` header (hono/csrf, app.ts:116) or they 403; GET is
  unaffected. CLEANUP: deleted the reminder (severs source link, keeps rows = history by design) + all 7
  materialized rows individually → DB restored to its pre-cycle state (4 expense reminders, the C88 reminder 404s).
  Doc-only — no committable source (shot.mjs is gitignored harness; no auto-fix). cov: be 87.47% / fe 86.35%
  (~ — eyes-on cert, no module touched). NEXT feature cycle: still Angelo-gated (import-trackers defaultCategory +
  #148) → with all 3 feature tails + every populated surface now eyes-on (dashboard/insurance/financing
  loan+lease/maintenance/recurring dialog), record parked + pivot to the co-starved category UNLESS Angelo steers.
- **C87 (guard — pinned bug #18 split-sibling exclusion on the PREV-PERIOD SQL fillup count, the C97 guard's
  missing twin)** — Balance at C87 (HEAD was C86; nudge label lags): THREE over budget — guard (87−80=7/6, +1),
  feature (87−82=5/4, +1), bug (87−83=4/3, +1); guard most-starved (7) → picked. Scouted the convert-dispatch
  family FIRST (the C73/C80/C86 "guard is narrowing" note) and confirmed it's saturated — C59 placeholder-scan +
  C73 orientation-scan + per-member behavioral guards (incl. radar C76's ranking-inversion fixture + the C79
  prev-year VOLUME mixed-unit test) fence every #94 dispatch. Found the genuine GAP one layer over: the FuelStats
  "This Period vs Last Period" fillup COMPARISON computes its two halves through DIFFERENT predicate
  implementations across two layers — `fillups.currentYear` is in-memory `fuelRows.filter(isFillup)`
  (volume != null && volume > 0) while `fillups.previousYear` is the SQL `COUNT(CASE WHEN volume > 0 THEN 1 END)`
  in queryFuelAggregates (C79's group-by-vehicle shape), coupled only by a "matches the isFillup predicate"
  comment. A split fuel expense makes volume-null siblings (ExpenseSplitService) that must NOT inflate either
  count (bug #18 / C97). VERIFIED FIRSTHAND the C97 guard pins ONLY the currentYear/in-memory half — NO test
  asserts `fillups.previousYear` from a populated DB (summary-route.test.ts:41 is a mocked fixture; previousMonth
  is the in-memory path), so the SQL count's null-exclusion is un-exercised: drop the `CASE WHEN volume > 0` to a
  plain `COUNT(*)` and the prev-period count silently inflates by the split legs ("Last Period over-reports
  fillups", NORTH_STAR #2) while every test stays green. GUARD: +1 in fuel-stats-fleet-distance-pooling.test.ts
  (next to the C79 prev-year volume test, same 2024-range/2023-prev-window) — seed 2 real fillups + a 2-leg
  volume-null split in the prev window, assert `fillups.previousYear === 2` (not 4) + the prev volume SUM stays
  19 (null contributes 0). NON-VACUOUS proved firsthand: forcing `COUNT(*)` → the new test RED (Expected 2,
  Received 4) while the OTHER 10 in-file + the C97 currentYear test + calendar-month tests ALL stay green
  (confirming the gap was prev-period-only); restored → 1698 pass. The bug-class-pinned-on-one-layer → guard-pins-
  the-sibling-layer pattern (C67 cross-module retry-ceiling; here C97 in-memory count → C87 SQL count). Verify:
  backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1698 pass / 0 fail
  (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.47% / fe 86.35% (~ — analytics repo already
  line-covered; +1 pins the prev-period SQL predicate's null-exclusion a same-row-shape test can't). Next guard:
  thin — the fuel-stats count/convert predicates are now fenced on both layers; prefer a fresh deep-review/feature
  eyes-on-surfaced invariant over another cold guard scout.
- **C86 (deep-review — surfaces SATURATED; 4 candidates verified already-guarded firsthand, recorded + pivot)**
  — Balance at C86: four AT budget (feature 4/4, deep-review 5/5, guard 6/6, bug 3/3); deep-review has the lowest
  budget (tips first) → picked. Scouted 4 fresh deep-review candidates; EACH already well-guarded, DON'T
  re-audit: (1) FE sync-manager RETRY/BACKOFF — sync-manager.test.ts pins retry-count, maxRetries cap,
  `retryDelay * 2^retries` exponential, no-reschedule-at-cap, #121 retry-conflict-surface, #134
  orphan-resurrection (the C67/C81 "next vein" pointer is STALE — covered since); (2) determineConflictType
  (C67 cert, sync-manager.test.ts:562+); (3) computeTCOTotal — the #27/#28 double-count rule directly pinned in
  per-vehicle.property.test.ts:411 + Property 14 + #33 block; (4) reminder-NOTIFICATION read path — feed order +
  #142 + mark-read/404 (notifications-feed.test.ts) + per-milestone (reminderId,dueOdometer) dedup incl. re-arm
  + both-axes no-collision (trigger-mileage.test.ts, C256). Recorded saturated; did NOT manufacture a redundant
  cert (GUIDE agent-HIGH-often-false + C12 structural-floor discipline). The one still-paying deep-review vein is
  EYES-ON of a never-shot surface (E2E can't catch never-rendered fields — the C68 lesson); NEXT: the
  recurring-expenses MaterializedExpensesDialog / ⟳ badge POPULATED (needs a type:expense reminder + trigger to
  materialize rows first; C5 shot the dashboard card, C27 verified the round-trip via API, the dialog markup is
  unshot). Doc-only — no source touched. cov: be 87.47% / fe 86.35% (~ — nothing changed). PATTERN NOTE: the
  C83 (bug) / C85 (arch) / C86 (deep-review) run of dry scouts confirms the codebase is mature — the highest-
  leverage remaining work is GATED on Angelo (#148/#100/#79/#129 + import defaultCategory); the loop will keep
  producing solid guards/certs but a steer unblocks a fresh vein.
- **C85 (arch — no churn warranted; convert family fully deduped, recorded + pivot)** — Balance at C85: arch
  (85−78=7/5, +2) the lone over-budget category → picked. Scouted the #94 convert-helper residue firsthand;
  REJECTED both candidates per arch rule 5 (name a concrete payoff): (1) the 5-arg convertEfficiency
  from-vehicle-units shape is only 2 sites (radarUnitConverters closure + the convertedGasEfficiencyPoints
  generator), one interleaved with skipConversion + the load-bearing gas-gate — a 2-site wrapper is thin churn
  the generator wouldn't cleanly delegate; (2) `vehicleNameMap.get(vId) ?? 'Unknown'` repeats 10× but is a
  COSMETIC fallback (a drift is harmless — UNLIKE C71's `?? {...DEFAULT}` that threw, or C78's NaN-guard),
  10 sites for a 1-token tidy. The convert family is already single-sourced (C64 generator / C71 vehicleUnitsFor
  / C78 convertRowVolume). Recorded no-churn; did NOT manufacture (the C4/C12/C36 precedent + the GUIDE
  "Don't manufacture churn"). RECOMMENDATION (echoing C12): arch is at its structural floor — next time it goes
  over budget, record no-churn FAST + let the budget pull elsewhere. Doc-only — no source touched. cov: be
  87.47% / fe 86.35% (~ — nothing changed).
- **C84 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C77).**
  TWO over budget at C84 — infra (84−77=7/6, +1) and arch (84−78=6/5, +1); infra wins the tie on raw starvation
  (7 > 6). Ran a touch early (7 cycles since C77) but the budget forces it. (1) UNTRACKED-TEST SWEEP: CLEAN —
  zero untracked `.test`/`.spec.ts`/`.svelte` specs (the gitignored `*.meshclaw.e2e.ts` agent specs + the C68
  shot.mjs CLICK_TEXT harness are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are the
  intentional local overrides). (2) COVERAGE RE-MEASURED: **BE 87.47% line / 87.19% func** (1697 pass — both
  +0.01 vs C77 from the C80 export-import column guard + C81 backup-files guard); **FE 86.35% line / 87.68% func
  / 78.78% branch** (735 pass — UNCHANGED, C78–C83 all backend/doc). Both at the ~87 BE / ~86 FE structural
  ceiling. (3) BOTH-SIDES GREEN: BE 1697 / FE 735. (4) BRANCH STATE: claude-loop-dev = **84 commits ahead** of
  fresh origin/main, PR-ready (category spread bug 21 / feature 16 / guard 13 / deep-review 13 / infra 11 /
  arch 9; the 84th is the C1 loop-doc reset). Doc-only — no source touched. cov: be 87.47% / fe 86.35%
  (MEASURED). NEXT cadence ~C94.
- **C83 (bug — write-path validation-asymmetry scout, DRY; 3 surfaces verified clean firsthand)** — Balance at
  C83: bug (83−79=4/3, +1) the lone over-budget category → picked. #94 is fully closed (C79); the approved bug
  queue is all gated (#100 arch-gated, #129/#79 product-calls awaiting Angelo, #148 parked). Per the GUIDE bug
  vein (write-path validation asymmetry = the gold seam; one fresh-surface scout then record+pivot if dry), ran
  a fresh scout. ALL 3 surfaces verified CLEAN firsthand: (1) REMINDER create/update splitConfig —
  `refineSplitConfig` enforces splitConfig-vehicleIds === reminder vehicleIds (validation.ts:143) + the route
  validateVehicleIdsOwned's them, so the blob's legs are transitively owned (no verbatim-write gap; #88/#97 were
  the delete-cascade siblings, this is the create/update side). (2) ODOMETER write path — POST/PUT/DELETE all
  validate ownership before any write (the #215 tenant-scope class). (3) ODOMETER updateSchema `.partial()` —
  PROBED whether the `recordedAt` future-date refine survives `.partial()` (the #109/C372 dropped-refine class);
  it DOES because it's a FIELD-level `.refine()` (part of the field's schema; `.partial()` only wraps it in
  ZodOptional), UNLIKE #109's object-level `.superRefine()` — and it's already guarded (update-route.test.ts +
  validation.property.test.ts). DEBUNKED the #109-analogy candidate firsthand rather than filing a false
  positive (the GUIDE agent-HIGH-findings-are-often-false discipline). Recorded dry; did NOT manufacture a
  finding. The write-path asymmetry seam stays SATURATED (#80–#146 + these 3). Doc-only — no source/test changed
  (a dry scout). cov: be 87.46% / fe 86.35% (~ — nothing touched). NEXT bug cycle: record dry + pivot fast;
  productive defects now come from deep-review/feature eyes-on surfacing concrete invariants, not cold scouts.
- **C82 (feature — /financing LOAN render eyes-on sweep, CLEAN)** — Balance at C82: feature (7/4, +3) the lone
  most-starved over-budget category → picked. Import-trackers (the only open feature SPEC work) stays
  Angelo-gated (defaultCategory) + #148 escalated, so per the C68/C75 precedent I took the shootable feature
  increment: a deep-UI eyes-on of the never-shot FinanceTab LOAN render (C68 shot the LEASE path; the loan +
  Payment-Metrics + amortization path was unshot — the vein C75/C81 flagged). Minted auth, shot the Toyota
  Camry loan vehicle (Bank of America 4.5% APR, $20k/60mo) Finance tab (CLICK_TEXT='Finance' since the tab
  state is client-side) + **Read the PNG**. CERTIFIED CLEAN: Next Payment $372.86 (Monthly · Loan · 4.5% APR,
  Record/Change buttons), Payment Progress 5% (Original $20,000 / Paid $900 / Remaining $19,100), and all 4
  PaymentMetricsGrid cards render correct loan math — Principal vs Interest $297.86 (+$75 interest), Payments
  Made 1 of 60, Estimated Payoff Mar 18 2031 (59 mo remaining), Total Cost of Loan $22,371.63 (12% over
  principal) — the figures the #92/#117/#139 0%-APR-class fixes touched. Payment History: the $900 Extra
  Payment with Principal/Interest split + Remaining Balance $19,100. The Amortization Schedule chart area is
  BLANK — VERIFIED firsthand this is the C26-documented IO-gated-chart headless-capture limit (ChartCard's
  visibility-watch IntersectionObserver doesn't fire in a full-page shot; the legend renders outside the gate),
  NOT a data/render defect: the /analytics/financing endpoint returns a populated loanBreakdown (12 entries),
  so the data path is healthy. No defect; no fix (the GUIDE agent-HIGH-findings-are-often-false discipline).
  The loan FinanceTab is architecturally sound — DON'T re-audit. No code changed; doc-only. cov: be 87.46% /
  fe 86.35% (~ — no test/code touched). NEXT feature cycle: still Angelo-gated → record parked + pivot, OR
  eyes-on the recurring-expenses dashboard widget in a populated state / a remaining un-shot surface.
- **C81 (deep-review)** — **Certified the backup-EXPORT serialization round-trip CLEAN + pinned the one
  unguarded invariant: OPTIONAL_BACKUP_FILES ⊆ TABLE_FILENAME_MAP (data-recovery, NORTH_STAR #1).** Balance at
  C81: deep-review (7/5, +2) most-starved over budget (feature tied on overage +2 but less starved + spec
  Angelo-gated) → picked. Audited the backup export path (createBackup → exportAsZip → parseZipBackup) firsthand
  — the C74 next-vein. CERTIFIED CLEAN + already well-guarded (DON'T re-audit): (a) createBackup's 15 BackupData
  keys === TABLE_SCHEMA_MAP (backup-createbackup-keys.test.ts, C208 part B); (b) SCHEMA_MAP keys === FILENAME_MAP
  keys + every schema table mapped-or-excluded (backup-table-coverage.test.ts, C208 part A); (c) export +
  restore BOTH derive columns from the SAME getTableColumns(table) → schema-symmetric, can't drift; (d) coerceRow
  numeric (#68/#209 thousands-separator) + JSON round-trips covered by the populated claims/maintenance/
  split-config/csv-special-chars round-trip suites. Found the GENUINE GAP: getRequiredBackupFiles() = FILENAME_MAP
  values MINUS the hand-maintained OPTIONAL_BACKUP_FILES set — coupled ONLY by literal filename strings. An
  OPTIONAL entry that drifts from the map (typo / a map rename) filters out NOTHING → a genuinely-optional file
  becomes REQUIRED → parseZipBackup rejects a valid OLDER backup missing it ("Missing required files"), so the
  user can't recover their own data (NORTH_STAR #1). Certified firsthand all 11 OPTIONAL entries are in the map
  today (zero orphans). GUARD: exported OPTIONAL_BACKUP_FILES + a 3rd test in backup-table-coverage.test.ts
  asserting OPTIONAL ⊆ FILENAME_MAP values. NON-VACUOUS proved firsthand: drifting the map's
  reminder_vehicles.csv → reminders_vehicles.csv orphans the OPTIONAL entry → RED naming the orphan + the
  consequence; restored → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing
  warnings, none new), 1697 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.46% /
  fe 86.35% (~ — guard/cert add; backup pipeline already well-covered, this pins the last drift seam). The backup
  export/restore round-trip is now broadly certified — next deep-review: the FE offline sync-manager retry/backoff,
  or an eyes-on /financing populated render.
- **C80 (guard)** — **Pinned the CSV export↔import column-name contract (the round-trip crown-jewel, NORTH_STAR
  #1) with a source-scan.** Balance at C80: THREE over budget — feature (5/4, +1), deep-review (6/5, +1), guard
  (7/6, +1); guard most-starved (7) → picked. With #94 fully closed (C79), scouted the convert-before-pool
  family FIRST and confirmed it's thoroughly fenced (C59 placeholder-scan + C73 dispatch-orientation + the
  per-member behavioral guards + the C79 prev-year test; the C71/C76/C78 private helpers are transitively
  driven — pinning them directly would be theater). Found the genuine GAP elsewhere: the export writes its
  header row from `EXPORT_COLUMNS` (expenses/routes.ts) and the native importer reads each cell BY NAME via
  `makeCellGetter`'s `get('<col>')` (import-csv.ts) — coupled ONLY by the column-name strings matching. Rename
  or drop an EXPORT_COLUMN without updating the importer's `get(...)` → a VROOM export silently STOPS
  round-tripping that field (the cell reads blank, the value is lost on re-import, NORTH_STAR #1). NEITHER
  existing suite catches it: export-csv.test.ts asserts the export only; import-csv.test.ts hand-writes its OWN
  literal header row (never imports the real EXPORT_COLUMNS const) — drift leaves both green. GUARD: exported
  EXPORT_COLUMNS + new export-import-column-contract.test.ts (+4): source-scans the importer's `get('<key>')`
  reads (10 cols) + asserts each is present in EXPORT_COLUMNS; pins the 2 export-only metadata cols
  (currency/createdAt) as INTENTIONALLY not-read (the asymmetry is one-directional ⊆, by design). NON-VACUOUS
  proved firsthand: renaming EXPORT_COLUMNS' `fuelType`→`fuel_type` → RED with "importer reads column(s) the
  export no longer writes: [fuelType] … would silently LOSE these fields"; restored → green. The
  one-edit→source-scan pattern (C25/C45/C59/C73) on the export/import round-trip contract. Verify: backend
  validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1696 pass / 0 fail (+4),
  build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard-only source-scan; pins a
  cross-module contract a single-side test can't). Next guard: thin — the import/export + convert families are
  now well-fenced; prefer a fresh deep-review-surfaced invariant.
- **C79 (bug #94, prev-year sub-member — #94 CLASS NOW FULLY CLOSED)** — **Convert each vehicle's prev-window
  volume to user-global units BEFORE pooling volume.previousYear (Angelo-APPROVED Sev-2, NORTH_STAR #2).**
  Balance at C79: four AT budget (feature 4/4, deep-review 5/5, guard 6/6, bug 3/3); bug has the lowest budget
  (tips first) + the concrete last #94 sub-member → picked. volume.previousYear (the FuelStats "Last Period"
  comparison) came from a raw SQL `SUM(volume)` in queryFuelAggregates over the prior equal-length window —
  cross-vehicle, UN-converted — so a mixed gal+L fleet pooled litres with gallons (the prev-year twin of the
  C62 current-period fix; the LAST un-fixed #94 member, a query-layer shape not a builder). FIX: changed
  queryFuelAggregates to GROUP the volume SUM BY vehicle (returns `{ count, volumeByVehicle: Map }` instead of
  a single totalGallons); buildFuelStatsFromData converts each vehicle's prev-window sum to the user's global
  unit before pooling (reusing vehicleUnitsFor + convertVolume), gated by skipConversion (a plain sum on the
  common single-unit branch). The COUNT stays unconverted (unit-free). Both callers (getFuelStats + getSummary)
  forward the new-shape agg unchanged. GUARD: +1 mixed gal+L test (range = calendar 2024, prev-window = 2023:
  A 40 gal + B 10 L→2.64 gal = 42.64, not the raw 50). NON-VACUOUS proved firsthand: reverting to the raw sum →
  50 not 42.64 RED; restored → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20
  pre-existing warnings, none new), 1692 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot).
  cov: be 87.46% / fe 86.35% (~ — analytics repo already well-covered; +1 mixed-unit guard). **#94 CLASS FULLY
  CLOSED** — all 6 builder members (distance C58 + volume C62 + monthlyConsumption C65 + seasonal C69 +
  dayOfWeek C72 + vehicleRadar C76) + the prev-year SQL sub-member (C79) now convert-before-pool. The
  fleet-wide analytics summary + fuel-advanced paths are unit-correct for a mixed mi+km/gal+L fleet end-to-end.
- **C78 (arch)** — **Extracted the per-row volume-convert idiom into ONE private helper across the 3
  volume-pooling sites (behavior-preserving; the zero-guard + per-vehicle lookup can't drift).** arch was the
  SOLE over-budget category (78−71=7/5, +2). The C62/C65/C72 #94 volume work left the SAME idiom hand-repeated
  at 3 sites: `v = row.volume ?? 0; if (v===0) return 0; vUnits = vehicleUnitsFor(map, row.vehicleId); return
  convertVolume(v, vUnits.volumeUnit, target.volumeUnit)` — in buildConvertedMonthlyConsumption (C65),
  buildConvertedDayOfWeekPatterns (C72), and the buildFuelStatsFromData volumeInUserUnits closure (C62).
  Extracted `convertRowVolume(row, vehicleUnitsMap, targetUnits)`; all 3 route through it. PAYOFF: the `?? 0`
  coalesce + the `=== 0` short-circuit (missing/zero volume → 0, never NaN into a sum) + the per-vehicle
  vehicleUnitsFor lookup are now ONE source of truth — a future site can't drift the zero-guard or drop the
  per-vehicle unit lookup. The volumeInUserUnits closure KEEPS its own leading `skipConversion ||` guard (it's
  the only volume path reached on BOTH branches; the 2 twins are converted-only) and delegates the rest.
  Behavior-preserving (green→green): the C62/C65/C72 mixed-unit volume guards (headline 42.64, monthlyConsumption
  42.64, dayOfWeek 6.06) all pass unchanged — `convertVolume` now has exactly ONE call site (inside the helper).
  Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1691 pass
  / 0 fail (no test delta — pure refactor), build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe
  86.35% (~ — pure refactor, same lines covered). STANDING PATTERN again: a bug cycle that threads a
  near-identical idiom into N sites (C62/C65/C72 #94) seeds the next arch cycle to converge it (sibling to C64
  generator + C71 vehicleUnitsFor). Don't re-scout these volume sites — single-sourced.
- **C77 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C70).**
  TWO over budget at C77 — infra (77−70=7/6, +1) and arch (77−71=6/5, +1); infra wins the tie on raw starvation
  (7 > 6). Ran a touch early (7 cycles since C70 vs the ~10 guideline) but the budget forces it AND the suite
  grew +19 (1672→1691) over C71–C76, so the re-measure is substantive, not ceremony. (1) UNTRACKED-TEST SWEEP:
  CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte` specs (the gitignored `*.meshclaw.e2e.ts` agent specs +
  the C68 shot.mjs CLICK_TEXT harness are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are
  the intentional local overrides). (2) COVERAGE RE-MEASURED: **BE 87.46% line / 87.18% func** (1691 pass); **FE
  86.35% line / 87.68% func / 78.78% branch** (735 pass) — BOTH FLAT vs C70 (C71–C76 were dedups/twins/guards on
  already-covered analytics + import modules + a new test file; FE untouched since C52). Both at the ~87 BE /
  ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1691 / FE 735. (4) BRANCH STATE: claude-loop-dev = **77
  commits ahead** of fresh origin/main, PR-ready (category spread bug 19 / feature 15 / guard 12 /
  deep-review 12 / infra 10 / arch 8; the 77th is the C1 loop-doc reset). Doc-only — no source touched.
  cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C87.
- **C76 (bug #94, vehicleRadar member — the LAST advanced builder)** — **Convert each vehicle's gas-MPG +
  odometer to user-global units BEFORE the cross-fleet normalize (Angelo-APPROVED Sev-2, NORTH_STAR #2).**
  Balance at C76: bug (4/3, +1) the lone over-budget category → picked. Took the 6th/last unit-bearing #94
  builder. buildVehicleRadar normalizes per-vehicle metrics via min/max ACROSS the fleet; TWO of its axes are
  unit-bearing — fuelEfficiency (each vehicle's avg gas-MPG in ITS mi/gal or km/L) AND mileage (each vehicle's
  max odometer in ITS distance unit). Pre-fix it normalized RAW values, so a mixed mi+km/gal+L fleet ranked a
  km/L car against an mpg car by bare magnitude → the efficiency ranking could fully INVERT (a more-efficient
  metric car scored LOWER). DESIGN: unlike the small twins (C65/C69/C72), buildVehicleRadar is ~75 lines + 2
  private helpers — a repository twin would be a large copy (arch-smell). Instead threaded an OPTIONAL
  `convert?: RadarUnitConverters` param (bound converter closures) into the ONE builder; it converts each
  vehicle's two unit-bearing metrics after the helpers populate `metrics` but BEFORE the normalize. Omitted →
  byte-identical (same-unit fleet + every existing caller). Kept analytics-charts UNIT-NAIVE: the repository
  owns the convertEfficiency/convertDistance deps via a new `radarUnitConverters(vehicleUnitsMap, userUnits)`
  helper (reuses the C71 vehicleUnitsFor fallback); switched at the call site by skipConversion. GUARD: +1 mixed
  mi/gal+km/L test driving getFuelAdvanced — A 30 mpg vs B 18 km/L→42.34 mpg: converted, B is more efficient →
  B.fuelEfficiency 100 / A 0 (the OPPOSITE of the raw magnitude ranking A>B). NON-VACUOUS proved firsthand:
  forcing the raw builder → B 100→0 (ranking inverts) RED; restored → green. The C73 orientation guard stays
  green (the radar ternary isn't a buildConverted* dispatch, correctly ignored). Verify: backend validate:local
  GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1691 pass / 0 fail (+1), build bundled.
  Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — analytics repo already well-covered; +1
  mixed-unit guard). **#94 ADVANCED BUILDERS ALL DONE** (monthlyConsumption C65 + seasonalEfficiency C69 +
  dayOfWeekPatterns C72 + vehicleRadar C76, on top of distance C58 + volume C62). REMAINING #94 = only the
  prev-year SQL-sum sub-member (previousYearGallons — a raw SQL SUM in queryFuelAggregates needing a per-vehicle
  group-sum at the query layer; a different, query-layer shape).
- **C75 (feature — /insurance eyes-on sweep, CLEAN; a suspected defect debunked firsthand)** — Balance at C75:
  feature (7/4, +3) the lone most-starved over-budget category → picked. Import-trackers (the only open feature
  SPEC work) stays Angelo-gated (defaultCategory) + #148 escalated, so per the C68 precedent I took the
  shootable feature increment: a deep-UI eyes-on of the never-shot /insurance render (the vein C46/C53/C60/C67
  repeatedly flagged). Stack already up; minted auth, confirmed 7 seeded policies (State Farm + Geico + 5 e2e
  leftovers), shot /insurance DESKTOP + MOBILE and **Read both PNGs**. CERTIFIED CLEAN: the page renders the
  data state + four-states correctly — header + New-Policy FAB, per-policy PolicyCard (Current Term:
  Expires/Total Cost/Monthly/Vehicles), Documents EMPTY ("No documents uploaded yet" + Upload), Claims EMPTY
  ("No claims filed") AND a populated "Collision · Settled" claim on the e2e claims policy, "Expired" term
  badges (correct — all seeded term dates predate 2026-06-18) + working Renew. MOBILE: NO horizontal overflow
  (NORTH_STAR #3) — label/value rows + Current-Term/Documents/Claims sections all reflow to the Pixel-5 width;
  FAB pins bottom. DEBUNKED a suspected defect firsthand (the GUIDE's "agent HIGH findings are often false"
  discipline): the "Active Policies" section header vs the "Expired" badges looked contradictory, but they're
  TWO LEGITIMATE AXES — groupPoliciesByActive splits on `policy.isActive` (policy lifecycle: Active vs Inactive
  sections), while "Expired" is the per-TERM currency (the current term's date lapsed → the Renew affordance).
  An active policy with an expired current term is the correct, intended state. NOT a bug; no fix. /insurance is
  architecturally sound — DON'T re-audit it. (The mid-page dark New-Policy button in the desktop full-page shot
  is the known fixed-FAB capture artifact, not a render defect — same as prior eyes-on cycles.) No code changed;
  doc-only. cov: be 87.46% / fe 86.35% (~ — no test/code touched). NEXT feature cycle: still Angelo-gated
  (import-trackers + #148) → record parked + pivot, OR eyes-on another never-shot surface (the /financing
  populated render, or the recurring-expenses dashboard widget in a populated state).
- **C74 (deep-review)** — **Certified the CSV-import idempotency key `deriveImportClientId` FIELD-SENSITIVE +
  left a direct field-by-field guard (a load-bearing data-safety invariant, never directly tested).** Balance
  at C74: deep-review (7/5, +2) most-starved over budget (feature tied on overage +2 but less starved + its
  only spec work is Angelo-gated) → picked. SCOUTED two C67-suggested veins firsthand and found BOTH already
  well-guarded — DON'T re-audit: (a) the FE sync-manager conflict path — `determineConflictType` is directly
  pinned (sync-manager.test.ts:562-642: amount/tags/date match → duplicate, any diff → modified, epsilon
  boundary), (b) the CSV-import round-trip — import-csv.test.ts covers lossless round-trip, re-import idempotency
  (C211), two-identical-rows-both-import, BOM, date-only/out-of-range, #102 ambiguous-vehicle, #137 fuel-field
  clear, formula-injection. Found the genuine GAP inside (b): `deriveImportClientId` (the crown-jewel
  idempotency key — re-import = no-op, but two different rows must get distinct keys so both land) was
  module-PRIVATE with NO direct test; its field-sensitivity was only exercised transitively through round-trips
  that NEVER compare two rows differing in exactly one field. A future edit dropping a field from the `content`
  hash array (e.g. tags / missedFillup) → two rows differing only in that field hash-COLLIDE → the second
  silently dropped by createIdempotent's (userId, clientId) unique index → NORTH_STAR #1 data loss, INVISIBLE to
  every existing test. CERTIFIED firsthand all 11 content fields flip the key + determinism holds. DOCUMENTED
  NUANCE (characterized, not fixed — it's mitigated): the content joins tags with '' so `['a','b']`/`['ab']`
  share a tags-segment, BUT buildImportPlan's occurrence counter gives within-file collisions distinct
  occurrences → distinct final keys, so the "both import" contract holds within a single import (the only place
  two such rows coexist). GUARD: exported deriveImportClientId + new import-client-id-field-sensitivity.test.ts
  (+14): each distinguishing field flips the key; same content+occurrence → same key; different occurrence →
  distinct; null-vs-value differs; csv: prefix. Drives the REAL fn (not a re-impl — the C181/C229 theater
  lesson). NON-VACUOUS proved firsthand: dropping missedFillup from the content array → exactly that field's
  test RED with the "silently dropped → losing the user's data" diagnostic; restored → green. Verify: backend
  validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1690 pass / 0 fail (+14),
  build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard/cert add; import-csv was
  round-trip-covered, this pins the key's field-sensitivity a round-trip can't). Next deep-review: an eyes-on
  /insurance or /financing render sweep, or the backup EXPORT serialization round-trip.
- **C73 (guard)** — **Pinned the #94 skipConversion DISPATCH ORIENTATION across the C65/C69/C72 twins (the
  inversion footgun the C59 placeholder-scan doesn't cover).** Balance at C73: THREE over budget — feature
  (5/4, +1), deep-review (6/5, +1), guard (7/6, +1); guard most-starved (7) → picked. The C65/C69/C72 #94 work
  added a NEW dispatch pattern — 3 `skipConversion ? <pure> : this.buildConverted<X>(...)` ternaries
  (monthlyConsumption/seasonal/dayOfWeek) + 1 `if (skipConversion) <pure> else <converted>` (cross-vehicle
  comparison). VERIFIED the gap firsthand: the C59 source-scan pins the converted call never gets a unit
  PLACEHOLDER, but NOTHING pins the branch ORIENTATION — flip a ternary to `? converted : pure` (or an
  `if (!skipConversion)`) and a MIXED-unit fleet takes the raw-pooling PURE builder → #94 regression, INVISIBLE
  to same-unit fixtures (the only kind the builder tests use), so no behavioral test catches it. GUARD: new
  `skip-conversion-dispatch-orientation.test.ts` (+3): source-scans every skipConversion builder-dispatch
  (ternary + if/else forms), asserts the converted twin is on the FALSY/ELSE (conversion-needed) branch only.
  Filters OUT the per-point `skipConversion ? point.efficiency : convertEfficiency(...)` value-ternary inside
  the C64 generator (not a builder dispatch — neither branch names buildConverted). NON-VACUOUS proved firsthand
  BOTH forms: flipping the monthlyConsumption ternary → ternary test RED ("converted twin must be on the FALSY
  branch"); flipping the cross-vehicle if/else → if/else test RED ("...in the ELSE block") — each with its own
  diagnostic, the other staying green; restored → green. The arch/feature-creates-pattern→next-guard-pins lesson
  (C25/C45/C59 source-scan family; here C65/C69/C72→C73). Verify: backend validate:local GREEN — tsc 0,
  musl-biome clean (20 pre-existing warnings, none new), 1676 pass / 0 fail (+3), build bundled. Backend-only (no
  UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard-only source-scan; pins an orientation a same-unit test
  can't). Next guard: thin — the convert-dispatch is now double-fenced (C59 placeholder + C73 orientation).
- **C72 (bug #94, dayOfWeekPatterns member)** — **Convert per-vehicle volume to user-global units BEFORE
  pooling the dayOfWeekPatterns avgVolume (Angelo-APPROVED Sev-2, NORTH_STAR #2).** Balance at C72: four AT
  budget (feature 4/4, deep-review 5/5, guard 6/6, bug 3/3); bug has the lowest budget (tips first) + the most
  concrete actionable work (#94) → picked. Took the 5th unit-bearing #94 member (2nd of the 3 advanced builders).
  buildDayOfWeekPatterns sums each fillup's `volume` per weekday across ALL vehicles raw → a mixed gal+L fleet
  skews avgVolume. The C69 query-layer thread already put units in buildFuelAdvancedFromData's scope, so this was
  a straightforward twin (as C69 predicted). FIX (the C62/C65 volume pattern): added a
  buildConvertedDayOfWeekPatterns twin — isFillup-gated count + totalCost ($) UNCHANGED (unit-free); only the
  per-row volume converts via the C71 vehicleUnitsFor helper + convertVolume — switched at the call site by
  skipConversion. Exported DAY_NAMES from analytics-charts.ts for the twin (mirrors the C65 normalizeDate / C69
  SEASON_MAP exports). Updated the stale C69 comment (dayOfWeek no longer "remains raw"). GUARD: +1 mixed gal+L
  test driving getFuelAdvanced (Monday avgVolume 6.06 not the raw-pool 9.0; fillupCount 4 + avgCost $50
  unchanged). NON-VACUOUS proved firsthand: forcing the pure builder on the mixed fleet → 6.06→9.0 RED; restored
  → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none new),
  1673 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ —
  analytics repo already well-covered; +1 mixed-unit guard). #94 PROGRESS: distance (C58) + volume-headline
  (C62) + monthlyConsumption (C65) + seasonalEfficiency (C69) + dayOfWeekPatterns (C72) DONE; REMAINING = 1
  advanced builder (buildVehicleRadar fuelEfficiency-normalize — the LAST, normalizes per-vehicle MPG across the
  fleet via normalizeScore, so it needs the gas points converted before the min/max normalize, a slightly
  different shape) + the prev-year SQL-sum sub-member (previousYearGallons).
- **C71 (arch)** — **Extracted the per-vehicle units fallback-lookup into ONE private helper across the 5
  analytics convert sites (behavior-preserving; the load-bearing default can't be silently dropped).** arch was
  the SOLE over-budget category (71−64=7/5, +2). Scouted the freshest churn surface first (the C65/C69 #94
  convert-twins) and REJECTED converging them — they're deliberately written to mirror their pure builders 1:1
  (the comments assert this; merging would destroy that auditability, arch rule 2) — and the 11-site
  `localeCompare` month-sort idiom has DIVERGING slices (−12/−24/−120) so it's not mergeable either. Found the
  genuine clean dedup: `vehicleUnitsMap.get(<id>) ?? { ...DEFAULT_UNIT_PREFERENCES }` was hand-repeated at 5
  per-vehicle convert sites (convertedGasEfficiencyPoints, computeConvertedTotalDistance ×2, the
  monthlyConsumption volume limb, the fuel-stats volumeInUserUnits closure, the cross-vehicle comparison).
  Extracted a private `vehicleUnitsFor(map, id)` → all 5 route through it. CONCRETE PAYOFF: the
  `?? {...DEFAULT_UNIT_PREFERENCES}` fallback is LOAD-BEARING — a missing-vehicle row without it throws on
  `.volumeUnit`/`.distanceUnit` at the convert call — so one source of truth means no site can silently drop it
  (and it stays a fresh clone per call, never a shared mutable default). Left the DIFFERENT-shape `getUserUnits`
  user-prefs fallback (`parsed ?? ...`, line 386) alone. Behavior-preserving (identical semantics); green→green
  (the #94 mixed-unit distance/volume/monthlyConsumption/seasonal guards + Property 11 conversion suite all pass
  unchanged). Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing warnings, none
  new), 1672 pass / 0 fail (no test delta — a pure refactor), build bundled. Backend-only (no UI → no shot).
  cov: be 87.46% / fe 86.35% (~ — pure refactor, same lines covered). STANDING PATTERN: a bug cycle that threads
  a near-identical lookup into N convert sites (C58/C62/C65/C69 #94) seeds the next arch cycle to converge the
  shared sub-expression (sibling to C64's generator extraction). Don't re-scout the convert sites — single-sourced.
- **C70 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C63).**
  TWO over budget at C70 — infra (70−63=7/6, +1) and arch (70−64=6/5, +1); infra wins the tie on raw starvation
  (7 > 6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test`/`.spec.ts`/`.svelte` specs (the gitignored
  `*.meshclaw.e2e.ts` agent specs are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are the
  intentional local overrides — left uncommitted by design). (2) COVERAGE RE-MEASURED (7 commits since C63):
  **BE 87.46% line / 87.18% func** (file-mean, 1672 pass — func +0.01 vs C63 from the C64 dedup + C65/C69 #94
  twins + C66/C67 guards); **FE 86.35% line / 87.68% func / 78.78% branch** (v8, 735 pass — UNCHANGED, C64–C69
  all backend). Both at the ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1672 / FE 735.
  (4) BRANCH STATE: claude-loop-dev = **70 commits ahead** of fresh origin/main, PR-ready (category spread
  bug 17 / feature 14 / guard 11 / deep-review 11 / infra 9 / arch 7 — the 70th is the C1 loop-doc reset). The
  C68 eyes-on harness add (shot.mjs CLICK_TEXT) is gitignored, not in the count. Doc-only — no source touched.
  cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C80.
- **C69 (bug #94, seasonalEfficiency member)** — **Convert per-vehicle gas-MPG to user-global units BEFORE
  pooling the seasonalEfficiency series (Angelo-APPROVED Sev-2, NORTH_STAR #2).** Balance at C69: bug (4/3, +1)
  the ONLY over-budget category → picked. Took the 4th unit-bearing #94 member (the 1st of the 3 fuel-ADVANCED
  builders): `buildSeasonalEfficiency` averages each gas pair's RAW efficiency per season across ALL vehicles
  with no per-vehicle conversion → a mixed mi/gal + km/L fleet mixes the two on the seasonal chart. Unlike the
  monthlyConsumption member (C65, callable from buildFuelStatsFromData where units were in scope), the advanced
  builders live in buildFuelAdvancedFromData which fetched NO units — so this needed the QUERY-LAYER thread the
  C65 note flagged: getFuelAdvanced now fetches getUserUnits + getAllVehicleUnits + computes skipConversion, and
  buildFuelAdvancedFromData gained a (userUnits, vehicleUnitsMap, skipConversion) signature (its OTHER caller
  getSummary already had them in scope). FIX (the C58/C62/C65 + getCrossVehicle pattern): added a repository
  buildConvertedSeasonalEfficiency twin (fillupCount via isFillup — UNITLESS, unchanged; efficiency via the C64
  convertedGasEfficiencyPoints generator), switched at the call site by skipConversion. Exported SEASON_MAP from
  analytics-charts.ts for the twin's season bucketing (mirrors the C65 normalizeDate export). The pure builder
  stays for the common single-unit fleet (zero change). GUARD: +1 mixed mi/gal+km/L test in
  fuel-stats-fleet-distance-pooling.test.ts driving getFuelAdvanced (Winter avg 62.04 not the raw-pool 35;
  fillupCount 4 unchanged). NON-VACUOUS proved firsthand: forcing the pure builder on the mixed fleet → 62.04→35
  RED; restored → green. Verify: backend validate:local GREEN — tsc 0, musl-biome clean (20 pre-existing
  warnings, none new), 1672 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be 87.46% /
  fe 86.35% (~ — analytics repo already well-covered; +1 mixed-unit guard). #94 PROGRESS: distance (C58) +
  volume-headline (C62) + monthlyConsumption (C65) + seasonalEfficiency (C69) DONE; REMAINING = 2 advanced
  builders (buildVehicleRadar fuelEfficiency-normalize + buildDayOfWeekPatterns volume — both now have units
  threaded into buildFuelAdvancedFromData, so each is a straightforward twin next bug cycle) + the prev-year
  SQL-sum sub-member (previousYearGallons).
- **C68 (feature — eyes-on FinanceTab lease render; #140 CONFIRMED + a NEW defect #148 escalated)** —
  Balance at C68: feature (7/4, +3) the lone most-starved over-budget category → picked. Import-trackers (the
  only open feature SPEC work) stays Angelo-gated (preset defaultCategory), so per the standing rule I took the
  shootable feature increment instead: a deep-UI eyes-on of the FinanceTab LEASE render — a surface CLAUDE.md
  flagged "stays eyes-on" + the home of the #140 "do it in a UI-work cycle / alongside a screenshot pass" item.
  Booted nothing (stack already up on :5173/:3001), minted auth, added a 30k odometer reading to the seeded e2e
  lease (Tesla Model 3, 36-mo/12k-yr), shot the Finance tab (extended the gitignored shot.mjs with a CLICK_TEXT
  arg since the tab state is client-side, not URL-driven), and **Read the PNG**. CONFIRMED #140 FIXED + consistent
  firsthand: the Mileage Overage card ("$0 · Within limit") and the burn-bar limit both use the WHOLE-LEASE 36,000
  allowance (leaseTotalMileageAllowance), no annual-vs-total contradiction. BUT eyes-on surfaced a NEW defect:
  **#148 — the LeaseMetricsCard burn bar reads "0 / 36,000 · 36,000 left" at a 30k odometer.**
  `calculateLeaseMetrics` gates `mileageUsed` on `initialMileage !== null`; a lease with no recorded starting
  odometer (the common case) leaves used=0, while the sibling PaymentMetricsGrid coalesces `initialMileage ?? 0`
  and computes used=30k → the SAME vehicle shows 30k driven on one card and 0 on the other (the #140 class on the
  null-initialMileage axis). It changes a displayed lease-mileage figure (semantics: coalesce to 0 / require an
  initial / show "set a starting odometer") → ESCALATED to Angelo, NOT auto-fixed (GUIDE product-call rule;
  send_message tool unavailable this turn → filed in BACKLOG as the durable record). Cleaned up the test odometer
  entry (DELETE /odometer/:id 200; fixture restored to its single 24k entry). Doc-only — no committable source
  (the shot.mjs CLICK_TEXT add is gitignored harness; no auto-fix). cov: be 87.46% / fe 86.35% (~ — no test/code
  change). NEXT feature cycle: still Angelo-gated (import-trackers defaultCategory + now #148) → record parked +
  pivot, OR eyes-on another never-shot surface (insurance/financing populated states).
- **C67 (deep-review)** — **Certified the sync-worker retry-ceiling coupling CLEAN + left a merge-surviving
  source-scan guard (a real unguarded cross-module invariant, NORTH_STAR #1 backoff honesty).** Balance at C67:
  deep-review (7/5, +2) most-starved over budget (feature tied on overage +2 but deep-review more starved by raw
  count) → picked. Per the C60 next-vein note (the sync-worker retry/backoff path), audited
  `backend/src/api/providers/sync-worker.ts` firsthand. The #144 terminal-auth fix (C461) parks a revoked-token
  ref at `MAX_RETRY_COUNT` so `photoRefRepository.findPendingOrFailed` (`retryCount < 3`) stops re-picking it —
  but those two `3`s are HAND-WRITTEN LITERALS in two different modules, coupled only by a code comment.
  CERTIFIED the runtime behavior is correct today (park at 3 → `3 < 3` false → dropped from the work set), and
  found the real GAP: nothing pins the coupling. If the query bound drifts (e.g. `< 5`) while MAX_RETRY_COUNT
  stays 3, a parked terminal-auth ref satisfies `3 < 5` → RE-PICKED every batch → a revoked token retried
  FOREVER (the #144 fix silently breaks), and the existing #144 test (which asserts the magic literal
  `retryCount: 3`) stays GREEN — blind to the drift. GUARD: exported `MAX_RETRY_COUNT` + new
  `sync-worker-retry-ceiling-sync.test.ts` (+3): imports the real constant, source-scans the repository's
  `${photoRefs.retryCount} < N` ceiling, asserts `N === MAX_RETRY_COUNT`. Also re-pointed the #144 test's magic
  `retryCount: 3` at the real constant. NON-VACUOUS proved firsthand: drifting the query bound to `< 5` → RED
  with the "DRIFTED... re-picked forever (#144 breaks)" diagnostic; restored → green. The one-edit→source-scan
  pattern (C25/C45/C59) applied to a CROSS-MODULE retry-ceiling invariant. Verify: backend validate:local GREEN
  — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1671 pass / 0 fail (+4), build bundled.
  Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard/cert add; sync-worker already
  behaviorally covered, this pins the cross-module coupling a single-module test can't). Next deep-review: an
  eyes-on /insurance or /financing render sweep, or the offline sync-manager conflict path (FE).
- **C66 (guard)** — **Pinned the C64 `convertedGasEfficiencyPoints` generator's gas/charge gate on the
  CONVERTED path (arch-extract→guard-pin; the #126/C427 footgun, currently invisible to every test).**
  Balance at C66: THREE over budget — feature (5/4, +1), deep-review (6/5, +1), guard (7/6, +1); guard is the
  most-starved (7) → picked. Per the C17→C18 / C50 standing pattern (a freshly-extracted shared helper gets a
  direct guard next cycle), the C64 generator now feeds 4 builders but had NO net for its gas-gate on the
  CONVERTED path. VERIFIED the gap firsthand: getFuelEfficiencyTrend's #126 test uses its OWN forEachVehiclePair
  loop (NOT the generator); Property 11 drives the converted consumers (getQuickStats/getCrossVehicle) but seeds
  GAS-ONLY rows — so a gate regression (revert gasEfficiencyPoint→computeEfficiencyPoint inside the generator,
  the exact #126/C427 footgun) would stay GREEN everywhere. GUARD (+1 in cross-vehicle.property.test.ts, next to
  the #126 sibling): a MIXED-unit (km/L vehicle, mi/gal user → skipConversion=false → the generator's CONVERT
  branch runs) PHEV fleet with gas fillups + charge sessions; asserts getQuickStats.avgEfficiency = the converted
  GAS pair alone (30 km/L → 70.57 mi/gal), charge mi/kWh excluded. NON-VACUOUS proved firsthand: reverting the
  generator's gate (with computeEfficiencyPoint imported) drops avgEfficiency 70.57 → 39.99 (the ~4 mi/kWh charge
  point mis-converted as mi/gal + averaged in) → RED on the exact value; restored → green. This is the WORSE half
  of #126 (convertEfficiency mis-converts mi/kWh as mi/gal), now pinned on the one path it can occur. Verify:
  backend validate:local — tsc 0, musl-biome clean (20 pre-existing warnings, none new), 1667 pass / 0 fail (+1),
  build bundled. Backend-only (no UI → no shot). cov: be 87.46% / fe 86.35% (~ — guard-only test add; generator
  already line-covered, this pins the BEHAVIOR). STANDING PATTERN reaffirmed: arch extracts a shared helper
  (C64) → next guard cycle pins it DIRECTLY against its load-bearing invariant (C66).
- **C65 (bug #94, monthlyConsumption member)** — **Convert per-vehicle volume + gas-MPG to user-global units
  BEFORE pooling the monthlyConsumption chart series (Angelo-APPROVED Sev-2, NORTH_STAR #2).** Balance at C65:
  feature/deep-review/guard/bug all AT budget (4/4, 5/5, 6/6, 3/3); bug has the lowest budget (tips first) AND
  the most concrete actionable work (the #94 class), so it's the highest-leverage pick. Took the 4th of the 6
  #94 members: `buildMonthlyConsumption` (analytics-charts.ts) pools each fuel row's RAW `volume` into a month
  bucket AND averages each gas pair's RAW efficiency, both across ALL vehicles with no per-vehicle conversion —
  so a mixed gal+L / mi+km fleet sums litres into the gallons volume series + averages mi/gal with km/L on the
  FuelStats monthly chart. Chose it as the cleanest member: it's called from EXACTLY ONE site
  (`buildFuelStatsFromData`, which already has userUnits/vehicleUnitsMap/skipConversion in scope — no query-layer
  signature thread needed) and its efficiency limb REUSES the C64 `convertedGasEfficiencyPoints` generator (gas-gate
  + band filter stay identical/centralized). FIX (the established C58/C62 + getCrossVehicle pattern): added a
  repository `buildConvertedMonthlyConsumption` twin (per-row `convertVolume` + the C64 generator), switched at the
  call site by `skipConversion` — the common single-unit fleet still takes the pure builder (zero change), only a
  mixed fleet hits the twin. Mirrors buildMonthlyConsumption's structure EXACTLY (month-keyed volume map, the
  `if (entry)` volume-seeded-months-only efficiency guard, ascending sort, most-recent-12 slice) + uses the SAME
  `normalizeDate` (exported from analytics-charts.ts) so the seconds-vs-ms date contract is preserved. GUARD: +1
  mixed gal+L behavioral test in fuel-stats-fleet-distance-pooling.test.ts (series volume 42.64 not 50); the C59
  source-scan still passes (twin call uses real units, no placeholder). Verify: backend validate:local GREEN — tsc
  0, musl-biome clean (20 pre-existing warnings, none new), 1667 pass / 0 fail (+1), build bundled. Backend-only (no
  UI → no shot). cov: be 87.46% / fe 86.35% (~ — analytics repo already well-covered; +1 mixed-unit guard). #94
  PROGRESS: distance (C58) + volume-headline (C62) + monthlyConsumption (C65) DONE; REMAINING = 3 advanced builders
  (buildSeasonalEfficiency / buildVehicleRadar / buildDayOfWeekPatterns — these live in buildFuelAdvancedFromData
  which fetches NO units, so they need a query-layer units thread, not just a twin) + the prev-year SQL-sum
  sub-member (previousYearGallons). Pick one per bug cycle, same convert-before-pool pattern.
- **C64 (arch)** — **Extracted the converted gas-MPG inner loop into ONE generator across the 3 per-vehicle
  efficiency builders (behavior-preserving, the #126/C427 gas-gate footgun centralized).** arch was the SOLE
  over-budget category (64−57=7/5, +2; all others within budget). Per the C57 watch-note (fresh duplication
  after C58/C61/C62 touched the analytics repository), scouted the convert-before-pool surface and found a
  real, clean dedup: `computeConvertedEfficiencyValues`, `buildConvertedEfficiencyTrend`, and
  `buildConvertedFuelEfficiencyComparison` each hand-rolled the SAME inner loop — `groupByVehicle` → fallback
  `vehicleUnitsMap.get(id) ?? {...DEFAULT_UNIT_PREFERENCES}` → `gasEfficiencyPoint` gate → `convertEfficiency`
  ternary — differing only in how they accumulate. That `gasEfficiencyPoint` gate IS the #119/#122 (C413) /
  #126 (C427) footgun: forget it on a new converted builder and a PHEV's charge mi/kWh contaminates the
  gas-MPG average (and convertEfficiency mis-converts it as mi/gal). EXTRACTED a private generator
  `*convertedGasEfficiencyPoints(fuelRows, vehicleUnitsMap, targetUnits, skipConversion)` yielding
  `{ vehicleId, efficiency, date }`; the three builders now consume the tuples (values push; trend month-buckets;
  comparison month×vehicle-buckets, called with skipConversion:false since it's the mixed-unit-only branch).
  Net −~40 LOC + the gas/charge gate now lives in ONE place — a future converted-efficiency builder physically
  CAN'T reintroduce the contamination (NORTH_STAR #6). Behavior-preserving + test-anchored: driven by
  analytics-units.property Property 11 (comparison), cross-vehicle.property #126 (trend gas-gate), and
  summary/year-end property (values + trend) — all GREEN unchanged. Verify: backend validate:local GREEN — tsc
  0, musl-biome clean (20 pre-existing warnings, none new), 1666 pass / 0 fail, build bundled. Backend-only (no
  UI → no shot). cov: be 87.46% / fe 86.35% (~ — pure refactor, same lines covered via the same builders).
  STANDING PATTERN reaffirmed: a bug/feature cycle that threads a near-identical helper into N builders
  (C58/C62 #94 convert-before-pool) seeds the NEXT arch cycle to converge them (C22→C23, C37→C43, C51→C57,
  now C58/C62→C64). Don't re-scout this surface — the 3 converted-efficiency builders are now single-sourced.
- **C63 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C56).**
  TWO over budget at C63 — infra (63−56=7/6, +1) and arch (63−57=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored
  `*.meshclaw.e2e.ts` agent specs are by-design — note C61 added import-t6-manual-fuel-roundtrip.meshclaw
  .e2e.ts, correctly gitignored; the persistent `M .gitignore`/`M frontend/.gitignore` are the intentional
  local overrides). (2) COVERAGE RE-MEASURED (7 commits since C56): **BE 87.46% line / 87.17% func**
  (file-mean, 1666 pass); **FE 86.35% line / 87.68% func / 78.78% branch** (v8, 735 pass) — both FLAT vs
  C56 (C57 dedup + C58/C62 #94 distance/volume + C59/C60 guards + C61 eyes-on were small targeted changes/
  test additions); FE UNCHANGED (C57–C62 all backend). Both at the ~87 BE / ~86 FE structural ceiling.
  (3) BOTH-SIDES GREEN: BE 1666 / FE 735. (4) BRANCH STATE: claude-loop-dev = **63 commits ahead** of fresh
  origin/main (C1–C62: 2 features COMPLETE + import-trackers manual-path fully eyes-on through T6 [detect-
  commit + the preset defaultCategory parked for Angelo]; category spread bug 15 / feature 13 / guard 10 /
  deep-review 10 / infra 8 / arch 6), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored.
  Doc-only — no source touched. cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C73.
- **C62 (bug #94, volume member)** — **Convert per-vehicle volume to user-global units BEFORE pooling the
  fleet fuel-stats volume + fillupDetails (Angelo-APPROVED Sev-2, NORTH_STAR #2).** bug was the SOLE
  over-budget category (62−58=4/3 +1; arch/infra AT). Cold-scout exhausted → top Angelo-approved item:
  the next #94 member after C58's distance (same approved convert-before-pool pattern, now guarded by
  C59). CONFIRMED FIRSTHAND: `buildFuelStatsFromData`'s `sumGallons` summed `row.volume` across ALL
  vehicles RAW (→ currentYear/currentMonth/prevMonth gallons) + the `volumes` array fed fillupDetails
  (avg/min/max) raw — so a mixed gal+L fleet pooled gallons with litres. FIX (mirror C58): added a local
  `volumeInUserUnits(row)` (skipConversion short-circuit, else `convertVolume(v, vehicleUnit, userUnit)`)
  + routed both sumGallons + the volumes array through it; the C58 fix already brought userUnits/
  vehicleUnitsMap/skipConversion into scope. No-op for a same-unit fleet (the common case → the C328
  same-unit pin stays green). EXPLICITLY SCOPED OUT: `previousYearGallons` is a raw SQL `SUM(volume)` from
  queryFuelAggregates (cross-vehicle, computed before this fn) — converting it needs a per-vehicle
  group-sum at the query layer, recorded as a separate prev-year sub-member. GUARD: +1 in
  fuel-stats-fleet-distance-pooling.test.ts — a mixed gal+L fleet reports 40 gal + 10 L→2.642 gal = 42.64,
  NOT raw 50, + fillupDetails min 5L→1.32 gal; updated the C328 same-unit pin's stale "update when the fix
  lands" note (still asserts 50 — no-op for same-unit). NON-VACUOUS (verified firsthand): neuter the
  conversion → ONLY the mixed-volume test RED (same-unit + distance green); reverted → 5/5 green,
  repository diff = only my change. Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1666 pass / 0 fail (+1), build bundled. Backend-only (FE charts already convert
  per-vehicle; summary scalar is the HTTP path → no shot). cov: be ~87.5% / fe 86.35%. #94 distance (C58)
  + volume (C62) members DONE; REMAINING: the 4 fuel-advanced builders (buildMonthlyConsumption /
  buildSeasonalEfficiency / buildVehicleRadar / buildDayOfWeekPatterns) + the prev-year SQL-sum sub-member.
- **C61 (feature)** — **Import-trackers T6: consolidated manual-fuel round-trip on a same-unit vehicle
  (eyes-on DONE).** feature was the SOLE over-budget category (61−54=7/4, +3). Import-trackers is the only
  open feature; its remaining T4 is the parked-Angelo preset `defaultCategory` (stays parked), so the
  unblocked work is T6 (verify-phase, eyes-on now works). VERIFIED FIRSTHAND that the per-slice eyes-on
  already covered C31 detect-preview / C37 manual-map (a maintenance row commits; the fuel row errors on
  missing fields) / C41 manual-units (km→mi conversion) / C47 category-remap — but the COMMON real case was
  NEVER committed end-to-end: a complete, SAME-UNIT (mi/US-gallons) manual FUEL log. Did that. EYES-ON via
  `import-t6-manual-fuel-roundtrip.meshclaw.e2e.ts` + shot (Read): a bespoke fuel CSV with all fields mapped
  (date/amount/category/odometer/volume/fuelType/description) on a Miles vehicle, units left at the
  vehicle's defaults (Miles/Gallons-US → NO conversion) → "1 ready" → commit → the API confirms a `fuel`
  expense with EXACT mileage 42000 + volume 11.5 (no conversion drift). CAUGHT-MY-OWN harness bug: first run
  didn't map Memo→description so the unique tag never persisted + the row wasn't findable (the C41 lesson) →
  mapped description too → green. T6 MANUAL half is now fully eyes-on (C37/C41/C47/C61). T6 REMAINING is
  BLOCKED, not deferrable: the AUTO-DETECT PRESET round-trip THROUGH COMMIT can't be exercised — a detected
  preset maps NO category column → 0-ready "Unknown category" → nothing to commit (the C47 remap doesn't
  apply: no column = no word to remap). That's the parked `defaultCategory:'fuel'` Angelo decision (#C31);
  the four-state populated-detect screenshot is likewise gated on it. Verify: frontend validate:local GREEN
  — type-check 0, build OK, 735 tests. The e2e spec is gitignored-by-design (agent harness, not CI; the C54
  no-utc source-scan is the merge-surviving net) — this cycle's deliverable is the eyes-on confirmation +
  the spec tick. cov: be ~87.5% / fe 86.35% (~ — eyes-on capture, no module touched). Feature now has NO
  unblocked increment left (manual half fully verified; the detect-commit + 4-state shot both wait on
  Angelo's defaultCategory) — the next feature over-budget cycle should record that + pivot to the
  co-starved category.
- **C60 (deep-review)** — **Certified the `createProviderInstance` fake-provider production-safety gate
  CLEAN + pinned (a previously-unguarded layer).** deep-review was most-starved over budget (60−53=7/5 +2;
  feature +2 lost on raw starvation). Per the C53 pointer ("auth/provider path"), verified FIRSTHAND that
  the provider CREDENTIAL surface is ALREADY broadly guarded — formatProviderResponse omits credentials
  across GET/POST/PUT (providers-routes-http.test.ts:206 + the C260 PUT re-encrypt no-echo), config
  fail-fast (C416), tenant-scoping (#63), createProviderInstance's google-drive/photos/s3/unknown-type/
  missing-refreshToken branches (C254) — so did NOT re-audit them. Found the genuine gap: the `fake`
  storage-provider DOUBLE-GATE in createProviderInstance (registry.ts:217-221) was UNPINNED. It instantiates
  a FakeStorageProvider (in-memory, no bytes leave the process) ONLY when CONFIG.allowFakeStorageProvider is
  true (ALLOW_FAKE_STORAGE set AND NODE_ENV !== production), else throws — a `fake` row reaching production
  would silently swallow every backup/photo upload (NORTH_STAR #1 data-loss). The ROUTE-create gate is
  pinned, but this REGISTRY-instantiation gate (the layer restore/sync resolve a live provider through, NOT
  the route) had no test. CERTIFIED FIRSTHAND CLEAN: the test env is allowFakeStorageProvider=false (the
  prod-safety default), so a fake row → throws 'Fake storage provider is not enabled'; AND the gate
  short-circuits BEFORE decrypt (a fake row with garbage creds still throws the GATE error, not a parse
  error — proving the 217→224 ordering). GUARD: +2 in registry.test.ts — no CONFIG mock needed (the test
  env already has the gate off). NON-VACUOUS (verified firsthand): remove the gate → both RED; reverted →
  22/22 green, registry.ts byte-identical. Deep-review test-only — no app source touched. Verify: backend
  validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1665 pass / 0 fail (+2),
  build bundled. Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — pins the fake-gate; no
  module logic touched). The provider credential + instantiation path is now broadly certified; next
  deep-review: the sync-worker retry/backoff path, or an eyes-on /insurance render sweep.
- **C59 (guard)** — **Tree-wide source-scan pinning the C58 #94 convert-before-pool invariant.** THREE over
  budget at C59 — guard (59−52=7/6 +1), deep-review (6/5 +1), feature (5/4 +1); guard wins on raw starvation
  (7 > 6 > 5). The C58 #94 distance fix's footgun was `getFuelStats` feeding NO-OP PLACEHOLDERS (`new Map()`
  / `DEFAULT_UNIT_PREFERENCES` / hardcoded `skipConversion=true`) to `computeConvertedTotalDistance`,
  defeating the per-vehicle conversion — and the C58 behavioral test only covers getFuelStats' distance
  scalar, while 4 summary readers (getQuickStats/getYearEnd/getSummary/getFuelStats) call the convert
  helpers and the bug is INVISIBLE to a same-unit fixture. GUARD: new `no-unconverted-fleet-pooling.test.ts`
  (+3) source-scans repository.ts for any `computeConverted*`/`buildConverted*` call whose arg list contains
  the placeholder (new Map() / DEFAULT_UNIT_PREFERENCES / a `, true` literal skipConversion) → so a future
  reader (or the remaining #94 members) reintroducing the footgun regresses RED even if its same-unit tests
  pass. The one-edit-fix→source-scan pattern again (C24→C25 #36, C44→C45 #37, C54 import-date → now C58→C59
  #94). CAUGHT-MY-OWN regex bug: the first non-greedy `\(([^;]*?)\)` stopped at the nested `new Map()`'s
  first `)`, capturing `fuelRows, new Map(` and MISSING the placeholder (probe stayed green) → switched to a
  greedy `\(([^;]*)\)\s*;` (full arg list up to the statement `;`); re-probed. NON-VACUOUS BOTH WAYS
  (verified firsthand): the placeholder triple → RED; a lone hardcoded `, true)` skipConversion → RED; the 7
  legit `vehicleUnitsMap, userUnits, skipConversion` calls don't match (baseline green); reverted →
  3/3 green, repository byte-identical. Guard-only — app source untouched. Verify: backend validate:local
  GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1663 pass / 0 fail (+3), build bundled.
  Backend-only (source-scan → no shot). cov: be ~87.5% / fe 86.35% (~ — pure source scan, no module logic).
- **C58 (bug #94, distance member)** — **Convert per-vehicle distance to user-global units BEFORE pooling
  the fleet fuel-stats totalDistance (Angelo-APPROVED Sev-2, NORTH_STAR #2).** NOTHING strictly over budget
  at C58 (feature/deep-review/guard/bug all tied AT) → took the highest-leverage open item: #94, the
  biggest open correctness defect (a mixed mi+km / gal+L fleet shows garbage pooled scalars on the DEFAULT
  analytics view). #94 is a 6-member CLASS — too big for one verified increment — so did the contained,
  highest-impact, LOWEST-RISK member: the `distance.totalDistance` scalar (the fleet fuel-stats + summary
  headline). KEY FIRSTHAND FINDING: the conversion machinery ALREADY EXISTS and is tested
  (`computeConvertedTotalDistance` + `allVehiclesMatchUnits`, the getCrossVehicle model), but `getFuelStats`
  fed it NO-OP PLACEHOLDERS (`new Map()`, DEFAULT_UNIT_PREFERENCES, skipConversion=true) pending the #94
  decision — so the fix is purely ACTIVATING tested infra, not new math. FIX (Angelo's "convert-to-user-
  global BEFORE pooling, mirroring getCrossVehicle"): `getFuelStats` now fetches userUnits +
  getAllVehicleUnits + computes skipConversion=allVehiclesMatchUnits, threads them into buildFuelStatsFromData
  → computeConvertedTotalDistance (replacing the placeholders); getSummary's call site already had all three
  in scope (its summary distance was equally un-converted — also fixed). No-op for a same-unit fleet (the
  common case → existing same-unit characterization tests stay green). GUARD: +1 in
  fuel-stats-fleet-distance-pooling.test.ts — a MIXED mi+km fleet now reports 800 mi + 200 km→124.27 mi =
  924.27, NOT the raw 1000; flipped the C301 same-unit test's stale "update when the fix lands" note (it
  still correctly asserts 1000 — conversion is a no-op there). NON-VACUOUS (verified firsthand): revert to
  the placeholders → ONLY the mixed-unit test RED (same-unit green, proving the fix bites only a mixed
  fleet); reverted → 4/4 green, repository diff = only my change. Verify: backend validate:local GREEN —
  tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1660 pass / 0 fail (+1), build bundled.
  Backend-only (the FE chart already converts per-vehicle; the summary scalar's the HTTP path → no shot).
  cov: be ~87.5% / fe 86.35% (~ — the +1 pins the mixed-unit distance conversion). #94 distance member
  DONE; REMAINING #94 members (own cycles): volume (gal+L pooling in getFuelStats sumGallons +
  fillupDetails) + the 4 fuel-advanced builders (buildMonthlyConsumption / buildSeasonalEfficiency /
  buildVehicleRadar / buildDayOfWeekPatterns).
- **C57 (arch)** — **Dedup the C51 overwrite strip-and-update into one `applyLocalOverwrite` helper (the
  C51-created drift vector — a genuine fresh pick).** arch was the SOLE over-budget category (57−50=7/5,
  +2). Not a no-churn ceremony — found a real dup exactly where the standing lesson predicts (a bug/feature
  cycle introduces a near-duplicate → the next arch cycle dedups it; C22→C23, C37→C43): my own C51 #98 fix
  added `const { clientId, userId, ...patch } = data; return this.update(<id>, patch)` at TWO byte-identical
  sites in `createIdempotent` — the pre-check-collision branch + the raced-winner branch. Extracted ONE
  private `applyLocalOverwrite(rowId, data)` (the strip + update), called from both. Net +14/−10 (the 2
  inline blocks collapse). BEHAVIOR-PRESERVING (rule 4): green→green, the C51 +6 overwrite tests drive the
  helper via both call sites (19 pass across idempotent-create + expenses-http); the extraction even
  IMPROVES the raced branch (hard to hit deterministically) by routing it through the same tested code.
  Arch rule 3 (test-anchored): the C51 chars are the net — no new test needed. WORTHWHILE EXPLORATION
  (recorded honestly): probed whether the identity-key strip is load-bearing by trying to force a foreign-
  userId mutation — found it's UNREACHABLE through the public API (createIdempotent looks up by
  (data.clientId, data.userId), so when the overwrite branch runs data.userId already == the row's owner; a
  foreign userId misses the lookup + takes the create path). So the strip is DEFENSIVE-only; removed the
  misleading forcing-test (it asserted an unreachable state) + documented the finding in a code comment
  rather than pinning theater. Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1659 pass / 0 fail (pure refactor), build bundled. Backend-only (no UI → no shot).
  cov: be ~87.5% / fe 86.35% (~ — behavior-preserving dedup, LOC net down, one source of truth for the
  overwrite). Arch was NOT at its floor — the C51 fix created the drift; keep watching after bug/feature cycles.
- **C56 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C49).**
  TWO over budget at C56 — infra (56−49=7/6, +1) and arch (56−50=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the gitignored
  `*.meshclaw.e2e.ts` agent specs are by-design; the persistent `M .gitignore`/`M frontend/.gitignore` are
  the intentional local overrides, NOT product changes). (2) COVERAGE RE-MEASURED (7 commits since C49):
  **BE 87.46% line / 87.18% func** (file-mean, 1659 pass); **FE 86.35% line / 87.68% func / 78.78% branch**
  (v8, 735 pass) — both essentially FLAT vs C49 (C50 dedup + C51 #98 + C52–C55 were test/small-guard
  additions; covered lines grew with the denominator); FE UNCHANGED (C50–C55 all backend). Both at the
  ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1659 / FE 735. (4) BRANCH STATE:
  claude-loop-dev = **56 commits ahead** of fresh origin/main (C1–C55: 2 features COMPLETE + import-trackers
  through T6's date-guard slice C54; category spread bug 13 / feature 12 / guard 9 / deep-review 9 / infra 7
  / arch 5), PR-ready; recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched.
  cov: be 87.46% / fe 86.35% (MEASURED). NEXT cadence ~C66.
- **C55 (bug #22)** — **Zip-bomb compression-ratio cap pre-inflation (Angelo-APPROVED Sev-4 hardening).**
  bug was the SOLE over-budget category (55−51=4/3 +1; arch/infra AT). Cold-scout exhausted → top
  unfinished Angelo-approved item; the Sev-1/2/3 are done or gated (#94 6-member class; #127/#100 arch-gated;
  #112 design-gated), so took the contained, clean Sev-4 #22 ("cheap, no new dep"). CONFIRMED FIRSTHAND:
  `parseZipBackup` (backup.ts) summed each entry's `header.size` (uncompressed) and rejected over
  maxUncompressedSize — but `header.size` is read from the ZIP central directory = ATTACKER-DECLARED. A bomb
  can declare a small size to pass the sum, then inflate to GB on `getData()`. FIX (Angelo's "compression-
  ratio cap pre-inflation"): added `CONFIG.backup.maxCompressionRatio = 1000` + a per-entry guard that
  rejects when `header.size / header.compressedSize > cap` BEFORE any getData() — `compressedSize` is the
  REAL in-file byte count, so an absurd declared-vs-actual ratio is a bomb signature the sum can't catch
  (DEFLATE's ~1032:1 ceiling makes 1000× generous for legit CSV ~3-20× / repetitive headers a few hundred×).
  compressedSize 0 (empty/stored entry) skipped. Probed AdmZip firsthand to confirm `header.compressedSize`
  exists. GUARD: +2 in restore-zip-bomb.test.ts (#22 block): an entry UNDER the total-size cap but over the
  ratio cap → rejected (only the ratio guard can catch it); a real exported backup's every-entry ratio is
  under the cap + parses through both guards (no false positive). NON-VACUOUS (verified firsthand): neuter
  the ratio guard → the isolated-ratio test RED; reverted → 4/4 green, backup.ts diff = only my +17.
  CAUGHT-A-SIDE-EFFECT: the pre-existing all-zeros total-size test (200MB zeros = 1029× ratio) now trips the
  EARLIER ratio guard → updated its assertion to accept either pre-inflation guard's message (both mean
  "bomb rejected before inflating"; the total-size guard stays the backstop for a declared-size lie with a
  plausible ratio). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing
  warnings; my 1 new noNonNullAssertion refactored away), 1659 pass / 0 fail (+2), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — the +2 pin the ratio guard; FE untouched).
  #22 DONE. Remaining Angelo Sev-4: #129 (OAuth email-sync, re-read archive first), #79 (stuck-offline-entry
  hygiene), #112 (chart palette, design-gated); plus #94 (6-member class, its own cycle).
- **C54 (feature)** — **Import-trackers T6: merge-surviving no-utc guard for the CSV-import date paths.**
  feature was the SOLE over-budget category (54−47=7/4, +3). Import-trackers is the only open feature; its
  remaining T4 piece is the Angelo-gated preset `defaultCategory` (PARKED — awaiting steer), so the
  unblocked work is T6 (verify-phase) — and the spec/GUIDE explicitly flag "extend the no-utc guard to cover
  import-mapping.ts." Took that. CONFIRMED FIRSTHAND: `normalizeForeignDate` (C19-certified clean) builds a
  date-only foreign value in LOCAL time via `buildLocalDate(year, month, day, …)` — NEVER `new Date('YYYY-
  MM-DD')` (parses as midnight UTC → rolls the calendar day BACK west of UTC, the #23/#59/#87 class). The
  behavioral net (import-mapping.test.ts: normalize→parse-back→local Y/M/D across iso/mdy/dmy/epoch in any CI
  zone) already exists, but only exercises today's paths; a future `buildLocalDate`→`new Date(string)` swap
  or a new write site could slip past. GUARD: new `no-utc-import-date.test.ts` (+3) source-scans
  import-mapping.ts / local-date.ts / import-csv.ts for a Date built from (a) a date-only quoted literal OR
  (b) a `${y}-${m}-${d}` template (a `}` before a date separator — the frontend no-utc-month-parse idiom),
  + pins that import-mapping still routes through buildLocalDate. The C24→C25 / C44→C45 one-edit-fix→
  source-scan pattern, now for the import date path. NON-VACUOUS BOTH WAYS (verified firsthand): injected the
  template antipattern → RED; injected a quoted-literal `new Date(datePart + '-01')` + `new Date('2024-03-
  15')` → RED; the 2 KNOWN-CORRECT sites (`new Date(ms)` epoch, `new Date(s)` for an explicit-offset ISO) do
  NOT false-flag (baseline green); reverted → 3/3 green, import-mapping.ts byte-identical. CAUGHT-MY-OWN: my
  first regex only matched quoted literals (digits after the quote), MISSING the template form — the likeliest
  refactor antipattern; split into literal + template matchers + re-probed both. Marked spec T6 `[~]`
  (date-guard slice done; the consolidated eyes-on multi-state round-trip E2E remains — each slice's eyes-on
  already landed C31/C37/C41/C47). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1657 pass / 0 fail (+3), build bundled. Backend-only (source-scan → no shot). cov:
  be ~87.5% / fe 86.35% (~ — pure source scan, no module logic touched). Feature now has NO unblocked
  increment left but T6's consolidated E2E + the parked `defaultCategory`; next feature cycle likely records
  that + pivots.
- **C53 (deep-review)** — **Certified `buildTCOMonthlyTrend` (the TCO monthly cost series) CLEAN + pinned
  the (category, sourceType) bucketing.** deep-review was most-starved over budget (53−46=7/5 +2; feature
  +2 lost on raw starvation, 6/4). Verified firsthand that the two C46-suggested money builders are ALREADY
  guarded — `buildAmortizationSchedule` (amortization-schedule.test.ts: decline/rise, payoff-clamp,
  multi-loan, no-mutate, negative-am) AND its caller `buildLoanBreakdown` incl. the #139 0%-APR-survives
  case (analytics-routes-http.test.ts drives the real GET over a raw-seeded 0% loan) — so did NOT re-scan
  them. Found the genuine gap: `buildTCOMonthlyTrend` (analytics-charts.ts:1020) — the per-month TCO SERIES
  the chart renders — had NO direct test (driven only transitively via getTCO; the C6/C18/C46 "helper output
  never pinned" gap). CERTIFIED FIRSTHAND CLEAN: buckets by (category, sourceType) — financial+financing→
  financing, financial+insurance_term→insurance, fuel→fuel, maintenance→maintenance (the TIME-dimension
  mirror of categorizeTCOExpenses, cert C33); an UNCATEGORIZED row (financial+reminder from C27 recurring /
  financial+null manual / regulatory / enhancement / misc) contributes to NO bucket (the deliberate
  "4 named categories only" trend contract — those route to otherCosts in the TOTAL but the trend doesn't
  surface them); same-month co-accumulate; ascending month-key sort; dateless row dropped. GUARD: +6 in
  tco-monthly-trend.test.ts. NON-VACUOUS (verified firsthand): dropping the financing sourceType guard
  (any financial row leaks into financing) → 3 of 6 RED; reverted → 6/6 green, analytics-charts.ts
  byte-identical. Deep-review test-only — no app source touched. Verify: backend validate:local GREEN —
  tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1654 pass / 0 fail (+6), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — pins the TCO trend series; no module
  logic touched). The TCO money path (total bucketing C33 + this trend series) is now broadly certified;
  next deep-review: a genuinely different surface (an eyes-on /insurance or /financing render sweep, or the
  auth/provider path).
- **C52 (guard)** — **Pin the C51 #98 overwrite path ∩ #76 fuel-field hygiene (a REAL invariant, not
  framework theater).** THREE over budget at C52 — guard (52−45=7/6 +1), deep-review (6/5 +1), feature
  (5/4 +1); guard wins on raw starvation (7 > 6 > 5). Scouted the freshest unguarded surface = the C51
  `forceOverwrite` flag. FIRST drafted two negative-invariant guards (flag never persisted / PUT strips it)
  but PROVED THEM VACUOUS firsthand: leaking forceOverwrite into the insert still passed (drizzle silently
  drops unknown insert keys; Zod strips unknown parse keys) — those are framework-guaranteed, so pinning
  them is coverage theater (the GUIDE's C181/C229 warning). DROPPED them. Pinned instead the genuinely
  load-bearing invariant: the C51 keep-local overwrite re-runs the create route's clearFuelFieldsIfNotFuel
  (body) BEFORE the idempotent UPDATE, so a resolved edit that switches a fuel row to a non-fuel category
  must NULL the existing row's stale volume/mileage/fuelType (the #76 class on the NEW overwrite branch — a
  lingering mileage poisons getCurrentOdometer cross-category). The C51 tests only changed the amount; this
  exercises the category-switch leg. GUARD: +1 HTTP-harness case (expenses-http.test.ts): seed a fuel
  expense w/ volume+mileage+fuelType → keep-local overwrite to maintenance → same row id, category flipped,
  all 3 fuel fields NULLED. NON-VACUOUS (verified firsthand): neuter the overwrite-update (return existing)
  → the case RED; reverted → green, repository byte-identical. Guard-only cycle — app source untouched
  (only the test file changed). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20
  pre-existing warnings), 1648 pass / 0 fail (+1), build bundled. Backend-only (no UI → no shot). cov: be
  ~87.5% / fe 86.35% (~ — pins the #98∩#76 overwrite-path invariant; no module logic touched). LESSON
  re-confirmed: a guard that a framework already guarantees is theater — drive the REAL app logic.
- **C51 (bug #98)** — **Real PUT-on-collision overwrite so sync-manager keep-local applies the offline edit
  (Angelo-APPROVED Sev-3 data-loss).** NOTHING strictly over budget at C51 (feature/deep-review/guard/bug
  all tied AT) → took the highest-leverage open item. #94 (Sev-2) is a genuine 6-builder multi-file analytics
  sweep (better as its own scoped effort, possibly a design pass) → took the contained, single-seam Sev-3
  #98, a NORTH_STAR #1 data-loss path. CONFIRMED FIRSTHAND: sync-manager `resolveConflict('keep_local')`
  re-POSTs with `forceOverwrite: true` + the local clientId, but (a) `createExpenseSchema` Zod-STRIPPED the
  unknown flag and (b) `createIdempotent` returned the existing (userId, clientId) row UNCHANGED — so on a
  GENUINE clientId collision the user's resolved offline edit was silently discarded. FIX (Angelo's "real
  PUT-on-collision/upsert"): (1) `createExpenseSchema.extend({ forceOverwrite: z.boolean().optional() })`
  (create-only, NOT on update); (2) the POST route separates the control flag from the row data (kept out
  of the insert) + threads it to the repo; (3) `createIdempotent(data, overwrite=false)` — on a collision
  with overwrite, UPDATEs the existing row with the local data, stripping clientId/userId from the patch so
  the identity + idempotency keys stay immutable; default false keeps the plain-retry no-op EXACTLY as
  before (the existing "retry returns original unchanged" test still passes). The race-recovery path honors
  the same overwrite contract on the re-read winner. GUARD: +4 repo cases (idempotent-create.test.ts:
  overwrite updates in place / identity immutable / default no-op unchanged / overwrite-on-absent =
  plain-create) + +2 HTTP-harness cases (expenses-http.test.ts: the REAL route applies the edit WITH the
  flag, no-ops WITHOUT — proves the schema no longer strips it). NON-VACUOUS (verified firsthand): neutering
  the overwrite branch → the 3 overwrite-applying tests RED, the no-op cases stay green; reverted → green,
  repository.ts diff = only my change. Updated the FE sync-manager comment + the stale "#98 not a real
  overwrite" characterization test to the now-real behavior (the wire contract — POST forceOverwrite +
  clientId — is unchanged + still asserted). The FE conflict-resolution path is eyes-on/Playwright-blocked
  (offline + conflict-dialog state); the end-to-end overwrite is covered by the HTTP-harness (the real
  route) — the right merge-surviving net for this seam, no shot feasible. Verify: backend validate:local
  GREEN (tsc 0, musl-biome 0 errors / 20 pre-existing warnings, 1647 pass / 0 fail, +6, build bundled) +
  frontend validate:local GREEN (type-check 0, build OK, 735 tests). cov: be ~87.5% / fe 86.35% (~ — the +6
  pin the overwrite path; FE comment/test-only). #98 DONE. Next Angelo: Sev-2 #94 (the fleet-unit-pool
  class, its own cycle) or the Sev-4 hardening (#100/#22/#129/#112/#79).
- **C50 (arch)** — **Dedup the split-config vehicleId extraction into ONE exported `splitConfigVehicleIds`
  (a genuine fresh pick — 3 hand-copies across 2 domains).** arch was the SOLE over-budget category
  (50−43=7/5, +2). Not a no-churn ceremony — found a real, clean dedup the prior scouts (C4/C6/C12/C36)
  hadn't covered: the `config.method === 'even' ? config.vehicleIds : config.allocations.map((a) =>
  a.vehicleId)` extraction was hand-copied at THREE sites — `expenses/routes.ts` (a LOCAL un-exported
  `splitConfigVehicleIds`, the split-ownership loop), `expenses/repository.ts` `validateVehicleOwnership`,
  and `reminders/validation.ts` `refineSplitConfig` (the split-vs-vehicleIds match check). FIX: lifted ONE
  exported `splitConfigVehicleIds(config)` into expenses/validation.ts (where `SplitConfig` lives +
  reminders/validation already imports splitConfigSchema from it), typed on the MINIMAL structural shape
  so BOTH `SplitConfig` AND the DB-layer `ReminderSplitConfig` satisfy it with no cross-import; de-dupes
  via Set (matching the callers' prior `[...new Set(ids)]`). Routed all 3 sites through it (routes drops
  its local copy; repo + reminder validator drop their inline ternaries). BEHAVIOR-PRESERVING (rule 4):
  the reminder validator wraps the result in `new Set(...)` exactly as before (helper returns a de-duped
  array → same set); the existing split-validation + reminder-validation + expense-ownership suites stayed
  green (142 pass across the affected files). Arch rule 3 (pin the newly-shared helper): +4 direct unit
  cases (split-config-vehicle-ids.test.ts — even/absolute/percentage extraction + the dedup) since it was
  a local un-exported helper with no direct net (the C17→C18 / C23 arch-extract→guard-pin pattern, in one
  cycle). NON-VACUOUS (verified firsthand): breaking the helper's even branch → 3 of 4 RED; reverted →
  green, validation.ts diff = only the +19-line helper. CAUGHT-MY-OWN: my first test passed bare object
  literals with `amount`/`percentage` → tsc excess-property error against the minimal param shape; typed
  the fixtures as `SplitConfig` (how callers actually use it) → green. Verify: backend validate:local GREEN
  — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1641 pass / 0 fail (+4), build bundled.
  Backend-only (no UI → no shot). cov: be ~87.5% / fe 86.35% (~ — behavior-preserving dedup, LOC net down
  at the 3 sites, +4 pin the shared helper; FE untouched). Arch was NOT at its floor this cycle — a real
  cross-domain dup existed; keep scouting fresh modules, not the saturated C4/C6/C12 surfaces.
- **C49 (infra)** — **Branch-hygiene sweep + coverage re-measure (the ~10-cycle cadence; last ran C42).**
  TWO over budget at C49 — infra (49−42=7/6, +1) and arch (49−43=6/5, +1); infra wins the tie on raw
  starvation (7 > 6). Warranted on substance (the C42 projection was ~C52, but the budget forces it now and
  real modules accrued): C44 atomic-swap + C46 insurance-trend guard + C47 dialog markup + C48 #88
  prune-helper since C42. (1) UNTRACKED-TEST SWEEP: CLEAN — zero untracked `.test.ts`/`.spec.ts` (the
  gitignored `*.meshclaw.e2e.ts` agent specs are by-design; the persistent `M .gitignore`/`M
  frontend/.gitignore` are the intentional local overrides — NOT product changes). (2) COVERAGE
  RE-MEASURED (7 commits since C42): **BE 87.47% line / 87.17% func** (file-mean, 1637 pass); **FE 86.35%
  line / 87.68% func / 78.88% branch** (v8, 735 pass) — BE UP vs C42 (line 87.33→87.47, func 86.97→87.17
  from the C44/C46/C48 added covered lines); FE line/func flat, branch +0.10 (C47 markup; helper logic
  already covered). Both still at the ~87 BE / ~86 FE structural ceiling. (3) BOTH-SIDES GREEN: BE 1637 /
  FE 735. (4) BRANCH STATE: claude-loop-dev = **49 commits ahead** of fresh origin/main (C1–C48: 2 features
  COMPLETE [maintenance C1, recurring-expenses C27] + import-trackers T4 through the category-remap table
  C47; category spread feature 11 / bug 11 / guard 8 / deep-review 8 / infra 6 / arch 4), PR-ready;
  recorded here since BRANCH_REVIEW.md is gitignored. Doc-only — no source touched. cov: be 87.47% / fe
  86.35% (MEASURED). NEXT cadence ~C59.
- **C48 (bug #88)** — **Prune a deleted vehicle from reminders' expenseSplitConfig blob (Angelo-APPROVED
  Sev-3 data-integrity).** bug was the SOLE over-budget category (48−44=4/3 +1; arch/infra AT). Cold-scout
  vein exhausted → took the top unfinished Angelo-approved item by severity: #88 (Sev-1 #36/#37 done,
  #127 arch-rule-6-gated; #94 is a 6-member multi-builder sweep better as its own cycle → took the
  contained, single-write-path #88). CONFIRMED FIRSTHAND: a reminder's `expenseSplitConfig` is a JSON blob
  (text mode:'json'), NOT FK-managed like the reminder_vehicles junction (onDelete:cascade). When a vehicle
  is deleted the junction cascades but the blob still NAMES the dead vehicleId, so the next trigger's
  `createExpenseFromReminder` builds a split sibling for that dead id (createSiblings inserts by the BLOB's
  vehicleIds, not the junction) → FK violation that (C151 async-tx footgun) leaves the surviving legs
  half-committed — a partial/inconsistent expense group every trigger. Same #88/#97 vehicle-delete family;
  #97 (junction→zero-vehicles) was closed C40, this is the blob sibling. FIX (Angelo's "drop+renormalize /
  single-vehicle fallback"): new pure `pruneVehicleFromSplitConfig(config, deletedId)` in
  split-config-helpers.ts — drops the leg (even: from vehicleIds; absolute: keep remaining fixed amounts,
  total shrinks honestly; percentage: drop + RESCALE survivors back to 100%, even-fallback when survivors
  sum 0); returns null when <2 legs remain (caller clears the blob → single-vehicle junction path) or the
  SAME ref when the id was absent (no-op skip). New `reminderRepository.pruneSplitConfigsForDeletedVehicle
  (userId, deletedId)` loads the user's split-config reminders, prunes each, writes back (clears to null on
  collapse). Wired into the vehicle-delete route BEFORE deactivateVehicleless (so a collapsed blob's
  now-vehicleless reminder is still caught by #97/C40). GUARD: +8 pure cases (prune-split-config.test.ts:
  all 3 methods, the rescale-to-100, the 0-sum even fallback, the <2 collapse, the absent no-op) + +4
  HTTP-harness cases (vehicle-delete-cascade.test.ts #88 block: even drop, percentage <2 collapse→null,
  3-way percentage rescale-to-100, unrelated-reminder untouched). NON-VACUOUS (verified firsthand): disabling
  the route's prune call → 3 of the 4 HTTP #88 tests RED (the no-op case correctly stays green); reverted →
  12/12 + 8/8 green, routes.ts diff = only my 6-line change. Verify: backend validate:local GREEN — tsc 0,
  musl-biome 0 errors (20 pre-existing warnings; my 2 new noNonNullAssertion warnings refactored away),
  1637 pass / 0 fail (+12), build bundled. Backend-only (no UI → no shot). cov: be ~87.3% / fe 86.35% (~ —
  the +12 pin the new prune helper + route path; FE untouched). #88 DONE — the #88/#97 vehicle-delete
  reminder-orphan family is now closed (junction C40 + blob C48). Next Angelo Sev-2 = #94 (fleet-unit-pool
  class, its own cycle) or Sev-3 #98 (PUT-on-collision upsert).
- **C47 (feature)** — **Import-trackers T4: category-remap table for unrecognized category words (eyes-on
  DONE).** feature was most-starved over budget (47−41=6/4 +2; bug sat AT 3/3, not over). Import-trackers
  is the only open feature; its remaining unblocked T4 piece was the category-remap table (the
  `defaultCategory` preset gap stays parked-for-Angelo, T6 e2e is verify-phase). REAL gap: when a foreign
  CSV's category column carries a word VROOM doesn't recognize, `mapCategory` falls it back to `misc` +
  surfaces it in the preview's `unmappedCategories` (D2 "never invent"), but the dialog had NO UI to remap
  it — so the user couldn't rescue a mis-categorized import without editing the CSV. FIX: when a preview
  surfaces `unmappedCategories`, render an "Unrecognized categories" panel — one row per word + a
  VROOM-category `Select` (reusing the canonical `categoryLabels` from expense-helpers, NOT a reinvented
  list — NORTH_STAR #4). Assigning a word folds into `buildMapping`'s `categoryMap` (merged OVER any
  preset's own map, user choices win; manual path sends categoryMap only once ≥1 word is assigned) +
  re-previews, so the word resolves, drops out of the list, and its rows re-categorize. State reset on
  dialog-close + on re-detect (no stale remap bleed). EYES-ON CONFIRMED via
  `import-category-remap.meshclaw.e2e.ts` + 2 PNGs (Read): a bespoke CSV with `Type=servicing` → the
  "Unrecognized categories" panel renders (amber, CircleAlert) → map servicing→Maintenance → panel
  disappears + "1 ready" + "Import 1 row" enabled → committed row imported as `maintenance` (NOT the misc
  fallback, verified via API). Remap trigger got `data-testid="remap-category-{word}"`. Verify: frontend
  validate:local GREEN — type-check 0, build OK, 735 tests pass. cov: be ~87.3% / fe 86.35% (~ — UI-markup
  cycle, the categoryMap round-trip is backend-covered at T1/T3; FE store/util layer untouched). T4 REMAINING:
  only the Angelo-gated preset `defaultCategory` (the remap table does NOT cover it — a detected preset maps
  no category COLUMN, so there's no word to remap; that's the parked missing-column decision) + T6 e2e.
- **C46 (deep-review)** — **Certified the insurance `monthlyPremiumTrend` month-bucketing CLEAN + guarded
  + fixed a latent test-harness epoch bug.** deep-review was most-starved over budget (46−39=7/5 +2;
  feature +1 lost on raw starvation). Per the standing notes (C39/C33/C26 all point to an unaudited
  surface), verified firsthand that the two recurring candidates are ALREADY well-guarded — the
  sync-manager conflict path (determineConflictType 4-way + resolveConflict 3-outcome + #98 char + retry
  backoff/cap + #121 + #134 orphan-no-resurrect) and the insurance premium MATH (effectiveMonthlyPremium /
  monthKeysInRange both directly unit-pinned; getInsurance totals/#8/#50/#25/#14/#51/contract all certified)
  — so didn't re-scan them. Found the genuine gap: `monthlyPremiumTrend` — the per-month premium SERIES the
  analytics tab's trend chart renders, built from `accumulateMonthlyPremiums`→`monthKeysInRange` — was
  driven ONLY transitively through getInsurance; NO test asserted the month-by-month bucketing (the C6/C18
  "helper output never pinned" gap on a money-facing series). CERTIFIED FIRSTHAND CLEAN: a term contributes
  its monthly premium to EACH spanned month (day-1 anchored, inclusive both ends); overlapping policies SUM
  in shared months; a totalCost-only term spreads its AMORTIZED monthly value per-month (matching the
  totals path) — all correct against source. GUARD (+3 in insurance-details.test.ts). NON-VACUOUS (verified
  firsthand): making accumulateMonthlyPremiums add once-then-break → the EACH-month + overlap tests RED;
  reverted → 17/17 green, repository byte-identical. FIRSTHAND HARNESS FINDING (recorded in-file): the
  file's shared `term()` helper inserts raw MILLISECONDS via direct SQL, but insurance_terms.start/end are
  Drizzle `mode:'timestamp'` (SQLite stores SECONDS; the real repo writes via the ORM which ÷1000) — so
  seeded term dates read back ~1000× too large (year ~55970). The PRODUCTION path is CLEAN (the route uses
  the ORM); the pre-existing tests never caught the harness bug because they're date-INDEPENDENT (monthlyCost
  flows straight through; the totalCost test asserts only >0) — the trend is the first date-DEPENDENT
  assertion. Added a local `termSeconds` seed matching the real storage contract; left the shared `term()`
  untouched (changing it risks the date-relative #14/#25/latest-term tests — a separate harness cleanup if
  ever warranted). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing
  warnings), 1625 pass / 0 fail (+3), build bundled. Backend-only (no UI → no shot). cov: be ~87.3% / fe
  86.35% (~ — insurance analytics already covered; +3 pin the trend series; FE untouched).
- **C45 (guard)** — **Tree-wide source-scan guard for the C44 #37 backup-atomicity invariant.** Two over
  budget (guard 45−38=7/6 +1, deep-review 45−39=6/5 +1); guard wins the tie on raw starvation (7 > 6). The
  C44 #37 atomic-swap is a HIGH data-safety fix whose regression risk is a ONE-EDIT revert — a future
  refactor reintroducing a `values.clear()` on a live sheet (the clear-then-write footgun), or adding a new
  unsafe write site — and the C44 fake-seam test only drives the single staging path that exists today
  (same gap the C24→C25 #36 source-scan closed). GUARD: new `sheets-atomic-backup.test.ts` (+4) scans
  google-sheets-service.ts for the three structural properties the atomicity rests on: (1) ZERO
  `.values.clear(` calls (the atomic design removed clearing entirely — staging tabs are born empty; a
  clear-then-write revert is the exact #37 footgun), (2) the staging+swap mechanism is present
  (`SHEET_STAGING_SUFFIX` constant + `deleteSheet`/`updateSheetProperties` in the commit batch), (3) the
  staging suffix is SPACE-FREE (it's interpolated UNQUOTED into A1 ranges `${title}${suffix}!A1` → a space
  silently corrupts every staging write's range). NON-VACUOUS (verified both ways firsthand): reintroducing
  a `values.clear` call → the clear test RED with the data-loss diagnostic; a spaced suffix → the
  space-free test RED; both reverted → 4/4 green, service file byte-identical to HEAD. Mirrors the
  established source-scan idiom (sheets-raw-value-input #36, no-utc-date-input). Source-scan > untracked
  e2e for merge survival (GUIDE); the one-token/one-edit-fix→source-scan pattern again (C24→C25, now
  C44→C45). Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings),
  1622 pass / 0 fail (+4), build bundled. Backend-only (pure source scan → no shot). cov: be ~87.3% / fe
  86.35% (~ — pure source scan, no module logic touched; pins the #37 atomicity contract tree-wide).
- **C44 (bug #37)** — **Atomic Google Sheets backup: stage-then-swap (Angelo-APPROVED Sev-1 data-safety).**
  bug was the SOLE over-budget category (44−40=4/3, +1). The cold-scout vein is exhausted (C6/C10/C15/C20),
  so took the top unfinished Angelo-approved item by severity — #37 (HIGH, the only actionable open Sev-1:
  #36 done C24, #127 is arch-rule-6-gated). CONFIRMED FIRSTHAND: `updateSheet` did per-sheet `clear()` THEN
  `update()`, and the 15 sheets ran under one `Promise.all` — so a failure mid-run (429 / network / process
  death) left a TORN backup: some sheets rewritten, the one mid-write EMPTIED by its own preceding clear,
  the rest stale, on what may be the user's ONLY copy (NORTH_STAR #1 silent data-loss). FIX (Angelo's
  ratified mechanism — write to temp sheets, then copy-then-promote/swap): new `writeAllSheetsAtomically` —
  (1) STAGE every table into a fresh `${title}__vroom_staging` tab (live canonical sheets untouched; any
  staging failure → clean up the temp tabs + rethrow, prior backup fully intact), (2) COMMIT one atomic
  `batchUpdate` that deletes the old canonical sheets + renames each staging tab to its canonical title AND
  sets its `index` to the canonical position (Sheets applies a batchUpdate all-or-nothing → a reader sees
  the whole old OR whole new backup, never a mix; the index keeps tab ORDER stable across backups). Dropped
  the per-sheet `clear()` entirely (staging tabs are born empty). The `tables` array had to be reordered to
  match SHEET_NAMES (Odometer before Photos) since the swap now derives each tab's index from its array
  position — caught by the create-tab-order test (good pin). HARNESS: taught the fake's `batchUpdate` to
  honor `deleteSheet`/`updateSheetProperties(title,index)` (extracted `applyAddSheet`/`applyDeleteSheet`/
  `applyRenameSheet`/`applyBatchRequests` to keep cognitive-complexity under the biome cap) + a MONOTONIC
  `nextSheetId` (real Sheets never reuses ids; `sheets.length` would collide after a delete+rename cycle on
  the 2nd backup). GUARD (+2 in google-sheets-service.test.ts, the #37 net): a values.update 429 during a
  RE-backup → the prior backup reads back byte-identical (Toyota still there, not torn/emptied) + no
  `__vroom_staging` tabs leak + tab order == SHEET_NAMES; a successful re-backup replaces the data (2
  vehicles) with stable tab order. NON-VACUOUS (revert to clear-then-write → the failure case reads torn).
  Verify: backend validate:local GREEN — tsc 0, musl-biome 0 errors (20 pre-existing warnings), 1618 pass /
  0 fail (+2), build bundled. Backend-only (no UI → no shot). #37 DONE — the Sheets-backup Sev-1 pair
  (#36 C24 + #37 here) is now closed; the remaining Sev-1 #127 is arch-rule-6 design-gated. cov: be ~87.3%
  / fe 86.35% (~ — Sheets service already fake-seam-covered; +2 pin the atomicity invariant; FE untouched).
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
