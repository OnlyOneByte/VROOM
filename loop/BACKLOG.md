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
   tests; caught + fixed a Zod-v4 exhaustive-record bug. **NEXT = T4/T5 (FRONTEND, eyes-on):** import-dialog
   mapping step — detected-source banner, per-field column dropdowns from the file headers, unit/date-format/
   target-vehicle pickers, category-remap table; reuse the existing preview/commit step; four-states + a11y +
   mobile. Then T6 e2e (incl. real-export signature validation). NOTE: T4–T6 are Playwright-eyes-on-blocked
   here, so the BACKEND of import-trackers (T1–T3) is complete but the feature isn't DONE until the FE→BE→DB
   round-trip e2e runs (feature-DoD rule) — lands "code-complete, eyes-on pending" like maintenance T7–T9.
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
   the backend seam `POST /reminders/trigger` is already built + deeply tested); T6 source-traceability UI ("Recurring"
   badge + link, reading the C96-surfaced sourceType); **T7 recurring-cost projection/lens (D4) — BACKEND CORE DONE C111**
   (`reminder-cost.ts`: monthlyRunRate / recurringCostSummary, +10 tests; REMAINING = the dashboard widget + a route to
   expose the summary, eyes-on); T8 round-trip E2E. Lands "code-complete, eyes-on pending" like maintenance T9 /
   import-trackers T4–T6 — the backend is fully built + characterized, so a human or unblocked Playwright closes the visible tail.

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
2. **Analytics route eyes-on** (per-vehicle + cross-vehicle + year-end), states + a11y.
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
> NEXT high-value low spots
> **(re-anchored to the C107 real reading — be 81.1% line / fe 61.4% line; FE now decisively the bigger gap, flat vs C81):**
> `body-limit.ts` (35% line size-enforcement branch), `sync/restore.ts`+`sync/routes.ts` (~32–61%, HTTP-harness-tractable);
> then the **frontend** components/routes deficit (61.4% line — steer FE guard cycles here, it's now the bigger gap). Route/
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
> **PENDING ANGELO (confirmed + traced C54, do NOT execute unilaterally — user-visible $ change):**
> **Lease/loan miles-used consume the period-scoped `currentMileage`.** `FinanceTab.svelte` passes
> `vehicleStatsData?.currentMileage` to both `PaymentMetricsGrid` (loan `mileageUsed`, line ~151) and
> `LeaseMetricsCard` (`currentMileage` → `calculateLeaseMetrics`, line ~173). But `vehicleStatsData` is
> fetched with the user's stats-period selector (`selectedStatsPeriod`, default `'all'`), and
> `currentMileage` is period-filtered + fuel-only. So picking "7d"/"30d" on the Overview tab silently
> **understates lease overage and loan miles-used** (and neither ever sees manual odometer entries).
> Miles-used is inherently all-time → the fix is a call-site swap to the C52 all-time `currentOdometer`
> field (`vehicleStatsData?.currentOdometer`). `calculateLeaseMetrics` itself is correct + well-tested;
> the landmine is documented inline at both FinanceTab call sites (C54). Decided fix, just needs the nod
> (it changes a displayed $ figure). When approved: swap both sites + a regression test asserting the
> projected excess fee is period-independent. *Sibling display call (#card semantics) stays with Angelo.*

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
- **#21 (MED) — replace-mode + an empty-but-valid backup = silent TOTAL data wipe.** `restoreFromBackup` mode='replace'
  (restore.ts:124-127) runs `deleteUserData` then `insertBackupData`; validation (backup.ts) only requires
  metadata.version/userId, so a corrupt/truncated download with empty data arrays passes, wipes everything, inserts nothing
  — atomically (the txn commits the empty state). No "payload must be non-empty / not implausibly smaller than current"
  sanity guard. FIX: reject replace-mode when the parsed payload is empty (or add a min-row / confirm-shrink guard). Also a
  small product decision (how aggressive a shrink to block). VERIFIED against source C108.
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

*(queue empty — repopulate as loop tooling / docs needs surface. #5 branch-hygiene sweep next due ~C120.)*
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
