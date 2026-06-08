# BACKLOG — VROOM autonomous loop

> Re-ranked every cycle. Pick the top unblocked item in the most-starved over-budget
> category (see LEDGER balance check); else the highest-leverage item overall.
> Keep this lean — prune done items, promote what the last cycle surfaced.

## Categories & starvation budgets
A category may go at most **N cycles** untouched before it MUST be picked next.

| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (often needs a spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits of already-shipped work. |
| **guard** | 6 | Merge-surviving regression prevention (committed tests, source-scans). |
| **bug** | 3 | A concrete defect found in review or reported. Always jump the queue when real. |
| **arch** | 5 | **Behavior-preserving** structural improvement: dedup, extract shared helpers, tighten layer boundaries, kill dead code, simplify, cut complexity. NOT new behavior (that's `feature`), NOT defect fixes (that's `bug`). |
| **infra** | 6 | Loop tooling, harness, CI, docs that keep the machine running. |

`bug` has the tightest budget on purpose: a known defect should never sit. `arch` at 5
keeps structural improvement firing regularly — it compounds in value, and the per-cycle
size cap (rule 1) keeps each increment small enough that frequent picks stay safe.

### `arch` rules (READ before any arch increment — refactors are the highest-risk work here)
1. **One coherent refactor per cycle, small.** A single rename / extract / merge / delete
   with a clear before→after. Never a sweeping multi-file rewrite. If it can't be ONE
   reviewable commit, it's too big — split it, or escalate per rule 6.
2. **Behavior-preserving, full stop.** No observable change to API, UI, or stored data. If
   you *want* to change behavior, it's a `bug` or `feature`, not `arch`.
3. **Test-anchored both ways (green → green).** The touched code must already have tests
   that pass BEFORE and pass UNCHANGED AFTER. If coverage is missing, the increment is to
   ADD the characterization test FIRST (that cycle counts as `arch`/`guard`), THEN refactor
   next cycle against the safety net.
4. **Verify the full gate** every time: tsc 0 · musl biome clean · `bun test` green ·
   `bun run build`. For any UI-touching refactor also run `regress.sh` + an eyes-on
   screenshot and diff before/after — a refactor must not move a pixel.
5. **No churn-for-churn.** Never reformat / re-order / rename for taste alone. Every arch
   item must name a concrete payoff: removes duplication, deletes dead code, unblocks a
   queued feature, drops a complexity score under the Biome max, or collapses N sources of
   truth into one.
6. **Big restructures need sign-off.** A cross-cutting change (new layer, dependency-flow
   inversion, schema/money-type migration, framework/lib swap) is a DIRECTION call: write a
   short `.kiro/specs/<refactor>/design.md`, `send_message` Angelo, and move on — never
   self-authorize a structural change of that size.
7. **Audits use fan-out.** To FIND arch work, spawn 2–3 parallel Explore agents (e.g.
   backend layer-boundary + duplication; frontend component/store duplication; dead-code +
   cyclomatic-complexity hotspots). Triage their findings into the `arch` queue below.
   Finding ≠ doing: file them, then execute only the single top item this cycle.

---

## Ranked queue (top = next)

### feature
1. **Maintenance-schedule reminders** — spec APPROVED; BUILD IN PROGRESS per
   `.kiro/specs/maintenance-schedule/tasks.md`. **T1 DONE (C15):** additive migration
   `0003_many_jean_grey.sql` (mileage columns + dueOdometer) + SHEET_HEADERS (T5-partial).
   **T2 DONE (C16):** `getCurrentOdometer(vehicleId)` = MAX-by-value UNION over expenses.mileage +
   odometer_entries (8 unit tests); vehicle-stats reconcile deferred to T3 (period-semantics call).
   **NEXT = T3:** trigger-service whichever-comes-first due logic + the deferred nextDueDate/dueDate
   nullable rebuild (table rebuild — verify child rows survive) + the vehicle-stats reconcile. Then
   T4 routes → T6–T9 frontend/e2e.
2. **Import from other trackers** — spec APPROVED (Angelo signed off D1–D5, cycle 12). **BUILD GO**,
   backend-first per `.kiro/specs/import-trackers/tasks.md` T1→T6. Server-side mapping pre-pass →
   VROOM-native CSV → the UNCHANGED hardened import pipeline (inherits cycle-8 idempotency/atomicity
   + formula/tenant safety). Backward-compatible route extension.
3. **Recurring expenses** beyond reminders — first-class recurring (insurance premium, loan
   payment, parking pass) with frequency + dashboard surfacing.

> NOTE (cycle 12): both feature builds are large, MULTI-TASK efforts — one tasks.md task per loop
> cycle, not one-and-done. They no longer gate the loop; pull T1 of the higher-value
> maintenance-schedule next time `feature` is the balance pick. Also new: standing TODO Misc goal —
> raise test coverage to 90% (frontend ~59% / backend ~74% today); fold into bug/guard/arch cycles.

### deep-review
1. **Eyes-on sweep: vehicle Overview tab + ExpensesTable populated states** (mobile +
   desktop) — code-reviewed C3 (findings below); still wants a real eyes-on screenshot pass.
2. **Analytics route eyes-on** (per-vehicle + cross-vehicle + year-end), states + a11y.
- ~~**Backend: Sheets restore path**~~ — *DONE C3: found + fixed the clientId column-drop
  data-loss bug; added the schema-vs-headers coverage guard. CSV path confirmed safe.*

- ~~**Class-level net: no clobbering `.default()` in a `.partial()` update schema**~~ — *DONE C41:
  `partial-update-no-default-injection.test.ts` — a RUNTIME net (text-scan was unreliable: schemas
  span files + chain .partial()) that imports each exported update schema, parses `{}`, and asserts no
  injected key beyond the EXEMPT allowlist (actionMode literal-default, C35-harmless). Tests the real
  invariant against the actual Zod objects; catches the NEXT instance of the C31/C34 class. Covers
  updateReminder/Term/Policy/Claim. FUTURE: export the route-local updateExpense + odometer update
  schemas to widen coverage.*
- ~~**maintenance-fields backup round-trip**~~ — *DONE C27: `maintenance-fields-roundtrip.test.ts`
  (3 tests, real exportAsZip → restoreFromBackup) locks the C22/C25 columns (triggerMode,
  intervalMileage, lastServiceOdometer, nextDueOdometer, dueOdometer) + the nullable dates surviving
  the round-trip — incl. the load-bearing NULL-date-not-coerced-to-0 cases (the C3 clientId class).
  Also closes T5's "Remaining" round-trip item.*
- ~~**ownership-dedup guard**~~ — *DONE C20: source-scan `ownership-uses-shared-validators.test.ts`
  locks in the C18 dedup — `photos/helpers.ts` must call the 3 shared validators, must NOT locally
  re-declare them, must NOT re-import vehicleRepository/insurancePolicyRepository (inlined-check
  marker). Makes the single-source-of-truth invariant merge-surviving.*
- ~~**no-oldest-month-slice guard**~~ — *DONE C13: source-scan `no-oldest-month-slice.test.ts`
  pins the C11 class (a localeCompare month-sort must not chain into `.slice(0,N)`); excludes the
  legit numeric `.slice(0,50)` maintenance-timeline by anchoring on localeCompare.*
- ~~**EUR/unit visual guard**~~ — *already built before the loop (insurance-currency-label +
  vehicle-form-unit-defaults e2e); confirmed cycle 2.*
- ~~**Category-grid no-wrap guard**~~ — *DONE cycle 2: committed source-scan
  `category-selector-labels.test.ts` (merge-surviving, single-word invariant) + runtime
  e2e `expense-category-nowrap.meshclaw.e2e.ts` (untracked).*

### bug
*(surfaced by the C3 vehicle-detail UI review — ranked by severity; all real, none data-safety)*
1. **Vehicle-detail load failure masquerades as empty state** — `loadSummary`/`fetchExpensesPage`
   in `vehicles/[id]/+page.svelte` only toast on failure, leaving `summary=null`/`expenses=[]`
   → renders "No expenses yet" instead of an error+retry. Same class fixed for dashboard/expenses;
   add a `*LoadError` flag + retry surface. (medium)
2. **Vehicle-detail Expenses tab: page-local search/category filter over a 20-row server slice**
   while header reads "All Expenses ({totalCount})" — matches on other pages invisible; the
   in-table category Select is uncontrolled here (no `onCategoryChange`). Wire server-side
   filtering (as `/expenses` does) or hide the controls when paginated. (medium)
3. **ExpensesTable ScrollArea `h-[{scrollHeight}]` is a DEAD class — CONFIRMED C14 via DOM probe**
   (`h-[600px]` present but no CSS rule generated → height is content-driven, the 600px cap +
   internal scroll NEVER engage; latent unbounded growth on a >~20-row vehicle). Fix: inline
   `style="height: …"` like ChartCard. The same interpolated-`h-[CHART_HEIGHT]` in ExpenseTrendChart/
   FuelEfficiencyTrendChart is harmless (ChartCard sets real height via style) but worth the sweep. (med, overflow)
4. **ExpensesTable combined-row re-sort lacks an id tiebreaker** — same-date/amount rows can
   reorder vs the server's id-tiebroken order. Cosmetic flicker. (low)

*(surfaced by the C7 backend deep review — CSV import + analytics math; ranked by severity)*
5. **CSV import: no UTF-8 BOM strip** — `import-csv.ts:~245` `parse()` lacks `bom:true`; an
   Excel/Sheets-edited export (BOM-prefixed) fails EVERY row with a misleading "Invalid date".
   Add `bom: true`. (correctness, med — clean one-liner)
6. **CSV import: date-only cells midnight-UTC** (`import-csv.ts:~120` `new Date(raw)`) + **currency
   column silently ignored** on import — same class as C6; foreign/edited files commonly use
   date-only and other currencies. (correctness, med)
7. **Analytics month bucketing uses local-tz `getMonth()`** (`analytics-charts.ts toMonthKey:~131`
   + heatmap/TCO/day-of-week/seasonal) — backend twin of the C6 class; benign if server runs UTC,
   real on a negative-offset host. Verify deploy TZ first, then bucket on UTC. (correctness, low-med)

*(surfaced by the C14 deep review — financing/insurance analytics + vehicle-detail eyes-on)*
9. **`interestPaidYtd` is mislabeled** — `repository.ts:763-764` computes ONE month's interest on the
   CURRENT balance, then sums it as `interestPaidYtd` (`:1592`). Neither YTD nor "paid". Rename to
   `monthlyInterestEstimate` (smallest honest fix) or compute true YTD from payment history. (med)
   *(C28 audit: CONFIRMED still real + unfixed; line refs refreshed.)*
- ~~**`buildLoanBreakdown` holds balance flat across 12 months (#10)**~~ — *DONE C38: extracted pure
  `buildAmortizationSchedule` (analytics-charts.ts) that walks each balance down by principal/month +
  clamps payoff; buildLoanBreakdown resolves balances then delegates. Pinned by
  amortization-schedule.test.ts (5, incl. interest-declines/principal-rises + mid-window payoff).*
11. **Mobile fuel-stat numbers wrap mid-value** — CONFIRMED C14 via screenshot+DOM probe: in
    `FuelEfficiencyStatsCard` the `StatCardGrid columns={3}` with dual-metric `text-2xl` StatCards =
    4 large numbers across 393px → `$97.80`→"$97"/".80", `25,850`→"25,"/"850". Same dual-metric
    cramping class as the cycle-169 fix. Drop to fewer columns on mobile or smaller value text. (overflow, med)

*(surfaced + VERIFIED by the C21 reminders/expenses backend audit — 4 agent "HIGH"s were false
positives, debunked in LEDGER C21; these two are the real ones)*
14. **Insurance `buildInsuranceDetails` counts an EXPIRED latest term as current premium** —
    `analytics/repository.ts:884-893`: picks the latest term per ACTIVE policy by `endDate` descending
    but never checks that endDate is in the future. An active policy whose latest term has lapsed (not
    renewed) still contributes its stale `monthlyPremium` to `totalMonthlyPremiums`/trend. SEMANTICS
    CALL, not a clear bug — "active policy, expired term" may legitimately mean "still owe / about to
    renew". Surfaced C28; needs a product decision (filter to `endDate >= now`, or keep + document)
    before fixing. No test covers buildInsuranceDetails at all — a characterization test should precede
    any change. (correctness?, med — needs decision)

*(surfaced + VERIFIED by the C42 mark-serviced/recheck audit — 1 fixed in-cycle, these 3 filed)*
15. **`markServiced` comment overclaims "optimistic-locked"** — `repository.ts` markServiced is
    ownership-scoped (`where id + userId`), NOT value-CAS'd like advanceNextDueDate
    (`where nextDueDate = expected`). Two concurrent user mark-serviced calls both succeed; they
    compute the SAME result from the same row so there's no corruption — but the C32 comment +
    design.md claim "optimistic-locked transaction" is false. Either add a CAS guard on the pre-call
    nextDueDate/nextDueOdometer, or (lighter) correct the comment to "ownership-scoped". (doc-accuracy
    / low — no data risk; pick one)
16. **mark-serviced advances nextDueDate one period even from an overdue date** — `routes.ts:100`
    computeNextDueDate from the CURRENT (possibly past) nextDueDate advances by ONE period, so marking
    an overdue reminder serviced without first running /trigger can leave it still in the past
    ("bounces" through past periods, re-firing). Matches the trigger's one-period model + assumes a
    trigger ran first. SEMANTICS CALL: catch-up to >= now, or assert/leave-as-is. (needs decision)
17. **recheck-on-write is CREATE-only** — recheckMileageReminders is wired into expense/odometer
    CREATE, not their UPDATE (PUT). Editing a reading upward across a milestone won't fire until the
    next /trigger. Matches D5's "after a create" wording — a documented scope choice. Expand to UPDATE
    routes only if the product wants edit-triggered rechecks. (by-design gap)
- ~~**recheckMileageReminders could 500 a successful write (C42)**~~ — *DONE C42 (found by the audit):
  the findMileageTracking fetch was outside the per-reminder try/catch + throws DatabaseError; recheck
  runs after the write persists, so a DB hiccup propagated + 500'd the (successful) write, breaking the
  "never throws" contract. Wrapped the fetch → swallows to a skip. Pinned by recheck-query-failure.test.ts.*
- ~~**Expense update wipes tags (`.default([])` survives `.partial()`)**~~ — *DONE C34 (found by the
  guard, failing-first): `updateExpenseSchema`'s base `tags: .optional().default([])` injected `[]` on
  any edit omitting tags → silent data loss. Fixed by re-declaring `tags` as plain `.optional()` (no
  default) via `.extend()`. Pinned by update-preserves-tags.test.ts. Class-level scan filed under guard.*
- ~~**`advanceCustom` no-default → fastForward infinite loop (#13)**~~ — *DONE C29: two-part fix in
  trigger-service.ts — (1) `advanceCustom` throws ValidationError on an unknown intervalUnit (root
  cause: a no-op date spins the while loops); (2) a non-progress backstop in `fastForwardPastNow`
  throws if the date didn't strictly advance. Both land in processReminder's per-reminder try/catch →
  corrupt reminder becomes a `skipped` entry, not a hang. Pinned by trigger-bad-interval-unit.test.ts
  (2 tests; the test completing IS the anti-hang proof).*
- ~~**`fastForwardPastNow` ignores `endDate` (#12)**~~ — *DONE C25: folded into T3 part 2 — added the
  main loop's `if (endDate && nextDue > endDate) { deactivate; return }` guard inside fastForward;
  pinned by trigger-fastforward-enddate.test.ts (lapsed bounded reminder deactivates, not left active).*
- ~~**Insurance shows $0 when only `totalCost` is set**~~ — *DONE C23 (bug #8): extracted exported
  `effectiveMonthlyPremium(term)` (monthlyCost wins, else totalCost / monthKeysInRange span);
  wired into buildInsuranceDetails:893 single choke point; 7 unit tests.*
- ~~**Insurance premium trend skips a month for day-29–31 term starts**~~ — *DONE C14: extracted
  day-1-anchored `monthKeysInRange` helper, routed accumulateMonthlyPremiums through it; 5 unit tests.*
- ~~**buildMonthlyConsumption shows OLDEST 12 months**~~ — *DONE C11: slice(0,12)→slice(-12) in
  buildMonthlyConsumption + the latent buildConvertedEfficiencyTrend copy; pinned by 2 unit tests.*
- ~~**CSV import: missed-fillup corrupts MPG/cost charts**~~ — *DONE C10: shared validMilesBetween
  guard (skip missedFillup either-row + over-cap gap) in accumulateFuelRow + accumulateCostPerMile;
  pinned by 5 unit tests.*
- ~~**CSV import: no idempotency + non-atomic commit**~~ — *DONE C8: deterministic per-row
  clientId + createIdempotent-style dedup, all inserts in one db.transaction (importExpenses);
  pinned by 2 HTTP tests (re-import no-op, identical-rows-both-import).*
- ~~**Analytics totalDistance pooled across vehicles**~~ — *DONE C7: buildFuelStatsFromData now sums
  per-vehicle max-min; pinned by a two-vehicle regression test.*
- ~~**Month-trend dates parsed midnight-UTC**~~ — *DONE C6: routed vehicle-detail + dashboard
  through parseMonthToDate; pinned by a helper unit test + the no-utc-month-parse source-scan guard.*

### arch
*(NEW category. Three concrete items seeded below from a quick grounding scan — verify each
against current source before acting, then knock out the top one. Once these are done (or to
go broader), run the AUDIT fan-out per rule 7 to repopulate. Obey the `arch` rules above —
behavior-preserving, test-anchored, ONE small reviewable refactor per cycle.)*

1. **Converge route error handling on the central error middleware.** `sync` (7 try/catch),
   `auth` (7), and `settings` (5) route handlers hand-roll try/catch→error-response blocks,
   while `expenses` and `providers` (1 each) lean on the shared Hono error middleware
   (`backend/src/middleware/`) + typed errors (`NotFoundError`/`ValidationError`/…). The
   hand-rolled blocks are boilerplate that can diverge from the canonical error envelope.
   - [x] **part 1 (C24) — make the middleware able to shape SyncErrors.** GROUNDING CORRECTION:
     `SyncError extends Error` (not `AppError`), and the central `errorHandler` had no SyncError
     branch → a thrown SyncError would have become a generic 500 (losing its code→status map).
     So the naive "just throw it" would have been a behavior change. Fixed first: extracted
     `syncErrorResponse()` (single source of truth), routed both `handleSyncError` AND the central
     `errorHandler` through it, committed `error-handler.test.ts` (7 tests) proving the two paths are
     byte-identical for all 7 SyncErrorCodes + pinning every pre-existing branch (had ZERO coverage).
     Dormant + behavior-preserving today (all SyncErrors still caught locally).
   - [x] **part 2a (C30) — characterize sync-route error behavior first.** GROUNDING CORRECTION
     (again): the "clean drop" premise is wrong for NON-SyncError throws — handleSyncError wraps any
     non-SyncError as 500 OPERATION_FAILED, but the central errorHandler maps a ZodError → 400
     ValidationError + an AppError by statusCode, so a blind drop changes status codes (not
     behavior-preserving). The sync routes had ZERO real HTTP-stack error coverage. Committed
     `sync-route-errors.test.ts` (4 tests, real app.request) pinning today's status+body on the
     SyncError paths + documenting the 500→400 divergence analytically. Test-only.
   - [x] **part 2b (C36) — dropped the sync try/catch.** Removed try/catch → handleSyncError from all
     7 `sync/routes.ts` handlers + the unused import; errors now propagate to the central errorHandler.
     SyncError-path C30 assertions stayed green (no regression on the common case); non-SyncError paths
     improved (proper status, not blanket 500) — authorized behavior change. sync-route-errors.test.ts
     updated to the post-drop contract + a live 401-via-central-handler assertion. validate:local green
     (943 pass), full 161-test sync suite green.
   - [x] **part 2c-characterize settings (C43).** settings is a DIFFERENT pattern from sync — hand-rolled
     try/catch rethrowing as AppError with transformed messages (GET / masks any error as 'Failed to
     fetch settings' 500; PUT / maps ZodError → 'Invalid settings data' 400). Pinned today's behavior in
     `settings-route-errors.test.ts` (4) with inline notes on what the drop will change. (Also verified
     updateSettingsSchema carries no C41-class default.)
   - [ ] **part 2c-drop settings.** Now safe: drop the 5 settings try/catch; let typed errors reach the
     central handler (GET stops masking; PUT ZodError → central 400 ValidationError). Update the
     `settings-route-errors.test.ts` 'Invalid settings data' assertion to the central message IN THE
     SAME COMMIT. Keep any catch that adds REAL value (e.g. a genuine error transform a caller depends
     on) — but GET/backup/restore are pure boilerplate masks.
   - [ ] **part 2d — `auth` (7 try/catch).** Same characterize-then-drop pair; check its throw types
     first (AppError subclasses are already centrally-shaped → drop is a no-op simplification). (consistency)
2. **Extract the frontend page load-state pattern.** ~14 `+page.svelte` files repeat the same
   `isLoading` / `loadError` / `try → fetch → catch → toast + set error` triad (dashboard,
   expenses, reminders, insurance, analytics, vehicles/[id], settings, profile, …) — the exact
   class the `bug` queue keeps re-finding per page (load-failure-masquerades-as-empty-state).
   Extract a shared helper/runes pattern (e.g. a `createLoadState<T>()` or a small
   `<LoadBoundary>` snippet wrapping loading/error/retry) and migrate ONE page per cycle onto
   it. Behavior-preserving per page; prove with that route's smoke + an eyes-on screenshot
   (no pixel moves). Bonus: structurally prevents the masquerade bug class. (dedup + bug-class
   prevention; do AFTER bug #1 fixes vehicle-detail so the helper reflects the correct shape)

- ~~**Dedup ownership-validation: one source of truth.**~~ — *DONE C17+C18. C17 added the safety net
  (`entity-ownership-gate.test.ts`, 14 cases pinning the gate's observable contract per entity type).
  C18 executed the refactor: `photos/helpers.ts validateEntityOwnership` now routes vehicle/expense/
  insurance_policy through the shared `validateVehicleOwnership`/`validateExpenseOwnership`/
  `validateInsuranceOwnership` (utils/validation.ts); deleted the private dup + 2 inlined checks +
  unused imports. Kept insurance_claim (transitive) + odometer_entry inline + validatePhotoOwnership
  as-is. 3 ownership impls → 1; behavior-preserving (all gate tests + full 889 suite green, unchanged).*

Seed audit angles for the rule-7 fan-out (once the above are done, or to go broader):
- **Backend layering** — route handlers doing repository/business logic inline; missing or
  leaky service layer; raw Drizzle queries outside repositories; cross-domain imports.
- **Duplication** — copy-pasted logic that should be one shared helper (the recurring win
  here: `buildExpenseConditions`, `validMilesBetween`, `parseMonthToDate`, `SHEET_HEADERS`
  were all "N copies → one source of truth" — find the next one).
- **Frontend** — near-duplicate components/stores; bespoke widgets that should compose from
  the kit; repeated fetch/error/loading boilerplate that wants a shared pattern.
- **Dead code & complexity** — unreferenced exports/files, `noExcessiveCognitiveComplexity`
  hotspots near the Biome ceiling, deeply-nested conditionals worth flattening.

### infra
*(queue empty — repopulate as loop tooling / docs needs surface.)*
- ~~**Frontend `validate:local` (C40)**~~ — *DONE C40: added frontend `validate:local` =
  type-check && build && test (the CLAUDE.md local VERIFY gate as one command, mirroring the C33
  backend script). The existing `validate` is the CI-shaped lint gate; this is the local floor. CLAUDE.md
  VERIFY step updated. Well-timed for the T7–T9 frontend arc.*
- ~~**`validate:local` + `check:musl` scripts (C33)**~~ — *DONE C33: added package scripts wrapping the
  musl-biome workaround — `check:musl`/`check:musl:fix` (src/) + `validate:local` (type-check &&
  check:musl && test && build) = the documented 4-step local-green path as ONE command. Refreshed
  CLAUDE.md to point at them. Running check:musl tree-wide caught a formatter reflow a per-file check
  missed.*
- ~~**Orientation-doc refresh (C26)**~~ — *DONE C26: CLAUDE.md current-state was stale (said
  maintenance-schedule "T1+T2 shipped, next T3"; actually T1/T2/T3-part-1/T3-part-2 all shipped,
  engine dormant until T4) → rewrote + spelled out the T4 surface; softened the coverage badge to a
  TODO.md baseline (suite grew to ~918 tests). APIConventions.md error-handling updated for C24
  (global handler is SyncError-aware via syncErrorResponse). Doc-only.*
- ~~**CLAUDE.md post-sign-off refresh**~~ — *DONE C12: the stale "maintenance-schedule drafted/
  awaiting sign-off" line → both specs APPROVED/BUILD GO + the standing 90% coverage goal.*
- ~~**CLAUDE.md stale refs**~~ — *DONE C5: corrected Biome (musl works), branch convention
  (claude-loop-dev), STATUS.md→loop/ pointers, refreshed state/gaps. All claims verified.*
- ~~**`loop/` scaffold + push.sh**~~ — *DONE cycle 1.*
