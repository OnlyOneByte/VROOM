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
   now fully eyes-on (C37/C41/C47/C61). **T5 MANUAL editor MOBILE eyes-on DONE (C121):** the manual
   column-mapping editor (the most control-dense VROOM dialog section) verified at Pixel-5 (393px) via
   `import-manual-mapping-mobile.meshclaw.e2e.ts` + shot (Read /tmp/c121-manual-mapping-mobile.png) — every
   field row + date-format + both conditional unit pickers reflow cleanly, NO horizontal overflow (asserted
   scrollWidth ≤ clientWidth+1, NORTH_STAR #3). The manual editor is now eyes-on across BOTH viewports.
   **REMAINING (both Angelo-BLOCKED, no unblocked work left):**
   (b) **the preset gap — a DETECTED Fuelly/Fuelio/Drivvo log maps NO category COLUMN so it previews 0-ready
   ("Unknown category") → nothing to commit; recommended fix defaultCategory:'fuel' per preset,
   send_message'd Angelo C31, awaiting steer** (the C47 remap does NOT cover this — no column = no word to
   remap); (c) the AUTO-DETECT-PRESET round-trip THROUGH COMMIT + the populated-detect four-state shot are
   GATED on (b). Spec: `.kiro/specs/import-trackers/`.
   This is the ONLY open feature (maintenance C1 + recurring-expenses C27 both DONE), and after C121 it has NO
   unblocked increment left — the manual half is fully verified desktop + mobile; the detect-commit + 4-state
   shot both wait on Angelo's defaultCategory. The next feature over-budget cycle should record that + pivot to
   the co-starved category.
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

> **GUARDED C119 — the dashboard EXPENSE-SUMMARY builder family CLEAN + pinned (4 zero-coverage builders).** A
> fresh grep of every analytics-charts.ts builder vs its test references found FOUR with ZERO coverage —
> `buildExpenseByCategory`, `buildVehicleExpenseBreakdown`, `buildMonthlyExpenseTrends`, `findBiggestExpense` (all
> GeneralExpenseRow[] → dashboard chart data). The C67 unpinned-builder audit (analytics-charts-unpinned.test.ts)
> certified the fuel/date siblings but never reached this expense-summary set. Read each against source firsthand —
> all CORRECT (no defect). New `expense-summary-builders.test.ts` (+16) pins: percentages SUM to 100 + total===0→[]
> + unknown→misc fold (buildExpenseByCategory); the same fold WITHOUT percentages (buildVehicleExpenseBreakdown);
> slice(-24) keeps the NEWEST 24 months (the C11 oldest-slice direction class) + co-accumulate + dateless-drop
> (buildMonthlyExpenseTrends); strict-greater max + []→null + null-desc fallback + ISO date (findBiggestExpense).
> Non-vacuous proven (flip slice(-24)→slice(0,24) → RED). BE 1732 pass. NEXT: the last zero-coverage analytics
> builders if any (buildFuelEfficiencyAndCost / buildVehicleMaintenanceCosts), else an eyes-on populated surface.
> Don't re-add.

> **AUDITED C124 (eyes-on) — the never-shot `/insurance/[id]/terms/new` form CLEAN desktop + mobile.** The
> InsuranceTermForm (572-line money+date form, the bug-#138 UTC-date subject) was never shot. Shot DESKTOP +
> MOBILE (Pixel 5) against a seeded State Farm policy + Read both PNGs. Desktop: all 4 sections render —
> Coverage Period (Start/End Date * pickers), Finance Details (Total/Monthly Cost + Payment Amount + Premium
> Frequency), Covered Vehicles (all 4 seeded vehicles as checkboxes = the multi-vehicle term link), Policy Details
> (number/deductible/coverage desc/limit/agent ×3); "State Farm" sub-header interpolates from the policy; Save Term
> / Cancel CTAs; ZERO console errors. Mobile (393px): 2-col field pairs reflow to single-column stacked, full-width
> pickers/inputs, NO horizontal overflow (NORTH_STAR #3), Save FAB pins bottom. No defect — DON'T re-shoot.
> Remaining never-shot real surfaces: the odometer entry forms (/vehicles/[id]/odometer/new) + the insurance term
> EDIT form; after those the surface set is fully eyes-on.
>
> **AUDITED C106 (feature eyes-on) — the FULL POPULATED dashboard CLEAN desktop + mobile (the primary landing
> surface, only ever partially-shot at C5/C12).** Shot desktop + mobile (Pixel 5) + Read both PNGs. Desktop: 4 KPI
> cards (Total Vehicles 4 / Total Expenses $21,677.87 / Monthly Average $277.92 / Active Financing 2, subtitle
> matches the vehicle count = consistent), Your Fleet (3 vehicle cards + Add-Vehicle), Trends + Category charts
> (canvas blank = C26 IO-gated headless limit, not a defect), Recent Activity (incl. the $900 split payment),
> Upcoming Reminders, Recurring Costs $460.50/mo. Mobile (393px): NO horizontal overflow (NORTH_STAR #3) — KPIs
> reflow to a 2×2 grid, "Log Fill-up" mobile CTA present, FAB pins full-width; figures consistent. No defect; DON'T
> re-audit. The dashboard's populated state now joins the fully-eyes-on set.
>
> **AUDITED C96 (feature eyes-on) — /profile CLEAN desktop + mobile → EVERY REAL SURFACE NOW EYES-ON.** The last
> never-shot real surface (the C93 pointer). Shot desktop + mobile (Pixel 5) + Read both PNGs. Desktop: Identity
> (avatar, editable Display Name, Email, Member Since "June 2026" = correct), Connected Accounts (Google + unlink +
> Link GitHub), Sessions (Coming Soon), Data & Privacy (Export-all-data working button + "images not included"
> disclosure; Delete = Coming soon), Sharing + Notifications (Coming Soon). Coming-Soon cards are clean intentional
> placeholders, not broken. Mobile (393px): NO horizontal overflow (NORTH_STAR #3) — all label↔value rows reflow.
> Zero console errors. No defect; DON'T re-audit. MILESTONE: every real surface is eyes-on
> (dashboard/analytics/insurance/financing/maintenance/recurring-dialog/settings/profile + the list pages). The
> feature category is now fully exhausted of self-authorizable work — import-trackers stays Angelo-gated.
>
> **AUDITED C93 (feature eyes-on) — /settings CLEAN desktop + mobile (the never-shot backup/restore + provider
> + unit-prefs crown-jewel).** /settings had ZERO prior eyes-on (vs /reminders ×12, /insurance ×12, /financing ×10,
> /expenses ×10, /analytics ×5) — a NORTH_STAR #1 (data-safety) + #3 (mobile) surface never visually verified. Shot
> desktop + mobile (Pixel 5) + Read both PNGs. Desktop: Profile card + Appearance (Light/Dark/System) + Unit
> Preferences (Distance/Fuel/Charge/Currency selects) + Install App (PWA) + Storage Providers (Download Backup /
> Restore buttons, Default Photo Source picker, a "Connected" e2e fake provider card with edit/delete + ZIP toggle).
> Mobile (393px): NO horizontal overflow (NORTH_STAR #3) — the 3-col theme grid + wide unit selects + Save-Settings
> FAB all reflow; FAB pins bottom. Zero console errors. The mid-page dark FAB in the desktop full-page shot is the
> known fixed-FAB capture artifact. No defect; DON'T re-audit. With this, the only remaining never-shot REAL surface
> is /profile (/trips is a "Coming Soon" placeholder; /privacypolicy + /termsofservice are static legal copy) — after
> /profile, every real surface is eyes-on and the feature category is fully Angelo-gated.
>
> **GUARDED C113 — the financing PUT /:financingId/payoff cross-tenant IDOR gap (4th route gap via the audit
> method).** The systematic cross-tenant-idor.test.ts sweep covers financing's DELETE + PATCH/payment-amount but
> SKIPPED PUT /payoff — a state-changing route on the SAME validateFinancingOwnership gate (routes.ts:219). A
> cross-tenant payoff lets A mark B's financing paid-off (deactivateFinancing → isActive=0 + severs source link), a
> destructive write on B's data. Exercised functionally (deactivate-hook test as owner) but never cross-tenant
> tested. +1 expectDenied in the financing IDOR case (reuses B's seeded fid). Non-vacuous (drop the payoff gate →
> financing IDOR test RED). PATTERN (C108/C109/C110/C113): the route-coverage audit method has found 4 real
> route gaps in 4 cycles — definitively productive. NEXT: audit the remaining domains' state-changing routes vs the
> IDOR sweep (odometer PUT, insurance term/claim PUT/DELETE — verify each is in cross-tenant-idor.test.ts). Don't re-add.
>
> **GUARDED C109 — the untested /vehicle-expenses analytics route's cross-tenant ownership gate (2nd
> route-ownership gap in 2 cycles).** Mapped the analytics domain's 13 route handlers vs HTTP-harness coverage →
> 4 routes had ZERO route-level coverage (/quick-stats, /cross-vehicle, /year-end, /vehicle-expenses).
> /vehicle-expenses is the highest-leverage: the only one of the 4 with a `validateVehicleOwnership` cross-tenant
> gate (routes.ts:147) — the SAME guard analytics-routes-http.test.ts already pins for vehicle-tco/health/fuel-*
> (C185/C290), but this route was the one it never covered. Repo method unit-tested; route guard-drop leaks
> another tenant's per-vehicle expense analytics (C109/#52 class). +3 in analytics-routes-http.test.ts: owned→200,
> foreign→404 (no leak), missing-required-vehicleId→400. Non-vacuous (drop the gate → foreign-id test RED).
> PATTERN CONFIRMED (C108 sync-status + C109 vehicle-expenses): mapping route-endpoint coverage finds REAL
> ownership gaps — the HTTP-harness vein is productive, not the "fixed point" the C103/C107 claims asserted. NEXT:
> the 3 remaining untested analytics routes are user-scoped (no per-vehicle gate, thinner); check OTHER domains'
> unmapped endpoints by the same method. Don't re-add the vehicle-expenses pin.
>
> **CHARACTERIZED C102 — the #148 null-initialMileage lease burn-bar invariant, as a red→green anchor (NOT a
> fix).** Audited the lowest-coverage money file (financing-calculations.ts, 75% line) — `calculateLeaseMetrics` is
> already extraordinarily well-tested (30+ cases + 2 fast-check properties incl. #64/#91/#110), so it's saturated
> EXCEPT the one genuinely unguarded branch, which is the #148 escalation itself: the gate requires
> `initialMileage !== null` for mileageUsed, with a test for null current but NONE for null initial. Since #148 is a
> PARKED product call, did NOT fix — pinned the CURRENT behavior (null initial → used 0 / remaining full) + the
> contradiction (initial=0 → used 30000) in lease-metrics.test.ts. Non-vacuous (apply the `?? 0` fix → the
> characterization flips RED). #148 is now test-anchored + ready: the fix is a 1-line gate change + flipping this
> test when Angelo rules. The FE-logic deep-review surface is largely certified now. Don't re-audit calculateLeaseMetrics.
>
> **CERTIFIED C92 — the rate-limit / client-IP abuse-prevention surface CLEAN + already comprehensively guarded
> (a NEW area, not in the prior audited set).** Security-load-bearing: a spoofed-XFF bypass would let an attacker
> get a fresh per-request rate-limit bucket → defeat the auth brute-force limiter. Audited 3 layers firsthand, ALL
> clean + guarded — DON'T re-audit: (1) `getClientIp` (utils/client-ip.ts) derives from the REAL socket and honors
> X-Forwarded-For ONLY behind a configured trusted proxy (default ignores it); client-ip.test.ts (C265) pins all 4
> trust branches + empty/multi-hop XFF edges + the "different-XFF-from-one-socket share a bucket" bypass-closed
> assertion. (2) the fixed-window limiter (middleware/rate-limit.ts); rate-limit.test.ts (C112) pins
> window-open/up-to-limit/over-limit-429-with-headers/body/key-isolation/reset + a disableRateLimit vacuity guard.
> (3) the wiring — auth keys on `auth:${getClientIp(c)}` (trusted IP, not raw header); sync/backup/restore/trigger
> key on user.id. The keyGenerator one-liners aren't worth a dedicated guard (coverage theater, C181/C229). No
> defect; recorded clean, did NOT manufacture (GUIDE agent-HIGH-often-false + C86 saturation discipline). NEXT
> deep-review: another genuinely UNAUDITED surface (CORS/CSRF origin config, bodyLimit/zip-bomb upload guards, or
> the session/cookie lifecycle) — the eyes-on + data-safety veins are exhausted.
>
> **SCOUTED C86 — deep-review surfaces SATURATED (4 candidates verified already-guarded firsthand; no
> manufacture).** With the backend correctness surfaces broadly certified, scouted 4 fresh candidates and found
> EACH already well-guarded — DON'T re-audit: (1) the FE sync-manager RETRY/BACKOFF path — sync-manager.test.ts
> pins retry-count tracking, the maxRetries hard cap, the `retryDelay * 2^retries` EXPONENTIAL backoff, the
> no-reschedule-at-cap, #121 retry-conflict-surfacing, #134 orphan-resurrection (the C67/C81 "next vein" pointer
> is now STALE — that path got covered since); (2) `determineConflictType` (sync-manager.test.ts:562+, the C67
> cert); (3) `computeTCOTotal` — the #27/#28 double-count-avoidance rule (purchasePrice all-time-only +
> purchasePrice-counted⇒exclude-financing-payments) is directly pinned in per-vehicle.property.test.ts:411
> (`#27` block) + Property 14 (bucket-sum) + the #33 mis-bucket block; (4) the reminder-NOTIFICATION read path —
> feed newest-first + #142 mileage-null-sorts-first + mark-read/unreadOnly/404 (notifications-feed.test.ts) and
> the per-milestone (reminderId,dueOdometer) dedup incl. re-arm + both-axes no-collision (trigger-mileage.test.ts,
> C256). Recorded saturated; did NOT manufacture a redundant cert (the GUIDE "agent-HIGH-often-false" + C12
> "structural-floor, don't force ceremony" discipline). The one deep-review vein that still pays is EYES-ON of a
> never-shot surface (E2E can't catch never-rendered fields, the C68 lesson) — ~~NEXT: the recurring-expenses
> MaterializedExpensesDialog / ⟳ badge in a POPULATED state~~ **DONE C88 (feature eyes-on): the dialog POPULATED
> state is certified CLEAN — created an overdue monthly $150 reminder, triggered 7 catch-up rows ($1,050), opened
> the dialog scoped past the e2e reminders via the per-card data-testid, Read the PNG: header + subtitle (reminder
> name interpolated) + "7 expenses · $1,050.00 total" + each Financial · {date} · Daily Driver · $150.00 row, zero
> console errors, full FE→BE→DB→render round-trip. The ⟳ badge was eyes-on at C9. With this, EVERY populated
> surface is now eyes-on (dashboard/insurance/financing loan+lease/maintenance/recurring dialog) — the eyes-on vein
> is exhausted; the next still-paying deep-review/feature work is a backend correctness audit of a genuinely
> UNAUDITED surface or an Angelo steer, NOT another render shot.**
>
> **AUDITED C82 — /financing LOAN render eyes-on sweep, CLEAN.** Shot the Toyota Camry loan vehicle (BoA
> 4.5% APR, $20k/60mo) FinanceTab desktop + Read the PNG (C68 covered the LEASE path; this is the unshot loan +
> PaymentMetricsGrid + amortization path). Renders correct: Next Payment $372.86 (Monthly · Loan · 4.5% APR),
> Payment Progress 5% ($20,000/$900/$19,100), all 4 PaymentMetricsGrid cards with correct loan math (Principal
> vs Interest $297.86+$75; Payments 1/60; Payoff Mar 2031 59mo; Total Cost $22,371.63, 12% over) — the figures
> the #92/#117/#139 0%-APR fixes touched — + Payment History ($900 Extra Payment split, Remaining $19,100). The
> Amortization chart area is BLANK = the C26 IO-gated-chart headless-capture limit (visibility-watch
> IntersectionObserver doesn't fire in a full-page shot), NOT a defect: /analytics/financing returns a
> populated loanBreakdown (12 entries) firsthand. DON'T re-audit. Next eyes-on vein: the recurring-expenses
> dashboard widget populated, or a remaining un-shot surface.
>
> **AUDITED C75 — /insurance eyes-on sweep, CLEAN (a suspected defect debunked firsthand).** Shot
> /insurance DESKTOP + MOBILE with 7 seeded policies + Read both PNGs. Renders the data + four-states clean:
> PolicyCard (Current Term Expires/Total Cost/Monthly/Vehicles), Documents EMPTY ("No documents uploaded yet"),
> Claims EMPTY + a populated "Collision · Settled" claim, "Expired" term badges (correct — seed term dates
> predate now) + Renew. MOBILE: no horizontal overflow (NORTH_STAR #3); all sections reflow; FAB pins bottom.
> DEBUNKED: "Active Policies" header vs "Expired" badges is NOT a contradiction — groupPoliciesByActive splits
> on `policy.isActive` (lifecycle: Active/Inactive sections) while "Expired" is the per-TERM currency (lapsed
> term → Renew affordance); an active policy with an expired current term is the intended state. /insurance is
> sound — DON'T re-audit. (The mid-page dark New-Policy button in the desktop full-page shot is the known
> fixed-FAB capture artifact.) Next eyes-on vein: the /financing populated render, or the recurring-expenses
> dashboard widget in a populated state.
>
> **CERTIFIED C81 — the backup-EXPORT serialization round-trip CLEAN + the OPTIONAL_BACKUP_FILES drift seam
> guarded.** Audited createBackup → exportAsZip → parseZipBackup firsthand. Already well-guarded (DON'T
> re-audit): createBackup keys === TABLE_SCHEMA_MAP (C208 part B); SCHEMA_MAP keys === FILENAME_MAP keys +
> schema-table coverage (C208 part A); export + restore derive columns from the SAME getTableColumns →
> schema-symmetric; coerceRow numeric (#68/#209) + JSON round-trips covered by the populated round-trip suites.
> GAP found: getRequiredBackupFiles() = FILENAME_MAP values MINUS the hand-maintained OPTIONAL_BACKUP_FILES set,
> coupled only by literal strings — an OPTIONAL entry drifting from the map (typo/rename) makes a real backup
> file REQUIRED → a valid older backup missing it fails restore ("Missing required files"), NORTH_STAR #1.
> Certified firsthand zero orphans today. GUARD: exported OPTIONAL_BACKUP_FILES + a 3rd test in
> backup-table-coverage.test.ts (OPTIONAL ⊆ FILENAME_MAP values); non-vacuous (drift a map value → RED). The
> backup export/restore round-trip is now broadly certified — next deep-review: the FE offline sync-manager
> retry/backoff path, or an eyes-on /financing populated render.
>
> **CERTIFIED C74 — the CSV-import idempotency key `deriveImportClientId` FIELD-SENSITIVE + directly guarded.**
> The crown-jewel import data-safety contract (re-import = no-op via createIdempotent's (userId, clientId)
> unique index, yet two genuinely-different rows must get DISTINCT keys so both land) was driven only
> transitively through import-csv.test.ts round-trips that NEVER compare two rows differing in ONE field, and
> the fn was module-PRIVATE. GAP: drop a field from the `content` hash (tags/missedFillup/…) → two rows
> differing only in that field collide → the second silently dropped on import → NORTH_STAR #1 loss, invisible
> to every test. Certified firsthand all 11 content fields flip the key + determinism. GUARD: exported the fn +
> import-client-id-field-sensitivity.test.ts (+14, one mutation per field at the same occurrence; non-vacuous —
> drop a field → that field's test RED). DOCUMENTED NUANCE (mitigated, not fixed): tags join with '' so
> `['a','b']`/`['ab']` share a segment, BUT buildImportPlan's occurrence counter distinguishes within-file
> collisions → distinct final keys. ALSO scouted + found ALREADY-GUARDED (don't re-audit): the FE sync-manager
> `determineConflictType` (sync-manager.test.ts:562-642) + the import round-trip (lossless/idempotent/#102/#137/
> formula-injection all in import-csv.test.ts). Next deep-review: an eyes-on /insurance or /financing render
> sweep, or the backup EXPORT serialization round-trip.
>
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
> **SCOUTED C122 — no fresh defect (10th consecutive; precondition-recorded dry + PIVOTED to guard). `git diff
> C85..HEAD` over production source EMPTY → regression structurally impossible.** Bug was forced (most-starved
> +5) but provably dry, so per the C99/C103/C107 discipline recorded dry immediately and pivoted the cycle's
> substantive work to the co-productive guard vein: pinned the two foundational zero-coverage analytics primitives
> (`normalizeDate` seconds-vs-ms boundary + `groupByVehicle`; see the guard GUARDED-C122 entry). NEXT bug cycle:
> precondition still holds → record dry + pivot; real defects now come only from a deep-review/feature-surfaced
> invariant or an Angelo steer.
>
> **CLOSED C114 — the insurance TERM routes' cross-tenant IDOR gap (PUT/DELETE /:id/terms/:termId).** The
> route-audit method (C108–C113) applied with the bug lens: systematically compared every state-changing route vs
> the cross-tenant-idor.test.ts sweep → the insurance term routes are gated on validateInsuranceOwnership(id) but
> were NEVER in the sweep. terms-http.test.ts (C272) pins the inner FK defense (foreign vehicleId in the payload)
> but always AS the policy owner — the policy-level cross-tenant gate on the term routes was untested. A
> cross-tenant term edit/delete lets A mutate B's terms + their premium expenses. +2 expectDenied in the insurance
> IDOR case (PUT + DELETE term); non-vacuous (drop the term PUT gate → IDOR test RED). 5th real route gap in 6
> cycles (4 cross-tenant IDOR). REMAINING IDOR-sweep gaps to check NEXT: `PUT /notifications/:id/read` (reminders)
> + `PUT/DELETE /split/:id` (expenses) — both state-changing, neither in the sweep. The cold pure-logic vein stays
> dry (no production source changed since C85); the productive bug axis is now the IDOR route-audit.
>
> **SCOUTED C103/C107 — no fresh defect (8th/9th consecutive; precondition-recorded dry). `git diff C85..HEAD` over
> production source still EMPTY → a regression is structurally impossible, a scout produces nothing.** Also confirmed the C100–C102 FE-logic guard frontier
> is now worked out: the only remaining <90% FE files are expense-api.ts (thin apiClient pass-throughs → testing
> them is C181/C229 coverage-theater) + sync-manager.ts (setupAutoSync DOM-effect wiring [Playwright territory] +
> the already-covered resolveConflict). The load-bearing FE-logic gaps are CLOSED (settings reload C100, theme
> listener C101, #148 anchor C102); residual FE under-coverage is STRUCTURAL (effect/DOM-bound), the FE mirror of
> the BE DI/OAuth tail. Productive work is now ONLY: the Angelo-gated queue (#148 READY w/ anchor, #100/#79/#129 +
> import defaultCategory) or structural coverage (needs Playwright/DI harness — not a normal cycle pick).
>
> **SCOUTED C99 — no fresh defect (recorded dry FAST; 7th consecutive). KEY: `git diff C85..HEAD` over production
> source is EMPTY — nothing has changed since the cold vein was last swept, so a regression is structurally
> impossible.** Per the loop's own C89/C95 recommendation, did ONE firsthand spot-check (buildAmortizationSchedule
> #92/#117/#139 0%-APR money class — CLEAN: 0%-APR→interest=0, principal clamped min(max(0,pay−int),balance), no
> mutation, pinned by amortization-schedule.test.ts) rather than re-running the full sweep on unchanged code.
> NEXT bug cycle: run the 1-line precondition first — if `git diff C85..HEAD` over src is empty, record dry
> IMMEDIATELY + pivot; re-scanning provably-unchanged surfaces is pure ceremony. Real defects now come ONLY from a
> deep-review/feature-surfaced invariant or an Angelo steer.
>
> **SCOUTED C95 — no fresh defect (offline-outbox field-dropout vein #66/#101/#111; 6th consecutive dry scout).**
> Scouted the GUIDE-flagged offline-outbox→backend mapper firsthand. CLEAN: (1) api-transformer.ts
> toBackendExpense/fromBackendExpense is symmetric + complete (volume/charge routed by isElectricFuelType; the
> create-vs-edit description null-clear is a deliberate isEdit option; every optional field round-trips). (2) the
> real call-site dropout class (the mapper can't carry a field the call site never set) is pinned by
> offline-save-carries-fuel-fields.test.ts — source-scans every addOfflineExpense({...}) call for missedFillup
> (#101/#111) + fuelType (#66) — plus api-transformer.property.test.ts for the round-trip. SATURATED (10 test
> files). Recorded DRY, did NOT manufacture. With the cold vein now 6× dry (C6/C10/C15/C83/C89/C95) + NO production
> source changed since C85, NEXT bug cycle: record dry on the FIRST recheck + pivot — the budget is forcing
> ceremony; real defects now come only from a deep-review/feature-surfaced invariant or an Angelo steer.
>
> **SCOUTED C89 — no fresh defect (date/tz + materialization vein; 4 surfaces verified clean firsthand; 5th
> consecutive dry scout).** With C88 having just exercised the reminder trigger/materialization path, scouted the
> date-advance + cost + split-materialization surfaces per the GUIDE date/tz seam. ALL CLEAN: (1) reminder
> date-advance (computeNextDueDate / advanceCustom / clampToAnchorDay) — the Jan-31→Feb overshoot is dodged by
> setDate(1) BEFORE setMonth/setFullYear, then month-end clamp anchored to startDate.getDate(); the
> #12/#13/#107/#114/#116 family (corrupt-frequency/non-positive-interval throws, endDate-boundary
> hasReminderEndedBy, fast-forward non-progress backstop) is all closed + guarded. (2) monthKeysInRange
> (analytics-charts.ts:185, the GUIDE-flagged setMonth site) — cursor anchored to day-1 via the 3-arg
> Date(y,m,1) ctor, rollover-safe (not just commented). (3) reminder-cost.ts annualization (occurrencesPerYear ÷
> 12, the C5/C88 run-rate) — un-fireable shapes → 0, no divide-by-zero. (4) split-materialization
> (createExpenseFromReminder) delegates to the shared expenseSplitService (same code as the regular split flow,
> saturated C2/C4/#88/#98). Recorded DRY, did NOT manufacture (GUIDE agent-HIGH-often-false + the C15/C83 "record
> dry FAST + pivot"). The productive bug surface is now ONLY the parked Angelo-gated queue (#148/#100/#79/#129);
> cold scouts are spent. NEXT bug cycle: record dry immediately + pivot UNLESS a deep-review/feature cycle surfaces
> a concrete invariant or Angelo steers.
>
> **SCOUTED C83 — no fresh defect (write-path validation-asymmetry vein; 3 surfaces verified clean
> firsthand).** With #94 fully closed (C79) and the approved bug queue all gated (#100 arch-gated, #129/#79
> product-calls awaiting steer, #148 parked), ran a fresh write-path scout per the GUIDE bug vein. Verified
> firsthand, all CLEAN: (1) the REMINDER create/update splitConfig path — `refineSplitConfig` already enforces
> splitConfig-vehicleIds === reminder vehicleIds (validation.ts:143), and the route validateVehicleIdsOwned's
> the reminder vehicleIds, so the blob's legs are transitively owned (no #88-style verbatim-write gap on the
> create/update side; #88/#97 were the delete-cascade siblings). (2) the ODOMETER write path — POST/PUT/DELETE
> all validateVehicleOwnership/validateOdometerOwnership before any write (properly tenant-scoped, the #215
> class). (3) the ODOMETER updateSchema `.partial()` — PROBED whether the `recordedAt` future-date refine
> survives `.partial()` (the #109/C372 `.refine()`-dropped class); it DOES, because it's a FIELD-level refine
> (part of the field's own schema, `.partial()` just wraps it in ZodOptional) — UNLIKE #109's object-level
> `.superRefine()`. Already guarded too (update-route.test.ts pins it). Recorded dry + did NOT manufacture a
> finding (the GUIDE bug-vein discipline). The write-path asymmetry seam stays SATURATED (swept #80–#146 + these
> 3). NEXT bug cycle: if still dry, record + pivot fast — the productive defects now come from deep-review/feature
> eyes-on surfacing concrete invariants, not cold write-path scouts.
>
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

> **GUARDED C122 — the two FOUNDATIONAL analytics primitives `normalizeDate` + `groupByVehicle` CLEAN + pinned
> (the last zero-coverage roots).** Closing the analytics-builder coverage sweep at its ROOTS (C119 expense-summary
> + C120 maintenance/gas-price certified the leaf builders; these are the primitives every builder calls).
> `normalizeDate` is the SECONDS-vs-MS epoch heuristic (`< 1e12` → ×1000) — the exact boundary where date
> corruption hides, since the DB stores timestamps in SECONDS (the recurring mode:'timestamp' footgun, C46/C34/C209)
> and NOTHING asserted it; `groupByVehicle` is the #54 cross-vehicle-pooling guard. Read both against source
> firsthand — CORRECT. New `normalize-date-group-by-vehicle.test.ts` (+9) pins: null→null / Date→identity /
> seconds×1000 / ms-verbatim / the 1e12 boundary→ms / epoch-0→1970; group order-preserving + empty + single-group.
> Non-vacuous proven (drop the ×1000 → seconds-epoch test RED). BE 1757 pass. The analytics-builder coverage sweep
> is now essentially complete; remaining sub-100% analytics files are DI/SQL-bound (repository.ts). Don't re-add.

> **GUARDED C120 — the MAINTENANCE + GAS-PRICE chart builder family CLEAN + pinned (3 zero-coverage builders).**
> Continuing the C119 analytics-builder coverage sweep: re-grepped every analytics-charts.ts builder vs test
> references → 3 more with ZERO coverage the C67 (fuel/date) + C119 (expense-summary) audits never reached —
> `buildGasPriceHistory`, `buildVehicleMaintenanceCosts`, `buildMaintenanceTimeline` (the last drives the private
> buildTimelineEntry / estimateServiceInterval / assignTimelineStatus trio). Read each against source firsthand —
> all CORRECT (clean cert). New `maintenance-gasprice-builders.test.ts` (+15) pins: priced-fillup filter +
> price=amount/vol + fuelType ?? 'Regular' + slice(-100) (gas-price); category==='maintenance' ONLY + month-sum +
> ascending + dateless-drop (vehicle-maintenance-costs); description grouping (case-insensitive; null→'general
> maintenance') + the assignTimelineStatus thresholds (<0 overdue / <30 warning / else good) + single-occurrence
> interval default 180 + daysRemaining-ascending sort (maintenance-timeline). Non-vacuous proven (shrink the warning
> band <30→<5 → the 10-day warning test RED). BE 1748 pass. Remaining zero-coverage analytics builders:
> groupByVehicle + normalizeDate (thin primitives, lower-leverage). Don't re-add.

> **GUARDED C101:** themeStore.initialize() + its live OS-preference listener now pinned (+1 in
> theme-initialize.test.ts) — the C336-skipped one-shot. C336 pinned setPreference but skipped initialize(); its
> load-bearing untested branch is the `prefers-color-scheme` change listener that re-applies the theme live ONLY
> when the stored preference is 'system' (so "System" tracks the OS in real time without yanking an explicit
> light/dark user when their OS enters night mode). Single ordered test (themeStore is a latching singleton — only
> the first initialize() runs the body): mount applies stored pref + registers ONE listener, 2nd init is idempotent,
> then fire the listener under 'system' (tracks OS) vs 'light' (untouched). Non-vacuous (make the listener apply
> 'system' unconditionally → RED, explicit-light user yanked dark). **theme.svelte.ts 60.52→92.1% line, 100% func;
> overall FE 87.6% line / 88.56% func / 79.74% branch (2nd consecutive real FE gain after C100).** CORRECTION: the
> C100 "load-state.svelte.ts 35% func" seed was a coverage-tool artifact — that primitive is ALREADY fully tested
> (load-state.svelte.test.ts, 11 cases). NEXT guard: RE-MEASURE actual <100% util/store files first, then pin
> genuine logic; don't trust a stale truncated coverage row. Don't re-add the initialize() pin.
>
> **GUARDED C100:** the FE settings-store `uploadBackup` mode-gated reload is now pinned (+2 in
> settings-state-contract.test.ts) — the C319 `restoreFromProvider` twin on the FILE-upload restore path. The store
> gates the post-restore `this.load()` on `mode !== 'preview'` (a non-preview replace/merge must refresh state; a
> preview must NOT) — C319 pinned the provider path, but the uploadBackup path was unguarded, so a dropped reload
> would leave the UI showing STALE pre-restore settings (NORTH_STAR #1), invisible to settings-api.test.ts (which
> pins only the wire/FormData contract). Non-vacuous (drop the gate → only the non-preview test RED, 1 fetch not 2).
> **First FE coverage movement since C52: 86.86% line / 87.97% func / 79.07% branch (+0.51/+0.29/+0.29).** This is
> the productive guard frontier now — REAL FE behavioral gaps, NOT backend source-scans on code unchanged since C85.
> SEEDED for the next guard cycle: load-state.svelte.ts (35% func) + theme.svelte.ts (60%) have genuine untested
> logic; pin those over another cold backend scan. Don't re-add the uploadBackup pin.
>
> **GUARDED C116 — ROUTE-COVERAGE IDOR AUDIT COMPLETE.** Closed the last sweep gap: PUT /notifications/:id/read
> (reminders), state-changing + (id,userId)-scoped (throws NotFoundError) but never in the sweep. +2 in the reminder
> IDOR case (raw-seed B's notification, assert A denied + B's row stays unread). Non-vacuous (drop the userId scope
> → reminder IDOR test RED). **MILESTONE: the route-coverage audit (C108–C116) found + closed 7 real route gaps in 9
> cycles — 6 cross-tenant IDOR (sync-status, vehicle-expenses, financing payoff, insurance terms, expense split,
> notification read) + 3 analytics auth/validation routes. cross-tenant-idor.test.ts now covers EVERY state-changing
> route across all domains; analytics is fully HTTP-harnessed. This vein is EXHAUSTED — genuinely productive for 9
> cycles, now done.** The self-authorizable veins are all swept again; record dry/no-churn fast + the highest-leverage
> work is GATED on Angelo (#148 READY / import defaultCategory / createLoadState + seedVehicle arch designs /
> #100/#79/#129). Don't re-add.
>
> **GUARDED C115:** the expense SPLIT routes' cross-tenant IDOR gap (PUT/DELETE /split/:id) is now pinned (+2
> expectDenied in the expense IDOR case). Both routes throw NotFoundError when the group isn't (groupId,userId)-owned
> (groupOwnedBy), so they 4xx-deny a foreign id today, but the cross-tenant-idor.test.ts sweep never covered them —
> destructive (regenerate/delete sibling rows + photos) + money-bearing, so an un-scoped regression lets A
> rewrite/delete B's split expenses. Non-vacuous (drop the userId scope from groupOwnedBy → expense IDOR test RED).
> 6th route gap via the audit method (C108–C115), 5 of them cross-tenant IDOR. REMAINING sweep gap: PUT
> /notifications/:id/read (reminders — verified (id,userId)-scoped + throws, but not in the sweep; LOW-stakes
> read-flag). NEXT: pin the notification-read IDOR (last known gap), then record the IDOR sweep COMPLETE for
> state-changing routes. Don't re-add.
>
> **GUARDED C110:** the analytics route domain now has COMPLETE HTTP-harness coverage — pinned the last 3 untested
> routes (/quick-stats, /cross-vehicle, /year-end) in analytics-routes-http.test.ts (+3). Unlike the C109
> vehicle-expenses gap these are USER-scoped (no per-vehicle ownership gate), so they pin: per-route auth-gating
> (the C185 net asserted 401 on only ONE representative route → a mis-mount skipping requireAuth on one would've
> gone unnoticed), the REQUIRED startDate+endDate validation on the two dateRange routes (omit → 400), and
> year-end's OPTIONAL year (omitted → 200 current-year default). Non-vacuous (drop the quick-stats zValidator →
> its 400 assertion RED). PATTERN (C108/C109/C110): the route-coverage audit method — inventory a domain's handlers
> vs HTTP-harness hits, pin the uncovered (ownership-gated first, then auth/validation) — is the productive
> guard/deep-review vein. analytics is the FIRST domain fully mapped + closed (13/13 endpoints). NEXT: apply the
> same method to the next thinnest domain — auth/photos are OAuth/upload-bound (structural), so check
> financing/insurance/odometer GET-by-id + list routes for any unharnessed ownership-gated handler. Don't re-add.
>
> **GUARDED C108:** the untested `GET /:id/sync-status` provider route's tenant-isolation chokepoint is now
> pinned (+4 in providers-routes-http.test.ts). Scouting the HTTP-harness guard vein (not source-scan) across all
> 12 route domains surfaced this endpoint with ZERO coverage despite gating on `findOwnedProviderOrThrow` — the
> same tenant-isolation guard the PUT/DELETE paths pin (#63), but on a READ that leaks another tenant's
> per-category photo-sync counts if dropped (NORTH_STAR #2). Pins owned→200 (4-category {total,synced,failed}
> shape), foreign→404 (no leak), non-existent→404, anon→401. Non-vacuous (drop the ownership check → foreign +
> non-existent tests RED). **CORRECTION: the C103/C107 "guard frontier worked out" claim was PREMATURE** — a real
> untested route with a cross-tenant guard gap existed. LESSON: the HTTP-harness vein isn't exhausted just because
> source-scan + FE-logic are; map route-domain endpoint coverage before asserting saturation. NEXT guard: re-scan
> the remaining low-coverage route endpoints (sync/auth/analytics harness are thin but mostly DI/OAuth-bound —
> verify genuinely-testable vs structural first). Don't re-add the sync-status pin.
>
> **GUARDED C98 (deep-review→guard):** the session-cookie SECURITY-ATTRIBUTE contract is now pinned by a
> source-scan (`session-cookie-security-attributes.test.ts`, +4) — the C92/C97-flagged unaudited session/cookie
> lifecycle. The attrs `secure: CONFIG.env==='production'` / `httpOnly: true` / `sameSite: 'Lax'` are hand-copied
> across 5 manual sites (2 setCookie: login + refresh-rotation; 3 deleteCookie: logout + 2 callback cleanups), and
> NO test asserted ANY of them (validate-and-refresh-session.test.ts mocks Lucia + checks the return value, never
> the cookie attrs). A drift on one site silently weakens auth on that path — hardcoded `secure:true` breaks
> local-http dev; `secure:false`/dropped httpOnly ships an insecure / JS-readable session cookie in prod (XSS-exfil
> + network theft); a drifted deleteCookie fails to clear the cookie (logout doesn't log out) — all invisible to a
> happy-path login test. Guard source-scans both auth files; non-vacuous (drop httpOnly from the refresh cookie →
> only the httpOnly test RED, names the offender). The auth-security surface (rate-limit C92, CORS/CSRF C94,
> session-cookie attrs C98) is now broadly fenced. The refresh LOGIC was already guarded (C-validate-refresh, all 4
> branches incl. fail-open). Don't re-add. The one-edit→source-scan pattern (C25/C45/C59/C67/C80/C87/C94).
>
> **GUARDED C94:** the CORS↔CSRF origin-allowlist coupling in app.ts is now pinned by a source-scan
> (`src/__tests__/cors-csrf-origin-coupling.test.ts`, +4) — the C92-flagged unaudited surface. app.ts wires
> `cors({ origin: CONFIG.cors.origins })` AND `csrf({ origin: CONFIG.cors.origins })` from the SAME allowlist,
> coupled only by both referencing that const; NO test pinned it (the 2 "csrf" files assert application-layer
> OAuth-state userId matching, not the middleware origin allowlist). Drift them (hand csrf a hardcoded/divergent
> list) → the two trust boundaries split: a CSRF gap on an origin one trusts and the other doesn't, or legit
> cross-origin state-changing requests rejected as forgery (NORTH_STAR #2) — invisible to a happy-path same-origin
> test. Guard source-scans both calls for `origin: CONFIG.cors.origins` + asserts they reference the IDENTICAL
> source (drift detector). Non-vacuous (drift csrf to a hardcoded list → 2 of 4 RED). The one-edit→source-scan
> pattern (C25/C45/C59/C67/C80/C87). The config-coupling seam (C67/C80/C81/C87/C94) is now broadly fenced. Don't re-add.
>
> **GUARDED C87:** bug #18 (split-sibling fillup-count inflation) is now pinned on the PREV-PERIOD axis — the
> C97 guard's missing twin (+1 in fuel-stats-fleet-distance-pooling.test.ts). The FuelStats "This Period vs Last
> Period" fillup comparison computes its halves through DIFFERENT predicates across two layers: `fillups.currentYear`
> is in-memory `fuelRows.filter(isFillup)` (volume != null && >0), while `fillups.previousYear` is the SQL
> `COUNT(CASE WHEN volume > 0 THEN 1 END)` in queryFuelAggregates (the C79 group-by shape), coupled only by a
> comment. Split fuel siblings carry volume=null (must not inflate either count, bug #18). C97 pinned ONLY the
> currentYear/in-memory half — nothing asserted `fillups.previousYear` from a populated DB (summary-route.test.ts
> is mocked), so dropping the SQL `CASE WHEN` to `COUNT(*)` silently inflated "Last Period" by the split legs with
> every test green. New guard seeds 2 real fillups + a 2-leg volume-null split in the prev window → asserts
> previousYear===2 (not 4) + prev volume stays 19. Non-vacuous (force COUNT(*) → RED Expected 2/Received 4; the
> other 10 in-file + the C97 currentYear + calendar-month tests stay green, confirming prev-period-only gap). The
> bug-pinned-on-one-layer→guard-pins-the-sibling-layer pattern (C67 retry-ceiling; here C97 in-memory→C87 SQL).
> The fuel-stats count/convert predicates are now fenced on BOTH layers. Don't re-add.
>
> **GUARDED C80:** the CSV export↔import COLUMN-NAME contract (round-trip crown-jewel, NORTH_STAR #1) now has
> a source-scan (`export-import-column-contract.test.ts`, +4). The export writes its header from EXPORT_COLUMNS
> (routes.ts); the importer reads each cell BY NAME via `get('<col>')` (import-csv.ts) — coupled only by the
> strings matching. A renamed/dropped EXPORT_COLUMN silently breaks the export→re-import round-trip (field
> reads blank, lost on re-import) and NEITHER suite catches it (export-only test + import test hand-writes its
> own header). Guard exports EXPORT_COLUMNS + asserts every importer `get()` key (10 cols) is present in it;
> pins currency/createdAt as intentionally export-only (the ⊆ is one-directional by design). Non-vacuous
> (rename `fuelType`→`fuel_type` → RED "…would silently LOSE these fields"). The one-edit→source-scan pattern
> (C25/C45/C59/C73). Don't re-add.
>
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

> **#94 CLASS FULLY CLOSED (C58/C62/C65/C69/C72/C76 + C79)** — all 6 builder members [distance.totalDistance
> (C58), volume/fillupDetails (C62), monthlyConsumption (C65), seasonalEfficiency (C69), dayOfWeekPatterns
> avgVolume (C72), vehicleRadar gas-MPG+odometer (C76)] + the prev-year SQL sub-member [volume.previousYear,
> C79 — queryFuelAggregates now GROUPs the volume SUM BY vehicle + buildFuelStatsFromData converts each
> vehicle's prev-window sum before pooling] now convert-before-pool. The fleet-wide analytics summary +
> fuel-advanced paths are unit-correct for a mixed mi+km/gal+L fleet END-TO-END. Each member has a mixed-unit
> behavioral guard in fuel-stats-fleet-distance-pooling.test.ts + the C59/C73 source-scans fence the dispatch.
> Don't re-pick #94 — it's done. (The product-gated cross-cutting siblings #112 chart palette + #30 MPG-band
> remain their own separate items.) Other open Angelo bug items: **Sev-4** #129 (OAuth email-sync,
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
> **UPDATE C102 (deep-review): #148 is now CHARACTERIZATION-PINNED + READY.** lease-metrics.test.ts has a
> red→green anchor test pinning the CURRENT null-initial behavior (mileageUsed 0 / remaining full) + documenting the
> contradiction (initial=0 drives used=30000). Verified firsthand that applying the recommended fix
> (`initialMileage ?? 0` in the :497 gate) flips that test RED — so when Angelo rules, the fix is a 1-line gate
> change + flipping this test's expectations to the chosen semantics. The escalation is no longer just a note: it's
> a ready-to-execute, test-anchored change awaiting only the product decision.
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
> - ~~**#94 (MED, 6-member CLASS + 1 sub-member) — FULLY CLOSED C58/C62/C65/C69/C72/C76 + C79.**~~ APPROVED:
>   convert-to-user-global BEFORE pooling, mirroring `getCrossVehicle`. All 6 builder members — DISTANCE (C58),
>   VOLUME+fillupDetails (C62), MONTHLY-CONSUMPTION (C65), SEASONAL-EFFICIENCY (C69), DAY-OF-WEEK avgVolume
>   (C72), VEHICLE-RADAR gas-MPG+odometer (C76, an optional `convert?` param + repository `radarUnitConverters`)
>   — PLUS the prev-year SQL sub-member (volume.previousYear, C79 — queryFuelAggregates now GROUPs the volume
>   SUM BY vehicle + buildFuelStatsFromData converts each vehicle's prev-window sum before pooling) now convert
>   each vehicle's value to the user's global unit before pooling/normalizing (skipConversion no-ops the common
>   single-unit case). +1 mixed-unit guard each (distance 924.27 not 1000; volume 42.64 not 50;
>   monthlyConsumption 42.64 not 50; seasonal 62.04 not 35; dayOfWeek 6.06 not 9.0; radar fuelEff 100 not 0;
>   prev-year 42.64 not 50), all non-vacuous; the C59/C73 source-scans fence the dispatch. The fleet-wide
>   analytics summary + fuel-advanced paths are unit-correct for a mixed mi+km/gal+L fleet END-TO-END. Don't
>   re-pick — done.
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

> **🚩 DESIGN-GATED (arch rule 6, AWAITING ANGELO) — surfaced C112: converge the `seedVehicle` test helper.** It's
> re-declared in 51 HTTP-harness test files with 7 distinct signatures (32× no-arg, 7× nickname, 4× make, + 4
> one-offs). A real DRY win (one shared `test-helpers` seeder vs 51 copies), but converging it is a SWEEPING 51-file
> refactor with an options-bag — NOT a self-authorizable arch increment (rule 1: one small reviewable; rule 2:
> behavior-change risk across 51 test files). RECOMMENDED if approved: add ONE shared seeder (an options bag
> covering nickname/make/extra), migrate ONE domain's test files per arch cycle (never a 51-file big-bang); the
> 32 no-arg call sites are the trivial first wave. Test-only (lower-leverage than production dedup, which is
> unchanged since C85). Until Angelo rules, arch records no-churn fast.
>
> **🚩 DESIGN-GATED (arch rule 6, AWAITING ANGELO) — surfaced C105: adopt `createLoadState<T>` across the 13
> load-bearing pages.** The scaffold (load-state.svelte.ts, arch #2) was extracted to centralize the page load triad
> (isLoading/loadError/load) so the error leg is STRUCTURAL not per-page — the "load failure masquerades as empty
> state" bug class (dashboard/reminders/settings/vehicle-detail C57). It has ZERO adopters; 13 pages still hand-roll
> it. NOT self-authorizable: every page loads MULTIPLE values via Promise.all into separate $state vars while
> createLoadState holds ONE `data`, so adoption is a reactivity REWRITE per page (composite type or N load-states +
> rewire every `isLoading`→`loadState.isLoading` template binding) touching observable render → needs
> `.kiro/specs/load-state-migration/design.md` + Angelo sign-off + shot-before/after per page (arch rules 1/2/4/6).
> RECOMMENDED if approved: migrate ONE page per arch cycle (start with a single-load page if one exists, else define
> the composite-state shape in the design doc). Until Angelo rules, arch records no-churn fast.

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
9. ~~**per-row volume-convert dedup**~~ — **DONE C78.** The C62/C65/C72 #94 volume work left the SAME idiom at
   3 sites: `v = row.volume ?? 0; if (v===0) return 0; convertVolume(v, vehicleUnitsFor(map, row.vehicleId)
   .volumeUnit, target.volumeUnit)` — in buildConvertedMonthlyConsumption, buildConvertedDayOfWeekPatterns, and
   the buildFuelStatsFromData volumeInUserUnits closure. Extracted `convertRowVolume(row, map, target)`; all 3
   route through it (volumeInUserUnits keeps its own leading `skipConversion ||` guard — the only volume path on
   BOTH branches — and delegates the rest). PAYOFF: the `?? 0` + `===0` zero-guard (never NaN into a sum) + the
   per-vehicle lookup are ONE source of truth; `convertVolume` now has exactly 1 call site. Behavior-preserving
   (green→green, 1691 pass, no test delta; the C62/C65/C72 mixed-unit guards pass unchanged). The
   bug-threads-idiom → next-arch-converges lesson again (C62/C65/C72 → C78; sibling to C64 generator + C71
   vehicleUnitsFor). Don't re-scout the volume sites — single-sourced.

> **SCOUTED C112 — no churn warranted (self-authorizable); surfaced a 2nd design-gated dedup.** Production source
> unchanged since C85 (no fresh production dedup). The only new code since is the C108–C110 route TESTS, which DID
> thread a real convergence candidate: `seedVehicle` re-declared in 51 HTTP-harness files (7 signatures). But that's
> a sweeping 51-file test-only refactor → design-gated (see the new arch queue item above), NOT a self-authorizable
> increment. Recorded no-churn; surfaced it. 9th no-churn confirm (C4/C6/C12/C36/C85/C91/C98/C105/C112) — both real
> dedups (createLoadState C105, seedVehicle C112) now await an Angelo design call.
>
> **SCOUTED C105 — no churn warranted for a SELF-AUTHORIZABLE increment, but surfaced a REAL design-gated dedup.**
> Scouted a fresh surface the backend scouts (C85/C91/C98) never touched: the FE load triad. FINDING:
> `createLoadState<T>` (load-state.svelte.ts) was extracted (arch #2) as a migration SCAFFOLD — docstring: "~14 pages
> hand-repeat the triad; pages migrate one per later cycle" — but it has ZERO adopters; all 13 pages still hand-roll
> isLoading/loadError/load(). The dedup is real (the payoff is the "load failure masquerades as empty state" bug
> class the scaffold structurally prevents), BUT every candidate page loads MULTIPLE values via Promise.all into
> SEPARATE $state vars while createLoadState holds ONE `data` — so migrating any page is a reactivity REWRITE
> (composite type or N load-states + every template binding rewired), touching observable render + needing
> shot-before/after. That's arch-rule-6 DESIGN-GATED (`.kiro/specs/<refactor>/design.md` + Angelo), NOT a
> self-authorizable cycle. See the NEW arch queue item below. Recorded no-churn for the cycle; did NOT force a risky
> rewrite. 8th no-churn confirm but INFORMATIVE — names a concrete real dedup, not just "DRY".
>
> **SCOUTED C98 — no churn warranted (recorded FAST per the C91 discipline; still NO source changed since C85).**
> `git diff C85..HEAD` over production source remains EMPTY (C86–C97 were all docs/tests/eyes-on/dry) — structurally
> nothing freshly-threaded to converge. Recorded no-churn IMMEDIATELY without re-scouting (the C12/C91 "don't force
> ceremony"); the cycle's substantive work pivoted to the co-starved deep-review (C98 session-cookie guard). 7th
> no-churn confirm (C4/C6/C12/C36/C85/C91/C98) — arch is firmly at its structural floor.
>
> **SCOUTED C91 — no churn warranted (route/pagination idioms already single-sourced + NO source changed since
> C85).** KEY FACT: `git diff C85..HEAD` over backend/src (excluding __tests__) is EMPTY — no production source
> changed since the last arch scout (C86 saturated / C87 test-only / C88 eyes-on / C89 dry / C90 docs), so there's
> structurally nothing freshly-threaded to converge. Scouted the freshest un-recorded candidate anyway — pagination
> parsing across odometer/photos/expenses routes — ALREADY well-factored: `clampPagination` + `buildPaginatedResponse`
> are both single-sourced in src/utils/pagination.ts; all 3 routes delegate; the per-endpoint query schemas
> (odometer/expenses search+tags coercion vs photos' generic commonSchemas.pagination) are deliberately divergent
> (merging couples endpoint contracts, arch rule 2). The ownership-validate+respond idiom is the C36 "natural Hono
> idiom" (not mergeable). Recorded no-churn; did NOT manufacture (C4/C12/C36/C85 precedent). RECOMMENDATION (6th
> confirm): arch is firmly at its structural floor — next over-budget, record no-churn IMMEDIATELY unless a
> bug/feature cycle threaded a NEW dup since the last arch scout (check the git diff first; if backend/src is
> unchanged, there's nothing to find).
>
> **SCOUTED C85 — no churn warranted (the convert family is fully deduped; remaining idioms are thin or
> cosmetic).** With the #94 cluster closed (C79), scouted its convert-helper residue firsthand. Two candidates,
> both REJECTED per arch rule 5 (name a concrete payoff): (1) the 5-arg `convertEfficiency(value,
> v.distanceUnit, v.volumeUnit, target.distanceUnit, target.volumeUnit)` shape appears at only TWO sites
> (radarUnitConverters closure + the convertedGasEfficiencyPoints generator), and the generator's is interleaved
> with the `skipConversion ?` short-circuit / the load-bearing gasEfficiencyPoint gate — a 2-site wrapper is
> borderline churn with a thin payoff (arg-order can't drift), and the generator wouldn't cleanly delegate; (2)
> `vehicleNameMap.get(vId) ?? 'Unknown'` repeats 10× across analytics-charts.ts + repository.ts, but it's a
> COSMETIC fallback (a dropped/typo'd `'Unknown'` is harmless — NOT load-bearing like C71's `?? {...DEFAULT}`
> which threw, or C78's zero-guard which prevented NaN), embedded in `vehicleName:` object-literal fields across
> a unit-naive module + its importer — extracting it touches 10 sites for a 1-token tidy. The convert family is
> already single-sourced (C64 generator, C71 vehicleUnitsFor, C78 convertRowVolume). Recorded no-churn; did NOT
> manufacture. STRONG RECOMMENDATION (echoing C12): arch is at its structural floor — when it next goes over
> budget, record no-churn FAST + let the budget pull elsewhere rather than forcing a 6th ceremony scout.
>
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

> **RAN C123 (cadence; last ran C117).** Untracked-test sweep CLEAN (the C119/C120/C122 test files all tracked;
> only the intentional `M .gitignore`/`M frontend/.gitignore` overrides remain). Coverage RE-MEASURED: BE 87.78%
> line / 87.54% func (1757 pass) — line FLAT vs C117, but `analytics-charts.ts` jumped 95→99.63% line / 99.01% func
> from the C119–C122 analytics-builder sweep (the module was near the file-mean, so overall is flat; residual
> ceiling DI/SQL/OAuth-bound). Its only "uncovered" rows (275, 1025-1026) are the bun ternary-in-`new Date()`
> line-attribution artifact (C100 lesson), not real gaps — the C122 mutant proved line 275 IS exercised. FE 87.6%
> line / 88.56% func / 79.84% branch / 85.57% stmts (739 pass) — FULLY UNCHANGED vs C117 (no FE source since).
> Both green (BE 1757 / FE 739). Branch = 123 ahead, PR-ready (bug 28 / guard 22 / feature 21 / deep-review 20 /
> infra 17 / arch 14). NEXT cadence ~C133. STANDING SIGNAL: the analytics-builder coverage vein (C119–C122) now
> joins FE-logic (C100–C102) + route-IDOR (C108–C116) as a CLOSED self-authorizable frontier; highest-leverage work
> is GATED on Angelo (#148 READY / import defaultCategory / createLoadState + seedVehicle arch designs /
> #100/#79/#129).
>
> **RAN C117 (cadence; last ran C111).** Untracked-test sweep CLEAN (only the intentional `M .gitignore`/`M
> frontend/.gitignore` overrides). Coverage RE-MEASURED: BE 87.78% line / 87.53% func (1717 pass) — +0.01 line vs
> C111 (the C113–C116 cross-tenant-idor.test.ts additions are +expect assertions on ownership-gate branches mostly
> already covered — they pin SECURITY behavior, not new lines, as expected for IDOR guards); FE 87.6%/88.56%/79.74%
> UNCHANGED (C112–C116 backend/docs). Both at the ~87.8 BE / ~87.6 FE structural ceiling. Both green (BE 1717 / FE
> 739). Branch = 117 ahead, PR-ready (bug 27 / guard 21 / feature 20 / deep-review 19 / infra 16 / arch 13). NEXT
> cadence ~C127. STANDING SIGNAL: both self-authorizable coverage frontiers are CLOSED — FE-logic guard (C100–C102,
> FE +1.25) + route-IDOR audit (C108–C116, 7 gaps + BE +0.31). Highest-leverage work GATED on Angelo (#148 READY /
> import defaultCategory / createLoadState + seedVehicle arch designs / #100/#79/#129).
>
> **RAN C111 (cadence; last ran C104).** Untracked-test sweep CLEAN. Coverage RE-MEASURED: **BE 87.77/87.53 (1717
> pass) — +0.30/+0.34 vs C104, moving UP OFF the ~87.47% ceiling** from the C108–C110 route-coverage arc
> (analytics/routes.ts 95.65→97%) — PROOF the audit found REAL untested route code; FE 87.6%/88.56%/79.74% unchanged.
> Both green, branch 111 ahead.
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
