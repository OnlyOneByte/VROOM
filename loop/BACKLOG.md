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
1. **Maintenance-schedule reminders** — spec APPROVED; **NEAR-COMPLETE** per
   `.kiro/specs/maintenance-schedule/tasks.md`. Backend 100% (T1–T5): migration + `getCurrentOdometer`
   (T1/T2), trigger engine whichever-comes-first + nullable rebuild (T3 parts 1–2, C22/C25), routes
   (T4, C31/C32/C37), backup round-trip guard (T5, C27). Frontend functionally complete (T6–T8, C39/
   C45/C46/C48/C49). **T3 part 3 DONE (C52):** the deferred vehicle-stats reconcile — added the
   canonical all-time `currentOdometer` to GET /stats (additive; `currentMileage` untouched), 4 HTTP
   tests pin period-independence + cross-source MAX. **REMAINING: T9 only** — promote the mileage e2e
   into the committed suite + the T7/T8 eyes-on screenshots; both Playwright-sandbox-blocked here, so
   T9 awaits either an unblocked Playwright or Angelo's glance at `/reminders`.
   *Follow-ons flagged to Angelo (C52): lease/loan miles-used consume period-scoped `currentMileage`
   (understates overage under a non-'all' window) → switch to `currentOdometer`; + the "Current Mileage"
   card display-semantics direction call. Both deferred, not blocking.*
2. **Import from other trackers** — spec APPROVED (Angelo signed off D1–D5, cycle 12). **BUILD IN PROGRESS**,
   backend-first per `.kiro/specs/import-trackers/tasks.md`. **T1 DONE (C58):** `import-mapping.ts` — pure
   `applyMapping(foreignCsv, mapping, target)` → VROOM-native CSV (rename + unit-convert + decimal-comma +
   category map + local-time dates + targetVehicle); 14 tests + `buildImportPlan` round-trip. **T2 DONE (C64):**
   `import-mapping-presets.ts` — Fuelly/Fuelio/Drivvo `MappingPreset` table + `detectSource(headers)`
   (normalized substring match on a distinctive signature subset; unknown → null → manual) + `presetToMapping`;
   10 tests. **T3 DONE (C70):** `POST /import` gained an optional `mapping` (Zod `columnMappingSchema`) →
   resolve target vehicle units → `applyMapping` → the EXISTING flow (no new write path); `unmappedCategories`
   in the response; new `POST /import/detect`. Backward-compat (no mapping → native path unchanged); 9 HTTP
   tests; caught + fixed a Zod-v4 exhaustive-record bug. **FE CLIENT METHODS DONE (C140):** `expenseApi.importExpensesCsv`
   now takes an optional `mapping` (backward-compat — native path request byte-identical) + new `detectImportSource(headers)`;
   + `src/lib/types/import-mapping.ts` (ImportColumnMapping/ImportMappingPreset mirroring the backend) + ExpenseImportResult
   gained `duplicates?`/`unmappedCategories?`; +5 tests (expense-import-mapping.test.ts). **NEXT = T4/T5 (FRONTEND MARKUP, eyes-on):**
   import-dialog mapping step — detected-source banner, per-field column dropdowns from the file headers, unit/date-format/
   target-vehicle pickers, category-remap table; reuse the existing preview/commit step; four-states + a11y +
   mobile (now has its detect + mapping-aware client methods to call). Then T6 e2e (incl. real-export signature validation).
   NOTE: T4–T6 are Playwright-eyes-on-blocked here, so the BACKEND of import-trackers (T1–T3) + the FE client slice (C140) are
   complete but the feature isn't DONE until the FE→BE→DB round-trip e2e runs (feature-DoD rule) — lands "code-complete, eyes-on
   pending" like maintenance T7–T9.
3. **Recurring expenses** — spec **APPROVED (Angelo signed off D1–D4, C94)**; **BACKEND COMPLETE (T0–T3); T4–T8 are the
   eyes-on frontend tail** per `.kiro/specs/recurring-expenses/`. KEY GROUNDING (verified against source C88, re-certified C94):
   the recurring-expense ENGINE ALREADY EXISTS — an `type:'expense'` reminder auto-creates real expense rows
   (single or multi-vehicle split, sourceType:'reminder') on its frequency via `trigger-service.ts`
   processReminder:407 → createExpenseFromReminder:108, and those flow into TCO automatically (the C94 deep-review
   CERTIFIED this path CLEAN). So the spec EXTENDS the engine (NOT a new table/scheduler — that would reinvent it,
   NORTH_STAR #4). The 3 verified gaps: (1) materialization is manual-button-ONLY (no cron/on-open → self-host PWA
   under-counts TCO); (2) ReminderForm omits expenseSplitConfig (no multi-vehicle recurring cost); (3) no source
   traceability. RATIFIED: D1 (✅ client-side opportunistic trigger on app open, idempotent — no cron), D2 (✅ keep
   past history on delete via clearSource not deleteBySource), D3 (✅ reuse the existing split widget), D4 (✅
   backend-first v1 order). **T1 DONE (C96):** grounding found the read-path surfacing was already a no-op — all expense
   reads use bare `.select()`, `buildPaginatedResponse` passes rows verbatim, and the frontend `Expense` type already
   declares `sourceType?`/`sourceId?` (expense.ts:57-58); a contract-drift guard is NOT warranted (C80 — GET /expenses is a
   clean repository pass-through, not a hand-assembled response). The one genuine deliverable shipped: `expense-source-
   traceability.test.ts` (+3) pins the OBSERVABLE API contract (the existing trigger-expense test only checked the DB row,
   which a dropped mapper would pass while breaking the T6 badge) — GET list + GET /:id echo sourceType='reminder'/sourceId
   for a materialized expense; a manual expense reports null. **T2 DONE (C102):** split-materialization characterization —
   extended trigger-expense.test.ts (+2) with even ($100→2×$50) + percentage (75/25 of $200→$150/$50) split reminders
   firing → N siblings, correct shares summing to the template, shared groupId, all sourceType:'reminder' (the
   trigger-service.ts:147-163 path; anchors T4). **T3 DONE (C104):** cascade-safe delete — wired
   `expenseRepository.clearSource('reminder', id, user.id)` into DELETE /reminders/:id (best-effort, between ownership check
   + reminder delete); keeps materialized expense history, NULLs the link (D2). delete-reminder-cascade.test.ts (+2): expense
   reminder → trigger → DELETE → rows remain with source nulled; notification delete is a no-op. **BACKEND T1–T3 COMPLETE.**
   **REMAINING = T4–T8 (frontend, eyes-on, Playwright-blocked here):** T4 multi-vehicle split in ReminderForm (reuse the
   expense-split widget); T5 reliable materialization (client-side opportunistic trigger on app open/focus, debounced — D1;
   the backend seam `POST /reminders/trigger` + client `reminderApi.trigger()` are built, and the GATE
   `shouldTriggerRecurringExpenses` is DONE C128 [+5 tests]; REMAINING = the eyes-on app-init/focus hook that calls the gate +
   POSTs trigger()); T6 source-traceability UI ("Recurring"
   badge + link, reading the C96-surfaced sourceType) — **its BACKEND SEAM is DONE (C122): `GET /reminders/:id/expenses` →
   findBySource, +4 HTTP tests; FE CLIENT METHOD DONE (C134): `reminderApi.getMaterializedExpenses(id)`, +tests; only the
   badge+view MARKUP is eyes-on**; **T7 recurring-cost projection/lens (D4) — BACKEND COMPLETE (core
   C111 `reminder-cost.ts` +10 tests; route C116 `GET /reminders/recurring-cost` +3 HTTP tests); FE CLIENT METHOD DONE (C134):
   `reminderApi.getRecurringCost()` → `RecurringCostSummary` type, +tests; REMAINING = the dashboard widget MARKUP that calls
   getRecurringCost() + renders it, eyes-on**; T8 round-trip E2E. Lands "code-complete, eyes-on pending" like maintenance T9 /
   import-trackers T4–T6 — the backend is fully built + characterized, so a human or unblocked Playwright closes the visible tail.
4. **Money: float→integer-cents migration** — spec DRAFTED C146 (`.kiro/specs/money-cents-migration/`), **awaiting Angelo
   sign-off (D1–D5); BUILD-BLOCKED on T0** (arch rule 6: a money-type migration is a direction call). The NORTH_STAR horizon
   item — money is `real` (float) across 14 columns/6 tables → silent drift in TCO sums, split allocations, amortization
   (split-service ALREADY round-trips through cents at :34/58/60 then stores float, so the code wants this). **KEY: this is the
   ONLY signed-off-horizon feature buildable WITHOUT Playwright** — a backend money-type migration is fully verifiable via
   validate:local, so once T0 clears it runs to DONE entirely in the loop (unlike the 3 eyes-on-blocked features above). Grounded
   C146 (2-agent fan-out + firsthand). THE data-safety crux (NORTH_STAR #1): an OLD float-dollars backup restored into the cents
   schema is SILENTLY corrupted 100× (coerceRow parseInt('12.34')→12¢) because validateBackupData only compares an unchanged
   version string — mitigation = bump CONFIG.backup.currentVersion (fail-closed) + a version-gated ×100 restore shim (ARCC
   SAX-04 fail-closed, per C144.5). Migration itself is LOW-risk (in-place UPDATE ROUND(*100), no rebuild/no FK-cascade — the
   0003 class, NOT the 0004 footgun). T0 sign-off → T1 schema+migration+test, T2 backup-version+shim [the data-safety core], T3
   input-edge, T4 repo/analytics math, T5 split-native-cents, T6 display-edge (API boundary → FE dollar contract unchanged), T7
   sweep. ESCALATED C146 (non-blocking).
5. **Trips & location** — spec DRAFTED C165 (`.kiro/specs/trips-location/`), **awaiting Angelo sign-off (D1–D6); BUILD-BLOCKED
   on T0** (is this the right next horizon item? + odometer-linkage / rate-model / purpose-taxonomy / free-text-vs-GPS / build-
   order calls). A NORTH_STAR horizon item; the LOWEST-architectural-risk of the 3 unspecced (additive `trips` table mirroring
   odometerEntries; NO ownership-model change [unlike vehicle-sharing]; NO external dep [unlike receipt-OCR vision API]; free-text
   location only, GPS deferred to a v2). Killer use case = business-mileage / reimbursement report. Grounded C165 vs the real
   schema (odometerEntries:344) + every established pattern (userId-scope, validateXOwnership C160, backup round-trip C145/C146 +
   coverage guards, analytics groupByVehicle div-guard, #46 distance clamp, C61/#39 tz dates). **KEY: a GOOD unblock candidate —
   T1–T5 (schema/repo/routes/backup/analytics) are loop-buildable backend-first, only T6 UI is eyes-on; unlike the 3 in-flight
   features that are backend-DONE + eyes-on-tail-only.** Folded into the C164 horizon-steer escalation (non-blocking).

> NOTE (cycle 12): both feature builds are large, MULTI-TASK efforts — one tasks.md task per loop
> cycle, not one-and-done. They no longer gate the loop; pull T1 of the higher-value
> maintenance-schedule next time `feature` is the balance pick. Also new: standing TODO Misc goal —
> raise test coverage to 90% (frontend ~59% / backend ~74% today); fold into bug/guard/arch cycles.
>
> **FEATURE DoD (loop-improvement #3): a feature is NOT done until one E2E exercises the real
> FE→BE→DB→render round trip for the new capability** — not just backend HTTP tests + frontend
> unit tests in isolation. Integrated UI/backend bugs (reminderApi.create called from nowhere
> cyc 151–165; the FE-sends-`undefined`/BE-skips clear-field class) hide precisely in the seam
> the round-trip E2E covers. If the E2E is Playwright-sandbox-blocked here, the task stays at
> "code-complete, T9/eyes-on pending" (as maintenance T7–T9 are) — it does NOT count as done,
> and the gap is logged so a human (or an unblocked harness) closes it.

### deep-review
1. **Eyes-on sweep: vehicle Overview tab + ExpensesTable populated states** (mobile +
   desktop) — code-reviewed C3 (findings below); still wants a real eyes-on screenshot pass.
2. **Analytics route eyes-on** (per-vehicle + cross-vehicle + year-end), states + a11y. *(C185: the BACKEND HTTP layer is now
   audited + covered — analytics-routes-http.test.ts certified the ownership guards fire [foreign vehicleId → 404, no cross-tenant
   analytics leak] + auth-gating + envelope, analytics/routes.ts 15→59% func. The remaining piece is the eyes-on UI render — Playwright-blocked.)*
3. **Pin `getFinancing` / financing-analytics math (TRACED C77, needs an arch DI first).** The financing
   analytics path (`analytics/repository.ts` getFinancing → buildFinancingDetails → buildSingleFinancingDetail)
   is effectively UNPINNED: its only test (cross-vehicle.property.test.ts "Property 23") is `test.skip`'d
   because getFinancing dynamically imports the `financingRepository` SINGLETON and calls
   `computeBalance(id)`, which binds to `getDb()` (the real connection), NOT the test's in-memory drizzle —
   so the C73 insurance approach (new AnalyticsRepository(testDb.drizzle)) can't reach it. The real math
   carries bug surface: `monthlyInterestEstimate = computedBalance*(apr/100)/12` (the C44-renamed field),
   `monthsRemaining = max(0, termMonths − monthsElapsed)`, unfinanced→'own' classification. TO UNBLOCK
   (arch, needs sign-off — bigger than one cycle): either DI `financingRepository` into AnalyticsRepository,
   or give `computeBalance` an optional-db param, so the in-memory harness can drive it; THEN un-skip
   Property 23 + add the math characterization. Filed as a traced finding (the C54 pattern) rather than
   forcing an awkward singleton-bound test this cycle.

> **NOTE → T3 wiring (surfaced by the C60 import-mapping audit, for when import-trackers T3 lands):**
> (a) `applyMapping`'s `target` param DEFAULTS to `{}` — if T3 passes `mapping.distanceUnit`/`volumeUnit`
> (the FILE's units) but forgets `target` (the vehicle's units), values store UNCONVERTED yet labeled as
> the vehicle's unit → silent unit corruption. T3 must always pass the resolved target vehicle's units.
> (b) `normalizeDecimal` treats a lone comma as a DECIMAL separator unconditionally, so a US-thousands
> value (`"1,234"`) becomes `1.234`. Fine for presets (comma-as-thousands handled at the preset layer),
> but a *manual* mapping of a US-thousands file would corrupt amounts — consider a `decimalSeparator`
> hint on `ColumnMapping` if manual mapping ships before presets cover it.

- ~~**Vehicle lifecycle vein audit (C179)**~~ — *DONE C179: inline audit (spawn_run hit an HTTP 400 transport failure → did it
  firsthand, higher-fidelity anyway) of vehicles/routes.ts + repository.ts. CERTIFIED CLEAN: (1) DELETE /:id avoids the C167 orphan
  class — cleans vehicle + expense + odometer photos (no-FK table) before delete, then DB FK-cascade handles the rest; VERIFIED every
  vehicle-child FK is `onDelete:'cascade'` (schema:70/159/210/352/482; insurance_claims `set null` by design) AND `PRAGMA foreign_keys
  = ON` on the prod connection (connection.ts:28) so the cascade FIRES; (2) PUT updateVehicleSchema is SAFE from the C31/C41 clobber
  class — proved firsthand `parse({})` injects `[]` (drizzle-zod doesn't surface the 4 .default() cols as Zod defaults). The one
  finding → a guard increment: the C41 net didn't cover updateVehicleSchema (highest-risk createInsertSchema instance) → exported it +
  added to partial-update-no-default-injection.test.ts (5 pass). green→green 1228 pass (+1).*
- ~~**Odometer write-path + recheck-seam vein audit (C180)**~~ — *DONE C180 (inline, the C179-carried-over vein): audited
  odometer/routes.ts + repository.ts. CERTIFIED CLEAN firsthand: PUT updateSchema's field-level future-date .refine SURVIVES
  .partial() (probed), negative-odometer rejected, empty-update no-op (C41-safe); getHistory + getCurrentOdometer userId-scoped
  (C168), correct UNION/MAX. PUT-recheck gap = the documented D5 by-design choice (#17), not a defect. THE FINDING → #48 completion:
  findByVehicleIdPaginated (backs GET /:vehicleId) filtered vehicle_id ALONE on both data+count legs — the leg C168's #48 sweep
  MISSED. Added userId param + ANDed eq(userId) into both legs + threaded user.id through the route; +3 tests incl. the cross-tenant
  case. green→green 1231 pass (+3). **#48 sweep now COMPLETE — all 3 odometer read methods userId-scoped.**)*
- ~~**Certify financing math + split/cascade primitives; pin source-survives-edit (C101)**~~ — *DONE C101: 2-agent
  fan-out on fresh backend-correctness surfaces. (A) Financing/loan balance + amortization math AUDIT-CLEAN — computeBalance
  is payment-history-based (max(0, original−Σpayments), not naive amortization), buildAmortizationSchedule decrements
  properly (bug #10 fixed), div-by-zero guarded; 1 cosmetic monthsElapsed day-of-month finding (no displayed-$ impact, not
  filed). (B) Split edit/delete + clearSource/deleteBySource CERTIFIED — both userId-scoped, clearSource keeps rows +
  deleteBySource removes rows+photos in a txn (verified repository.ts:483-553). 2 agent "CRITICAL/MAJOR" flags were FALSE
  HIGHs (absolute-sum validated by Zod at the API layer; percentage penny-to-last is standard). The 1 genuine finding: a
  reminder-linked split's sourceType/sourceId survives updateSplitExpense (copied from firstOld) but was UNPINNED — and T3
  cascade-delete keys on sourceId. Closed with a deterministic test in expense-repository.property.test.ts (create
  sourceType:'reminder' split → edit 2→3 vehicles → assert source link persists on new siblings + DB rows). validate:local
  EXIT 0 (1110 pass, +1). De-risks recurring-expenses T2/T3.*
- ~~**Characterize `withTimeout` (0%-coverage utility, C82)**~~ — *DONE C82: steered by the C81 coverage
  baseline to a concrete 0%-covered module. `utils/timeout.ts` (withTimeout + OPERATION_TIMEOUTS) is live in
  the sync backup path (backup-orchestrator, sync/routes) — a hung Drive/Sheets call must fail as a typed
  SyncError, not hang. Pinned the 3 race outcomes (value-resolves-wins / timeout→SyncError(NETWORK_ERROR)
  with the "op timed out after Nms" message / the promise's OWN rejection wins — a real error isn't masked
  as a timeout) + the 5 OPERATION_TIMEOUTS constants. Small real timeouts (10ms vs 200ms margins), no
  fake-timer dep, deterministic. timeout.ts 0%→covered. 1055 BE pass (+5). cov: be ~78% / fe 63.7%.*
- ~~**Insurance analytics (getInsurance/buildInsuranceDetails) audit (C73)**~~ — *DONE C73: the
  insurance-analytics path had ZERO test coverage. Read against source: cost-shape handling correct (bug #8
  effectiveMonthlyPremium — monthly + amortized-total both non-zero), latest-term-by-endDate selection +
  inactive-policy exclusion correct. CONFIRMED the open #14 behavior (an expired latest term on an active
  policy still counts toward current premium — buildInsuranceDetails never checks endDate >= now). Pinned the
  CURRENT behavior (incl. the #14 expired-term case, flagged as the one to flip when Angelo decides) via
  insurance-details.test.ts (6 cases through public getInsurance over a real DB). NOTE-also-spotted (not
  fixed, no decision): coveredVehicleIds spans ALL terms' junctions not just the latest term's — a vehicle
  dropped from the current term but on an old one still shows. 1044 BE pass (+6).*
- ~~**analytics-charts.ts unpinned-builders audit (C67)**~~ — *DONE C67: fan-out (2 Explore agents) +
  direct read of 6 date/bucketing builders with ZERO test references (buildDayOfWeekPatterns,
  buildSeasonalEfficiency, buildMonthlyCostHeatmap, computeRegularityScore, computeMileageScore,
  computePreviousYearComparison) — the historical analytics defect class. Verdict: CORRECT. Both agents
  flagged `accumulateIntervalBuckets` in-place `.sort()` as a HIGH cross-chart bug; VERIFIED against source
  (C21/C60 rule) and DOWNGRADED — it sorts a freshly-grouped LOCAL array, not the caller's fuelRows (the
  route passes the same fuelRows to buildDayOfWeekPatterns, which is order-independent anyway), so no
  observable bug. Applied a defensive `[...vehicleRows].sort()` (behavior-identical hygiene) + locked all
  6 with characterization tests (analytics-charts-unpinned.test.ts, 15 cases: empty/single-elem no-NaN,
  divide-by-zero guards, the newest-24-months slice direction, the no-mutation invariant). 1021 BE pass (+15).*
- ~~**C58 import-mapping.ts backend audit (C60)**~~ — *DONE C60: adversarial read of the freshly-landed
  (self-authored, un-reviewed) translation pre-pass. Verdict: CORRECT for its documented contract. Locked
  two verified-but-uncovered branches with characterization guards (NORTH_STAR #5): ISO-with-explicit-tz
  honored as an absolute instant (the one date branch that must NOT use local-time construction), and the
  non-finite-mapped-value → defer-to-buildImportPlan-per-row-error contract (mapVolume/mapMileage don't
  throw on garbage). +3 tests (987→990). Surfaced two T3-wiring risks (noted above), neither a C58 defect.*
- ~~**Backend: Sheets restore path**~~ — *DONE C3: found + fixed the clientId column-drop
  data-loss bug; added the schema-vs-headers coverage guard. CSV path confirmed safe.*

- ~~**FE↔BE contract-drift lock on the /stats response (C55)**~~ — *DONE C55: implements loop-improvement
  proposal #2 for the freshest surface. The /stats response is hand-assembled in routes.ts
  (`c.json({ period, ...stats, currentOdometer })`) with NO type binding to the frontend `VehicleStats`
  contract — backend `calculateVehicleStats` returns 11 fields, the route adds period + currentOdometer
  separately (C52 widened this). 3 HTTP cases in vehicle-stats-current-odometer.test.ts assert
  `Object.keys(data).sort()` EXACTLY equals the 13-field frontend contract (bidirectional: dropped OR
  unmirrored-added key both fail; shape-stable across empty/populated + all 5 periods). 969 BE pass.
  FUTURE: generalize to other hand-assembled multi-field responses (the proposal's broader intent).*
- ~~**Lock the frontend null-nextDueDate invariant (C48)**~~ — *DONE C48: extracted null-safe
  `isReminderTimeDue` + `isMileageTracking` to `reminder-helpers.ts`, routed the /reminders page
  through them, pinned by `reminder-helpers.test.ts` (5, incl. the load-bearing "null nextDueDate is
  never time-due" — guards against a future `new Date(null)`=1970-epoch deref the C39 nullable type
  introduced). Behavior-preserving extraction.*
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

### guard
> **NEW STANDING ANGLE (C83): coverage-ratchet on the C81-named low spots.** With loop-improvement #2
> closed and the audit veins thin, a grounded non-churn guard pick is to steer at a low-covered, high-risk
> module (per the revived #4 rule). PRIORITIZE high-RISK pure logic over trivial passthroughs (e.g. SKIP
> `logger.ts` 75% — its only gaps are emoji-prefix wrappers, coverage theater). DONE: `timeout.ts` 0%→covered
> (C82), `pending-credentials.ts` 76%→100%/92% (C83, OAuth-store TTL/cleanup), `expenses/validation.ts`
> 50%→100%/100% (C84 — the split money-math refinements: %-sum=100, absolute-sum=total, source both-or-neither);
> `financing/hooks.ts` 0%→100% func (C85 — onFinancingDeactivated: payoff/delete SEVERS the source link on
> linked expenses but KEEPS the rows; remaining gap is the best-effort catch block, not cleanly inducible via
> the HTTP harness); `reminders/validation.ts` 64%→100%/100% (C87 — the 6 cross-field refinements:
> custom-frequency, expense-type, mileage-trigger D4 single-vehicle, date-range, split-config sums/match);
> `providers/routes.ts` 0%→covered HTTP (C91 — the GET/POST/PUT/DELETE characterization net: response key-shape
> of all 3 hand-assembled formatters + the credentials-never-echoed security invariant + auth/ownership/domain
> guards; ALSO the safety net for the C92 formatter dedup. Used an `s3` provider to dodge the fake-provider
> CONFIG-import-order gate — see LEDGER C91).
> `db/sql-helpers.ts` 33%→covered (C98 — the 3 dialect date fragments extractMonth/formatYearMonth/toDateTimeString,
> executed via real Drizzle selects over a seeded expense; pins the `unixepoch` invariant whose omission caused the
> blank-chart/$0-average + garbage-month bugs the doc comments record).
> `middleware/idempotency.ts` 43%→covered (C105 — the double-charge guard; +7 via a minimal-Hono app + a per-app
> handler-run counter: method gating (GET bypass), key gating (required→400 / optional→passthrough), cache-hit replay
> (handler NOT re-run), user-scoping (`${userId}:${key}` — no cross-user collision), the only-cache-2xx invariant
> (a 500 is NOT cached → re-run not replayed forever), and TTL expiry via setSystemTime).
> `middleware/rate-limit.ts` 60%→covered (C112 — the abuse guard; +5 via a minimal-Hono app with a fixed-key tiny-window
> limiter: window-open, up-to-limit pass, over-limit 429 with all 4 X-RateLimit-*/Retry-After headers + the
> RATE_LIMIT_EXCEEDED body, per-key isolation, window-reset via setSystemTime; + a precondition test asserting
> CONFIG.disableRateLimit===false so the net can't go vacuous — the C77/C91 trap). **Both middleware low spots now covered.**
> `frontend utils/memoize.ts` 0%→covered (C118 — the FIRST FE ratchet pick: memoizeMulti cache-hit/distinct-args/JSON-value
> identity/MAX_CACHE_SIZE eviction-cascade + debounce collapse-to-one-trailing-call via vi fake timers; +7. The gate caught
> a wrong eviction-model assumption — the code was right).
> `frontend vehicle-form-validation.ts` 15%→covered (C125 — the C124 FE report's lowest pure-logic module: the two
> DB-gating validators; +10 covering year boundary 1900..now+2, VIN regex+length band, the financing own-skip + loan-only
> APR band + term boundary).
> `frontend formatters.ts` 31%→well-covered (C130 — the two user-facing relative-time formatters + formatNumber/formatDate;
> +11 covering Today/Yesterday/days/weeks/months/years + Just-now/m/h/d buckets + the future-clamp Math.max(0,…) guards,
> all driven relative-to-now so they're host-independent).
> `frontend error-handling.ts` 34%→well-covered (C137 — the C124 top FE low spot + load-bearing: every page's catch routes
> through handleErrorWithNotification → handleApiError, the user-facing error copy; +8 covering the ApiError class + the 3-way
> handleApiError branch [VroomError→friendly-or-own / network-TypeError / unknown-fallback] + the error-code→friendly map +
> the notification side-effect, driven through the exported entry with the store mocked so assertions check the USER's message.
> extractErrorMessage was already pinned C90).
> `frontend api-client.ts` low→well-covered (C143 — THE most load-bearing FE module: every API call routes through
> request/requestFull; the 3 sibling tests all MOCK it so its internals were unexercised; +17 driving the REAL methods via a
> global.fetch stub — envelope unwrap incl. the `data:0` falsy-present edge, non-JSON/204 passthrough, all 3 error-message
> branches + array-details→validationErrors, FormData/Content-Type gating, getPaginated full-envelope, withPagination).
> `frontend expense-api.ts` service layer low→well-covered (C149 — the method→endpoint wiring + the backend↔frontend transform
> the methods drive [buildExpenseQuery was already pinned]; +13: getExpense amount/volume/charge-by-fuelType mapping, list
> getPaginated passthrough + per-row transform, create OMITS empty description / update sends NULL [the clear-field class],
> downloadExpensesCsv blob→anchor + non-ok throw, split/delete wiring).
> `middleware/body-limit.ts` 35%→covered (C156 — the C138-named backend low spot; the DoS guard wired live at app.ts:41 +
> sync/routes.ts:209 but only its happy path was hit; +7 via the C105/C112 minimal-Hono+handler-counter pattern: under→200,
> over→413 PAYLOAD_TOO_LARGE/handler-not-run/MB-message, EXACT-boundary passes (strict `>`), no-Content-Length passthrough
> (chunked gap), malformed-NaN passthrough, custom-message override, multi-MB formatting. **Backend middleware trio now all
> covered — idempotency C105 + rate-limit C112 + body-limit C156.**)
> `services/reminder-api.ts` 12%→covered (C163 — the FE service-layer sibling the C143/C149 ratchet left behind; the C134 test
> covered only 2 of 11 methods. +15 driving the other 9 [create/list/getById/update/delete/trigger/markServiced/getNotifications/
> markNotificationRead] + buildReminderQuery [the isActive!==undefined edge: `false` must survive] via the file-scoped vi.mock
> apiClient stub.)
> `services/settings-api.ts` 7%→covered (C169 — the LAST FE service-layer sibling; +11 driving all 9 methods + the load-bearing
> restoreFromProvider zip-vs-sheets body branch [zip includes fileRef, sheets OMITS it] + the Idempotency-Key header on both
> restore paths [double-restore guard] + listBackupsFromProvider encodeURIComponent + uploadBackup FormData + downloadBackup via
> apiClient.raw. tsc caught a real test-type bug [Partial<UserSettings> nested-object trap]. **FE SERVICE LAYER now 100%
> module-covered — api-client C143 + expense-api C149 + reminder-api C163 + settings-api C169 + error-handling C137.**)
> `sync/backup-orchestrator.ts` 0%→50% func (C181 — the data-safety backup core, worst-covered substantive BE module. ROOT CAUSE was
> COVERAGE THEATER: backup-orchestrator.test.ts RE-IMPLEMENTED the orchestrator's logic locally + asserted against the copies, never
> touching the real module [NORTH_STAR #5 anti-pattern]. FIX: extracted `filterEnabledProviders` + `needsZipGeneration` as exported
> pure fns + rewired execute() to call them, pointed the test at the REAL exports + 4 edge cases [empty config; strict `=== true`
> sheetsSyncEnabled; Sheets-only-no-ZIP; ZIP+Sheets-needs-ZIP]. execute()'s body stays getDb-singleton-bound [the deep-review #3 DI
> limit] → honestly documented, not falsely claimed. **WATCH FOR THIS PATTERN: a green test that re-implements logic locally is NOT
> coverage** — grep a 0%-covered module's test for local copies of its functions.)
> NEXT high-value low spots
> **(C152 re-measure — be 82.02% line / fe 70.09% line; FE STILL the bigger gap but closing — broke 70%):**
> backend — ~~`body-limit.ts`~~ DONE C156; ~~`backup-orchestrator.ts` 0%~~ now 50% func C181 (execute() body still DI-blocked);
> ~~`analytics/routes.ts` 15%~~ now 58.82% func / 59.40% line C185 (analytics-routes-http.test.ts +8 driving the REAL routes via
> createTestApp — auth 401, the vehicle-scoped ownership-guard 404s [C109/#52 cross-tenant], the optional-vehicleId branch, the success
> envelope; ALSO certified the analytics-route ownership guards clean as a deep-review). ~~`sync/routes.ts` 50%/31%~~ now 72% func /
> 59% line C188 (sync-route-success.test.ts +7 — the success/derivation handlers the C30/C36 error tests didn't reach: GET /status flag
> derivation, GET /restore/providers sourceTypes zip/sheets logic + skip branches, POST / no-provider success; the byte/provider-bound
> paths [download, restore-from-provider/backup] deliberately left — C163 mock-trap territory). REMAINING named BE low spot:
> `activity-tracker.ts` (53%/44%, but timer/setInterval-bound — less clean). NOTE (C163): `restore.ts:160-246` (restoreFromSheets) is
> uncovered but needs a process-global Sheets-service mock — NO sync test uses mock.module (the C38/C91 cross-suite-flake trap), so it's
> NOT a clean guard pick; defer until a DI seam exists or accept the gap. FRONTEND — the FE SERVICE layer is now FULLY covered (C137/C143/C149/C163);
> the remaining FE gap is the **components/routes deficit** (largely eyes-on — prefer the few pure-`.ts`
> `.svelte.ts`/store/util modules still thin, e.g. settings.svelte.ts 10% [but that's the filed handleError arch pick] /
> sync-manager.ts 58%). ~~pwa.ts 56%~~ DONE C175 — getPlatformInfo() (the file's only pure branching logic) 0%→covered + the
> promptInstall accept/dismiss branches the old suite admitted it couldn't reach; +10 (iPad-MacIntel-touch masquerade, Opera-not-
> Chromium !/OPR/, the maxTouchPoints>1 desktop negative control). (SKIP navigation.ts — thin goto
> wrappers, coverage theater.) Route/
> integration files need the full HTTP harness — but C91 PROVED the createTestApp harness makes them tractable
> (the `s3` seam sidesteps real OAuth), so a route file IS a fair coverage pick when it doubles as an arch
> safety-net (as providers did). Pick one high-value module per cycle when guard is the balance. (Verified C85:
> the 0%-coverage files — financing/hooks, auth/providers/*, *routes.ts — are all LIVE-but-hard-to-test, NOT
> dead code, so there's no dead-code arch removal hiding there.)
- ~~**Generalize the FE↔BE contract-drift guard to every hand-assembled response (loop-improvement #2) —
   COMPLETE (C80).**~~ — *A route that hand-builds its JSON with no type binding to the frontend contract
   silently drifts when a field is added/dropped/renamed (the `.optional()`-vs-`.nullish()`, dropped-clientId,
   interestPaidYtd-rename family). ALL hand-assembled response surfaces are now key-shape locked vs their
   named frontend contract: `/stats` (C55), `/vehicles` list enriched financing (C62), single-financing GET
   (C68), `/analytics/insurance` (C74), `/analytics/year-end` (C78), and `/analytics` per-vehicle
   getVehicleHealth (C80 — the last one). VERIFIED the non-targets too: `/reminders` + `/expenses` page are
   CLEAN repository pass-throughs (no route-injected fields → not drift surfaces). Proposal #2 fully landed.
   FUTURE: when a NEW hand-assembled response is added, lock it in the same cycle (now the established pattern).*

### bug
> ~~**Lease/loan miles-used consume the period-scoped `currentMileage`** (traced C54, APPROVED Angelo C151)~~ — *DONE C157
> (CODE-COMPLETE, EYES-ON-PENDING for the FinanceTab visual). `FinanceTab.svelte` fed `vehicleStatsData?.currentMileage`
> (period-scoped + fuel-only — shrinks under a 7d/30d stats selection, ignores manual odometer entries) into both
> `PaymentMetricsGrid` (loan mileageUsed) + `LeaseMetricsCard` (lease overage → excess-fee $), silently understating both under
> a non-'all' period. FIX (verified semantics vs source — VehicleStats type + GET /stats both document currentOdometer as the
> canonical ALL-TIME, all-sources, period-INDEPENDENT reading, C52): swap both sites to `currentOdometer`. Extracted a pure
> `resolveCurrentOdometer(currentOdometer, currentMileage, initialMileage)` helper (financing-calculations.ts) so both sites
> derive identically + the logic is unit-testable (the .svelte render is eyes-on). +5 tests pinning the selection contract
> (currentOdometer wins over a lower period-scoped currentMileage; fallbacks; `??`-not-`||` zero-reading honored). green→green
> frontend validate:local EXIT 0, 475 pass (+5). Only the FinanceTab visual render remains eyes-on (Playwright-blocked).*

> ~~**#27 (HIGH, the loop's first; found+VERIFIED C120, escalated, APPROVED by Angelo C151) — TCO double-counts a financed
> vehicle's principal.**~~ — *DONE C154 (Angelo-approved option c). `getVehicleTCO` summed `purchasePrice` + the `financingInterest`
> bucket, but that bucket sums WHOLE financing-sourced rows (full loan payments = principal + interest, proven by computeBalance =
> originalAmount − SUM(financing expenseAmount), financing/repository.ts:68) → a $30k car + ~$33k payments reported TCO ≈ $63k. FIX
> (implemented as a CONDITIONAL — the key subtlety): exclude the financing-payment rows from the total ONLY when purchasePrice is
> counted (they retire the already-counted price); when purchasePrice is NOT counted (no price, or a year-scoped view per #28), the
> financing outflow IS the cost signal → keep it (an unconditional exclude would have NEW-undercounted an unpriced financed vehicle).
> Extracted `computeTCOTotal(costs, purchasePrice, year)` (also dropped getVehicleTCO complexity 16→<15); report the financing
> bucket as the COUNTED value (0 when excluded) so the breakdown stays internally consistent (Property 14 / Req 10.2). +2
> regression tests (the double-count had ZERO coverage — Property 14's generator never emits sourceType:'financing'). green→green
> 1194 pass (+2).*

> **#36 (HIGH, found + VERIFIED C132; ESCALATED) — Sheets backup writes with `USER_ENTERED` → formula injection +
> silent round-trip corruption.** `google-sheets-service.ts` `updateSheet` writes `valueInputOption: 'USER_ENTERED'`
> (:605) and `formatValue` (:610-616) does NO leading-token neutralization (`return String(value)`). So Sheets PARSES every
> cell as if typed: a user's `expenses.description = "=1+1"` is EVALUATED to `2` (read back as 2 → silent data mutation on
> round-trip), and `=IMPORTRANGE`/`=HYPERLINK`/`=IMAGE` formulas EXECUTE on open (injection; self-affecting but real). FIX
> (one line, closes BOTH): `valueInputOption: 'RAW'` preserves literals losslessly + disables formula evaluation. Likely the
> next bug-cycle pick — but it's a security + backup-fidelity change, so ARCC-consult first (the secure-coding / output-
> encoding angle). The CSV export path (backup.ts convertToCSV) is also unguarded but lower-risk (no live evaluation).
> **#37 (HIGH, found + VERIFIED C132; ESCALATED) — Sheets backup is a non-atomic in-place rewrite that can destroy the only
> good copy.** `updateSheet` does `clear(A:Z)` (:592) THEN `update` (:602) per tab, all 15 tabs in a `Promise.all` (:526),
> over the SINGLE reused backup spreadsheet (found-or-reused, NOT versioned — unlike the ZIP path which retains copies). A
> mid-flight failure (failed update after a succeeded clear) leaves an EMPTY/half-written tab AND has already overwritten the
> prior good backup → restore would silently apply a truncated dataset. FIX: write to a fresh spreadsheet (or staging tabs)
> + swap only after all 15 writes succeed, or batch all ranges into ONE `values.batchUpdate` (atomic API call). Bigger than
> a one-liner → likely needs an approach call. (NOTE: the restore READ derives userId from the first vehicle row :694 — the
> C108 audit confirmed restore.ts validateUserId gates it, so not a cross-tenant hole, but worth keeping in view.)

**NEW — surfaced + verified-against-source by the C108 deep-review fan-out (restore + mileage paths). All MED, none HIGH; none data-safety on the WRITE path (cross-tenant write-stamp + atomicity + the 5 mileage classes were CERTIFIED CLEAN). Unblocked — ranked for a future bug cycle:**
- ~~**#20 (MED) — `detectConflicts` is not tenant-scoped → cross-tenant READ leak in merge mode.**~~ — *DONE C109:
  detectConflicts probed `WHERE id IN (backup ids)` with no ownership filter + returned the full existing row as
  `localData` in the merge `conflicts` response, so a colliding id surfaced another tenant's row (VIN/amounts) — same class
  as the C145 write-stamp. FIX: threaded `userId` in + a per-table `scope` predicate — eq(table.userId, userId) for the 4
  userId-direct tables (vehicles/expenses/insurancePolicies/photos); inArray(fk, ownedParentIds) for financing (vehicleId)
  + photoRefs (photoId), owned-parent ids fetched once; folded into `where(and(inArray(table.id, ids), scope))`. Re-verified
  the schema ownership columns vs source first (C67). MERGE-SURVIVING net: restore-conflict-tenant-scope.test.ts (+2) — a
  cross-tenant id collision leaks nothing (victim's row never echoed, untouched in DB, post-fix merge correctly hits the PK
  constraint not an overwrite) + a self-collision still reports a conflict (feature intact). validate:local EXIT 0, 1123
  pass (+2). Low exploitability (cuid2 ids) but the tenant-isolation gap is closed at the query.*
- ~~**#21 (MED) — replace-mode + an empty-but-valid backup = silent TOTAL data wipe.**~~ — *DONE C136 (the DECIDED half):
  re-VERIFIED vs source — validateBackupData (backup.ts:523) checks only metadata + per-row schema + referential integrity, so
  an empty-but-valid backup (every data array empty) passes clean; a `replace` restore then deleteUserData-wipes everything +
  insertBackupData-inserts-nothing, atomically committing the empty state (NORTH_STAR #1 violation, on BOTH restoreFromBackup
  ZIP + restoreFromSheets). FIX: private `assertReplaceNotEmpty(summary, mode)` sums all ImportSummary row-counts, throws
  SyncError(VALIDATION_ERROR) on a 0-row replace; wired into both methods after the merge check, before the txn (one chokepoint
  — both build the identical summary). preview/merge unaffected. restore-empty-replace-guard.test.ts (+4): empty replace throws
  + existing vehicle SURVIVES (load-bearing) + preview/merge controls + non-empty replace still works. validate:local EXIT 0,
  1164 pass (+4).* **STILL FILED (the product-decision half): the partial-SHRINK guard** — reject a replace whose payload is
  implausibly SMALLER than current (e.g. 3 rows replacing 3000), not just empty. Needs Angelo's call on how aggressive a shrink
  to block (a legit large delete is a valid replace). The empty case is now closed; the shrink case is a separate threshold.
- **#22 (MED, hardening) — zip-bomb guard trusts the attacker-declared `header.size`.** `backup.ts:469` sums
  `e.header?.size` from the ZIP central directory (attacker-controlled in an uploaded archive) and checks it before
  `getData()`. A forged archive can declare a small size while the deflate stream inflates large. The 50MB COMPRESSED
  bodyLimit (routes.ts:209) is the real backstop on the UPLOAD path — but the provider DOWNLOAD path (downloadBackup) has
  no such cap, relying solely on this spoofable check. FIX: enforce a hard running byte-cap DURING inflation, not from the
  declared size. VERIFIED against source C108.
- **Mileage Findings A/B (MED → delayed-fire only, NOT lost) — no IMMEDIATE recheck on PUT-update.** Editing an expense's
  mileage (expenses/routes.ts PUT /:id) or a manual odometer entry (odometer/routes.ts PUT /:id) to push a vehicle past a
  milestone does NOT call `recheckMileageReminders` (recheck is wired only on CREATE). The crossed reminder fires on the
  next periodic /trigger or login pass — eventually-consistent, nothing permanently lost, so the D5 "fires the moment
  crossed" guarantee silently doesn't hold for edits. FIX: add the same best-effort recheck after both update paths.
  VERIFIED against source C108. (The 5 hunted mileage defect classes — double-fire, boundary, cross-vehicle, stale, throw —
  were all CERTIFIED CLEAN.)

**NEW — surfaced + verified-against-source by the C114 deep-review fan-out (CSV-import + insurance-cost paths). All MED/LOW, none HIGH; the strong parts of both paths were CERTIFIED CLEAN (CSV: cross-tenant vehicle resolution, userId double-stamp, txn atomicity, idempotency, injection-on-export, C61 local-day; insurance: div-by-zero guarded, no monthly-vs-total double-count, aggregate totals correct). Unblocked — ranked for a future bug cycle:**
- ~~**#23 (MED) — CSV import: an out-of-range month/day silently ROLLS OVER instead of erroring.**~~ — *DONE C115:
  normalizeForeignDate validated only integer-ness then `new Date(year, month-1, day)` — JS rolls out-of-range parts over
  (13/45/2024 → ~3.7yr later; wrong-format 25/03 rolled forward; Feb 30 → March; "2024--15" → Dec 2023), all stored
  silently. FIX: an ECHO-CHECK extracted into `buildLocalDate(...)→Date|null` — construct the local Date, verify
  getFullYear/getMonth/getDate match the input; on mismatch return the RAW string so buildImportPlan's parseDate reports a
  clean per-row "Invalid date" (the deferred-error contract). The helper extraction also fixed the biome complexity ceiling
  the inline guard tripped. +4 tests (out-of-range/Feb-30/empty-segment return raw; valid date still normalizes — the
  over-reject guard); host-independent. validate:local EXIT 0, 1142 pass (+4).*
- **#24 (MED — needs a product decision) — CSV import: comma-as-thousands corrupts numbers.** `normalizeDecimal`
  (import-mapping.ts:139-147) treats a lone comma as the decimal separator, so a US-style `"1,234"` (thousands, no decimal)
  → `"1.234"` → 1.234, which is finite+positive so `parseAmount` accepts it — a $1,234 expense imports as $1.23 (same for
  volume/mileage). VERIFIED C114. This is the ratified decimal-comma design choice (a lone comma IS decimal); the harm is a
  manually-mapped US-thousands file. DECISION: add a per-file "decimal separator" hint to the mapping (dot vs comma), or
  detect-and-warn — needs Angelo's call on scope before a fix.
- ~~**#25 (MED) — insurance per-vehicle attribution: LATEST-term premium ÷ ALL-terms vehicle count.**~~ — *DONE C178: VERIFIED
  firsthand vs source — analytics/repository.ts:924 `monthlyPremium = effectiveMonthlyPremium(latestTerm)` (latest term only) but
  :926 built `coveredVehicleIds` from `junctionRows.filter(j => policyTerms.some(t => t.id === j.termId))` (EVERY term's junctions),
  then :977 `perVehicleMonthly = monthlyPremium / coveredVehicleIds.length`. So when coverage CHANGED across terms (old {A,B,C},
  latest {A}): A understated 3×, dropped B+C got phantom premium/3, costByCarrier.vehicleCount over-reported. Aggregate
  totalMonthly/Annual CORRECT (added once per policy) — a mis-DISTRIBUTION. FIX (one-line, non-gated): scope the filter to
  `j.termId === latestTerm.id` (the term the premium came from), so divisor + attribution match it. +2 tests (the #25 regression:
  old {veh-1,veh-2} + latest {veh-1} @ $120 → only veh-1 @ full $120, carrier count 1; + an unchanged-coverage control proving the
  normal multi-vehicle split still splits). green→green 1227 pass (+2).*
- **#26 (LOW, insurance nuances, C114) — (c) DONE C184; (a)+(b) remain.** three small ones, none data-safety: (a) totalCost
  amortization + monthly trend use `monthKeysInRange` which is INCLUSIVE of both endpoint months, so a 6-mo policy entered as
  Jan 1→Jul 1 (renewal-day endDate) amortizes over 7 months (internally consistent — totals reconcile — but a ±1-day data-entry
  choice shifts the displayed monthly premium); (b) an open-ended (null endDate) `monthlyCost` term contributes to totals but is
  DROPPED from monthlyPremiumTrend (accumulateMonthlyPremiums returns early on null endDate) AND sorts LAST in the latest-term race
  (null endDate → 0). All VERIFIED C114. ~~(c) findExpiringTerms has no `isActive` filter, so terms of cancelled policies show as
  "expiring."~~ — *DONE C184: VERIFIED firsthand — `findExpiringTerms` (repository.ts:703, backs GET /expiring-soon) filtered
  endDate-BETWEEN + userId but NOT isActive → a cancelled policy's in-range term still nagged "renew soon." FIX: ANDed
  `eq(insurancePolicies.isActive, true)` (the :741 per-vehicle-coverage pattern); behavior-preserving for active policies. +1 test
  (cancelled-policy term excluded while a same-window active term still shows). green→green 1237 pass (+1).*

**NEW — surfaced + verified-against-source by the C120 deep-review fan-out (TCO aggregation + offline-sync). #27 (HIGH) is in the PENDING ANGELO block above (accounting decision); these two are unblocked MED:**
- ~~**#28 (MED) — TCO `purchasePrice`/`ownershipMonths` ignore the year window.**~~ — *DONE C121: getVehicleTCO
  window-filtered the expenses when `year` was set but added `purchasePrice` to totalCost UNCONDITIONALLY + computed
  ownershipMonths as purchaseDate→now (never year-bounded), so a 2024 TCO absorbed the full lifetime purchase price ÷
  full-ownership months. FIX (two matched halves): (1) `includePurchase = !year` — purchasePrice (a one-time acquisition
  cost) only in the all-time total; (2) extracted + exported `monthsOwnedInYear(ownershipStart, now, year)` (pure, injected
  now → host-independent) for the year-scoped divisor so costPerMonth divides by a matching ≤12-mo span. +6 unit tests
  (tco-months-owned.test.ts: full-year=12, mid-year=6, in-progress=3, future=0, before-ownership=0, single-month=1).
  validate:local EXIT 0, 1151 pass (+6). NOTE: #27 (principal double-count) is the SAME function + still Angelo-gated.*
- **#29 (MED, design call) — silent last-writer-wins on PUT (no optimistic-concurrency guard).** `BaseRepository.update`
  (utils/repository.ts:62-66) keys the UPDATE on `id` ONLY — it WRITES `updatedAt` but never READS it as a guard. So an
  offline edit (queued T0) replayed after an online edit (committed T1>T0) to the same row silently overwrites the newer
  values with stale ones, no 409, no conflict signal (`expense` PUT is not idempotency-keyed — clientId is stripped from
  updates; the Idempotency-Key mw is only on sync/restore routes; detectConflicts is restore-only). VERIFIED C120. LWW is a
  legitimate PWA model, but undocumented + no signal — DECISION: keep LWW (document it) or add an `updatedAt`/version
  precondition to PUT (WHERE id=? AND updated_at=?) + 409 on mismatch. (CERTIFIED CLEAN this cycle: TCO split/insurance/
  sign/div-by-zero/unit; sync idempotent-return dedup, (userId,clientId) scoping, per-row outbox, userId stamping.)

**NEW — surfaced + verified-against-source by the C126 deep-review fan-out (auth/session + fuel-efficiency). AUTH = WELL-HARDENED (no HIGH/MED, consistent with C56); FUEL = no HIGH (every divide guarded, missed-fillup dropped, first-row excluded, convertEfficiency direction correct). The findings, ranked:**
- **#30 (MED, scope-gated) — the fuel-efficiency OUTLIER FILTER is unit-unaware.** `analytics-charts.ts:8-10`
  `MAX_REASONABLE_MILES_BETWEEN_FILLUPS=1000` / `MIN_VALID_MPG=5` / `MAX_VALID_MPG=100` are IMPERIAL constants (the comment
  says "must match frontend expense-helpers.ts"), but they're applied to NATIVE stored values BEFORE unit conversion
  (`isRealisticEfficiency:106` on the km/L value computed `:121`; `validMilesBetween:431` on the raw km delta). So a
  metric-storing vehicle gets a mis-shaped filter: a thirsty truck ~9.4 mpg ≈ 4 km/L is wrongly dropped as `<5`, and a legit
  >1000 km inter-fillup gap is dropped. Aggregate arithmetic is still correct; only the OUTLIER cull is mis-calibrated.
  VERIFIED C126. **SCOPE CONFIRM NEEDED before any fix:** does VROOM store per-vehicle native units (then this is reachable)
  or convert-to-canonical on write (then it's moot)? AND it's a shared FE/BE invariant (the same constants live in
  expense-helpers.ts) — a fix must touch both or it drifts. Not a clean unilateral fix → needs the scope call.
- **#31 (LOW-MED) — fuel pair ordering is by DATE, not odometer.** Every pairing path sorts by `date.getTime()` then pairs
  consecutive rows; the math assumes odometer increases with date. A backdated entry (or two same-date fillups in
  odometer-descending order) yields a non-positive delta → SAFELY DROPPED by the `miles <= 0` guard (no wrong value reaches a
  chart/average), but a legitimate interval is silently lost. VERIFIED C126. FIX (if desired): sort each vehicle's rows by
  `(mileage ?? date)` before pairing, or pair by odometer order. Low urgency — guards prevent any incorrect output.
- **#32 (LOW ×3, auth hygiene — none exploitable). (a) DONE C127; (b)+(c) remain.** ~~(a) `/me` + `/refresh` throw 401 on a
  bad session but skip `deleteCookie`~~ — *DONE C127: added the canonical deleteCookie (mirroring the logout handler) before
  the 401 throw at both sites; ARCC-grounded (secure_cookie_handling / OWASP session-mgmt). +3 HTTP tests (garbage-session
  → 401 + clearing Set-Cookie; missing-cookie stays plain 401). validate:local EXIT 0, 1158 pass.* STILL OPEN:
  (b) `validateAndRefreshSession` (utils.ts:57-96) — if `invalidateSession` throws AFTER `createSession` succeeds, the catch
  returns the still-valid OLD session and the new one orphans until its 30-day expiry (same-user session sprawl, not a priv
  issue); (c) `resolveNewUser` (routes.ts:200-202) `auth_error=email_exists` reveals account existence — but only to a caller
  who already completed OAuth + proved they own that email, so no arbitrary enumeration (and no-merge is the correct
  anti-takeover posture; likely WONTFIX). VERIFIED C126.

**NEW — surfaced + verified-against-source by the C132 deep-review fan-out (photo-storage/credentials + Sheets-backup-write). The credential/crypto/cross-tenant cores were CERTIFIED CLEAN (encryption.ts textbook AES-256-GCM w/ per-call IV; secrets stripped; all ops userId-scoped). The 2 HIGHs (#36/#37, Sheets) are in the PENDING-ANGELO block above. Unblocked MEDs/LOW:**
- ~~**#35 (MED) — photo download lacks `X-Content-Type-Options: nosniff` + trusts client-asserted MIME.**~~ — *DONE C133:
  added `'X-Content-Type-Options': 'nosniff'` to the thumbnail-serve Response (photos/routes.ts). ARCC-consulted FIRST
  (Secure-HTTP-Headers makes nosniff MANDATORY; Secure-File-Uploads = "don't trust Content-Type / mitigate MIME sniff").
  Guard: photo-serve-headers.test.ts (+2 source-scan — the 200-byte-serve calls the real provider download(), not
  in-harness-testable, so pin the header literal in the serve block, per the no-*-source-scan convention). validate:local
  EXIT 0, 1160 pass. The deeper magic-byte upload sniffing (Apache-Tika-style) is the larger follow-on, NOT done — folds in
  with #34.*
- **#33 (MED) — delete-side external-byte orphans.** `photo-service.ts:257-275` deletes the provider bytes in a try/catch
  that only `logger.warn`s on failure, then UNCONDITIONALLY deletes the ref + photo row → if the provider delete fails
  (network/expired token) the S3/Drive object is orphaned AND the ref is gone (unreconcilable). Same in
  `deleteRefsFromProviders`. ALSO: DELETE /providers/:id (routes.ts:467-487) drops the provider + photoRefs but never the
  external bytes NOR the `photos` rows → dangling photo rows that 422 forever. VERIFIED C132. FIX: a reconcile/retry queue
  for failed external deletes, + cascade the photos rows on provider delete.
- **#34 (MED) — photo upload is not atomic.** `uploadPhotoForEntity` (photo-service.ts:62-91) does bytes→photo row→ref with
  no txn + no compensating delete: a DB failure after `provider.upload` orphans the external bytes; a ref-insert failure
  after the photo row leaves a 422 dangling row. FIX: wrap the 2 inserts in a txn + best-effort `provider.delete` the
  just-uploaded object on failure. VERIFIED C132.
- **#38 (LOW, latent) — Sheets write range hard-capped at `A:Z` (26 cols)** (google-sheets-service.ts:594 + the :604
  `String.fromCharCode(64 + headers.length)`); the widest table (reminders) is at 25 cols — a 27th column produces an
  invalid A1 ref (charCode 91 = `[`) and silently truncates the clear/write range. Not a bug today; guard before the next
  reminders/expenses column addition. VERIFIED C132.

**NEW — surfaced + verified-against-source by the C139 deep-review fan-out (dashboard headline math + expense-list query path). The fleetHealthScore/getQuickStats/getVehicleHealth core + the classic query traps (count-vs-list, hasMore/limit/offset, sortBy injection/DoS, tags-AND, list==export) were all CERTIFIED CLEAN. #39 (the data-correctness one) FIXED in-cycle; these two filed:**
- ~~**#39 (MED) — expense-list endDate boundary drops same-day rows.**~~ — *DONE C139: `buildExpenseConditions` used
  `lte(date, endDate)`, but the UI DatePicker sends a date-only YYYY-MM-DD → z.coerce.date() → LOCAL midnight (start of day),
  so a "through Mar 31" filter dropped every Mar-31 expense not at exactly midnight (C6/C61/C103 local-vs-UTC class; VERIFIED
  the FE sends date-only). FIX: `endOfDayIfDateOnly(d)` extends a local-midnight endDate to 23:59:59.999 local (inclusive whole
  day), honors a mid-day timestamp verbatim; host-independent; one chokepoint fixes list + CSV export (keeps list==export).
  date-range-boundary.test.ts (+5). validate:local EXIT 0, 1169 pass.*
- **#40 (MED, needs a product decision) — `buildVehicleRadar` ranks MISSING data as an EXTREME score.** analytics-charts.ts:
  706-760 — a vehicle with no data for a metric keeps its initialized 0, which `normalizeScore` then ranks against the fleet
  min/max: a never-serviced car → reliability 100 (inverted maintenanceCount=0 = "best"); a car with no fuel pairs →
  fuelEfficiency 0 (worst). So "I never logged it" reads as simultaneously best-reliability and worst-efficiency. VERIFIED C139.
  The core fleetHealthScore is UNAFFECTED (that path uses neutral-50 defaults, not this radar). This is a relative-comparison
  RADAR DISPLAY semantics call (how to render "no data" — exclude the vehicle / grey it / neutral-midpoint), not a mechanical
  correctness fix → needs a product decision before any change. Secondary analytics surface.
- ~~**#41 (LOW) — expense search doesn't escape LIKE wildcards `%`/`_`.**~~ — *DONE C142: scope-checked first — the ONLY
  user-input LIKE in product source is this one expenses search site (the 2 other LIKEs are test files with literal patterns),
  so it's a single-site fix not a class. `buildExpenseConditions` built `%${search}%` with no ESCAPE → "50%" matched every row
  containing "50", "oil_change" matched "oilXchange". FIX: escape `\`/`%`/`_` in the term (regex, backslash-first) + `ESCAPE '\'`
  on both LIKEs. +5 guards in search-paginated.test.ts (literal "50%"/`_`/bare-"%"/backslash + normal-search-still-works).
  validate:local EXIT 0, 1175 pass. Parameterized so never a security issue — this closed the over-matching UX.*

**NEW — surfaced + verified-against-source by the C144 deep-review fan-out (backup orchestration/scheduling + vehicle-stats/odometer). The scary concurrency paths (mutex check-then-act atomic, finally-release + TTL self-heal, Promise.allSettled per-provider isolation, withTimeout hang-cap) AND getCurrentOdometer (vehicle-scoped UNION, null-safe MAX, unit-consistent) were all CERTIFIED CLEAN. #42 (data-safety, clean) FIXED in-cycle; the rest filed:**
- ~~**#42 (HIGH, data-safety) — backup drops a data change made DURING the run.**~~ — *DONE C144: `updateSyncDate` stamped
  `lastSyncDate = new Date()` (END of run), but the ZIP snapshots the DB near the START; a long run (10min timeout) means an
  edit made after the snapshot but before the end-stamp gets `lastDataChangeDate < lastSyncDate` → hasChangesSinceLastSync false
  → silently dropped from ALL future backups (NORTH_STAR #1). FIX: `updateSyncDate(userId, syncedAt = new Date())` + the
  orchestrator passes its START `timestamp` (errs safe — at worst a redundant re-backup, never a lost change). +3 regression
  tests (settings-repository.property.test.ts: snapshot-stamp keeps a mid-run edit unsynced + a negative control). validate:local
  EXIT 0, 1178 pass.*
- **#43 (HIGH? — needs a decision) — ZIP upload fails but Sheets sync succeeds → the run is marked SUCCESS + won't retry.**
  backup-orchestrator.ts:80-92 + a provider with both `enabled` (ZIP) and `sheetsSyncEnabled`: if exportAsZip throws, zipBuffer
  stays null, the strategy's ZIP leg returns success:false but the Sheets leg succeeds → strategy `success = anySuccess` true →
  orchestrator sets lastBackupAt + advances lastSyncDate. So the user's actual DATA ARCHIVE (ZIP) failed to upload, the run reads
  as successful, and change-gating means the ZIP isn't retried until the next data change. `capabilities.zip.success=false` is in
  the payload but neither scheduling nor the route surfaces it. VERIFIED C144. DECISION: should a ZIP failure mark the whole run
  unsuccessful (so it retries), or surface a partial-success warning? Needs Angelo's call on backup success semantics + retry.
  **ARCC-GROUNDED (queried C144.5):** SAX-04 Outcome 1 sets `FailureModes.systemError → FAIL_SAFE` and lists "failing open
  instead of closed" as the #1 pitfall; Outcome 3 best-practice is "monitor + alert on backup failure with immediate
  notification." Reporting success when the data archive failed = failing OPEN → the policy-aligned resolution is the
  mark-unsuccessful/retry option (or at minimum surface a non-silent partial-failure warning), NOT silent success.
- **#44 (MED — needs a decision) — route returns 200 "Sync completed" when EVERY provider failed.** sync/routes.ts:86-95 — the
  orchestrator result has no top-level success flag; when all providers fail (anySuccess=false, nothing persists) the route still
  `createSuccessResponse(result, 'Sync completed')` → 200. The caller must inspect per-provider `results[*].success` to learn
  nothing backed up. VERIFIED C144. FIX (decision): add a top-level status ('ok'|'partial'|'failed') + non-2xx (or an explicit
  failure flag) when anySuccess===false. (Pairs naturally with #43 — both are "surface backup failure honestly" calls.)
  **ARCC-GROUNDED (C144.5):** same SAX-04 fail-closed / surface-failure posture — a 200 "completed" on a total failure is the
  fail-open pitfall; the policy direction is an explicit failure status, not a silent 200.
- **#49 (LOW) — activity-tracker `handleInactivity` finally clobbers a concurrent `recordActivity`.** activity-tracker.ts:67-83 —
  handleInactivity captures `activity` then in finally writes that OLD object back (syncInProgress=false); if recordActivity
  installed a fresh object during the awaited performAutoSync, its fresh lastActivity is reverted → can prematurely age out a
  user in cleanupInactiveUsers. Stale-state edge, not data loss. VERIFIED C144.
- **#45 (HIGH-ish, but a SEMANTICS decision — grouped with the gated currentMileage/lease-loan + "Current Mileage card" calls) —
  vehicle-stats totalMileage/costPerMile mix a period-FILTERED numerator with an ALL-TIME denominator.** vehicle-stats.ts:129-143
  — the /stats route passes period-filtered `fuelExpenses` but the unfiltered all-time `vehicle.initialMileage`, so for any
  period!=='all': totalMileage = (in-window MAX mileage) − (lifetime purchase odometer), and costPerMile = (in-window cost) /
  (lifetime miles) — a windowed numerator over an all-time denominator (e.g. a 7d view shows ~85,000 mi distance + a ~100×-too-low
  cost/mile). VERIFIED C144. This is the SAME period-scoped-stats semantics family as the already-filed Angelo-gated lease/loan
  `currentMileage` bug + the "Current Mileage card display-semantics" direction call — what SHOULD "cost/mile for the last 7 days"
  mean (in-window delta? all-time?). Decide the whole stats-period contract together; not a clean unilateral fix.
- ~~**#46 (MED) — negative `totalMileage` when the in-window max reading is below `initialMileage`.**~~ — *DONE C148:
  vehicle-stats.ts:138 `latestMileage - initialMileage` had no floor → a backdated/mistyped reading below initialMileage (e.g.
  45000 vs 50000) surfaced a NEGATIVE distance verbatim. FIX: `Math.max(0, latestMileage - initialMileage)` — correct under ANY
  #45 windowing (a driven distance is non-negative regardless), so no churn when #45 lands. +3 guards in
  vehicle-stats.property.test.ts (below→0 [the regression] + currentMileage still surfaced + costPerMile null; above→real
  positive; exact-boundary→0). validate:local EXIT 0, 1185 pass. (Chose the clamp over a data-warning — the negative was the
  defect; flagging the bad reading is a separate UX feature, not needed to fix the wrong number.)*
- **#47 (MED, partly by-design) — getCurrentOdometer MAX-by-value lets one typo'd high reading poison the reminder axis.**
  odometer/repository.ts:138-157 takes MAX(odometer) by VALUE not date (D2 design, pinned by get-current-odometer.test.ts), so a
  fuel/odometer row mistyped as 999999 makes getCurrentOdometer return 999999 FOREVER (until that row is corrected) → every
  mileage/`both` reminder fires immediately + mark-serviced/resolveMileageFields anchor to the bad value + lease/loan inflated. A
  separate later good reading does NOT fix it (only correcting the bad row does). VERIFIED C144. FIX (design): latest-by-date or a
  sanity-cap reconciliation — needs a call since MAX-by-value is the ratified D2 behavior.
- ~~**#48 (LOW, hardening) — getCurrentOdometer / getHistory are vehicle-scoped but NOT userId-scoped.**~~ — *DONE C168:
  odometer/repository.ts getCurrentOdometer (:138) + getHistory (:73) filtered on vehicle_id only (the C109/#52 tenant class) — no
  live leak (callers validate ownership first), but a latent boundary. FIX: added a userId param to both + ANDed `user_id =
  ${userId}` into every WHERE leg (6: 2 getCurrentOdometer + 4 getHistory incl. the COUNT subqueries); threaded userId through all
  5 production callers (reminders/routes ×2 via resolveMileageFields + trigger-service via reminder.userId + vehicles/routes
  /stats + odometer/routes history) + both test files. +1 cross-tenant regression test (another user's reading → null under our
  userId; owner still reads it). green→green 1211 pass (+1).* **COMPLETED C180: the C179→C180 odometer audit found C168 had MISSED
  a 3rd read method — `findByVehicleIdPaginated` (backs GET /:vehicleId) still filtered vehicle_id alone on both data+count legs.
  Scoped it (userId param + eq(userId) on both legs + route threading) + 3 tests. ALL odometer read methods now userId-scoped.*

**NEW — surfaced + verified-against-source by the C150 deep-review fan-out (reminder recurrence date-advance + insurance multi-term attribution). KEY: agent B's headline MED "null-endDate term sorts last → wrong premium" was a FALSE POSITIVE — insuranceTerms.endDate is `.notNull()` (schema.ts:129), so a null endDate CANNOT exist and that sort branch is unreachable dead code (caught firsthand: the NOT NULL constraint rejected the test insert; the C21/C77 vacuity rule). effectiveMonthlyPremium / inactive-exclusion / costByCarrier dedup / per-vehicle div-guard / overlapping-month accumulation all CERTIFIED CLEAN. #50 (real) FIXED in-cycle; #51 filed. Reminder agent's findings land with its delayed event.**
- ~~**#50 (LOW) — insurance latest-term pick was DB-row-order dependent on an endDate tie.**~~ — *DONE C150: `buildInsuranceDetails`
  (analytics/repository.ts:906) sorted terms by endDate desc but returned 0 on a tie, and the term query has no ORDER BY → two
  terms sharing an endDate (e.g. a mid-term correction with different monthlyCost) picked nondeterministically by storage order.
  FIX: tiebreak by the later startDate (the more-current term). +1 test (equal-endDate → later-starting term's premium wins).
  validate:local EXIT 0, 1187 pass. (The null-endDate "Finding 1" was debunked — endDate is NOT NULL, branch unreachable.)*
- **#51 (LOW, consistency) — an active policy with NO terms inflates activePoliciesCount while contributing $0.**
  analytics/repository.ts:911 `if (!latestTerm) continue;` skips a term-less policy for premium/vehicle entries, but
  activePoliciesCount is the raw count of active policies (:~1702) → the card can show "1 active policy / $0.00 / empty details" —
  internally inconsistent. Arguably intentional (it IS active). VERIFIED C150. FIX (if desired): count only policies with a term,
  or surface a "no current term" state. Low.

**NEW — surfaced + verified-against-source by the C155 deep-review fan-out (expenses-repository query/filter/search/pagination/aggregation + fuel-stats/efficiency math). KEY: agent A CERTIFIED the entire filter/sort/pagination/aggregation core CLEAN (the search OR is pre-parenthesized + AND-joined with the userId scope → can't widen past tenant; count==rows WHERE; allowlisted sort with id tiebreaker; split SUM not double-counted since siblings carry per-share expenseAmount; every read userId-scoped). #52 (real, security) FIXED in-cycle; #53 filed. Fuel-stats agent (delayed event, triaged post-C155): its Finding 1 → **#54 (HIGH, VERIFIED firsthand)** filed below; its div-guard/split-sibling checks matched my C155 pre-read (isFillup volume>0, fillupDetails length-guards, per-vehicle distance — clean).**
- ~~**#52 (MED, security defense-in-depth) — split delete/regenerate keyed the destructive write on groupId alone.**~~ — *DONE
  C155: `deleteSplitExpense` (repository.ts:720) + `updateSplitExpense` step 2 (:771) ran `delete(expenses).where(eq(groupId))`
  while their guarding SELECTs (:704/:743) were userId-scoped — ownership check + destructive write on DIFFERENT predicates. NOT
  exploitable today (groupId is a server cuid2, single-owner; the SELECT throws NotFoundError first), but a latent cross-tenant
  boundary if a group ever held cross-user siblings (a future merge/import path). FIX (the C109 tenant-scope class): AND
  `eq(expenses.userId, userId)` into both deletes — behavior-identical today, closes the boundary at the write. +2 regression
  tests (inject a same-groupId sibling owned by USER_2 → delete/update as USER_1 → the foreign row SURVIVES). validate:local EXIT
  0, 1196 pass.*
- **#53 (LOW, latent, UTC-prod-mitigated) — expense date-range upper bound inclusivity is server-TZ-conditional.**
  `endOfDayIfDateOnly` (repository.ts:59-64) extends an `endDate` to 23:59:59.999 only when the Date sits at LOCAL midnight, but
  the route coerces `?endDate=YYYY-MM-DD` via `z.coerce.date()` → `new Date("…")` parses date-only as UTC midnight. On a non-UTC
  server the extension doesn't fire → a "through Mar 31" filter silently drops same-day expenses (the list + the CSV export
  identically). Mitigated if prod runs UTC (the documented assumption). VERIFIED C155. FIX (if desired): detect date-only at the
  route (string-shape) and build the bound from local parts, or normalize to local midnight before the helper. Low.
- ~~**#54 (HIGH — VERIFIED firsthand C155.5, displayed-chart correctness) — `getFuelEfficiencyTrend` pairs consecutive fuel rows
  ACROSS vehicles in the fleet view.**~~ — *DONE C158: the query ordered by `date` ONLY (no vehicle group; vehicleId not even
  selected) and paired rows[i]/rows[i-1] → in the fleet view (/fuel-efficiency with NO vehicleId, reachable for any multi-vehicle
  user) consecutive rows could be DIFFERENT cars → computeEfficiencyPoint subtracts two cars' odometers → a phantom MPG point when
  they have close odometers (12,000 & 12,100 → 100mi/10gal → a plausible 10 MPG surviving the [5,100] filter). FIX: select
  vehicleId, order by `(vehicleId, date)`, pair only WITHIN each vehicle via the EXISTING `forEachVehiclePair` helper (the same
  per-vehicle pairing computeMpgAndCostPerMile uses) — generic-ized it + groupByVehicle over `T extends {vehicleId}` (backward-
  compatible) and exported it. +3 tests (2 cars, close odometers + interleaved dates → no phantom point; per-vehicle trends still
  computed; single-vehicle scoping unchanged). green→green 1206 pass (+3).*

**NEW — surfaced + verified-against-source by the C161 deep-review fan-out (FE financing-calculations.ts math + backend analytics money rollups). Both agents returned a real, verified, MED, displayed-figure finding; #55 FIXED in-cycle, #56 filed. Agent B CERTIFIED clean: ytdSpending (correct half-open local year, split-safe SUM), category-% (div-guarded, sums to 100), fleetHealthScore (div-guarded, no NaN), avgEfficiency (per-vehicle, no #54-class pooling), vehicleCostComparison. Agent A CERTIFIED clean: calculatePayoffDate, calculateMinimumPayment, calculateExtraPaymentImpact, calculateLeaseMetrics div-guards.**
- ~~**#55 (MED, displayed-figure) — calculateAmortizationSchedule had no negative-amortization guard.**~~ — *DONE C161:
  financing-calculations.ts:91 computed `principalAmount = Math.min(paymentAmount − interest, balance)` but, UNLIKE its siblings
  calculatePayoffDate:238 + calculateExtraPaymentImpact:311 (both bail on `principalAmount <= 0`), omitted the guard. When payment
  < monthly interest, principal goes NEGATIVE and `balance − principalAmount` GROWS the balance every period → rows with negative
  principal + a climbing balance into the displayed amortization table AND derivePaymentEntries' totalPrincipalPaid/totalInterestPaid
  (FinanceTab:58,67). FIX: `if (principalAmount <= 0) break;` (mirrors the siblings). +2 tests (amortization-negative-guard.test.ts:
  under-funded loan → no negative principal + non-increasing balance; healthy loan still amortizes to 0). green→green fe 477 pass (+2).*
- ~~**#56 (MED, displayed-figure) — `computeAverageCosts.perFillup` double-counts split fuel siblings in its denominator.**~~ —
  *DONE C162: analytics-charts.ts:405 computed perFillup = sum(expenseAmount over cost>0 rows) / count(those rows); a split fuel
  sibling carries positive expenseAmount + NULL volume, so a 2-way split fillup counted as 2 → "Avg cost/fillup" understated ~Nx
  (the #18 class, left open in this field after C97 fixed the COUNT). FIX: restrict BOTH numerator + denominator to volume-bearing
  rows (`volume != null && volume > 0`, the isFillup predicate) — a null-volume sibling = 0 fillups, so its share drops out of
  perFillup too. withCost/totalSpending (avgCostPerDay numerator) left unchanged (split shares sum to true total there). +3 tests
  (split → $55 not $47.5; unsplit unchanged $50; all-split → null). green→green 1209 pass (+3).*

**NEW — surfaced + verified-against-source by the C167 deep-review fan-out (insurance WRITE + premium→expense materialization · photos + sync-worker). #57 (HIGH) FIXED in-cycle; #58 filed. Agent A CERTIFIED clean: premium→expense idempotency (#13 class — create-once, update delete-then-recreate), term-vehicle junction ownership (validateVehicleIdsOwned), claim CRUD ownership, FK cascade, #8/#39 money/date. Agent B CERTIFIED clean: retry bound finite (retryCount<3), cross-tenant delete/serve blocked, nosniff #35 held, DI not mock.module, listing userId-scoped.**
- ~~**#57 (HIGH, displayed-$ + data-safety) — deleting an insurance policy orphaned its auto-materialized premium expenses.**~~ —
  *DONE C167: premium expenses link to terms by plain TEXT sourceType/sourceId (NO FK, schema.ts:233-234); the DELETE-policy route
  (routes.ts:133) cleaned PHOTOS but never deleteBySource the premium expenses → the term cascade-deleted but the expense row
  PERSISTED with a dangling sourceId, still summed into TCO insuranceCost forever (analytics has no term-exists check) + leaking
  its expense photos. Asymmetry-proof: DELETE-term (:221) + UPDATE-term (hooks:70) both deleteBySource; only parent-policy delete
  didn't. FIX: enumerate the policy's terms (findById→terms) + deleteBySource('insurance_term', term.id, userId) per term before
  delete, mirroring the claim-photo cleanup block. +1 regression test (costed term → premium expense → policy delete → 0 orphans).
  green→green 1210 pass.*
- **#58 (MED, data-safety) — sync-worker retry is non-idempotent for Google Drive/Photos on the upload→DB-write await gap.**
  providers/sync-worker.ts:212-253 (processSingleRef): `upload()` then `updateStatus()` are NOT atomic. If upload succeeds but
  updateStatus throws (DB lock/timeout, crash/restart in the gap), the ref stays pending/failed with storageRef='' and the remote
  blob is never recorded → the next retry uploads AGAIN. S3 is SAFE (deterministic buildKey → overwrite, idempotent), but Drive/
  Photos mint a new fileId per call → duplicate remote files, the earlier orphaned (no ref → never cleaned). VERIFIED via the C167
  agent (read the actual loop + provider upload). Narrow window (hence MED). FIX: a recorded idempotency key (deterministic remote
  name, or persist a pre-claim/storageRef before upload). Pure backend, but needs an approach choice (per-provider). Filed.

**NEW — surfaced + verified-against-source by the C173 deep-review fan-out (native CSV-import pipeline · split-service allocation core). #59 (MED, agent A) FIXED C173; #60 (MED, agent B) FIXED C174. Agent A CERTIFIED clean: BOM strip (C51 held), money parsing (no NaN→0 corruption, thousands-sep rejected not coerced), formula-injection denormalize (symmetric round-trip), idempotency (clientId sha256 dedup + partial unique index), cross-tenant vehicle resolution (name-map from the user's own fleet only). Agent B (split-service, delayed event triaged C174) CERTIFIED clean: computeEvenSplit exact (cents floor + remainder distribution), refineSplitConfig enforces percentage-sum=100 ±0.001 + absolute-sum=total (when total present) at the Zod layer, createSiblings copies sourceType/sourceId; the ONE real finding was #60.**
- ~~**#59 (MED, data-safety + displayed-$) — native CSV-import parseDate silently rolled forward an out-of-range date-only cell.**~~
  — *DONE C173: import-csv.ts:136 built a date-only value in LOCAL time (the C61 trap avoided) but checked ONLY Number.isNaN —
  and `new Date(2024,12,45)` ("2024-13-45") never NaNs, it rolls to 2025-02-14 (skewing TCO/trend/year analytics). The #23/#39
  echo-check was applied to the MAPPING path (buildLocalDate, C115) but never ported to the native path. FIX: echo-check the
  constructed Y/M/D against the input parts → mismatch returns the clean per-row "Invalid date" error (full-ISO branch unchanged).
  +1 regression test (2024-13-45 + 2024-02-30 both rejected, imported 0). green→green 1215 pass.*
- ~~**#60 (MED, data-safety + displayed-$) — absolute split EDIT without `totalAmount` kept a stale groupTotal (legs ≠ header).**~~
  — *DONE C174: updateSplitSchema makes totalAmount OPTIONAL (validation.ts:102) AND gates its absolute-sum refinement on it being
  present (:64), so an absolute edit can omit the total + pass validation; updateSplitExpense (repository.ts:762) then fell back to
  the STALE firstOld.groupTotal while computeAllocations' absolute branch returns the new allocations verbatim → create 30/30 ($60)
  → edit 40/40 no-total → siblings stamped groupTotal=$60 but legs sum $80 (persistent stored inconsistency surfaced by the header
  at routes.ts:177/207; violates Property 3 — whose tests only cover create/total-present paths). FIX (method-aware, pure): for
  ABSOLUTE derive total = round(Σallocations*100)/100 (definitionally the sum); even/percentage keep the caller-or-stored total to
  divide. No-op when total IS sent (validation forces sum===total). +3 tests (no-total→groupTotal&legs both $80; with-total→unchanged;
  even-split-no-total→still reuses stored $60, scoping control). green→green 1218 pass (+3). HONEST CAVEAT: backend gap confirmed
  firsthand; whether the current FE actually omits totalAmount on absolute edits is UNVERIFIED (the real-world trigger frequency
  hinges on it) — folded into a FE-eyes-on follow-on note, doesn't gate the backend correctness fix.*

*(surfaced by the C3 vehicle-detail UI review — ranked by severity; all real, none data-safety)*
- ~~**Vehicle-detail load failure masquerades as empty state (#1)**~~ — *DONE C57: `loadSummary`
   (Overview) + `fetchExpensesPage` (Expenses tab) in `vehicles/[id]/+page.svelte` only toasted on
   failure, leaving `summary=null`/`expenses=[]` → the empty state rendered, so a returning user whose
   fetch failed thought their data vanished (four-states: error ≠ empty). Added `summaryLoadError` +
   `expensesLoadError` flags + error+retry branches that take PRECEDENCE over the empty states
   (`{#if error && !isLoading} … {:else if !hasData}`), mirroring the dashboard/analytics idiom. frontend
   validate:local EXIT 0 (355 tests). CAVEAT: eyes-on screenshot Playwright-blocked here (pure tsc-checked
   conditional mirroring a shipped pattern). Motivates arch #2 (frontend load-state extraction) — this is
   its 2nd concrete instance.*
2. **Vehicle-detail Expenses tab: page-local search/category filter over a 20-row server slice**
   while header reads "All Expenses ({totalCount})" — matches on other pages invisible; the
   in-table category Select is uncontrolled here (no `onCategoryChange`). Wire server-side
   filtering (as `/expenses` does) or hide the controls when paginated. (medium)
- ~~**ExpensesTable ScrollArea `h-[{scrollHeight}]` is a DEAD class (#3)**~~ — *DONE C65: Tailwind can't
   generate a rule for a runtime-interpolated arbitrary value, so `h-[{scrollHeight}]` produced NO CSS — the
   600px cap + internal scroll never engaged and a many-row vehicle grew unbounded (CONFIRMED C14 via DOM
   probe). Fixed: inline `style="height: {scrollHeight}"` (ScrollArea spreads style to the DOM; the ChartCard
   idiom). MERGE-SURVIVING GUARD: `no-interpolated-arbitrary-class.test.ts` source-scans every `.svelte` for
   `<util>-[…{…]` (static `h-[600px]` never matches). The two chart `h-[{CHART_HEIGHT}px]` are the SAME dead
   class but HARMLESS (each passes `height={CHART_HEIGHT}` to its ChartCard wrapper, which sets the real height
   in style) → excluded with a documented anchor, not edited (avoids a blocked eyes-on chart change). frontend
   validate:local EXIT 0 (367 tests, +2). CAVEAT: eyes-on Playwright-blocked; fix is tsc/build-verified + the
   proven ChartCard idiom.*
- ~~**ExpensesTable combined-row re-sort lacks an id tiebreaker (#4)**~~ — *DONE C89: both sort sites
   (flat sortedExpenses :194 + the combined tableRows re-sort :268) compared only by date/amount and
   returned 0 on a tie, so equal-key rows fell back to JS engine ordering / the standalone-then-group
   array-build order (grouping reorders same-key rows vs. the server). Extracted a pure
   `compareExpenseRows(a,b,by,dir)` + `SortableRow` to expense-helpers.ts mirroring the server's
   `dir(sortColumn), dir(id)` (repository.ts:287) — id tiebreak folded into the raw comparison BEFORE the
   asc/desc flip, so it inherits the sort direction (a naive post-flip localeCompare would always break
   ascending + diverge on desc). Both sites wired through it; group rows key off the first child's id.
   MERGE-SURVIVING GUARD: compare-expense-rows.test.ts (+8) pins the tiebreak direction + input-order
   independence (the exact #4 invariant). frontend validate:local EXIT 0 (375 pass). CAVEAT: sort
   DETERMINISM can't be shown in a screenshot — the unit test is the right gate (C39 non-visual class).*

*(surfaced by the C7 backend deep review — CSV import + analytics math; ranked by severity)*
- ~~**CSV import: no UTF-8 BOM strip (#5)**~~ — *DONE C51: added `bom: true` to the csv-parse options
   in `buildImportPlan`. The export's first column is `date`, so a BOM-prefixed re-save (Excel/Sheets/
   Numbers) keyed it as "﻿date" → record.date undefined → EVERY row failed a misleading "Invalid date".
   Anchored by a real-stack HTTP regression in import-csv.test.ts (BOM CSV imports cleanly; pre-fix
   imported:0/errorCount:1). validate:local EXIT 0 (962 pass).*
- ~~**CSV import: date-only cells midnight-UTC (#6a)**~~ — *DONE C61: `parseDate` did `new Date(raw)`, so a
   bare `YYYY-MM-DD` (hand-edited/foreign file) parsed as UTC midnight → rolled the calendar day BACK for any
   user west of UTC (cycle-6/11 class). Fix: detect date-only via regex + build from parts in LOCAL time;
   full-ISO and other parseable strings keep their absolute-instant semantics via `new Date`. +2 HTTP tests
   (date-only keeps local day; full-ISO instant un-regressed). validate:local EXIT 0 (992 pass). The
   "**currency column silently ignored**" half (#6b) was investigated + DISMISSED: `currencyUnit` is a
   USER-SETTINGS field (schema.ts:303), NOT per-expense — amounts store as bare numbers in the user's single
   currency, so the export's `currency` column is informational and ignoring it on re-import is correct (no
   per-expense currency to store; "converting" would be wrong). Not a bug.*
7. **Analytics month bucketing uses local-tz `getMonth()`** (`analytics-charts.ts toMonthKey:~131`
   + heatmap/TCO/day-of-week/seasonal) — backend twin of the C6 class; benign if server runs UTC,
   real on a negative-offset host. Verify deploy TZ first, then bucket on UTC. (correctness, low-med)

*(surfaced by the C14 deep review — financing/insurance analytics + vehicle-detail eyes-on)*
- ~~**`interestPaidYtd` is mislabeled (#9)**~~ — *DONE C44: the field was ONE month's interest on the
  current balance, mislabeled as year-to-date-paid. Smallest honest fix = rename end-to-end
  (backend FinancingData type + 4 impl sites, frontend FinancingResponse type + 2 UI labels) →
  `monthlyInterestEstimate` / 'Est. Monthly Interest'. A true-YTD recompute (payment-history sum) was
  out of scope (a feature, not a rename). No screenshot — pure label/field rename, no layout change.*
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
    before fixing. **C73 UPDATE: the characterization net now EXISTS** — `insurance-details.test.ts` pins
    the current "expired-term-still-counts" behavior (the test to flip when decided), so a future #14 fix is
    safe. STILL needs Angelo's product decision before changing. (correctness?, med — needs decision)

*(surfaced + VERIFIED by the C42 mark-serviced/recheck audit — 1 fixed in-cycle, these 3 filed)*
- ~~**`markServiced` overclaims "optimistic-locked" (#15)**~~ — *DONE C71: took the lighter (decided)
    option — corrected the false claim rather than add a CAS guard (no data risk to fix: two concurrent
    mark-serviced calls compute the SAME re-armed values from the same source row, so a CAS would only
    collapse a redundant write, not prevent loss). VERIFIED against source first: the repository.ts
    markServiced comment was ALREADY accurate ("ownership-scoped"); the route had NO claim; the false
    "optimistic-locked transaction" lived ONLY in design.md:83. Rewrote it to describe the real
    ownership-scoped single-statement update + why no CAS is needed. Doc-only.*
16. **mark-serviced advances nextDueDate one period even from an overdue date** — `routes.ts:100`
    computeNextDueDate from the CURRENT (possibly past) nextDueDate advances by ONE period, so marking
    an overdue reminder serviced without first running /trigger can leave it still in the past
    ("bounces" through past periods, re-firing). Matches the trigger's one-period model + assumes a
    trigger ran first. SEMANTICS CALL: catch-up to >= now, or assert/leave-as-is. (needs decision)
17. **recheck-on-write is CREATE-only** — recheckMileageReminders is wired into expense/odometer
    CREATE, not their UPDATE (PUT). Editing a reading upward across a milestone won't fire until the
    next /trigger. Matches D5's "after a create" wording — a documented scope choice. Expand to UPDATE
    routes only if the product wants edit-triggered rechecks. (by-design gap)

*(surfaced + VERIFIED by the C103 fresh-bug fan-out — the known queue was all-gated, so hunted a new one)*
- ~~**Expense-form date validation rejects TODAY for positive-UTC-offset users (C103)**~~ — *DONE C103:
  `expense-form-validation.ts:36-38` did `new Date(value) > new Date()` — `new Date('YYYY-MM-DD')` parses as UTC midnight,
  so for a user at a positive UTC offset today's picked date landed on tomorrow-morning-local and the Date-instant compare
  wrongly rejected TODAY as "in the future" (the C6/C61 local-vs-UTC class). Fixed to compare CALENDAR-DAY strings (picker
  value is already local 'YYYY-MM-DD'; today's local day via the getFullYear/getMonth/getDate idiom this file already uses
  at :96/:109) — timezone-safe + host-independent (sidesteps the C77 UTC-host vacuity trap). Guard:
  expense-form-validation-date.test.ts (+6, today accepted = the regression, future rejected). frontend validate:local
  EXIT 0 (385 pass). Found via a 2-agent fan-out; the OTHER agent finding (getSummary Date→gte seconds/ms mismatch) was a
  FALSE POSITIVE — expenses.date is mode:'timestamp', Drizzle auto-converts Date↔seconds (verified vs source). CAVEAT:
  UI-touching but pure .ts, no markup; TZ-safe compare can't be shown in a screenshot, so the unit test is the gate.*

*(surfaced + VERIFIED by the C94 reminder→expense materialization deep-review — engine certified clean;
these two are the only findings, both verified against source: 1 real low-sev bug, 1 needs-decision)*
- ~~**Cross-fleet fuel fillup COUNT inflated by a split fuel expense (#18)**~~ — *DONE C97: a split fuel
    expense creates N sibling rows but only the AMOUNT is split — siblings carry volume=null
    (ExpenseSplitService.createSiblings, verified). So the cross-fleet `getFuelStats` (no vehicleId) counting
    raw `fuelRows.length` reported one logical fillup as N. FIX (cleaner than dedup-on-groupId, which isn't even
    SELECTed): a "fillup" is a fuel PURCHASE with a volume → count only volume-bearing rows via `isFillup(r) =
    r.volume != null && r.volume > 0` (the predicate fillupDetails already uses). Applied to currentYear/Month/
    prevMonth in buildFuelStatsFromData + `COUNT(CASE WHEN volume > 0 THEN 1 END)` in queryFuelAggregates
    (prev-year, for year-over-year consistency). Volume/cost SUMS were always correct (null contributes 0) —
    only counts were wrong. Behavior-preserving for non-split data (a real fillup has a volume). Guard:
    deterministic regression in fuel-stats.property.test.ts (2 real fillups + a 2-car split → cross-fleet
    currentYear fillups == 2 not 4, gallons == 19 unchanged). validate:local EXIT 0 (1104 pass, +1).*

19. **TCO monthly-trend chart omits non-major-category expenses** — `buildTCOMonthlyTrend`
    (analytics-charts.ts:953-961) is a 4-bucket chart (financing/insurance/fuel/maintenance, no "other"),
    so a `category` outside those four (financial/regulatory/enhancement/misc) is omitted from THIS trend
    chart. NOT a bug + NOT reminder-specific: the financing/insurance branches require
    `sourceType==='financing'/'insurance_term'`, so a MANUALLY-entered `financial` expense (sourceType null)
    is omitted identically; and the dollars are NOT lost from TCO totals (`categorizeTCOExpenses` routes
    them to otherCosts). SEMANTICS CALL (#14-class): should ad-hoc/recurring `financial` etc. expenses
    appear in the financing/insurance trend, or is the 4-bucket scope intentional? Needs a product
    decision before any change. (needs decision — chart scope, not a defect)
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

- ~~**Converge providers/routes.ts ownership lookups on a helper (filed C119).**~~ — *DONE C123: the 7-line
  `select().from(userProviders).where(and(eq id, eq userId)).limit(1); if (!existing[0]) throw NotFoundError('Provider')`
  block (5 sites: PATCH/DELETE/health/backfill/sync) → `findOwnedProviderOrThrow(db, id, userId): Promise<UserProvider>`
  (returns the row, userId-scoped, local DbInstance type). MIXED SHAPE (C113 pattern): 3 sites use the row (.domain /
  createProviderInstance) → keep `const existing = [await …]`; 2 existence-only (backfill, sync) → discard form. The gate
  earned its keep — biome noUnusedVariables enforced the split. green→green vs the C91 13-test providers net (1155 pass,
  unchanged). validate:local EXIT 0.* NEXT ARCH PICKS (lower priority): ~~analytics getUserUnits/getVehicleUnits
  share a byte-identical parse-default tail [2 sites, C119 #2]~~ — *DONE C129: extracted private `resolveUnitsOrDefault(row)`;
  EXCLUDED getAllVehicleUnits (throws on invalid prefs, not fallback — the C90 inverted-semantics catch). green→green 1158
  pass.* ~~`reminder-helpers.ts` frequencyLabel hand-rolls the SAME `frequency.charAt(0).toUpperCase()+frequency.slice(1)`
  idiom C119 extracted as `capitalize()` [filed C128]~~ — *DONE C135: routed frequencyLabel (:75) through the shared
  `capitalize` from formatters.ts (1 import + 1 call swap). Verified byte-identical + test-anchored (frequencyLabel's
  'monthly'→'Monthly' tests are the green→green net) + no circular import (formatters imports only settingsStore). green→green
  427 pass unchanged.* ~~plural multi-vehicle ownership check duplicated in reminders/routes.ts [C141 rule-7 fan-out]~~ —
  *DONE C141: extracted `validateVehicleIdsOwned(vehicleIds, userId)` to utils/validation.ts (beside the single-vehicle
  validator); the create (:148) + update (:234) sites — VERIFIED byte-identical firsthand incl. the exact ValidationError
  string — collapsed to a 1-line call. Distinct from the excluded single-vehicle validateVehicleOwnership (plural set-membership
  → ValidationError-list vs single → NotFoundError). Removed the now-dead vehicleRepository + ValidationError imports (C123
  class). Added a PUT-foreign-vehicle-rejected test (arch rule 3 — the update site was uncovered). green→green 1170 pass (+1).*
  **ARCH QUEUE EMPTY of clean single-cycle picks.** `MS_PER_DAY` (the lone remaining filed idea) is grounded as NOT
  byte-identical — ~20+ sites across BE+FE in 3 spellings with divergent semantics (pure day-divisor vs a 30-day-MONTH
  approximation); collapsing it is a sweeping multi-file rewrite (arch rule 1) and the FE half was already rejected as churn
  (C99) → leave it.
  - ~~**backend `extractErrorMessage` seam (C147)**~~ — *DONE C147: the `error instanceof Error ? error.message : String(error)`
    idiom is hand-rolled ~60× across the backend with NO canonical helper (the FE has one — C90). Created
    `utils/error-handling.ts extractErrorMessage(error)` + wired the 3 byte-identical VALUE-capture sites (connection.ts:91,
    index.ts:23, sync-worker.ts:261); the ~57 `logger.error({error:…})` structured-log sites are a DISTINCT idiom left to
    converge incrementally (not value-extraction); connection.ts:74 stays inline (fallback `'Unknown error'`, not byte-identical).
    +4 unit tests. green→green 1182 pass. Creates the one-source-of-truth + a convergence target.*
  - **`roundToCents(x)` [`Math.round(x*100)/100`] — RE-FILED with an EYES-ON + cents-migration caveat (re-grounded C147).** Of
    the ~8 sites, only financing-calculations.ts:456 is pure-`.ts`; the other ~7 are `.svelte` (eyes-on-BLOCKED here) and several
    round MONEY (SplitConfigEditor:40, ExpensesTable:237, VehicleForm:299-301) that the **cents-migration T5/T6 will rework** →
    extracting now is churn-or-unverifiable. DEFER until either Playwright unblocks (so the component sites are verifiable) OR the
    cents migration lands (which subsumes the money-rounding sites). Not a clean single-cycle pick today.
  - ~~**`advanceReminderDueDate(reminder, from)` — the reminder-due-date advance, 4 sites → 1 (C153)**~~ — *DONE C153: my own
    C151 hoist had left FOUR byte-identical `computeNextDueDate(nextDue, reminder.frequency, reminder.intervalValue,
    reminder.intervalUnit, getAnchorDay(reminder))` blocks. VERIFIED all four firsthand: trigger-service processExpensePeriod:207
    + processNotificationPeriod:228 + fastForwardPastNow:264, AND routes.ts:111 (mark-serviced re-arm — spelled the anchor inline
    as `reminder.startDate.getDate()`, identical to getAnchorDay; comment said "reuse the trigger math"). COMPLETE 4→1 (no inline
    site left → no C75/C92/C99 partial-churn). Exported the wrapper (folds getAnchorDay in), wired all 4, swapped routes.ts's
    import + stale comment. Pure/backend-only/behavior-preserving/cents-independent. +3 delegation tests (rule 3). green→green
    1192 pass (+3).*
  - ~~**`validateReminderOwnership` — the inline reminder ownership guard, 5 sites → 1 (C160)**~~ — *DONE C160: a rule-7 AUDIT
    fan-out (2 agents) surfaced it as the best clean pick. The `const x = await reminderRepository.findByIdAndUserId(id, user.id);
    if (!x) throw new NotFoundError('Reminder')` guard repeated 5× in reminders/routes.ts (mark-serviced/GET:id/GET:id/expenses/
    PUT/DELETE) — VERIFIED byte-identical firsthand. Added validateReminderOwnership to utils/validation.ts (mirrors
    validateExpenseOwnership, slots into the validateXOwnership family) + wired all 5 (3 consume entity, 2 guard-only) + dropped
    the dead NotFoundError import. Test-anchored by EXISTING 404 coverage (mark-serviced.test.ts:173 + materialized-expenses-route)
    passing green through the helper. green→green 1206 pass (behavior-preserving).* **ARCH QUEUE again empty of clean picks.**
  - ~~**FE runner-up (filed C160): settings.svelte.ts handleError → extractErrorMessage**~~ — *DONE C166: the local
    `handleError(error) = error instanceof Error ? error.message : 'An unexpected error occurred'` (:18) was byte-identical to the
    shared `extractErrorMessage` (C90/C137, error-wins — NOT the inverted handleApiError:120). Deleted the local helper, imported
    extractErrorMessage, replaced all 9 call sites with `extractErrorMessage(err, UNEXPECTED_ERROR)` (fallback hoisted to a named
    const). Behavior-preserving; anchored by extractErrorMessage's existing test + green→green FE suite (the C160 precedent — store
    has no test file; adding one is heavier than the dedup warrants). green→green fe 492 pass (unchanged).*
  - ~~**validateOdometerOwnership (filed C160 backend audit runner-up)**~~ — *DONE C172: the `findById + entry.userId !==
    user.id → NotFoundError('Odometer entry')` guard repeated 3× byte-identical in odometer/routes.ts (GET /entry/:id, PUT,
    DELETE). Added validateOdometerOwnership to utils/validation.ts (mirrors validateInsuranceOwnership — findById + post-filter,
    NOT findByIdAndUserId) + wired all 3 (GET consumes entry, PUT/DELETE guard-only) + dropped the dead NotFoundError import. Wrote
    the anchoring 404 tests the caveat flagged: +3 not-found cases in update-route.test.ts (GET/PUT/DELETE → 404). green→green 1214
    pass (+3).*
  - ~~**Shared `buildLocalDate` — the date echo-check, 2 import paths → 1 (C177)**~~ — *DONE C177: a STRONGER lead than a fresh
    fan-out — my own C173 #59 fix added an echo-check to import-csv.ts parseDate that explicitly "mirrors the mapping path's
    buildLocalDate" (import-mapping.ts, C115/#23). VERIFIED firsthand both sites run the IDENTICAL "construct local Date + NaN-check
    + echo getFullYear/getMonth/getDate" guard — two pure-`.ts`, cents-INDEPENDENT impls of one algorithm. Extracted the canonical
    `buildLocalDate(y,m,d,hh=0,mm=0,ss=0): Date|null` to new sibling `expenses/local-date.ts`; wired both callers (import-mapping
    deletes its copy + imports; import-csv's inline check → a call mapping null→its existing {error}). Behavior-preserving (time
    defaults to 0 = local midnight ≡ `new Date(y,m-1,d)`; no circular import). Anchored by the EXISTING #59 + #23 out-of-range suites
    (green→green through the extraction) + new local-date.test.ts (+7). green→green 1225 pass (+7).*
  - ~~**`isEligibleForPayoff` + `PAYOFF_BALANCE_THRESHOLD` — the payoff rule, 3 sites → 1 (C182)**~~ — *DONE C182: the
    `eligibleForPayoff: computedBalance <= 0.01` idiom was triplicated inline at vehicles/routes.ts:154 + :230 + financing/routes.ts:89
    (a business rule + magic number, no single source). A clean arch-scout (spawn a11fa350 recovered) returned a serializeSessionUser
    candidate; I independently found + chose THIS one (3 sites vs 2, all 3 test-anchored, collapses a correctness rule). Extracted both
    as exported decls in financing/repository.ts (beside computeBalance) + wired all 3 + converted the property test's 4 local `<= 0.01`
    copies to the real export + boundary test. Behavior-preserving, anchored by the existing contract tests. green→green 1236 pass (+1).*
  - ~~**`serializeSessionUser(u)` — the auth session-user block, 2 sites → 1 (PRIMED by the C182 scout; C187)**~~ — *DONE C187:
    VERIFIED firsthand the 5-field block `{id,email,displayName,createdAt?.toISOString()??null,updatedAt?.toISOString()??null}` is
    byte-identical at auth/routes.ts GET /me (:463, src `user`) + POST /refresh (:562, src `result.user`); the PATCH /me + /accounts
    near-misses correctly stay EXCLUDED (different shapes). Extracted `serializeSessionUser` (structurally typed → accepts both sources)
    + wired both. CLOSED the caveat's gap: /refresh's success body was UNANCHORED → added a POST /refresh success-body shape test to
    me-http.test.ts. Behavior-preserving, green→green 1246 pass (+1).* **ARCH QUEUE empty — next arch cycle runs a rule-7 fan-out
    (spawn cap permitting) or an inline scout.**
  - **Next arch pick (no primed pick):** a rule-7 fan-out scoped to **pure-`.ts`, cents-migration-INDEPENDENT** duplication (the eyes-on +
    pending-migration constraints rule out most FE/money candidates). The BE `extractErrorMessage` convergence of the ~57 logging sites
    is available but is multi-cycle/borderline-churn (a distinct logging idiom) — only if nothing cleaner.

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
   - [x] **part 2c-drop settings (C50).** Dropped the 4 settings try/catch (GET / PUT / backup / restore)
     + removed the now-unused `AppError`/`logger` imports (`ValidationError` kept — used by the storage/
     backup validators). PUT ZodError → central 400 `ValidationError('Invalid request data')` (status
     unchanged 400, only the transformed message standardized); GET/backup stop masking typed errors as
     500; restore's catch was dead (try body only returns). Updated the one C43 `settings-route-errors`
     assertion to the central message in the same commit; the positive-control + path-traversal-400
     tests stayed green. validate:local EXIT 0 (961 pass). The storage/backup `ValidationError`s (AppError
     subclass) flow through by their 400 statusCode unchanged.
   - [x] **part 2d — `auth` (C56): VERIFIED ALREADY CONVERGED — no drop.** GROUNDING CORRECTION (the
     "7 hand-rolled try/catch" premise was WRONG — that was a rough scan count). Read every block in
     `auth/routes.ts`: the handlers that surface errors (`/me`, `/refresh`, `PATCH /me`,
     `/providers/connect/google`) ALREADY throw `HTTPException` directly with NO try/catch — and the
     central `errorHandler` shapes `HTTPException` (error-handler.ts:43) → already on the canonical
     envelope. The 5 try/catch that DO exist are NOT envelope boilerplate; each is meaningful logic that
     MUST stay: (1) `emailErr` (L164) UNIQUE-constraint recovery — retry update without email;
     (2) `txErr` (L206) new-user-tx race recovery — look up the row a concurrent insert created;
     (3) `err` (L368) + (4) `err` (L837) OAuth token-exchange → SPECIFIC redirect outcomes
     (`no_email`/`provider_unavailable`/`exchange_failed`), control flow not error-shaping;
     (5) JSON-parse guard (L472) → intentional 400 'Invalid JSON body'. Dropping ANY would be a behavior
     change → violates the arch rules. So auth needs no convergence work; arch #1 is COMPLETE.
   - **arch #1 CLOSED (C56).** sync (C36) + settings (C50) hand-rolled boilerplate dropped onto the central
     handler; auth verified already-converged (above). No route file hand-rolls an error envelope anymore.
2. **Extract the frontend page load-state pattern.** ~14 `+page.svelte` files repeat the same
   `isLoading` / `loadError` / `try → fetch → catch → toast + set error` triad (dashboard,
   expenses, reminders, insurance, analytics, vehicles/[id], settings, profile, …) — the exact
   class the `bug` queue keeps re-finding per page (load-failure-masquerades-as-empty-state).
   - [x] **step 1 — extract the scaffold (C63).** `createLoadState<T>()` in
     `frontend/src/lib/utils/load-state.svelte.ts` — a rune primitive with `data`/`isLoading`/
     `error`/`isError` getters + `run(loader)` (the try/catch/finally verbatim: onError side-effect,
     message via `e instanceof Error ? .message : fallback`, prior data kept on failure, isLoading
     reset in finally) + `set`/`clearError`. Pinned by 10 unit tests (`load-state.svelte.test.ts`) —
     ALSO established that `.svelte.ts` rune modules are unit-testable here (no prior precedent; runes
     compile under the `sveltekit()` vitest plugin, synchronous `$state` access, no `$effect`). No page
     touched → no eyes-on needed (new unused module). frontend validate:local EXIT 0 (365 tests, +10).
   - [ ] **step 2+ — migrate ONE page per cycle onto it.** UI-touching → eyes-on-blocked. **C79 SCOPING
     FINDING (blocks this until the scaffold is reshaped):** `createLoadState<T>()` wraps ONE `data: T`, but
     the real pages don't fit that shape — vehicle-detail has TWO load pairs entangled with pagination
     state (currentOffset/totalCount/pageSize) + shares isLoadingStats across summary+fuelEfficiency; the
     dashboard's one loader populates ~6 separate $state vars (stats/overviews/recentExpenses/dueReminders/
     photos) from a single fetch, not one `data`. So a faithful migration is NOT the clean 1:1 swap the
     scaffold assumes — it would reshape working code for marginal dedup (churn). **Two honest paths, both
     need a direction call:** (a) reshape `createLoadState` into a leaner `{ isLoading, error, run }`
     loading/error pair WITHOUT owning `data` (pages keep their own data $state) — fits every page, smaller
     win; or (b) accept the scaffold only fits future SINGLE-resource pages and don't retrofit. Flag Angelo;
     don't force a misfit migration. Bonus (if reshaped): structurally prevents the masquerade bug class.

- ~~**Extract a `capitalize` FE helper from 5 hand-rolled sites (C119).**~~ — *DONE C119: rule-7 fan-out (backend +
  frontend agents); took the FE candidate (doubles down on the C107/C118 FE-is-the-bigger-gap steer). The
  `<x>.charAt(0).toUpperCase() + <x>.slice(1)` idiom was byte-identical at 5 sites — ClaimsSection.svelte had even
  hand-written a LOCAL `titleCase` (this formalizes a helper a component already wanted), + ReminderForm.svelte ×3 +
  FinancingAnalytics.svelte (inside a `=== 'own' ? 'Owned' : …` ternary, preserved). Added `export function capitalize(s)`
  to formatters.ts, removed ClaimsSection's local titleCase (4 calls rerouted), wired the other 4. VERIFIED all 5 vs source
  (C69). +3 tests (basic, empty/already-cap no-op, only-first-char). green→green: frontend validate:local EXIT 0 (395 pass,
  +3), tsc 0. Pure string fn, no reactivity — no eyes-on.*
- ~~**Dedup the `instanceof Error ? .message : fallback` idiom (C90).**~~ — *DONE C90: rule-7 fan-out (2
  agents). The `<err> instanceof Error ? <err>.message : <literal>` catch-block idiom was hand-repeated; extracted
  `extractErrorMessage(error, fallback)` to utils/error-handling.ts and routed the 4 genuinely-identical sites
  through it (load-state.svelte.ts:91, auth.svelte.ts:98 + :116, sync-manager.ts:224). VERIFIED against source
  (C21/C28/C35 rule): EXCLUDED error-handling.ts:106 — its `fallbackMessage || (...)` gives the caller's message
  PRECEDENCE (opposite ordering), so folding it in would invert semantics (arch rule 2). Pure .ts/.svelte.ts → no
  eyes-on. Anchored by extract-error-message.test.ts (+4, incl. the load-bearing empty-Error-message→'' = branch
  on TYPE not truthiness). Complete one-cycle behavior-preserving dedup. frontend validate:local EXIT 0 (379 pass).*
- ~~**Dedup the repeated query-if-nonempty guard in google-sheets-service (C75).**~~ — *DONE C75: rule-7
  fan-out (2 agents: layering + complexity). The Sheets backup builder `updateSpreadsheetWithUserData`
  repeated `ids.length > 0 ? await db.select()…where(inArray(col, ids)) : []` 4× (insurance terms, term-
  vehicles, claims, reminder-vehicles). Extracted a typed `queryIfNonEmpty<T>(ids, () => query)` private
  helper (closure form, simpler than the agent's db-passing signature); collapses the guard to one named
  place. Behavior-identical (skips a pointless `inArray(col, [])` round-trip exactly as before). REJECTED the
  layering finding (extract ONE raw `db.delete` from providers/routes.ts into a repo) — the agent itself
  noted 5 OTHER raw queries in that file are left inline, so extracting just one is churn that makes the file
  MORE inconsistent (arch rule 5). green→green: full suite (incl. google-sheets-service round-trip test) 1046
  pass, unchanged. NOTE: the single-suite run hit the C38 cross-suite migration flake (duplicate due_odometer)
  — NOT my change; the canonical gate is full `validate:local`, which is green.*
- ~~**Dedup the stats-period → start-date switch (C69).**~~ — *DONE C69: the identical period-to-Date
  day-offset switch was duplicated in vehicles/routes.ts (stats) + expenses/repository.ts (query filter).
  Extracted `getPeriodStartDate(period, now?)` + `StatsPeriod` type to utils/calculations.ts ('all'→null,
  bounded→now−N days). Both call sites wired through it; expenses keeps its defensive `?? new Date(0)`
  fallback (behavior-identical — that branch is unreachable for the fixed 5-value enum anyway). Surfaced
  by a rule-7 fan-out (2 Explore agents); VERIFIED the agents' "subtle default divergence" concern against
  source (the `new Date(0)` vs `null` defaults sit in never-reached branches behind a `period!=='all'`
  guard / the 'all' case), so the extraction is safe. +5 unit tests; both call sites' existing property
  tests stayed green (the green→green proof). 1029 BE pass (+5). NOTE: the OTHER agent finding (delete dead
  `handleSyncError`) was REJECTED — it's the byte-identical oracle the C24 equivalence test asserts against;
  removing it is churn-for-churn (arch rule 5), not a payoff.*
- ~~**Dedup ownership-validation: one source of truth.**~~ — *DONE C17+C18. C17 added the safety net
  (`entity-ownership-gate.test.ts`, 14 cases pinning the gate's observable contract per entity type).
  C18 executed the refactor: `photos/helpers.ts validateEntityOwnership` now routes vehicle/expense/
  insurance_policy through the shared `validateVehicleOwnership`/`validateExpenseOwnership`/
  `validateInsuranceOwnership` (utils/validation.ts); deleted the private dup + 2 inlined checks +
  unused imports. Kept insurance_claim (transitive) + odometer_entry inline + validatePhotoOwnership
  as-is. 3 ownership impls → 1; behavior-preserving (all gate tests + full 889 suite green, unchanged).*

- ~~**Dedup the 3× provider response formatter + the 2× photoRef count query (C91 net → C92 execute).**~~ —
   *DONE C92 (the C18/C36 net-then-refactor second half): (1) the 8-field provider response object hand-assembled
   identically at 3 sites (GET list / POST create / PUT update) → `formatProviderResponse(row: UserProvider)`
   (credentials deliberately omitted — the security invariant); (2) the synced-vs-failed photoRef count queries
   in /sync-status, byte-identical bar the status filter → `countPhotoRefsByStatus(db, id, status, entityTypes)`.
   ~50 lines of dup → 2 helpers. green→green: the C91 net's 13 assertions stayed green UNCHANGED. tsc caught a
   real type bug (photoRefs.status is a literal union, not string — tightened the param). backend validate:local
   EXIT 0 (1100 pass). DELIBERATELY did NOT extract the lone raw `db.delete(userProviders)` :466 into a repo —
   the whole file uses raw db.* inline (no providersRepository), so extracting one op makes it MORE inconsistent
   (C75 reasoning, arch rule 5). If a providersRepository is ever introduced, route ALL its raw queries through
   it as one coherent change — not piecemeal.*

- ~~**Converge the REMAINING route files on `validateVehicleOwnership` (C99 follow-on).**~~ — *DONE — the ARC IS COMPLETE
  (analytics C99 · expenses C106 · vehicles C113; financing EXCLUDED by design). **C113 closed vehicles/routes.ts:** per-site
  verification (the file was mixed-shape) converted the 2 byte-identical sites — DELETE /:id (:287, binding unused → discard
  form) + GET /:id/stats (:330, captures the return: `const vehicle = await validateVehicleOwnership(...)` since the stats
  handler uses vehicle.initialMileage/trackFuel/trackCharging — tsc caught this after a pre-edit scan missed it). EXCLUDED
  GET /:id (:205) + PUT /:id (:249): they use `findByIdWithAccess` (SHARED-access lookup, not findByUserIdAndId) AND use the
  returned vehicle — different semantics, correctly left. NotFoundError + vehicleRepository imports stay (the excluded sites
  still use them). green→green 1138 pass unchanged. **financing/routes.ts stays EXCLUDED** — its 2 sites throw
  `HTTPException(404)`, not `NotFoundError('Vehicle')`; converging would change the error envelope (the C69 exclusion).*
- ~~**Converge `analytics/routes.ts` on shared `validateVehicleOwnership` (C99).**~~ — *DONE C99: rule-7 fan-out found the
  inline `findByUserIdAndId` + `NotFoundError('Vehicle')` ownership check hand-repeated at 13 sites across 4 route files; a
  shared `validateVehicleOwnership` already existed (used by odometer/insurance/photos). Scoped to analytics (6 sites — the
  densest, all test-covered) per arch rule 1; converted all 6 (3 mandatory + 3 optional keeping their `if (vehicleId)`
  guard), removed the now-unused NotFoundError + vehicleRepository imports. Byte-identical to the helper (verified vs source);
  green→green (1109 pass unchanged). Rejected the frontend MS_PER_DAY consolidation as churn (arch rule 5). validate:local
  EXIT 0.*

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
> **STANDING CADENCE (loop-improvement #5): every ~10 cycles, run a branch-hygiene sweep** — the
> loop is now 50+ commits deep on `claude-loop-dev` headed for one big human PR. Each sweep:
> (1) `git status` for untracked `*.test.ts` OUTSIDE the by-design-untracked set (`*.meshclaw.e2e.ts`)
> — bun discovers tests by filesystem, so an untracked spec counts locally every cycle but VANISHES
> on merge, silently dropping its coverage (confirmed cyc 200); commit or delete any stray;
> (2) full `regress.sh` for a clean green baseline; (3) refresh `BRANCH_REVIEW.md` (gitignored), grouping
> commits since the last refresh by theme so the eventual PR stays reviewable. Counts as one `infra`
> increment; the most recent sweep cycle is noted in the LEDGER so the next is easy to time.

*(queue empty — repopulate as loop tooling / docs needs surface. #5 branch-hygiene sweep DONE C164 (branch 116 commits; §23), next due ~C174; CLAUDE.md refresh DONE C171 (3 drifts: coverage re-measure + FE-service-layer-100%, suite 1211/503, #57 closed), next ~C184. NOTE C164/C165: feature chronically starved (eyes-on-blocked + money-cents/trips both T0-gated) — escalated to Angelo for a horizon-spec steer + the T0 ratify; trips T1–T5 are loop-buildable once cleared.)*
- ~~**#5 branch-hygiene sweep + coverage re-measure (C152)**~~ — *DONE C152 (overdue; last C138, branch now 101 commits / 14
  cycles of drift). (1) zero stray untracked unit/spec tests (all untracked = the by-design `*.meshclaw.e2e.ts` set + `.meshclaw-tools/`
  harness + screenshots/snapshots + gitignored dirs); (2) green baseline + re-measure — backend bun test --coverage EXIT 0
  (1189 BE / 1 skip), frontend vitest --coverage 470 FE; (3) BRANCH_REVIEW.md refresh — header 85→101, status 1164→1189 BE /
  435→470 FE, appended §22 (C138–C151), reviewer checklist now reflects #27 + lease/loan APPROVED C151 (only #36/#37 HIGHs still
  gated). RE-MEASURE: be 82.02% line / 82.51% func (func up from C138's 81.81%); fe 70.09% line / 66.77% func / 62.85% branch
  (UP +4.8 line / +4.2 branch from C138 — the C143/C149 service-layer ratchet broke 70% line). Updated the COVERAGE TREND
  header. Doc/measurement-only. Next sweep ~C162.*
- ~~**CLAUDE.md orientation refresh post-C131–C144 (C145)**~~ — *DONE C145: 5 drifts fixed (verified vs source/LEDGER, no churn).
  (1) import-trackers "frontend not started" → FE client slice shipped C140; (2) recurring-expenses "frontend not started" →
  T6/T7 FE client methods shipped C134; (3) coverage cited stale C124 (81.8/62.0) + named error-handling/api-client as next low
  spots — but C138 re-measured (82.25/65.32) + C137/C143 closed both → updated + re-pointed to expense-api.ts/components; (4)
  suite ~1158/~421 → 1178/457; (5) Pending-Angelo line missing #36/#37 + the new #43/#44 (ARCC-grounded) + #45/#21-shrink →
  added. Doc-only. Next CLAUDE.md refresh ~C160.*
- ~~**#5 branch-hygiene sweep + coverage re-measure (C138)**~~ — *DONE C138 (overdue; last C124, branch now git-authoritative
  85 commits off origin/main). (1) zero stray untracked unit/spec tests (all untracked = the by-design `*.meshclaw.e2e.ts` set +
  e2e screenshots/results + the Playwright config + gitignored dirs); (2) green baseline + coverage re-measure — backend bun
  test --coverage EXIT 0 (1164 BE), frontend vitest --coverage EXIT 0 (435 FE); regress.sh Playwright-blocked; (3)
  BRANCH_REVIEW.md refresh — header 71→85, status 1155→1164 BE / 395→435 FE, appended §21 (C124–C137), reviewer checklist now
  THREE HIGHs gated (#27 + #36 + #37) + #21-shrink. RE-MEASURE: be 82.25% line / 81.81% func (up from C124 81.78/82.17); fe
  65.32% line / 61.76% func / 58.70% branch (UP +3.3 line / +6.2 branch from C124 — the C125/C130/C134/C137 FE ratchet arc
  delivered). Updated the COVERAGE TREND header. Next sweep ~C148.*
- ~~**#5 branch-hygiene sweep + coverage re-measure (C124)**~~ — *DONE C124 (overdue; last C110, branch now 71 commits).
  (1) zero stray untracked unit/spec tests; (2) green baseline — backend validate:local EXIT 0 (1155 BE / 395 FE; regress.sh
  Playwright-blocked); (3) BRANCH_REVIEW.md refresh — header 56→71, status 1123→1155 BE / 385→395 FE, appended §20 (C110–C123),
  reviewer checklist now FOUR Angelo decisions (leads with #27 the TCO HIGH). RE-MEASURE (loop-improvement #4, deferred since
  C120): be 81.78% line / 82.17% func (up from C107 81.10/81.84); fe 62.03% line / 60.48% func / 52.47% branch (up from C107
  61.41 — the C118/C119 FE ratchet; still the bigger gap). Updated the COVERAGE TREND header. Doc-only. Next sweep ~C134.*
- ~~**#5 branch-hygiene sweep — BRANCH_REVIEW.md refresh (C110, milestone)**~~ — *DONE C110: due per the C100 note
  (~10 cycles, branch now 56 commits). (1) zero stray untracked unit/spec tests (all untracked are the by-design
  `*.meshclaw.e2e.ts` set + gitignored dirs); (2) green baseline — backend validate:local EXIT 0 (1123 BE / 385 FE;
  regress.sh Playwright-blocked); (3) digest header 46→56 commits, status 1109→1123 BE / 379→385 FE + the C107 measured
  coverage (be 81.1% / fe 61.4%), appended §19 (C100–C109: recurring-expenses T2/T3 backend finish, #20 restore leak fix +
  #103 date-TZ fix, C106 arch convergence, C105 idempotency net, C101/C108 deep-review certs, C107 re-measure) + refreshed
  the merge footer to THREE mid-build features. BRANCH_REVIEW.md is gitignored. ALSO this cycle: confirmed the `feature`
  category is eyes-on-EXHAUSTED (all 3 builds backend-complete, FE tails Playwright-blocked; the backend seams they depend
  on are built+characterized) — escalated to Angelo that unblocking Playwright is the real lever. Next sweep ~C120.*
- ~~**Real coverage re-measurement + ratchet re-anchor (loop-improvement #4, C107)**~~ — *DONE C107: the cov: tags had
  carried forward stale ~81%/~64% ESTIMATES since the C81 baseline through 25+ ratchet cycles. Ran bun test --coverage +
  vitest --run --coverage. RESULT: be 81.10% line / 81.84% func (up ~+4 from C81 — the C82–C106 ratchet delivered);
  fe 61.41% line / 59.31% func / 52.24% branch (FLAT vs C81's 63.7%, slightly down — FE product code outgrew its tests,
  now decisively the bigger gap). Re-anchored the C83 ratchet header + the COVERAGE TREND header to the real reading +
  current low spots (rate-limit 60%, body-limit 35%, sync routes, analytics GET handlers; FE components/routes). Doc-only,
  no build gate (the C100 measurement pattern). Next coverage re-measure ~C120 or after a big test-adding arc.*
- ~~**#5 branch-hygiene sweep — BRANCH_REVIEW.md refresh (C100, milestone)**~~ — *DONE C100: due per the C86 note
  (~14 cycles, branch now 46 commits). (1) zero stray untracked unit tests (all untracked are the by-design
  `*.meshclaw.e2e.ts` set + gitignored dirs); (2) green baseline — backend validate:local EXIT 0 (1109 BE / 379 FE;
  regress.sh Playwright-blocked); (3) digest header 36→46 commits, status 1076→1109 BE / 367→379 FE, appended §18
  (C86–C99: recurring-expenses spec+sign-off+T1, bugs #4/#18, the C90/C92/C99 arch dedups, the C87/C91/C98 coverage
  ratchet, C93 doc refresh) + refreshed the merge footer. BRANCH_REVIEW.md is gitignored. Next sweep ~C110.*
- ~~**CLAUDE.md orientation refresh post-C117–C130 (C131)**~~ — *DONE C131: 3 drifts fixed (verified vs source/LEDGER).
  (1) recurring-expenses "Remaining" list mis-stated T5/T6 as unstarted → rewrote to "every non-eyes-on backend slice T1–T7
  built (T6 read-seam C122, T5 gate C128); remaining ALL eyes-on". (2) Coverage C107→C124 re-measure (be 81.8/fe 62.0,
  1158/421) + the FE-creeping-up steer. (3) Open gaps: added recurring-expenses T4–T8 to the eyes-on list + a new
  "Pending Angelo decision" line surfacing #27 (TCO HIGH) + the 3 other gated calls. Doc-only. Next refresh ~C145.*
- ~~**CLAUDE.md orientation refresh post-C93–C116 (C117)**~~ — *DONE C117: 3 actively-misleading drifts fixed
  (verified vs source/LEDGER, no churn). (1) recurring-expenses was ABSENT — "Two feature specs" + only
  maintenance/import-trackers listed; it's now the most backend-complete feature (T1–T3+T7), added as the 3rd bullet
  with the "engine exists, EXTEND it" grounding. (2) Coverage 77.8%/63.7% (C81) → the C107 re-measure (be 81.1%/81.8%,
  fe 61.4%/59.3%) + the FE-is-now-the-bigger-gap steer. (3) Suite ~1100/~379 → ~1145/~385. Doc-only. Next CLAUDE.md
  refresh ~C130 or after the next big arc.*
- ~~**CLAUDE.md orientation refresh post-C81–C92 (C93)**~~ — *DONE C93: 2 actively-misleading drifts fixed
  (the C5/C47/C72 class). (1) The coverage line cited a stale ~74%/~59% / ~1038-test floor → corrected to the
  real C81 MEASURED baseline (be 77.8% / fe 63.7% line) + the loop-improvement #4 per-cycle cov: tag + ~1100/
  ~379 suite. (2) The "Open gaps" line claimed the in-process HTTP harness doesn't exist yet (needs a DB-injection
  refactor) — FLATLY WRONG: C91 proved createTestApp() works (1100 tests run through it). Rewrote to DOCUMENT the
  harness + the CONFIG-snapshot import-order caveat, and narrowed the real DI gap to the specific one (analytics
  computeBalance singleton, the C77 Property-23 skip). Verified both claims against source; doc-only.*
- ~~**#5 branch-hygiene sweep — BRANCH_REVIEW.md refresh (C86)**~~ — *DONE C86: due per the C76 note
  (~10 cycles, branch now 36 commits). (1) zero stray untracked unit tests; (2) full validate:local green
  (1076 BE + 367 FE); (3) digest header 26→36 commits / +4355/−287, appended §17 (C76–C85: loop-improvement
  #2 CLOSED, coverage-baseline revival, the C82–C85 coverage arc, C77/C79 direction-call findings) + noted
  the arc is test/guard hardening with zero product change. BRANCH_REVIEW.md is gitignored. Next sweep ~C96.*
- ~~**#5 branch-hygiene sweep — BRANCH_REVIEW.md refresh (C76)**~~ — *DONE C76: due per the C66 note
  (~10 cycles, branch now 26 commits). (1) zero stray untracked unit tests; (2) full validate:local green
  (1046 BE + 367 FE; regress.sh Playwright-blocked); (3) digest header 16→26 commits / +3589/−287, appended
  §16 (C66–C75: import-trackers T2/T3, 2 contract guards, 2 arch dedups, 2 characterization deep-reviews, 2
  doc refreshes) + corrected the stale "T1+T2 inert until T3" merge note. BRANCH_REVIEW.md is gitignored.
  Next sweep due ~C86.*
- ~~**CLAUDE.md orientation refresh post-C58–C71 (C72)**~~ — *DONE C72: "Current state" listed
  import-trackers as "approved, NOT STARTED" but T1–T3 shipped (backend complete) — a fresh agent would
  re-plan done work; rewrote to backend-done / T4–T6-frontend-remaining with the honest eyes-on DoD. Also
  bumped stale test floors (~966→1038 be / ~355→367 fe). Verified drift against source first; doc-only.*
- ~~**#5 branch-hygiene sweep — BRANCH_REVIEW.md refresh (C66)**~~ — *DONE C66: first FULL run of the standing
  #5 cadence (C59 did only the untracked-test half). (1) zero stray untracked unit tests; (2) green baseline
  via validate:local (regress.sh Playwright-blocked); (3) the digest was BADLY stale — it described the OLD
  `feat/offline-entries` branch at 154 commits, but that squash-merged into origin/main and claude-loop-dev
  was rebased onto it, so the live branch is only 16 commits (C51–C65) off origin/main. Rewrote from real
  `git log origin/main..HEAD`: correct branch/scope/base, themed, with eyes-on-pending + Angelo-pending
  call-outs. BRANCH_REVIEW.md is gitignored (not committed). Next sweep due ~C76.*
- ~~**Land NORTH_STAR loop-improvement #3 (C59)**~~ — *DONE C59: the FE→BE→DB→render E2E feature-DoD
  rule (Angelo-approved 2026-06-09) was rolled out split — its BACKLOG "FEATURE DoD" pair landed C57 but the
  NORTH_STAR quality-bar half was cut by a 503, leaving the vision file inconsistent. Added the round-trip-E2E
  sentence to NORTH_STAR §3 (green build = FLOOR; harness-blocked E2E → "code-complete, eyes-on pending", not
  done). Verified against the approved #3 wording, not a self-authored vision change. Also confirmed the cheap
  half of the #5 cadence: zero stray untracked unit tests. All 5 loop-improvements now landed (#1 still needs
  live shell). Doc-only.*
- ~~**CLAUDE.md post-C52 orientation refresh (C53)**~~ — *DONE C53: "Current state" still listed the
  vehicle-stats reconcile (T3-part-3) as REMAINING, but C52 shipped it (additive `currentOdometer`) — a
  fresh agent would re-do done work. Rewrote to "T3-part-3 DONE, remaining T9 only", noted the two
  Angelo-flagged follow-ons (lease/loan consumer bug + card display call), bumped stale test floors
  (~962→966 be / ~345→355 fe). Doc-only, verified drift against source before editing.*
- ~~**CLAUDE.md maintenance-schedule status refresh (C47)**~~ — *DONE C47: the orientation doc was
  stale since C26 (said backend dormant-until-T4, frontend T6–T9 to-do) — but C31–C46 shipped the full
  backend + frontend T6/T7/T8. Rewrote to: backend COMPLETE, frontend T6–T8 (T7/T8 eyes-on-pending),
  remaining T9 + vehicle-stats reconcile. Bumped stale ~918 test floor → ~962 be / ~345 fe.*
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
