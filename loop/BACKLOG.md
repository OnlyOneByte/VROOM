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
   (C31, eyes-on):** ImportExpensesDialog auto-detects a Fuelly/Fuelio/Drivvo fuel log → "Detected a
   <Tracker>" banner + target-vehicle picker (presets have no vehicle column → D4) → builds the mapping →
   reuses the existing preview/commit. **REMAINING:** (a) the manual per-field column-dropdown editor +
   category-remap table for an UNKNOWN-source file; (b) date-format/unit override pickers; (c) **the
   flagged preset gap — fuel presets map no category column so a detected log previews 0-ready ("Unknown
   category"); recommended fix defaultCategory:'fuel' per preset, send_message'd Angelo C31, awaiting steer**;
   (d) T6 round-trip e2e (incl. real-export signature validation). Spec: `.kiro/specs/import-trackers/`.
   This is now the ONLY open feature (maintenance C1 + recurring-expenses C27 both DONE).
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

> **GUARDED C18:** `averageConsecutiveMpg` (the C17-extracted shared MPG loop) now has a direct unit net
> in calculations.test.ts (+6: mean / <2→null / missedFillup-skip / both-odometer+volume guard / outlier
> drop / half-open 150 band) — closes the C181/C229 "helper tested only via callers" gap the C17 dedup
> created. STANDING PATTERN (loop-improvement): whenever an arch cycle extracts a shared helper, the NEXT
> guard cycle should pin it directly (C6 monthsBetween, C18 averageConsecutiveMpg). Don't re-add.
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
> - **#37 (HIGH) — APPROVED: make the Sheets backup atomic — write to a temp sheet/range, then
>   copy-then-promote (swap). STILL OPEN** (left for its own cycle — a materially larger restructure than
>   #36's one-line switch; the fake seam + `batchUpdate`/`duplicateSheet`/rename API surface is the
>   mechanism). Currently a non-atomic in-place clear-then-write per sheet that can destroy the only good
>   copy on a mid-write failure. Next Sev-1 bug pick.
> - **#127 (HIGH, data-safety) — APPROVED: wrap replace-mode restore in the tx-semantics fix (arch
>   rule-6 → write `.kiro/specs/<refactor>/design.md` first, then build).** Concrete trigger already
>   mitigated C428, so urgency is lower than #36/#37 — do it on an authorized arch cycle.
>
> _Severity 2 — wrong numbers shown today (correctness):_
> - **#94 (MED, 6-member CLASS) — APPROVED: convert-to-user-global BEFORE pooling, mirroring
>   `getCrossVehicle` (the correct contrast).** All fleet-SUMMARY fuel-stats builders currently pool
>   mixed units (gal+L / mi+km) → garbage totals on the DEFAULT analytics view. One root fix for the
>   whole class.
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
> - **#88 (MED) — APPROVED: on vehicle delete, prune the deleted vehicleId from any reminder's
>   `expenseSplitConfig` JSON, and deactivate the reminder if the split becomes invalid.** (junction
>   cascades, the blob doesn't.)
> - **#97 (LOW-MED) — APPROVED: when a reminder's last/sole vehicle is removed, auto-deactivate it +
>   surface a "needs attention" flag** (instead of leaving it `is_active=1` and silently never firing).
> - **#98 (MED) — APPROVED: add a real PUT-on-collision / upsert path so sync-manager `keep_local`
>   actually overwrites.** Today `forceOverwrite` is Zod-stripped → offline edit silently lost on a true
>   clientId collision.
>
> _Severity 4 — hardening / display (lower urgency):_
> - **#100 (arch-gated) — APPROVED: SQL-atomic merge via `json_patch` in one UPDATE** for the
>   userPreferences read-modify-write across the 5+ write sites (no migration, no per-user queue, avoids
>   the C151 async-tx footgun). Last-writer-wins lost-update race today.
> - **#22 (MED, hardening) — APPROVED: add a compression-ratio cap pre-inflation** to the zip-bomb guard
>   (cheap, no new dep) instead of trusting the attacker-declared `header.size`.
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
