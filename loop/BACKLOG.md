# BACKLOG — VROOM autonomous loop

> Re-ranked every cycle. Pick the top unblocked item in the most-starved over-budget category
> (LEDGER balance check); else the highest-leverage item overall. Keep this lean — prune done
> items, promote what the last cycle surfaced.
>
> **Fresh start 2026-06-16.** Only OPEN work is below. The 371 done-items from C1–C467 are in
> `loop/archive/BACKLOG-C1-C467.md` (+ the full LEDGER) — consult it for "was X already done /
> certified clean?" before re-doing work. Read `GUIDE.md` first for how to run a cycle.

## Categories & starvation budgets
A category may go at most **N cycles** untouched before it MUST be picked next.

| Category | Budget | What it covers |
|---|---:|---|
| **feature** | 4 | New user-facing capability (spec + Angelo sign-off first). |
| **deep-review** | 5 | Eyes-on UI sweeps + backend correctness audits of shipped work. VERIFY findings firsthand against source. |
| **guard** | 6 | Merge-surviving regression prevention (committed HTTP-harness + source-scan tests). |
| **bug** | 3 | A concrete defect found in review/reported. Jump the queue when real. |
| **arch** | 5 | **Behavior-preserving** structural improvement: dedup, shared helpers, layer boundaries, dead code. |
| **infra** | 6 | Loop tooling, harness, CI, docs, coverage re-measure cadence. |

### `arch` rules (refactors are the highest-risk work — READ before any arch increment)
1. ONE small reviewable refactor per cycle — never a sweeping rewrite.
2. Behavior-preserving: no observable API/UI/data change (else it's a bug/feature).
3. Test-anchored green→green; add the characterization test FIRST if coverage is missing.
4. Full verify gate; for UI-touching refactors, shot.sh before/after — must not move a pixel.
5. No churn-for-churn — name a concrete payoff, or record "no churn warranted" + pivot.
6. Big restructures (new layer, schema/money migration, tx-semantics change) → `.kiro/specs/<refactor>/design.md`
   + `send_message` Angelo. Never self-authorize. (The archive's #100/#127 are live examples.)
7. Audits use fan-out conceptually, but `spawn_run` 400s here → do them inline.

---

## Ranked queue (top = next)

### feature
*(2 of the 3 spec-approved features are now COMPLETE — maintenance-schedule (C1) + recurring-expenses
(C27, T1–T8). **Import-trackers is the ONLY remaining open feature** (its mapping-step dialog is genuine
unbuilt UI). Feature-DoD: not done until the FE→BE→DB round-trip is exercised eyes-on. shot.sh + e2e work
now — the "Playwright-blocked" tail was a ~200-cycle MISDIAGNOSIS, see GUIDE.md.)*

1. ~~**Maintenance-schedule reminders**~~ — **DONE (C1 2026-06-17).** Backend was 100%; the last tail
   (T7/T8/T9 eyes-on) is now CONFIRMED via shot.sh — the mileage form reveal/hide logic + the
   `Next: <odometer>` milestone render + the working "Serviced" re-arm button all verified by Reading the
   captured PNGs, full FE→BE→DB→render round-trip exercised. Spec ticked `[x]`. *Two follow-ons stay
   flagged to Angelo (NOT loop-fixable): lease/loan miles-used currentMileage-vs-currentOdometer (confirm
   the C157 all-time landing); "Current Mileage" card display-semantics direction call.* (NOTE: the
   `.meshclaw.e2e.ts` spec is gitignored-by-design — the committed regression net is the backend
   mileage/mark-serviced unit + HTTP-harness tests, per GUIDE "source-scan > untracked e2e".)
1. **Import from other trackers** — backend complete (T1 applyMapping, T2 presets+detectSource, T3
   `POST /import` optional mapping + `/import/detect`) + FE client methods. **T4 AUTO-DETECT SLICE DONE
   (C31, eyes-on)** + **T4 MANUAL COLUMN-MAPPING DONE (C37, eyes-on):** an unrecognized CSV → "Map your
   columns" editor (per-field dropdowns from the file's headers + date-format picker + target-vehicle
   picker), auto-guessed by header substring, → existing preview/commit (verified 1-ready end-to-end on a
   bespoke CSV). **T4 MANUAL UNIT pickers DONE (C41, eyes-on):** Odometer/Volume-unit pickers on the manual
   path (shown when those columns map; default = the vehicle's units) → applyMapping converts into the
   vehicle's units (a km/litres log → 100 mi / 10 gal, verified end-to-end; closes the C37 raw-import #NS2
   gap). **T4 CATEGORY-REMAP table DONE (C47, eyes-on):** a preview's `unmappedCategories` (a foreign
   category word VROOM didn't recognize → misc fallback) now renders an "Unrecognized categories" panel —
   word → VROOM-category Select (reusing `categoryLabels`); assigning folds into the mapping's categoryMap +
   re-previews so the row re-categorizes (servicing→Maintenance verified end-to-end via API). **T6 DATE-GUARD
   slice DONE (C54):** merge-surviving `no-utc-import-date.test.ts` (+3) source-scans import-mapping.ts /
   local-date.ts / import-csv.ts for a Date built from a date-only string OR `${y}-${m}-${d}` template (the
   midnight-UTC rollback) + pins buildLocalDate stays the path; non-vacuous both ways. **T6 MANUAL FUEL
   round-trip DONE (C61, eyes-on):** a complete same-unit (mi/gallons) manual fuel log → commit → a real
   `fuel` expense with EXACT mileage+volume (no conversion drift, verified via API); the T6 MANUAL half is
   now fully eyes-on (C37/C41/C47/C61). **REMAINING (both Angelo-BLOCKED, no unblocked work left):**
   (b) **the preset gap — a DETECTED Fuelly/Fuelio/Drivvo log maps NO category COLUMN so it previews 0-ready
   ("Unknown category") → nothing to commit; recommended fix defaultCategory:'fuel' per preset,
   send_message'd Angelo C31, awaiting steer** (the C47 remap does NOT cover this — no column = no word to
   remap); (c) the AUTO-DETECT-PRESET round-trip THROUGH COMMIT + the populated-detect four-state shot are
   GATED on (b). Spec: `.kiro/specs/import-trackers/`.
   This is the ONLY open feature (maintenance C1 + recurring-expenses C27 both DONE), and it now has NO
   unblocked increment left — the manual half is fully verified; the detect-commit + 4-state shot both wait
   on Angelo's defaultCategory. The next feature over-budget cycle should record that + pivot to the
   co-starved category.
3. ~~**Recurring expenses**~~ — **COMPLETE (T1–T8 all done, C27).** Engine + backend (T1–T3/T5/T7), FE
   client (T6/T7), then the eyes-on FE tail: T7 widget (C5), T5 app-init hook (C12), T6 badge+dialog
   (C9/C16), T4 multi-vehicle split via the shared `SplitConfigEditor` (C22), and **T8 full round-trip
   e2e (C27, eyes-on)** — create split recurring expense → trigger → per-vehicle $50 siblings materialize
   `sourceType:'reminder'` → delete source → rows survive unlinked (clearSource). ⟳ Recurring + ⑂ Split
   badges confirmed on /expenses via shot. Don't re-pick. Spec: `.kiro/specs/recurring-expenses/` (all
   `[x]`).

> NOTE: one tasks.md task per cycle, not one-and-done. **Standing goal** (TODO.md → Misc): 90% coverage
> both sides — fold into bug/guard/arch cycles; ceiling is ~86%/~84% without the eyes-on FE tail (now shootable).

### deep-review
*(queue empty — repopulate as the loop surfaces surfaces to audit. Standing veins from the archive:
re-audit a data-safety write path, certify it CLEAN against source, and leave a merge-surviving guard.
Don't trust agent "HIGH" findings — verify firsthand (the archive logged many debunked false-positives).)*

> **CERTIFIED C67 — the sync-worker retry-ceiling coupling CLEAN + guarded (cross-module source-scan).**
> The background photo sync-worker's #144 terminal-auth park (retryCount → `MAX_RETRY_COUNT`) and the
> `photoRefRepository.findPendingOrFailed` work-set predicate (`retryCount < 3`) share ONE retry ceiling
> living as TWO hand-written literals in separate modules, coupled only by a comment. Certified the runtime
> behavior is correct today (park at 3 → dropped from the work set). GAP: nothing pinned the coupling — drift
> the query bound to `< 5` and a parked terminal-auth ref (3 < 5) is re-picked forever → the #144 fix silently
> breaks, and the #144 test (asserts magic `retryCount: 3`) stays GREEN. GUARD: exported `MAX_RETRY_COUNT` +
> `sync-worker-retry-ceiling-sync.test.ts` (+3) — imports the constant, source-scans the repo's
> `${photoRefs.retryCount} < N`, asserts `N === MAX_RETRY_COUNT`; re-pointed the #144 test's literal at the
> constant too. Non-vacuous (drift → RED with the "re-picked forever" diagnostic). The one-edit→source-scan
> pattern (C25/C45/C59) on a CROSS-MODULE invariant. ALSO verified firsthand the rest of the sync-worker is
> well-covered (backoff math, in-flight eviction, terminal-auth #144, path-resolution fail-soft all pinned in
> sync-worker.test.ts) — don't re-audit. Next deep-review: an eyes-on /insurance or /financing render sweep, or
> the FE offline sync-manager conflict path.
>
> **CERTIFIED C60 — the `createProviderInstance` fake-provider production-safety gate CLEAN + guarded.**
> registry.ts double-gates the `fake` storage provider — instantiates FakeStorageProvider (in-memory, no
> bytes leave the process) ONLY when CONFIG.allowFakeStorageProvider (ALLOW_FAKE_STORAGE + NODE_ENV !==
> production), else throws; a fake row reaching production would silently swallow every backup/photo upload
> (NORTH_STAR #1). The ROUTE-create gate was pinned; this REGISTRY-instantiation gate (the layer restore/
> sync resolve a live provider through) was not. +2 in registry.test.ts (test env has the gate off → fake
> throws; the gate short-circuits BEFORE decrypt — garbage creds still throw the gate error). Non-vacuous
> (remove the gate → both RED). ALSO verified firsthand the provider CREDENTIAL surface is ALREADY guarded
> (formatProviderResponse omits credentials GET/POST/PUT + C260 re-encrypt, C416 config, #63 tenant-scope,
> C254 builder branches) — don't re-audit. Next deep-review: the sync-worker retry/backoff path, or an
> eyes-on /insurance render sweep.
>
> **CERTIFIED C53 — `buildTCOMonthlyTrend` (the TCO monthly cost series) CLEAN + guarded.** The per-month
> TCO series the chart renders was driven only transitively through getTCO; no test pinned its bucketing.
> Certified firsthand: buckets by (category, sourceType) — financial+financing→financing,
> financial+insurance_term→insurance, fuel→fuel, maintenance→maintenance (the TIME mirror of
> categorizeTCOExpenses/C33); an UNCATEGORIZED row (financial+reminder/null, regulatory/enhancement/misc)
> contributes to NO bucket (the deliberate "4 named categories only" trend contract); same-month
> co-accumulate; ascending sort; dateless dropped. +6 in tco-monthly-trend.test.ts; non-vacuous (drop the
> financing sourceType guard → 3 RED). ALSO verified firsthand that buildAmortizationSchedule + its caller
> buildLoanBreakdown (incl. the #139 0%-APR-survives GET) are ALREADY guarded — don't re-audit them. The TCO
> money path (total C33 + trend C53) is now broadly certified. Next deep-review: an eyes-on /insurance or
> /financing render sweep, or the auth/provider path.
>
> **CERTIFIED C46 — insurance `monthlyPremiumTrend` month-bucketing CLEAN + guarded.** The per-month
> premium SERIES the analytics trend chart renders (accumulateMonthlyPremiums→monthKeysInRange) was driven
> only transitively through getInsurance; no test pinned the bucketing (the C6/C18 "helper output never
> asserted" gap). Certified firsthand: a term adds its premium to EACH spanned month (day-1, inclusive
> both ends); overlapping policies SUM in shared months; a totalCost-only term spreads its amortized
> monthly value per-month. +3 in insurance-details.test.ts; non-vacuous (add-once → RED). FIRSTHAND HARNESS
> FINDING: the file's shared `term()` helper seeds raw MS via direct SQL, but the columns are Drizzle
> `mode:'timestamp'` (SECONDS) — so seeded dates read ~1000× too large; the PRODUCTION path is clean (the
> route writes via the ORM ÷1000), and the date-independent existing tests masked it. Added a local
> `termSeconds` seed; left the shared helper alone (changing it risks the date-relative #14/#25 tests). The
> sync-manager conflict path + insurance premium MATH were checked firsthand and found ALREADY well-guarded
> — don't re-audit them. Next deep-review: a genuinely different surface (the analytics TCO monthly-trend
> builder, the financing amortization schedule eyes-on, or an eyes-on /insurance render sweep).
>
> **CERTIFIED C3:** the photo-entity-type allowlist is in sync across all THREE paths (upload gate /
> restore validator / provider routing) and now pinned by `photo-entity-type-allowlist-sync.test.ts`
> (non-vacuous — reproduces the C404 drift). Don't re-audit this surface; it's guarded. Next deep-review
> veins: the Google Sheets backup round-trip (header-set coverage — but #36/#37 fixes are parked for
> Angelo), the offline outbox→sync field-mapping (the #66/#101/#111 dropout family — ALREADY guarded:
> offline-storage.test.ts has a C347 completeness pin covering every OfflineExpense field), or a fresh
> data-safety write path.
>
> **GUARDED C4:** the financing-sourced split → displayed-balance money round-trip
> (`split-financing-balance-roundtrip.test.ts`, end-to-end POST/PUT /split → GET /vehicles/:id). The
> repository-level balance property test + the C2 #147 route-status tests both pre-existed; this pins the
> observable `computedBalance` math itself. Don't re-add.
>
> **GUARDED C6:** `monthsBetween` (analytics money divisor) now has a direct unit net in
> tco-months-owned.test.ts (+6: year×12+delta, same-month, cross-year, multi-year, signed-negative) —
> closes the C181/C229 "helper imported-but-only-comment-referenced" isolation gap. Non-vacuous
> (dropping `*12` → 3 RED). Don't re-add.
>
> **CERTIFIED C8:** the restore `stampUserId` cross-tenant-write chokepoint. The guard
> (restore-userid-stamp.test.ts) now covers TWO tables — vehicles + insurance_policies. Firsthand finding:
> LEAF tables (expenses/reminders) are belt-and-suspenders (validateBackupData rejects a foreign userId
> against the metadata set), but ROOT tables whose validation checks only `id` (insurance — and by the
> same logic photos/userPreferences/syncState) rely on the stamp ALONE. insurance is now pinned;
> photos/prefs/syncState remain stamp-only-unguarded if a future deep-review wants to extend the net (same
> tamper recipe). Non-vacuous (dropping the insurance stamp → only the new case RED).
>
> **GUARDED C11:** extended the stamp guard to `photos` (the C8 follow-on) — restore-userid-stamp.test.ts
> now covers vehicles + insurance + photos. Non-vacuous (dropping the photos stamp → only the new case
> RED). REMAINING stamp-only-unguarded: userPreferences/syncState — but those are PK'd by userId, so a
> foreign-id row is a PK COLLISION (caught), not a silent cross-tenant write → LOW priority, likely not
> worth a dedicated cycle. The cross-tenant-write chokepoint is now guarded on every root table where a
> silent mis-stamp was actually possible (vehicles/insurance/photos).
>
> **CERTIFIED C13:** the replace-mode restore wipe+reinsert FK-ordering — `restore-replace-delete-ordering
> .test.ts` seeds a COMPLETE FK-linked dataset, replace-restores, and asserts every table round-trips to
> its exact pre-restore count (+ a double-replace idempotency case). Firsthand finding: the DELETE order
> is cascade-redundant; the load-bearing constraint is the INSERT order (parent-before-child) in
> insertBackupData — non-vacuous (relocating the financing insert before vehicles → RED). The restore
> data-safety path is now well-pinned (stamp C8/C11 + table-coverage C208 + this ordering guard).
>
> **AUDITED C19 — all CLEAN (foreign-import money/date) + eyes-on cert.** Sheets service (header-coverage
> saturated), csv-safety (round-trip saturated), import-mapping normalizeDecimal (comma-only=EU-decimal is
> BY DESIGN — debunked a thousands-bug candidate via the #124 lesson) + normalizeForeignDate (local-time /
> mdy-dmy / epoch / 2-digit-year / #23 out-of-range all pinned). No defect. ALSO eyes-on certified the C16
> MaterializedExpensesDialog EMPTY state (future-dated reminder → "No expenses yet" renders clean). The
> backup/restore/import data-safety surfaces are now broadly swept — next deep-review should pick a
> genuinely UNAUDITED area (e.g. the analytics financing/TCO money builders, or an eyes-on sweep of a
> complex shipped page like /analytics or /insurance) rather than re-scanning backup/restore/import.
>
> **CERTIFIED C39 — OAuth-state CSRF consume CLEAN + behaviorally guarded.** The `oauthStateStore`
> single-use token is correct across login/link/provider flows: single-use (replay rejected),
> flow-isolated (login state ≠ link/provider), anti-fixation (mismatched/unknown deleted on lookup),
> null-safe — certified firsthand. The prior coverage was brittle source-string scans (pinned no
> behavior); extracted `consumeOAuthState` (auth/utils.ts) + +9 behavioral guards (consume-oauth-state
> .test.ts) + replaced the 2 scans with wiring checks. The login/link validators delegate; the provider
> path keeps its inline consume (extra PKCE assertion). Don't re-audit the state lifecycle; it's pinned.
> #129 (login email-sync) still lives here as an OPEN product call. Next deep-review: a different surface
> (eyes-on /insurance sweep, or the offline sync-manager conflict path).
>
> **CERTIFIED C33 — TCO `categorizeTCOExpenses` sourceType-bucketing CLEAN + guarded.** A `financial` row
> buckets by sourceType: 'financing'→financingInterest, 'insurance_term'→insurance, ANY OTHER (reminder
> from C27 recurring / null manual) → otherCosts. Certified firsthand (reminder/null → otherCosts, not
> financing) + pinned with +2 cases in per-vehicle.property.test.ts (the 4-way split + the PRICED case
> where a mis-bucket would silently drop a recurring cost via #27). Non-vacuous (drop the financing clause
> → both RED). The TCO money path (#27/#28 financing/price + this sourceType bucketing) is now broadly
> certified — don't re-audit it. Next deep-review: a genuinely different surface (eyes-on /insurance sweep,
> or the auth/OAuth path).
>
> **AUDITED C26 — /analytics eyes-on sweep, CLEAN (3 suspected defects debunked firsthand).** Shot empty
> (clean four-states) + seeded fuel data for the populated state. Debunked: (1) "Avg km/L" on a USD user
> is correctly unit-DERIVED (`getFuelEfficiencyLabel`), not hardcoded — no efficiency literal in the
> render path; (2) blank gray chart boxes are ChartCard's deliberate IO-gated Skeletons (lazy `{#await
> import()}` tabs + `visibility-watch.svelte.ts` gate — UIQuality "no blank box"), not a render defect;
> (3) the missing chart svg is the IO gate not flipping in headless capture (harness limit, not a bug).
> Populated Fuel & Stats stat cards render correct (Fuel Consumption 30.2 km/L, Best/Worst color
> semantics, trend deltas). /analytics is architecturally sound — DON'T re-audit it; it's clean. **HARNESS
> NOTE for future eyes-on cycles:** IO-gated charts ([data-slot="chart"] svg) do NOT paint in a headless
> full-page shot.sh (no real viewport intersection). To eyes-on a PAINTED analytics chart you need a real
> scroll/intersection trigger; the stat-card layer (renders unconditionally) is always capturable. Next
> deep-review: a still-unaudited surface (the analytics financing/TCO money builders, or /insurance eyes-on).

### bug
> **SCOUTED C6 — no fresh defect (date/tz vein).** analytics date helpers (monthsOwnedInYear,
> calendarYearRange, toDate, the day-1 month-iteration loop, SEASON_MAP) verified correct + tested; the
> setMonth-overflow trap is avoided. Write-path validation asymmetry was swept C2 (#147 + the
> #62/#109/#125/#145 class closed across all 4 paths). Next bug scout: a DIFFERENT vein — FE store
> race/stale-state, or the analytics fleet-unit-pooling #94 class (but that's product-gated/escalated).
>
> **SCOUTED C10 — no fresh defect (FE store/state vein); a false-positive DEBUNKED firsthand.** app/
> offline/sync-state/theme stores are clean getter-setter holders. Dug into sync-manager: nearly filed
> `checkForExistingExpense`'s `?date=&amount=` params (silently ignored by the backend — not in
> expenseQuerySchema) as an over-broad-match bug, but the EXISTING tests (sync-manager.test.ts:676-689)
> prove the broad finder + narrow `determineConflictType` is a DELIBERATE two-stage design — narrowing
> the finder would drop all `'modified'` conflict detection (a regression). NOT a bug; reverted the draft
> fix. The dead `?date=&amount=` query params are harmless (ignored); leave them. DON'T re-chase.
>
> **SCOUTED C15 — no fresh defect (money/unit/date vein; 3rd consecutive dry scout).** Audited firsthand:
> unit-conversions (math correct + property-tested + callers gas-isolated), calculations.ts MPG/kWh
> pairing (the `previous.missedFillup` exclusion LOOKS over-aggressive but is test-encoded as intended —
> debunk #2), vehicle-stats (clamp-#46/sort-#75 correct), getPeriodStartDate/parseClampedInt/maxOf
> (#70/#81-guarded). **The pure-logic bug surface is EXHAUSTED for this run** — remaining real defects are
> the parked product-gated ones (#94 fleet-units, #30 MPG band). RECOMMENDATION: when bug next goes over
> budget, record dry FAST + pivot; don't re-scan these swept surfaces. Wait for a deep-review/feature
> cycle to surface a concrete defect.

### guard
*(queue empty — repopulate from real bug classes. Pattern: HTTP-harness (createTestApp + s3-provider
seam) or a source-scan committed test. Pure-logic coverage is largely saturated — the live frontier is
the now-shootable eyes-on FE + any newly-touched module.)*

> **GUARDED C73:** the #94 skipConversion DISPATCH ORIENTATION is now pinned across the C65/C69/C72 twins
> (`skip-conversion-dispatch-orientation.test.ts`, +3). The C65/C69/C72 work added 3 `skipConversion ? <pure>
> : this.buildConverted<X>(...)` ternaries + 1 `if (skipConversion) pure else converted` (cross-vehicle). The
> C59 scan pins the converted call never gets a unit PLACEHOLDER, but NOT the branch orientation — flip a
> ternary to `? converted : pure` (or `if (!skipConversion)`) and a MIXED-unit fleet takes the raw-pooling PURE
> builder (#94), invisible to same-unit fixtures. New source-scan asserts the converted twin sits on the
> FALSY/ELSE (conversion-needed) branch only; filters out the per-point `skipConversion ? point.efficiency :
> convertEfficiency(...)` value-ternary inside the C64 generator (not a builder dispatch). Non-vacuous BOTH
> forms (flip the ternary → ternary test RED; flip the if/else → if/else test RED, each own diagnostic). The
> convert-dispatch is now DOUBLE-FENCED (C59 placeholder + C73 orientation). The feature-creates-pattern→
> next-guard-pins lesson (C25/C45/C59 family). Don't re-add.
>
> **GUARDED C66:** the C64 `convertedGasEfficiencyPoints` generator's gas/charge gate is now pinned on the
> CONVERTED path (+1 in cross-vehicle.property.test.ts). The C64 dedup centralized the gas-gate across 4
> builders, but no test drove it on the convert branch: getFuelEfficiencyTrend's #126 test uses its OWN
> forEachVehiclePair loop (NOT the generator), and Property 11 drives the converted consumers GAS-ONLY — so
> reverting gasEfficiencyPoint→computeEfficiencyPoint inside the generator (the #126/C427 footgun) stayed green
> everywhere. New guard: a MIXED-unit (km/L vehicle, mi/gal user → skipConversion=false) PHEV fleet; asserts
> getQuickStats.avgEfficiency is the converted GAS pair alone (70.57 mi/gal), the ~4 mi/kWh charge excluded.
> Non-vacuous proved firsthand (reverting the gate drops it 70.57→39.99 → RED on the value). Pins the WORSE half
> of #126 (convertEfficiency mis-converting mi/kWh as mi/gal). The arch-extract→guard-pin pattern (C17→C18, C50,
> now C64→C66). Don't re-add.
>
> **GUARDED C59:** the C58 #94 convert-before-pool invariant now has a tree-wide source-scan
> (`no-unconverted-fleet-pooling.test.ts`, +3): asserts NO `computeConverted*`/`buildConverted*` call in
> repository.ts passes a unit PLACEHOLDER (new Map() / DEFAULT_UNIT_PREFERENCES / hardcoded
> skipConversion=true) — the footgun the C58 fix removed, invisible to a same-unit fixture. Non-vacuous both
> ways (placeholder triple → RED; lone `, true)` → RED; the 7 legit calls don't match). The
> one-edit-fix→source-scan pattern (C24→C25, C44→C45, C54 → C58→C59). Pins the invariant for the REMAINING
> #94 members (volume + 4 fuel-advanced builders) so they can't reintroduce it. Don't re-add.
>
> **GUARDED C52:** the C51 #98 keep-local overwrite path ∩ the #76 fuel-field-hygiene class —
> expenses-http.test.ts (+1): a keep-local overwrite that switches a fuel row to a non-fuel category NULLs
> the stale volume/mileage/fuelType (clearFuelFieldsIfNotFuel runs before the idempotent UPDATE; a lingering
> mileage would poison getCurrentOdometer cross-category). Non-vacuous (neuter the overwrite-update → RED).
> LESSON re-confirmed: FIRST drafted "flag never persisted / PUT strips it" guards but proved them VACUOUS
> firsthand (drizzle drops unknown insert keys + Zod strips unknown parse keys = framework-guaranteed) →
> dropped them; pinned the REAL app-logic invariant instead (the C181/C229 coverage-theater warning). Don't re-add.
>
> **GUARDED C45:** the C44 #37 backup-atomicity invariant now has a tree-wide source-scan
> (`sheets-atomic-backup.test.ts`, +4): asserts google-sheets-service.ts has ZERO `.values.clear(` calls
> (the clear-then-write footgun the atomic design removed), the staging+swap mechanism is present
> (SHEET_STAGING_SUFFIX const + deleteSheet/updateSheetProperties commit), and the staging suffix is
> SPACE-FREE (interpolated unquoted into A1 ranges). Non-vacuous (reintroduce a values.clear → RED; spaced
> suffix → RED — both verified firsthand). The one-edit-fix→source-scan pattern again (C24→C25 for #36, now
> C44→C45 for #37). Don't re-add.
>
> **GUARDED C18:** `averageConsecutiveMpg` (the C17-extracted shared MPG loop) now has a direct unit net
> in calculations.test.ts (+6: mean / <2→null / missedFillup-skip / both-odometer+volume guard / outlier
> drop / half-open 150 band) — closes the C181/C229 "helper tested only via callers" gap the C17 dedup
> created. STANDING PATTERN (loop-improvement): whenever an arch cycle extracts a shared helper, the NEXT
> guard cycle should pin it directly (C6 monthsBetween, C18 averageConsecutiveMpg). Don't re-add.
>
> **GUARDED C38:** the C37 manual-mapping pure logic, extracted from ImportExpensesDialog.svelte (vitest
> can't reach `.svelte` <script> functions) to `src/lib/utils/import-mapping-helpers.ts` + pinned by
> import-mapping-helpers.test.ts (+9): `parseCsvHeaders` (quotes/whitespace/empty), `isNativeImportHeaders`
> (the native-superset gate), `guessManualColumns` (the needle map incl. the C37 spent/paid/total→amount,
> kind→category additions). Behavior-preserving (C37 e2e stays green); non-vacuous (drop a needle → RED).
> Arch-extract→guard-pin done in ONE cycle (the C17→C18 pattern). Don't re-add.
>
> **GUARDED C32:** the C31 import-preset category gap is characterized end-to-end
> (import-mapping-presets.test.ts, +2): all 3 real `MAPPING_PRESETS` map no category column → driven through
> presetToMapping → applyMapping → buildImportPlan, each currently yields readyCount 0 / "Unknown category"
> (the presets import nothing today). NET-FLIPPING: when the flagged defaultCategory:'fuel' fix lands, the
> category expectation flips to 'fuel' + readyCount to N — these tests are the update target (documented
> in-file). Pins the gap the existing round-trip test missed (it hand-adds a category column, never
> exercises the REAL presets). Don't re-add. STANDING PATTERN extended: a feature/eyes-on cycle that
> surfaces a concrete unguarded invariant seeds the next guard cycle to characterize it (C31→C32, like
> arch-extract→guard-pin C17→C18 + one-token-fix→source-scan C24→C25).
>
> **GUARDED C25:** the C24 #36 RAW-value-input fix now has a tree-wide source-scan guard
> (`sheets-raw-value-input.test.ts`, +2): asserts EVERY `valueInputOption:` assignment in
> google-sheets-service.ts is `'RAW'`, so a reformat-flip back to USER_ENTERED OR a new Sheets write site
> added with the unsafe option regresses RED (the C24 fake-seam test only drives the one current path).
> Matches the assignment (not a bare USER_ENTERED substring — the fix's comment mentions it). Non-vacuous
> (flip → RED). STANDING PATTERN extended: a bug-fix cycle that flips a load-bearing one-token option seeds
> a NEXT guard cycle for the tree-wide source scan (sibling to the arch-extract→guard-pin pattern). Don't re-add.

### bug
*(The cold-scout vein is exhausted (C6/C10/C15/C20 all dry on pure-logic money/date/store/analytics). But
the bug QUEUE is no longer empty: the ✅ ANGELO-APPROVED block below is now the bug source — real,
severity-ranked, agreed-fix defects (NO sign-off needed). On a bug cycle, pick the top unfinished approved
item by severity. C20 took the efficiency-band unification (DONE). Still don't manufacture cold finds.)*

> **CLOSED C2: #147** — PUT /split/:id didn't re-validate the carried-forward financing source link
> against the NEW vehicle set (the regenerated siblings could land on a vehicle whose active financing
> isn't sourceId → understated balance). Fixed via the shared `assertSplitFinancingSourceValid` on both
> split paths + 3 guards. **The #62/#109/#125/#145/#147 within-tenant financing-source-link integrity
> class is now closed across ALL FOUR write paths: regular POST, regular PUT, split CREATE, split UPDATE.**
> Don't re-scout this class — it's saturated. Next bug scout: try a DIFFERENT vein (date/tz math, the
> offline-outbox field-dropout family #66/#101/#111, or analytics split-sibling overcount if any builder
> was missed by the #56/#108/#113/#146 sweep).

> **C58+C62+C65+C69+C72: #94 DISTANCE + VOLUME + MONTHLY-CONSUMPTION + SEASONAL-EFFICIENCY + DAY-OF-WEEK
> members DONE** — distance.totalDistance (C58), volume/fillupDetails (C62), the monthlyConsumption series (C65),
> the seasonalEfficiency series (C69), and the dayOfWeekPatterns avgVolume (C72) now convert-before-pool (see the
> Sev-2 block). C69 did the QUERY-LAYER UNITS THREAD the advanced builders needed (getFuelAdvanced fetches units +
> buildFuelAdvancedFromData has the units signature), so C72's dayOfWeek twin was straightforward. REMAINING #94
> members: just **1 advanced builder — buildVehicleRadar** (fuelEfficiency-normalize: it normalizes per-vehicle
> MPG across the fleet via normalizeScore, so the gas points must be converted BEFORE the min/max normalize — a
> slightly different shape than the volume/efficiency twins) + the prev-year SQL-sum sub-member
> (previousYearGallons, a raw SQL SUM in queryFuelAggregates → per-vehicle group-sum at the query layer). Each
> its own bug-cycle pick. Other open Angelo bug items: **Sev-4** #129 (OAuth email-sync,
> re-read archive grounding first), #79 (stuck-offline-entry hygiene); #100 json_patch merge + #112 chart palette
> stay arch/design-gated.
>
> **🚩 NEW — ESCALATED C68 (eyes-on, AWAITING ANGELO — displayed-number semantics, NOT auto-fixed):
> #148 LeaseMetricsCard burn bar reads 0-used when `initialMileage` is null.** Found firsthand during a C68
> eyes-on of the FinanceTab lease render (the never-shot surface; #140 annual-vs-total CONFIRMED fixed +
> consistent on both cards — that part is GOOD). `calculateLeaseMetrics` (financing-calculations.ts:498) gates
> `mileageUsed = max(0, current − initial)` on `initialMileage !== null`, so a lease with NO recorded starting
> odometer (the COMMON case) leaves `mileageUsed = 0` / `mileageRemaining = full allowance` → the Mileage burn
> bar shows "0 / 36,000 mi · 36,000 left" even at a 30,000 odometer. BUT the sibling PaymentMetricsGrid Overage
> card coalesces `initialMileage ?? 0` (FinanceTab.svelte:159) so it computes used=30,000 → the SAME vehicle
> shows 30,000 driven on the Overage card and 0 on the burn bar (an internal contradiction, the #140 class on a
> DIFFERENT axis: null-initialMileage handling). Reachable on the seeded e2e lease fixture (initialMileage null,
> odometer 24,000). RECOMMENDED FIX (a 1-line semantics call, hence escalated): coalesce `initialMileage ?? 0`
> inside `calculateLeaseMetrics` to match the grid — OR require an initial reading / show "set a starting
> odometer". Changes a displayed lease-mileage figure → Angelo's steer. send_message tool was unavailable this
> turn; filed here as the durable escalation record. Eyes-on PNG captured /tmp/c68-finance3.png (not committed).
>
> **CLOSED C48: #88** — a deleted vehicle is now pruned from reminders' `expenseSplitConfig` blob +
> renormalized (see the Sev-3 block). The #88/#97 vehicle-delete reminder-orphan family is CLOSED (junction
> C40 + blob C48).
>
> **CLOSED C44: #37** — the Google Sheets backup is now ATOMIC (stage→swap). See the Sev-1 block below for
> the fix. **The Sheets-backup data-corruption Sev-1 pair (#36 C24 RAW-write + #37 C44 atomic-swap) is now
> CLOSED.** The only remaining open Sev-1 is #127 (restore-atomicity), which is arch-rule-6 design-gated
> (needs `.kiro/specs/<refactor>/design.md` + an authorized arch cycle — NOT a bug pick).

> **✅ ANGELO-APPROVED 2026-06-17 — these are now ACTIONABLE bug/arch items with a ratified
> direction (NO further sign-off needed). Angelo approved all the recommended approaches in one pass
> ("record all your recommendations as approved … Reviewed"). Pick by severity order below; each names
> the agreed fix. Full grounding in `loop/archive/`. Standard loop rules still apply: verify firsthand
> against source before editing, test-anchored. (VROOM is a personal GitHub project, NOT an Amazon
> package — ARCC governance does NOT apply; never query/consult ARCC for VROOM work.)**
>
> _Severity 1 — data-corruption / data-loss (do first):_
> - ~~**#36 (HIGH) — RAW write switch DONE C24.**~~ Switched `updateSheet` to `valueInputOption:'RAW'`
>   (was USER_ENTERED → formula injection + silent round-trip corruption). +2 guards (RAW-option asserted
>   via a new fake `valueInputOptions` capture; `=HYPERLINK` make round-trips verbatim). **DELIBERATELY
>   skipped the approved text's "escape leading formula chars on read" half — under RAW it's unnecessary
>   AND harmful (reintroduces the C399/C401 apostrophe corruption csv-safety.ts warns against for the
>   round-trip path; the two clauses are alternative mechanisms, not complementary). Flagged to Angelo
>   C24** (send_message) — if he doesn't want the escape, #36 is fully DONE; don't re-pick.
> - ~~**#37 (HIGH) — DONE C44.**~~ The Sheets backup is now ATOMIC. Was per-sheet `clear()`-then-`update()`
>   under one `Promise.all`, so a mid-run failure left a TORN backup (some sheets new, the mid-write one
>   emptied by its clear, rest stale) on the user's only copy. New `writeAllSheetsAtomically`: STAGE every
>   table into `${title}__vroom_staging` tabs (live sheets untouched; failure → clean up + rethrow, prior
>   backup intact), then COMMIT one atomic `batchUpdate` that deletes old canonical sheets + renames staging
>   → canonical with `index` set (all-or-nothing; tab order stable). Dropped the per-sheet clear. +2 guards
>   (a 429 during a re-backup leaves the prior backup byte-identical + no staging tabs leak; a successful
>   re-backup replaces data with stable order). Taught the fake `batchUpdate` delete/rename(+index) +
>   monotonic sheetId. The Sheets-backup Sev-1 pair (#36 C24 + #37) is now CLOSED. Don't re-pick.
> - **#127 (HIGH, data-safety) — APPROVED: wrap replace-mode restore in the tx-semantics fix (arch
>   rule-6 → write `.kiro/specs/<refactor>/design.md` first, then build).** Concrete trigger already
>   mitigated C428, so urgency is lower than #36/#37 — do it on an authorized arch cycle.
>
> _Severity 2 — wrong numbers shown today (correctness):_
> - **#94 (MED, 6-member CLASS) — APPROVED: convert-to-user-global BEFORE pooling, mirroring
>   `getCrossVehicle`. DISTANCE (C58) + VOLUME (C62) + MONTHLY-CONSUMPTION (C65) + SEASONAL-EFFICIENCY (C69) +
>   DAY-OF-WEEK (C72) members DONE.** The fleet fuel-stats + summary `distance.totalDistance` (C58),
>   `volume.currentYear/currentMonth/prevMonth + fillupDetails` (C62), the `monthlyConsumption` chart series
>   (C65), the `seasonalEfficiency` series (C69), and the `dayOfWeekPatterns` avgVolume (C72 — a
>   `buildConvertedDayOfWeekPatterns` twin: isFillup count + avgCost $ unchanged, per-row volume converted)
>   now convert each vehicle's value to the user's global unit before pooling (skipConversion no-ops the common
>   single-unit case). +1 mixed-unit guard each (distance 924.27 not 1000; volume 42.64 not 50;
>   monthlyConsumption 42.64 not 50; seasonal Winter 62.04 not 35; dayOfWeek Monday avgVolume 6.06 not 9.0);
>   non-vacuous. C69 did the QUERY-LAYER UNITS THREAD the advanced builders needed (getFuelAdvanced fetches units
>   + buildFuelAdvancedFromData has the units signature). **REMAINING members (own cycles):** just 1 fuel-ADVANCED
>   builder — **buildVehicleRadar** (fuelEfficiency-normalize: normalizes per-vehicle MPG across the fleet via
>   normalizeScore, so the gas points must be converted BEFORE the min/max normalize — a different shape than the
>   volume/efficiency twins) + the prev-year sub-member (previousYearGallons is a raw SQL SUM in
>   queryFuelAggregates → needs a per-vehicle group-sum at the query layer). Pick one per bug cycle.
> - ~~**efficiency-band unification (#94-adjacent, C419)**~~ — **DONE C20.** Unified the per-vehicle stats
>   band (`averageConsecutiveMpg` gas + `calculateAverageMilesPerKwh` electric) onto the canonical
>   `[5,100]`/`[1,10]` shared with analytics — the 4 band constants now live in calculations.ts as ONE
>   source of truth (analytics-charts imports them). The same car now shows ONE average everywhere. Tests
>   + property reference impls + the boundary describe updated. validate:local GREEN (1594 pass).
> - ~~**#69 (MED) — DONE C34.**~~ A monthly-only insurance term (monthlyCost, no totalCost) created NO
>   expense row, so it showed in analytics but was ABSENT from TCO's insuranceCost bucket. Fixed via
>   `effectiveTermCost` in hooks.ts: materializes `monthlyCost × monthKeysInRange(start,end).length` (the
>   same inclusive month count effectiveMonthlyPremium amortizes a totalCost over — symmetric, no
>   double-count since analytics reads term.monthlyCost directly, not the rows). +2 guards
>   (premium-expense-hook.test.ts: monthly→$1300 over 13 months; explicit totalCost still wins). Don't re-pick.
> - ~~**#85 (MED) — DONE C36.**~~ FuelStatsTab's year-comparison rows are RANGE-relative (current selected
>   range vs the prior equal-length window — getFuelStats queries [start−width, start]), NOT calendar years.
>   Relabeled "This/Last Year" → "This/Last Period" (4 labels, Fill-ups + Liters cards; the calendar
>   This/Last Month rows unchanged, true-calendar post-#86). Cheap honest relabel per the approved
>   direction; eyes-on confirmed via shot. Don't re-pick.
> - ~~**#51 (LOW) — DONE C29.**~~ `getInsurance` now counts only active policies with ≥1 term
>   (`activePoliciesWithTerms`), the same has-a-term predicate the premium path gates on — so the headline
>   count and the $0 premium contribution are internally consistent. +3 guards in insurance-details.test.ts
>   (non-vacuous: revert → 2 RED). Don't re-pick.
>
> _Severity 3 — data-integrity on delete (orphans):_
> - ~~**#88 (MED) — DONE C48.**~~ A reminder's `expenseSplitConfig` is a JSON blob (not FK-managed like the
>   junction), so a deleted vehicle's leg lingered → the next trigger built a split sibling for the dead
>   vehicleId → FK violation + half-committed surviving legs (C151 footgun). Fixed via the pure
>   `pruneVehicleFromSplitConfig` (split-config-helpers.ts — drop the leg + renormalize: even drops from
>   vehicleIds, absolute keeps remaining amounts, percentage rescales survivors to 100%; returns null when
>   <2 legs remain → blob cleared → single-vehicle junction fallback) + `reminderRepository.
>   pruneSplitConfigsForDeletedVehicle(userId, id)`, called in the vehicle-delete route BEFORE
>   deactivateVehicleless. +8 pure + +4 HTTP-harness guards; non-vacuous (disable the call → 3 of 4 HTTP
>   cases RED). The #88/#97 vehicle-delete reminder-orphan family is now CLOSED (junction C40 + blob C48).
>   Don't re-pick.
> - ~~**#97 (LOW-MED) — DONE C40.**~~ A vehicle delete cascades the reminder_vehicles junction but leaves
>   the reminder row active with zero vehicles (skipped 'no_vehicles' forever). Fixed via
>   `reminderRepository.deactivateVehicleless(userId)` (LEFT JOIN + isNull junction → bulk deactivate),
>   called in the vehicle-delete route after the delete. Flipped the #97 characterization test to the
>   fixed behavior + a multi-vehicle no-over-deactivation case; non-vacuous (remove the call → RED). The
>   "needs attention" surfacing was NOT added (the deactivation alone removes the silent-orphan footgun;
>   a needs-attention flag is a separate UX add). Don't re-pick. (#88 — the split-config-blob sibling — is
>   still OPEN, same family, more involved.)
> - ~~**#98 (MED) — DONE C51.**~~ sync-manager `keep_local` re-POSTs `forceOverwrite:true` + the local
>   clientId, but the create schema Zod-STRIPPED the flag and `createIdempotent` returned the existing
>   (userId, clientId) row UNCHANGED → the resolved offline edit was silently lost (NORTH_STAR #1). Fixed:
>   `createExpenseSchema.extend({ forceOverwrite })` (create-only) + the route threads it (stripped from the
>   row) + `createIdempotent(data, overwrite=false)` UPDATEs the existing row in place on collision when set
>   (clientId/userId stripped from the patch → identity immutable); default false keeps the plain-retry
>   no-op unchanged. +4 repo + +2 HTTP-harness guards; non-vacuous (neuter the branch → 3 RED). FE comment +
>   stale characterization test updated to the now-real overwrite (wire contract unchanged). Don't re-pick.
>
> _Severity 4 — hardening / display (lower urgency):_
> - **#100 (arch-gated) — APPROVED: SQL-atomic merge via `json_patch` in one UPDATE** for the
>   userPreferences read-modify-write across the 5+ write sites (no migration, no per-user queue, avoids
>   the C151 async-tx footgun). Last-writer-wins lost-update race today.
> - ~~**#22 (MED, hardening) — DONE C55.**~~ parseZipBackup summed each entry's `header.size`
>   (uncompressed) but that's ATTACKER-DECLARED (ZIP central directory) — a bomb declares a small size to
>   pass the sum, then inflates to GB on getData(). Added `CONFIG.backup.maxCompressionRatio = 1000` + a
>   per-entry guard rejecting `header.size / header.compressedSize > cap` BEFORE any inflation
>   (compressedSize is the real in-file count → an absurd ratio is the bomb signature the sum can't catch).
>   +2 guards (over-ratio-but-under-total-cap → rejected; real backup ratio under cap, no false positive);
>   non-vacuous (neuter → RED). Updated the pre-existing all-zeros total-size test (now trips the earlier
>   ratio guard) to accept either pre-inflation message. Don't re-pick.
> - **#129 (MED) — APPROVED to fix, but RE-READ the archive grounding (~C-note line 197) FIRST** before
>   editing — it's a credentials/account-linking finding; don't guess the fix from the one-line summary.
> - **#112 (LOW) — APPROVED: extend / generate distinct hues for the cross-vehicle analytics chart
>   palette** for legibility at fleet size.
> - **#79 (LOW) — APPROVED: add a data-hygiene path so a malformed fuel offline entry can't get stuck**
>   (skip/repair + surface, don't silently retry forever).
>
> _Maintenance-feature follow-ons (from the C1 T9 closeout):_
> - **lease/loan currentMileage→currentOdometer — APPROVED: CONFIRM the C157 all-time landing, then
>   close.** Likely already done (memory: approved C151, landed C157) — verify firsthand, no new code if
>   already correct.
> - **"Current Mileage" stat-card — APPROVED: headline all-time `currentOdometer` with period context.**
>   Display preference; verify the card reads correctly via shot.sh after.
>
> _(REMOVED C1 2026-06-17: **#140 LeaseMetricsCard annual-vs-total** — verified ALREADY FIXED + merged via
> "Merge Monday (#112)"; all 3 display sites route through `leaseTotalMileageAllowance`. It was stale
> post-reset doc-drift, not open work. Don't re-pick it.)_

### arch
*(reliably DRY per the archive. Run a fresh dedup scout; if nothing clean surfaces, record "no churn warranted" + pivot. Obey the arch rules above.)*

1. ~~**MPG-pairing dedup**~~ — **DONE C17.** Extracted `averageConsecutiveMpg(sortedExpenses)` in
   calculations.ts; both `calculateAverageMPG` (calculations.ts) and `calculateAverageMpg`
   (vehicle-stats.ts) now sort (each keeping its own contract) + delegate. Behavior-preserving (pre-sorted
   input, (0,150) band preserved exactly, #30 NOT unified); green→green across both property suites (58
   pass). The C161-vulnerable hand-copied loop now has one source of truth. Don't re-scout.
2. ~~**`buildSplitConfig` dedup**~~ — **DONE C23.** The C22 T4 work added a near-byte-identical
   `buildSplitConfig` to ReminderForm (vs ExpenseForm's). Extracted ONE pure
   `buildSplitConfig(method, vehicleIds, allocations): SplitConfig` into expense-helpers.ts (the
   resetSplitAllocations home); both forms delegate (ReminderForm via a thin null-guard wrapper).
   InsuranceTermForm's flat split shape is a DIFFERENT contract → not merged. Characterization test added
   FIRST (+5, incl. the cleared-input→0 coalesce); behavior-preserving confirmed via the C22 e2e specs.
   green→green (726 pass). Don't re-scout. *(Lesson reinforced: a feature cycle that copies a helper into a
   new component seeds the NEXT arch cycle — same as C15→C17. Watch for this after future eyes-on features.)*
3. ~~**`SHEET_NAMES` tab-roster dedup**~~ — **DONE C30.** The 15-tab Sheets roster was hand-copied across 4
   sites (`'Reminder Notifications'` literal appeared 4×). Extracted ONE exported `SHEET_NAMES` const +
   routed the two PURE-roster sites (`createSpreadsheet` + `ensureRequiredSheets`) through it; left the
   logic-paired write fan-out + read ranges inline (riskier to converge — arch rule 1). Behavior-preserving
   (same titles/order; create test now asserts `info.sheets === [...SHEET_NAMES]`). +2 drift guards
   (SHEET_NAMES 1:1 with the table count; distinct+non-empty) so a 16th table forces a roster entry.
   green→green (1602 pass). Don't re-scout this surface.
4. ~~**ImportExpensesDialog target-vehicle picker dedup**~~ — **DONE C43.** The C31 preset-path picker +
   the C37 manual-path picker were near-byte-identical ~22-line blocks (same bound `targetVehicleId`/
   `handleTargetVehicleChange`/`Select.Root`/`#each`, differing only in trigger id + wrapper class + empty
   copy). Extracted ONE local `{#snippet targetVehiclePicker(triggerId, emptyText)}` + `{@render}`'d at
   both sites (each keeps its own wrapper div — manual has a `border-t` separator, rule 1). Net −17 LOC; a
   local snippet not a shared file (binds this component's state → no reuse to extract for). Behavior-
   preserving confirmed eyes-on: both picker-path e2e specs (import-mapping-detect + import-manual-units)
   GREEN + Read the editor PNG (pixel-identical). The 3 import e2e specs are the merge-surviving net. The
   C22→C23 "feature copies markup → next arch dedups" lesson again. Don't re-scout this surface.
5. ~~**`splitConfigVehicleIds` dedup**~~ — **DONE C50.** The `even ? vehicleIds : allocations.map(...)`
   split-config vehicleId extraction was hand-copied at 3 sites (expenses/routes.ts local helper,
   expenses/repository.ts `validateVehicleOwnership`, reminders/validation.ts `refineSplitConfig`).
   Lifted ONE exported `splitConfigVehicleIds(config)` into expenses/validation.ts, typed on the minimal
   structural shape so both `SplitConfig` + `ReminderSplitConfig` satisfy it; routed all 3 through it.
   Behavior-preserving (de-dupes via Set as before; 142 affected tests green) + 4 direct unit guards
   (arch-extract→guard-pin, C17→C18 pattern). Non-vacuous (break the even branch → 3 RED). Don't re-scout.
6. ~~**`applyLocalOverwrite` dedup**~~ — **DONE C57.** The C51 #98 overwrite added a byte-identical
   `const { clientId, userId, ...patch } = data; return this.update(<id>, patch)` at TWO sites in
   `createIdempotent` (pre-check-collision + raced-winner branches). Extracted ONE private
   `applyLocalOverwrite(rowId, data)`, called from both. Behavior-preserving (green→green; the C51 +6
   overwrite tests drive both branches). Found firsthand the identity-key strip is DEFENSIVE-only
   (unreachable as a mutation via the public API — the lookup is already userId-scoped); documented in a
   code comment instead of pinning unreachable theater. The C22→C23/C37→C43 "bug/feature creates a dup →
   next arch dedups" lesson again. Don't re-scout.
7. ~~**converted gas-MPG inner-loop dedup**~~ — **DONE C64.** The C58/C62 #94 convert-before-pool work left
   THREE analytics builders (`computeConvertedEfficiencyValues`, `buildConvertedEfficiencyTrend`,
   `buildConvertedFuelEfficiencyComparison`) hand-rolling the SAME per-vehicle inner loop — groupByVehicle →
   fallback `vehicleUnitsMap.get(id) ?? {...DEFAULT_UNIT_PREFERENCES}` → `gasEfficiencyPoint` gate →
   `convertEfficiency` ternary — differing only in accumulation. Extracted ONE private generator
   `*convertedGasEfficiencyPoints(...)` yielding `{vehicleId, efficiency, date}`; all 3 consume it. Net
   −~40 LOC AND the #119/#122(C413)/#126(C427) gas/charge gate now lives in ONE place (a new converted builder
   can't silently re-pollute gas MPG with PHEV charge mi/kWh — NORTH_STAR #6). Behavior-preserving + test-
   anchored (analytics-units.property #11 + cross-vehicle.property #126 + summary/year-end property all green
   unchanged); 1666 pass. The C22→C23/C37→C43/C51→C57 "bug/feature threads a dup → next arch converges" lesson
   again (here C58/C62→C64). Don't re-scout the converted-efficiency builders — single-sourced now.
8. ~~**per-vehicle units fallback-lookup dedup**~~ — **DONE C71.** `vehicleUnitsMap.get(<id>) ?? {
   ...DEFAULT_UNIT_PREFERENCES }` was hand-repeated at 5 per-vehicle convert sites (convertedGasEfficiencyPoints,
   computeConvertedTotalDistance ×2, the monthlyConsumption volume limb, the fuel-stats volumeInUserUnits
   closure, the cross-vehicle comparison) — the residue the C64 generator extraction + the C65/C69 #94 twins
   left behind. Extracted a private `vehicleUnitsFor(map, id)`; all 5 route through it. PAYOFF: the
   `?? {...DEFAULT}` fallback is LOAD-BEARING (a missing-vehicle row without it throws on `.volumeUnit` at the
   convert call), so one source of truth stops a future site silently dropping it (+ stays a fresh clone per
   call). Left the different-shape getUserUnits `parsed ?? ...` user-prefs fallback alone. Behavior-preserving
   (green→green, 1672 pass, no test delta; the #94 mixed-unit guards + Property 11 conversion suite pass
   unchanged). The "bug threads a dup → next arch converges the shared sub-expression" lesson (C58/C62/C65/C69 →
   C71). Don't re-scout the convert sites — single-sourced.

> **SCOUTED C4 — no churn warranted.** Checked FE date helpers (formatters.ts single-sources
> toDateInputValue/dateOnlyToISO; expense-filters' local-date parse is INTENTIONALLY a different time
> anchor — midnight vs noon — convergence PROHIBITED), backend validate*Ownership (per-entity by
> ownership topology, not mergeable), FE buildQueryString (already C337), the offline mapper +
> computeNextDueDate (saturated). Arch stays DRY; don't re-scout these next cycle — try a fresh module
> the loop hasn't touched, or accept arch is at its structural floor and let the budget pull elsewhere.
>
> **SCOUTED C12 — no churn warranted (3rd confirm; FRESH modules).** FE service layer
> (insurance/odometer/vehicle-api etc. all delegate to the shared apiClient.get/post/getPaginated — thin
> per-domain wrappers, not dup) + api-transformer.ts (to/fromBackendExpense are deliberately asymmetric:
> create-vs-edit description, volume↔charge routing — no extraction). **Arch is confirmed at its
> structural floor across 3 scouts (C4/C6/C12).** STRONG RECOMMENDATION: when arch next goes over budget,
> record no-churn IMMEDIATELY (don't re-scout the same DRY surfaces) + pivot to the co-starved category —
> the budget is forcing ceremony, not finding work.
>
> **SCOUTED C6 — no churn warranted (fresh modules).** analytics-charts builders route through the
> single-sourced `isFillup` (NOT duplicated — #108/#113/#146 already deduped); FE chart components are
> distinct; the `mean`/`groupBy` idioms have DIVERGING empty-guards (Math.max(0,…) vs (1,…) vs none) so a
> shared helper would change behavior (arch rule 2). **Arch is at its structural floor** — recommend
> letting the budget pull elsewhere rather than forcing a 4th scout; if arch goes over again, record
> no-churn quickly + pivot to the co-starved category.
>
> **SCOUTED C36 — no churn warranted (4th confirm).** The C34 `effectiveTermCost` vs `effectiveMonthlyPremium`
> pair are DUALS (inverse precedence + opposite direction — converging distorts one, rule 2 PROHIBITS); the
> source dup-markers all point to ALREADY-deduped sites (C200 etc.); route-handler ownership+respond is the
> natural Hono idiom with shared validators. Pivoted to the highest-leverage unblocked item (#85 relabel).
> Arch remains at its structural floor — keep recording no-churn fast + pivoting.

### infra
*(queue empty — repopulate as tooling/docs/coverage needs surface. Standing cadence (loop-improvement #5):
~every 10 cycles run a branch-hygiene sweep — `git status` untracked-`*.test.ts` check (bun discovers by
filesystem; untracked specs vanish on merge), full regress, coverage re-measure (update the LEDGER cov:
baseline), refresh `BRANCH_REVIEW.md` grouped by theme so the eventual PR stays reviewable.)*

> **RAN C7 (cadence).** Untracked-test sweep CLEAN (0 stray committed-ext specs; the 45 .meshclaw.e2e.ts
> are gitignored-by-design). Coverage RE-MEASURED + written to the LEDGER header: BE 87.22% line / 86.96%
> func; FE 85.95% line / 87.15% func / 78.38% branch — both at the ~87/~86 structural ceiling. Both suites
> green (BE 1582 / FE 715). Branch = 6 ahead, PR-ready (state recorded in the C7 LEDGER entry since
> BRANCH_REVIEW.md is gitignored). NEXT cadence ~C17. The 90% goal stays structurally gated — BE tail is
> OAuth/DI-bound (auth/routes, provider services, backup-orchestrator, db connection), FE tail is eyes-on
> components; neither is a clean unit pick, so don't chase coverage % directly — let real bug/guard work
> nudge it.
>
> **RAN C14 (cadence).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: BE 87.22%/86.96% (unchanged vs
> C7 — sync-test additions hit already-covered modules); FE 86.07% line / 87.19% func / 78.53% branch (UP
> from C12's helper tests). Both suites green (BE 1587 / FE 721). Branch 7 ahead, PR-ready. NEXT cadence
> ~C24. Coverage is plateaued at the structural ceiling — don't chase % directly.
>
> **RAN C21 (cadence).** Untracked-test sweep CLEAN. Coverage BOTH UNCHANGED vs C14 (BE 87.22/86.96, FE
> 86.07/87.19/78.53 — the C15-C20 arc was tests/dedups/eyes-on, no new covered lines). Both suites green
> (BE 1594 / FE 721). Branch 20 ahead, PR-ready.
>
> **RAN C28 (cadence).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: BE 87.22/86.97 (flat vs C21),
> FE 86.14/87.31/78.70 (marginally UP — C22/C23 added covered lines). Both suites green (BE 1597 / FE 726).
> Branch 28 ahead of fresh origin/main, PR-ready.
>
> **RAN C35 (cadence).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: BE 87.29/86.97 (line UP vs C28
> from the C29/C33/C34 analytics+insurance tests), FE 86.14/87.31/78.70 (FLAT — C29-C34 were backend +
> 1 FE-markup). Both suites green (BE 1608 / FE 726). Branch 35 ahead, PR-ready. NEXT cadence ~C45.
> Coverage plateaued at the structural ceiling — keep not chasing %; let real bug/feature work move it.
