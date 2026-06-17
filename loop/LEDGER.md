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
> cycles that touch a module. Goal 90% both (structural ceiling ~86% BE / ~84% FE per the archive —
> the remaining gap is eyes-on FE components, now shootable via shot.sh). Last measured before reset
> (archive C323): **BE 86.5% line / FE 84.4% line** — treat as the floor, re-measure to confirm.

## Balance table
`starved-for = current cycle − last-touched`. If `starved-for > budget` for any category,
the next increment MUST come from the most-starved over-budget category. Recompute ALL 6 every
cycle (slow-budget categories mis-forecast otherwise).

| Category | Budget | Last touched (cycle) |
|---|---:|---|
| feature | 4 | 1 |
| deep-review | 5 | 0 |
| guard | 6 | 0 |
| bug | 3 | 2 |
| arch | 5 | 0 |
| infra | 6 | 0 |

Current cycle: **2**

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
