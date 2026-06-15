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
> ~~**Insurance premium-materialization + expenses-split audit (C458) → insurance CERTIFIED CLEAN; found+fixed #141 (split sub-cent groupTotal drift).**~~ — *DONE C458 (deep-review
> OVER budget 6>5 → forced). 2-agent fan-out. (A) INSURANCE materialization CERTIFIED CLEAN (verified firsthand): largest-remainder cents split exact (C382), re-materialize deletes-
> before-recreate, #57/#84/C369 hold, no C151 async-tx footgun. (B) EXPENSES split → #141: createSplitExpenseSchema.totalAmount had NO cent quantization; groupTotal stored the raw
> totalAmount (repository.ts:648) while legs round to cents (Math.round(total*100)) → a sub-cent total (100.005) persisted groupTotal=100.005 while legs summed to 100.01 — a stored
> header disagreeing with Σsiblings (NORTH_STAR #1). FIX: extracted a centsAmount schema (positive + .transform round-to-2dp), routed create+update totalAmount through it → header
> computed from the same cent-aligned value as the legs. +3 guards (sub-cent create/update rounds; clean 2-decimal no-op), NON-VACUOUS. be validate:local EXIT 0, 1548 pass (+3).*

> ~~**Vehicle CRUD + cascade-delete audit (C452) → CERTIFIED CLEAN; +1 photo-cascade-coverage symmetry guard.**~~ — *DONE C452 (deep-review OVER budget 7>5 → forced).
> 1-agent fan-out on the stalest surface. CERTIFIED CLEAN, verified firsthand: cascade-delete ordering correct (enumerate IDs before FK cascade, reap photos, then delete — #34/C280);
> all 6 FK children verified (5 cascade; insuranceClaims set-null = preserved, C366); tenant isolation solid; plate uniqueness well-covered; /stats correct-by-design. ONE LOW finding
> NOTED (product nuance, not filed): an empty-STRING licensePlate bypasses the friendly per-user check (the partial index still 409s it) — clean fix is normalize ""→null at the boundary.
> THE unpinned invariant → guard: the delete handler hard-codes which photo-entity types it reaps (vehicle/expense/odometer_entry); ENTITY_TO_CATEGORY is the full registry; the omitted
> insurance_policy/insurance_claim correctly survive a vehicle delete but NOTHING pinned that correspondence → a future photo-bearing vehicle-cascade-child without a cleanup call would
> silently orphan bytes (the #34 leak class). +1 symmetry guard (C302 pattern): every ENTITY_TO_CATEGORY key is reaped OR in a documented survives-set + a liveness floor. PROVEN
> NON-VACUOUS (removing the odometer_entry cleanup → RED). be validate:local EXIT 0, 1542 pass (+2).*

> ~~**Sync conflict-resolution / offline-apply path audit (C445) → found+fixed #134 (orphaned-retry conflict resurrection); filed #135.**~~ — *DONE C445 (deep-review OVER
> budget 6>5 → forced). 1-agent fan-out on the stalest data-safety surface (flagged C439, only single-bug-patched since via C424/C442). FOUND #134: retrySingleExpense
> (sync-manager.ts:250) guarded only on !onlineStatus before re-running the conflict-check, but the backoff setTimeout is DETACHED from retryCount → a retry scheduled on an
> earlier failed POST fires even after an interleaving syncAll surfaced + the user RESOLVED that conflict (markExpenseAsSynced); the orphaned retry then re-finds the committed
> server row + RE-LISTS the dismissed conflict (the C424 dedup misses it — resolution removed it from the live set). FIX (one guard): early-return when getPendingExpenses()
> (!synced source of truth) no longer contains the row. +1 fake-timer guard, PROVEN NON-VACUOUS (reverting → resurrects). fe validate:local EXIT 0, 713 pass (+1). Resolution
> legs (keep_local/keep_server/merge), backoff cap, dedup all otherwise CERTIFIED CLEAN. Filed #135 (LOW, see bug queue — SyncManager never reaps synced rows).*

> ~~**Analytics TCO / depreciation / cost-composition audit (C439) → CERTIFIED CLEAN (last full cert C361); +1 year-scoped costPerMonth divisor guard.**~~ — *DONE C439
> (deep-review OVER budget 6>5 → forced). 1-agent fan-out on the stalest money surface. CERTIFIED CLEAN, verified firsthand: #27 fix holds (purchasePrice>0 → financing rows
> excluded; $0-price gate is `>0` not `!=null`, correct), categorizer no money-slip (else→otherCosts; a 'financial' recurring expense is a label debate not a total error),
> denominators sound (year path date-filters numerator + distance + monthsOwnedInYear together; div-by-zero guarded), no depreciation curve exists, #28/#27 year-scoping = the
> C333-certified design (not re-flagged). THE unpinned invariant → guard: monthsOwnedInYear is unit-tested in ISOLATION + Property-15 pins only the ALL-TIME costPerMonth (no
> year arg) → the YEAR branch's divisor SELECTION (monthsOwnedInYear ≤12 vs full-ownership monthsBetween — the #28 mistake) was undriven through the real getVehicleTCO. +1 guard
> (a 2020-purchased vehicle + $1200 in-year financing → getVehicleTCO(…,2024) returns ownershipMonths===12, costPerMonth===100). NON-VACUOUS (monthsBetween(2020→now) ~70+).
> be validate:local EXIT 0, 1533 pass (+1). Next stale deep-review candidate: the sync conflict-resolution / offline-apply path.*

> ~~**Auth/session/OAuth lifecycle + backup EXPORT path audit (C433) → BOTH CERTIFIED CLEAN; +1 RFC-4180 round-trip guard; filed #129.**~~ — *DONE C433 (deep-review
> OVER budget 6>5 → forced). 2-agent fan-out on the two stalest data-safety surfaces. (A) AUTH/SESSION/OAuth CERTIFIED CLEAN: session rotation create-before-invalidate +
> fail-open (C313 holds), logout server-side invalidate, provider-callback CSRF (state.userId===session.user.id), tenant-scoped provider read/mutate/unlink + last-sign-in
> guard, credentials never leaked (AES-256-GCM at rest, omitted from responses), account-linking blocks cross-account hijack. FILED #129 (MED, see bug queue) — the one real
> finding: login callback overwrites users.email with the provider email every login; the UNIQUE-collision branch is correct but UNTESTED + a within-account email drift is
> silent. (B) BACKUP EXPORT CERTIFIED CLEAN: completeness guards REAL (CSV schema-derived; sheets-header-coverage drives live getTableColumns), serialization correct
> (csv-stringify quoted ↔ csv-parse RFC-4180), non-neutralization by-design (csv-safety.ts:16 — round-trip must be verbatim), #36/#37/#43/#44 unchanged/escalated, C431
> column-letter ceiling re-confirmed. THE unpinned invariant → guard: existing round-trip tests drive the real exportAsZip→restoreFromBackup but NONE seeds a comma/quote/
> newline free-text value. +1 guard (csv-special-chars-roundtrip.test.ts, +2): a nickname AND a description = `Joe's "Daily", commute\nsecond line` survive byte-for-byte; +
> a leading-`=` value round-trips verbatim (pins the lossless-not-neutralized contract). NON-VACUOUS, drives the real stack. be validate:local EXIT 0, 1531 pass (+2).*

> ~~**Reminder trigger/recurring-materialization engine + CSV import↔export round-trip audit (C399) → found+fixed bug #116.**~~ — *DONE C399 (deep-review OVER
> budget 6>5 → forced). 2-agent fan-out. (A) reminder engine surfaced #116: trigger-service.ts processReminder's catch-up `while` (:443) — the in-loop endDate guard
> (:445) only inspects nextDue <= now (the while condition); the FINAL advance steps nextDue PAST now and exits the loop UNDER the 12-occurrence cap, never tested
> against endDate (the post-loop block at :464 only runs AT the cap). A bounded reminder whose endDate falls between its last in-window occurrence and that final advance
> was left is_active=1 with a future nextDueDate → inflates GET /reminders/recurring-cost (monthlyRunRate gates only on isActive) + stays active until a LATER trigger
> lazily closes it (NO dup expense — in-loop guard precedes materialization — purely wrong active-state/run-rate). The EXACT #107(C362)/#114(C394) bug-#12 family on a
> THIRD path neither fix touched. FIX (atomic, ONE deactivation site): in-loop guard now `break`s, single post-loop guard deactivates+returns (covers both the break
> case + the natural-exit boundary); mirrors fastForwardPastNow:303. +1 HTTP guard (weekly, 4wk history « 12 cap, endDate≈now → is_active=0 + no re-fire). NON-VACUOUS.
> be validate:local EXIT 0, 1484 pass (+1). The materialization path itself CERTIFIED CLEAN (split sums + source-links every sibling; per-period advance-before-insert
> sound; #88/#97 already filed). (B) CSV round-trip mostly CLEAN (numbers, dates, RFC-4180 quoting, multi-tag, BOM, formula-injection `=…` round-trip all survive) —
> surfaced one NARROW asymmetry, noted below.*
> NOTE (filed C399, RE-CLASSIFIED C401 to a DIRECTION CALL — ESCALATED to Angelo, NOT a clean guard fix): a user free-text value (description / tag / vehicle
> nickname) literally beginning with `'` + a formula-trigger char (`=`/`+`/`-`/`@`/TAB/CR) round-trips LOSSY. neutralizeCsvCell (csv-safety.ts:35) only escapes a value
> whose FIRST char is a trigger, so `'=mc2` exports UNCHANGED; but denormalizeCsvCell (:65, called on every cell via makeCellGetter:88) strips a leading `'` whenever
> char-2 is a trigger → re-imports as `=mc2` (the apostrophe is silently gone). For a vehicle nickname it's worse: the stripped name no longer matches the registered
> key → the whole row fails to import. Reachable but NARROW (only `'`+trigger-led values). C401 VERIFIED FIRSTHAND the C399-proposed "clean fix" (escape to `''=mc2`)
> is WRONG: denormalizeCsvCell strips only when char-2 is a TRIGGER, and `'` isn't one → `''=mc2` returns UNCHANGED (still corrupt), AND it collides with the pinned
> `''=double`-stays test. A single-`'` sentinel CANNOT disambiguate a user-typed `'=` from an export-escaped `'=`; the ONLY invertible scheme (escape EVERY leading-`'`
> on write, strip one on read) reinterprets hand-authored leading-`'` FOREIGN CSVs, flipping the deliberate import-csv.test.ts:532 "preserves a genuinely
> apostrophe-led description" contract → a data-safety TRADEOFF (optimize VROOM-own-export round-trip faithfulness vs foreign-import faithfulness), Angelo's call.
> C401 increment (safe): corrected the FALSE doc claim ("can never eat real data") + pinned the actual lossy behavior with a labeled characterization test (flips to a
> true round-trip assertion when the call lands) + escalated. NORTH_STAR #1 (round-trips every field, no silent loss) — but the fix is gated on the direction decision.
>
> ~~**Middleware (idempotency/rate-limit/body-limit) + split-tx-integrity audit (C393).**~~ — *DONE C393 (BOTH CERTIFIED CLEAN; idempotency in-memory-race
> hardening FILED). 2-agent fan-out. (B) split create/update tx CLEAN — C151 async-tx footgun NOT exposed (all validation pre-hoisted out of the async callback;
> createSiblings throw-free; delete→insert→photo-migrate rolls back atomically; groupTotal==sum penny-exact, property-pinned). (A) middleware: idempotency
> comprehensively pinned (user-scoped, non-2xx-not-cached, non-JSON-2xx-no-500 #96/C315, TTL-drop — verified firsthand), rate-limit per-user, body-limit strict>.
> The agent's check-then-cache RACE is real in-principle but low-sev (see note); NO genuinely-unpinned invariant → docs-only certification, no manufactured test.*
> NOTE (filed C393, concurrency-hardening — low priority): the idempotency middleware (idempotency.ts) is check-then-cache (get :71, set :88, with an
> `await next()` yield between), so two requests with the SAME Idempotency-Key interleaving in the event loop would BOTH run the handler (idempotency replay
> defeated for that pair). Low-sev because (1) the DURABLE dedup is the DB-level clientId (createIdempotent/C8) — a duplicate EXPENSE can't persist regardless of
> this in-memory replay cache racing; (2) the sync worker POSTs sequentially (not parallel same-key), so it's not in the app's actual traffic. A hardening cycle
> could add a per-key in-flight promise (check-if-pending-else-execute) to serialize duplicates — a concurrency-architecture change; deferred (the DB clientId
> layer arguably makes it unnecessary). No flaky timing test added (the singleton-store-across-tests constraint makes one fragile).

> ~~**Dashboard quick-stats + expense-list pagination/filter audit (C388).**~~ — *DONE C388 (BOTH CERTIFIED CLEAN; docs-only, no manufactured test). 2-agent
> fan-out. (A) dashboard quick-stats/getSummary CLEAN — known issues FILED (#94, #85) or FIXED (#86/C262); div/NaN/precision guards present + property-tested;
> summary↔per-method equivalence pinned. (B) expense-list pagination+filter CLEAN (verified firsthand): id-tiebreaker → deterministic sort (no drop/dup,
> sort-paginated.test.ts:122), hasMore strict-< correct at boundary (pagination.ts:53, spot-checked), list↔export share buildExpenseConditions, tag-AND,
> LIKE-escape (#41), endDate-inclusive, sort allowlist — all pinned. NO reachable defect, NO genuinely-unpinned invariant (both comprehensively guarded). Per the
> dormant-vein protocol, recorded a CERTIFICATION not a redundant test (coverage-theater avoided) — the vein is dry on these surfaces. No source/test touched.*

> ~~**Insurance premium-materialization + financing lifecycle audit (C382).**~~ — *DONE C382 (BOTH CERTIFIED CLEAN; +1 non-even-split materialization guard).
> 2-agent fan-out. (B) financing create-or-replace/refinance/payoff CLEAN — type-change field reset (#90/C293), refinance-reactivation (#67/C206),
> balance=max(0,original−SUM) clamped + single computeBalances (C332), deactivateFinancing single-call-site (C343), inactive excluded from analytics — verified +
> guarded. (A) insurance materialization CLEAN — totalCost split via integer-cents largest-remainder (exact to the cent), re-materialize-on-edit deletes+recreates,
> #57 orphan-cleanup fixed, edge cases handled. THE unpinned invariant → guard: the existing premium test uses 1200/2=600 (EVEN), so the remainder-distribution
> path was unpinned at the HTTP/materialization layer. +1 HTTP guard (premium-expense-hook.test.ts): a $100/3 premium → 3 legs summing to EXACTLY 10000 cents
> [3333,3333,3334]. NON-VACUOUS. be validate:local EXIT 0, 1467 pass (+1).*

> ~~**Offline outbox sync write-path + photo upload/serve audit (C377).**~~ — *DONE C377 (photo CERTIFIED CLEAN; found+fixed bug #111). 2-agent fan-out.
> (B) photo upload/serve CLEAN — every route ownership-scoped (validateEntityOwnership) + nosniff'd + mime/size-gated; #74/#77/#78 confirmed fixed+guarded.
> (A) surfaced #111: ExpenseForm saves offline from TWO sites — the offline-first path (:579, carries fuelType+missedFillup) AND the error-fallback path (:624,
> online-create throws→catch). The error-fallback addOfflineExpense (:635) carried fuelType but OMITTED missedFillup — the #101 fix landed on the offline-first
> path only. A fuel fill-up logged "missed previous" during an online-create FAILURE dropped the flag → calculateAverageMpg pairs across the gap → garbage MPG.
> FIX: add the missedFillup spread at :635. GUARD: +1 SOURCE-SCAN (offline-save-carries-fuel-fields.test.ts, 3 tests) — every addOfflineExpense site must carry
> missedFillup AND fuelType (the mapper-side C347 pin can't catch a field the call site never adds; the catch path is Playwright-gated → C229 trap). fe
> validate:local EXIT 0, 673 pass (+3).*

> ~~**Auth/session/ownership + expense create/update write-path audit (C372).**~~ — *DONE C372 (auth CERTIFIED CLEAN; found+fixed bug #109). 2-agent fan-out.
> (A) auth/session/ownership CLEAN — comprehensive firsthand cross-tenant verification: every CRUD route requireAuth-gated + userId-scoped, PUT vehicle-reassign
> re-validates ownership, 404 (not 200) for not-owned, Lucia lifecycle sound, cross-tenant-idor.test.ts (7) passes. (B) surfaced #109: createExpenseSchema has a
> both-or-neither sourceType/sourceId .refine() but updateExpenseSchema dropped it (.refine() doesn't survive .partial()/.omit()) — a PUT could persist an
> ASYMMETRIC source link (the #62/#34 within-tenant integrity class: skews source-bucketed analytics + mis-/never-triggers financing cascade-delete). FIX:
> re-add the refine to update. +3 guards (PUT only-id→400, only-type→400, neither→200). be validate:local EXIT 0, 1464 pass (+3).*

> ~~**Vehicle-delete cascade + backup/restore round-trip audit (C366).**~~ — *DONE C366 (CERTIFIED CLEAN; +1 claim-survival data-safety guard). 2-agent
> fan-out on NORTH_STAR #1 surfaces. (B) backup/restore CLEAN: all 15 tables round-trip, FK-correct insert order, validateReferentialIntegrity rejects dangling
> refs, atomic transaction (coverage guards pin symmetry). (A) vehicle-delete cascade CLEAN: every child correctly cascaded or set-null; photos manually cleaned
> pre-cascade; both orphan findings (#88, #97) already filed + characterized; the non-transactional delete handler is the documented best-effort photo-cleanup
> (orphan photo rows, not data loss) → noted, not fixed. THE unpinned invariant → guard: insurance_claims.vehicleId is onDelete:'set null' (schema.ts:188) —
> a claim is a financial record belonging to its POLICY, so a vehicle delete must PRESERVE it with vehicleId nulled, NOT destroy it. A regression flipping that
> FK to 'cascade' would silently wipe claim history. +1 HTTP guard (vehicle-delete-cascade.test.ts): claim SURVIVES vehicle delete, vehicle_id NULL, policy +
> payout intact. NON-VACUOUS. be validate:local EXIT 0, 1457 pass (+1).*

> ~~**Financing-amortization + depreciation/cost-per-period money audit (C361).**~~ — *DONE C361 (CERTIFIED CLEAN; +1 beyond-schedule guard). 2-agent
> fan-out on under-audited money surfaces. (B) depreciation + cost/mile + cost/month + value-over-time: CLEAN — all div-guarded (Math.max(1, ownershipMonths)
> + >0 checks), anchored by the expectAllFinite(tco) property test, #27/#28 year-vs-all-time honored. (A) the agent flagged derivePaymentEntries' beyond-
> schedule fallback as a money bug — DEBUNKED FIRSTHAND (C21/C60): the amortization schedule is the CONTRACTUAL projection (stops at termMonths / payoff /
> the C161 negative-am guard); a payment logged beyond it gets principal=expense.amount, interest=0, which is CORRECT (balance is already 0, no interest to
> attribute; remainingBalance stays Math.max(0,…)-floored). Not a defect. THE unpinned invariant → guard: the Property-10 test SKIPS it via `if (entry &&
> scheduleEntry)`. +1 deterministic guard (financing-calculations.property.test.ts): a 1000@12%/6mo loan overpaid 8×200 → every beyond-schedule entry
> all-principal/zero-interest/balance-floored-0. NON-VACUOUS (asserts the case triggers). fe validate:local EXIT 0, 664 pass (+1).*

> ~~**Google provider service wrappers + backup-orchestrator/restore audit (C356).**~~ — *DONE C356 (found+fixed bug #105). 2-agent fan-out, both
> over-reported. (B) orchestrator/restore: the "per-provider status not recorded" findings are the FILED #43/#44 fail-open family; ZIP-omission/restore-
> atomicity/coercion all GUARDED. (A) provider services: #36/#37 filed, listAlbums->50-pagination + Sheets-sparse-row are lower-priority hardening; the CLEAN
> atomic defect → #105: createRealPhotosClient.uploadBytes (the one Photos call bypassing authedFetch — raw-octet headers) threw a flat NETWORK_ERROR on a
> 401, so an expired token was retried as a transient flake instead of surfacing AUTH_INVALID. FIXED (mirror authedFetch's status mapping). No guard — the
> fix is in the real HTTP client; the suite injects a fake that bypasses it, so a real-401 test needs a global-fetch mock the suite avoids (C163 mock-trap,
> documented). validate:local EXIT 0, 1454 pass.*

> ~~**Health-score (getVehicleHealth / computeFleetHealthScore) surface audit (C350).**~~ — *DONE C350 (CERTIFIED CLEAN; +1 fleet-aggregation guard).
> Firsthand audit. Every agent "REAL DEFECT" debunked: the "active policy with expired term counts" IS the filed #14 (different surface, not new); the
> "negative mileage/time interval mis-score" findings are UNREACHABLE (maintenance rows are .orderBy(asc(date)) — the #75 caller-sorts class; backward-gap-
> not-good is defensible scoring-semantics); the rounding nit is product-gated. Bounds/div-guards all present. NO new reachable defect → certification. THE
> unpinned invariant → guard: computeFleetHealthScore INCLUDES a no-data vehicle in the mean at default sub-scores (reg50+mile50+ins0→round(37.5)=38), not
> excluded/zeroed — +1 deterministic guard (single no-data→38; 2nd→still 38). NON-VACUOUS. validate:local EXIT 0, 1447 pass (+1).*

> ~~**Native CSV import pipeline + year-end/quick-stats analytics audit (C344).**~~ — *DONE C344 (found+fixed bug #102; year-end CERTIFIED CLEAN).
> 2-agent fan-out. (B) year-end + quick-stats: the agent's 3 "defects" were all schema-shape nits it admitted were math-sound (categoryBreakdown:[] on a
> zero year is correct; the div "drift" is same-array same-rounding) → CERTIFIED CLEAN (year-boundary/tz, div-guards, empty-shape, no #94-pooling). (A)
> native CSV import surfaced a CLEAN ATOMIC live defect → #102: buildImportPlan's vehicleByName resolved a "year make model" name shared by two cars to the
> LAST-seen one (silent misattribution, NORTH_STAR #1). FIXED inline (collision-aware map → ambiguous=null → per-row error) + extracted resolveImportVehicleId
> (kept parseRow under the complexity cap). +2 HTTP guards. validate:local EXIT 0, 1444 pass.*

> ~~**Backup/restore round-trip + offline-sync write-path audit (C339).**~~ — *DONE C339 (found+fixed bug #101; backup-validation hardening filed).
> 2-agent fan-out on the NORTH_STAR #1 crown jewels. (B) offline-sync surfaced a CLEAN ATOMIC live defect → #101: the outbox dropped `missedFillup` on sync
> (OfflineExpense lacked the field, offlineExpenseToBackend didn't map it, both ExpenseForm call sites omitted it — while the form collects it + the online
> path sends it). A missed offline fill-up synced as normal → calculateAverageMpg pairs across the gap → garbage MPG (the #66 family). FIXED inline (4 edits)
> + a true/false round-trip guard. (A) backup/restore RE-CONFIRMED clean (insert-order, table-coverage, JSON/date/bool round-trip); filed a defense-in-depth
> note (validateBackupData doesn't cross-check expense financing-sourceId / reminder splitConfig vehicleIds vs the in-backup sets — only a tampered
> self-backup triggers it; lower priority than a live bug). validate:local EXIT 0, 647 pass.*
> NOTE (filed C339, low priority — backup-validation hardening): `validateBackupData` (backup.ts) cross-checks expense `sourceType:'reminder'` sourceIds
> against the in-backup reminders but NOT `sourceType:'financing'` sourceIds against financing, nor reminder `expenseSplitConfig` vehicleIds against
> vehicles. Both are defense-in-depth on the user's OWN backup (sourceId has no FK by design; restore's validateReferentialIntegrity already constrains the
> real FK-children C246) — only a hand-tampered backup smuggles a dangling ref. A future hardening cycle could extend the source-ref validator; not a live
> data-safety defect (no escalation).
> NOTE (filed C356, low priority — Photos/Sheets hardening, surfaced by the C356 fan-out, not live-reachable): (a) google-photos-service listAlbums uses a
> hardcoded pageSize=50 with NO nextPageToken loop — a user with >50 app-created albums could fail to find the VROOM album → a duplicate album + fragmented
> photo backup. (b) google-sheets-service parseSheetData reads a SHORT row (fewer cells than the header) as trailing nulls — only triggerable by a manual
> Sheets edit, and restore's per-row schema validation catches a NOT-NULL violation. Both need a real Google-API harness path (not the injected fake) to test
> — fold into a future Sheets/Photos pass with #36/#37 (the Sheets HIGHs already FILED).

> ~~**TCO money-aggregation + reminder-materialization/CSV-round-trip audit (C333).**~~ — *DONE C333 (CERTIFIED CLEAN; +3 year-scoped guards).
> 2-agent fan-out. (B) reminder-materialization CAS-idempotent (no double-materialize), backend reminder advance uses clampToAnchorDay (NO C330 setMonth
> bug — FE-only), CSV value round-trip guarded (thousands-sep/bool/nested-JSON/null); lone hit #88 already filed. (A) an agent flagged a "year-scoped +
> unpriced + financed double-count" — VERIFIED FIRSTHAND it's NOT a bug: computeTCOTotal:1081 DOCUMENTS the Angelo-approved #28/#27 design (purchasePrice
> all-time-only → excluded from a year window; the window's financing IS the cost signal, not a double-count). TCO math CLEAN. THE finding → guard: every
> getVehicleTCO call omitted the `year` arg → the year-scoped path was UNPINNED. +3 (per-vehicle.property.test.ts): priced+financed, unpriced+financed,
> breakdown-contract — pin the #28/#27 year semantics so a future "fix" turns RED. NON-VACUOUS. validate:local EXIT 0, 1438 pass (+3).*

> ~~**#94 isolation check — fleet analytics unit-conversion + per-vehicle stats audit (C328).**~~ — *DONE C328 (#94 BROADENED to a CLASS; +1
> characterization guard; per-vehicle stats CERTIFIED CLEAN). 2-agent fan-out + firsthand source verify (C21/C60). (a) `calculateVehicleStats`
> CLEAN: every ratio div-guarded (costPerMile/averageMpg/averageMilesPerKwh), unit-by-design at the route layer, 100-run property-tested — no
> defect. (b) #94 is NOT one scalar — the fleet SUMMARY + fuel-advanced builders (buildFuelStatsFromData / buildFuelAdvancedFromData) pool
> distance, VOLUME (gal+L), and EFFICIENCY (mi/gal+km/L) across vehicles with NO unit conversion (6 members, see bug #94). PROOF: getCrossVehicle
> (repository.ts:1531) is the correct contrast — convertDistance per vehicle BEFORE pooling; the summary builders receive no units. Product-
> semantics-gated → folded into the #94 escalation (broadened), NOT self-fixed. Pinned the cleanest unfiled member (volume pooling, same file as
> #94's distance pin) in fuel-stats-fleet-distance-pooling.test.ts; non-vacuous raw-sum proof. green→green 1435 pass (+1).*

> ~~**Insurance premium-allocation analytics audit + #5 coverage re-measure (C323).**~~ — *DONE C323 (CERTIFIED CLEAN, no defect).
> buildInsuranceDetails latest-term scoping (#25), #50 tiebreak, #8 totalCost amortization, cycle-14 monthKeysInRange all sound; the
> per-vehicle premium division is a DISPLAY distribution (headline total computed independently, so float-split values carry no
> inconsistency — not stored money). Paired the overdue #5 re-measure (last C303): be 86.53% line / 86.21% func; fe 84.39% line / 83.97%
> func / 76.43% branch (UP +2.6 line / +3.3 func — the C308/C314/C319 FE arc; settings.svelte.ts ~12%→covered). BE↔FE gap ~2pts. Next sweep ~C333.*

> ~~**Odometer→reminder D5 mileage-trigger seam audit (C317).**~~ — *DONE C317 (CERTIFIED CLEAN, +1 coexistence guard). findMileageTracking
> + the check-then-insert + race-safe createMileageNotification (catches the UNIQUE violation) + the TWO partial unique indexes
> (rn_reminder_due_idx on dueDate, rn_reminder_odo_idx partial-on-dueOdometer) — a disjoint-domain whichever-comes-first design. Pinned the
> cross-axis coexistence (a `both` reminder overdue on BOTH axes fires two distinct notifications, one per axis, no collision) — unpinned;
> a single-index regression would silently drop the mileage notification. +1 guard in trigger-mileage.test.ts, non-vacuous. No defect.
> validate:local EXIT 0, 1432 pass (+1).*

> ~~**Expenses split create/update/delete + group-integrity audit (C311).**~~ — *DONE C311 (CERTIFIED CLEAN, +1 contract-pin guard).
> updateSplitExpense derives the absolute total from the legs (Property-3 fix), userId-scoped delete; deleteSplitExpense cascades photo_refs
> via FK + the ROUTE cleans provider files first (documented, not a gap); createSiblings is cents-based + COST-ONLY (the create-split schema
> has no volume/mileage/fuelType input path — a shared cost can't attribute a physical volume per leg). Pinned the cost-only contract
> (Property 4: every sibling null volume/mileage/fuelType + missedFillup=false across all categories incl. 'fuel') so a future change can't
> silently pollute MPG attribution. No defect. validate:local EXIT 0, 1425 pass (+1).*

> ~~**Provider/storage CREDENTIAL layer audit (ARCC-grounded, C306).**~~ — *DONE C306 (CERTIFIED CLEAN, no defect — the C291
> certification precedent). VROOM's most security-sensitive surface. ARCC-consulted first (SAX-01/SAX-08: encrypt at rest, key outside the
> data store). Firsthand: encryption.ts AES-256-GCM + random IV + auth tag + env key (not in DB); routes.ts encrypt-on-write +
> whitelist-response (credentials structurally can't leak); S3 clean config/secret split; registry decrypt-on-read contained per-provider
> (Promise.allSettled); fake provider double-gated; no log leakage. Coverage already comprehensive (encryption.test.ts tamper/wrong-key/
> round-trip + providers-routes-http.test.ts credentials-never-echoed incl. the C260 re-encrypt-at-rest column check). No code change
> warranted.*

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

- ~~**backup-orchestrator execute() audit (C291)**~~ — *DONE C291 (deep-review → guard): CERTIFIED CLEAN — mutex (idempotent-delete, double-release
  harmless), force-bypass + change-skip, no-providers early return, ZIP-fail→Sheets-only, per-provider decrypt-fail skip, Promise.allSettled containment,
  #42 snapshot-start-timestamp persist-on-success. THE finding: backup-orchestrator.test's mutex/skip/no-providers cases were LOCAL SIMS (C181 theater, its
  header claimed execute() "not reachable in-harness" — OVER-CAUTIOUS: createTestApp rewrites DATABASE_URL before the dynamically-imported orchestrator's
  getDb() resolves, and the early-return skip paths predate any provider work → drivable). +3 real-execute() tests (new backup-orchestrator-execute.test.ts:
  no-changes→skipped; has-changes+no-providers→empty; force+no-providers→empty). NON-VACUOUS. green→green 1414 pass (+3).*
- ~~**Split-expense edit/delete cascade + expense-filter builder audit (C286)**~~ — *DONE C286: inline (spawn_run 400), record-only. BOTH CERTIFIED CLEAN +
  already comprehensively pinned: updateSplitExpense/deleteSplitExpense (userId-scoped destructive writes #52/C109; absolute-edit derives groupTotal from
  legs #60; source-link preserved across edit C101; photo migration) — all in expense-repository.property.test; buildExpenseConditions (endDate-inclusive
  #39, tag-AND json_each, LIKE-escape #41) — all in date-range-boundary + search-paginated + repository.property tests. NO defect, NO warranted test
  (coverage-theater per C225/C259/C275). The C259/C275 clean-cert precedent.*
- ~~**buildAmortizationSchedule audit (C281)**~~ — *DONE C281: inline (spawn_run 400). CERTIFIED CLEAN — balance-clamped principal (final payment ≤
  balance), paid-off loans skip, interest non-neg-clamped, no caller-mutation. Comprehensively pinned (interest-declines/principal-rises #10, payoff-clamp,
  multi-loan aggregation, no-mutation, empty). THE finding → guard: the NEGATIVE-AMORTIZATION edge (payment < monthly interest → principal 0, balance
  frozen, never pays off) was uncovered (all prior tests used payment > interest). +1 test ($10k @ 24%, $150/mo < $200 interest → principal 0, constant
  $200 interest every month). NON-VACUOUS. green→green 1397 pass (+1). C67 covered 6 OTHER analytics builders; this one hadn't been re-reviewed since C38.*
- ~~**Offline-sync outbox + conflict-resolution write path audit (C270)**~~ — *DONE C270: inline (spawn_run 400). CERTIFIED CLEAN: offline-storage.ts is
  comprehensively pinned (deterministic clientId backfill, #66 charge survival, corrupted-LS fallback, every CRUD primitive, syncOfflineExpenses
  happy/partial-failure/malformed-skip + the #79 stuck-queue characterization); sync-manager determineConflictType is C223-pinned. THE finding → guard:
  `resolveConflict` (keep_local/keep_server/merge — the conflict-resolution WRITE path) had only 2 boolean happy-path tests; +4 pinning the load-bearing
  outcomes (keep_local forceOverwrite+clientId; FAILED overwrite → false [edit survives, not dropped]; keep_server no-POST; merge→keep_local delegation).
  NON-VACUOUS. green→green fe 600 pass (+4). Note: resolveConflict uses the class-private this.markExpenseAsSynced, so assertions pin the boolean + fetch.*
- ~~**Backup EXPORT path audit (C264)**~~ — *DONE C264: inline (spawn_run 400). CERTIFIED CLEAN: the export/restore TABLE-SET symmetry is AIRTIGHT —
  five hand-maintained lists (createBackup's 15 data keys, TABLE_SCHEMA_MAP, TABLE_FILENAME_MAP, restore insertBackupData inserts, ImportSummary fields)
  all pinned equal by the C208/C209 drift guards, incl. the `if (table && filename)` silent-skip + every-table-backed-up-or-EXCLUDED_BY_DESIGN. THE
  finding → guard: the per-column VALUE round-trip through convertToCSV JSON.stringify → csv-stringify → csv-parse → coerceRow JSON.parse was pinned only
  in ISOLATION for the parse half on flat columns (unitPreferences, tags[]); no test round-tripped a NESTED-object JSON column (the CSV-hostile case).
  +2 HTTP round-trip tests (reminder-split-config-roundtrip.test.ts) for expenseSplitConfig (the deepest nested JSON: ABSOLUTE allocations[] + EVEN
  vehicleIds[]) via real export→wipe→restore; NON-VACUOUS. green→green 1378 pass (+2).*
- ~~**Cross-vehicle analytics vein audit (C259)**~~ — *DONE C259: inline (spawn_run 400). CERTIFIED CLEAN: getCrossVehicle costPerDistance is the
  documented #45-family period-scoped semantics (not a new bug; maxMileage/minMileage guard requires ≥1 reading, single-reading→null handled);
  buildMonthlyExpenseTrends sort-then-slice(-24) [C11 guard], buildExpenseByCategory unknown→misc + div-by-zero guarded, #54 per-vehicle pairing.
  NO guard gap — cross-vehicle.property.test ALREADY pins it (Property 4 category-%s-sum-100, Property 5 costPerDistance+null-edge, #54); only skip
  is Property 23 (financing-DI, deep-review #3). NO code (record-only, certified clean + already pinned — the C246/C256 precedent).*
- ~~**Mileage-reminder trigger vein audit (C256)**~~ — *DONE C256: inline (spawn_run 400). CERTIFIED CLEAN: processMileageReminder guards
  null-milestone/single-vehicle/due-check; idempotency is belt-and-braces (app mileageNotificationExists + the partial unique rn_reminder_odo_idx
  on (reminderId,dueOdometer) + createMileageNotification UNIQUE-catch→null under races); time/mileage axes cleanly separated via NULL-distinct +
  partial index; no auto-re-arm (mark-serviced is explicit, C25). GUARD: trigger-mileage.test covered firing+idempotent-same-milestone but NOT the
  DISTINCT-milestone invariant (after mark-serviced re-arms, crossing the NEW milestone must fire a fresh notif — per-milestone dedup, not
  per-reminder). +1 HTTP test (35000→1; re-arm→40200; below→still 1; 40500→2 at [35000,40200]); NON-VACUOUS. NO production change (record-only cert,
  the C246 precedent). green→green 1366 pass (+1).*
- ~~**Sync RESTORE path vein audit (C246)**~~ — *DONE C246: inline audit (spawn_run 400). CERTIFIED CLEAN: both ZIP + Sheets restore call
  assertReplaceNotEmpty symmetrically (#21 wipe-guard, no path-asymmetry); stampUserId force-stamps every userId-column table + the unstamped
  children (financing/terms/claims/junctions) own indirectly via FK, and validateReferentialIntegrity constrains EVERY FK-child to in-backup id
  sets — so a crafted backup can't smuggle foreign-owned data; detectConflicts tenant-scoped (C109). GUARD: restore-junction-refs covered the
  junction ref-check but NOT financing (the highest-stakes unstamped child — no userId column, owns purely via vehicleId FK); +1 HTTP test (tamper
  vehicle_financing.csv → out-of-backup vehicleId → restore rejected, data intact). NO production change (record-only cert, the C179/C240
  precedent). green→green 1353 pass (+1).*
- ~~**Financing write+balance+hook vein audit (C240)**~~ — *DONE C240: inline audit (spawn_run 400). CERTIFIED CLEAN: computeBalance/Balances
  payment-history-based + C101-consistent; every route entry ownership-gated (POST validates the vehicle, PATCH/PUT/DELETE validateFinancingOwnership
  — financing→vehicle→owned, no info leak); onFinancingDeactivated clearSource nulls sourceType+sourceId userId-scoped; the #67/C206 re-finance
  reactivation correct. The one un-pinned subtle invariant: re-financing REUSES the row, so the new balance is right ONLY because payoff/DELETE first
  clearSource the old payment links (else computeBalance subtracts the OLD loan's payments from the NEW originalAmount). +2 DB-integration tests
  (refinance-balance-reset.test.ts): clear→reuse→fresh-full-balance, + a proves-the-dependency case (skip clear → wrong $22k). NON-VACUOUS by
  construction (cases differ only by the clearSource call). NO production change (record-only cert, the C179/C225 precedent). green→green 1344 pass (+2).*
- ~~**Auth session-refresh + OAuth callback vein audit (C225)**~~ — *DONE C225: inline audit of the auth surface C56/C126 certified for
  session/email but NOT the OAuth-callback + refresh paths. CERTIFIED CLEAN firsthand: (1) validateAndRefreshSession create-before-invalidate
  ordering correct; both callers pass `c` so no live cookie-loss; C32(b) orphan edge = documented sprawl note. (2) requireAuth deletes cookie +
  401s on null (C127). (3) OAuth state CSRF/PKCE: validateLoginState requires store-present + flowType-undefined + single-use delete; the
  callback VALIDATES STATE BEFORE the token exchange + binds the codeVerifier (PKCE), and is ALREADY guarded by auth-routes.property.test.ts. (4)
  resolveNewUser email-conflict + txn + UNIQUE-race-recovery; the findByProviderIdentity lookup queries the SAME userProviders table the insert
  writes with a byte-matching WHERE → a returning user is found (no new-row-per-login bug). NO fix + NO new test (invariants already pinned —
  more would be coverage-theater). Lone note: oauthStateStore is in-memory → breaks under horizontal scaling (documented; self-host PWA is
  single-instance, a scaling-arch limitation not a bug). Record-only (the C179/C191 clean-cert precedent).*
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
> ~~**C456 — pin buildFuelEfficiencyComparison, the cross-vehicle per-month gas-MPG builder (per-vehicle-pairing + gas-gate, via the REAL export).**~~ — *DONE C456 (guard most-starved
> 6/6). buildFuelEfficiencyComparison (analytics-charts.ts:1175) is exported + rendered on the cross-vehicle tab (getCrossVehicle skipConversion, the default same-units case) but had ZERO
> test refs; it re-rolls inline TWO load-bearing invariants the prior pins don't reach: groups byVehicle BEFORE pairing (the #54 cross-vehicle-phantom class, but the #54 pin covered the
> trend path) + gates on gasEfficiencyPoint (the #122/C413 class, but that swept buildMonthly/buildSeasonal, not this). +2 guards driving the REAL export: interleaved two-car rows →
> each vehicle's own 30 MPG (no cross phantom); a v1 charge row → excluded from v1's gas MPG. NON-VACUOUS. be validate:local EXIT 0, 1545 pass (+2).*

> ~~**C450 — pin getLatestTerm's equal-endDate tiebreak (the load-bearing `>`-not-`>=`, first-seen-wins, via the REAL export).**~~ — *DONE C450 (guard OVER budget 7>6 → forced;
> arch also over but guard more-starved). getLatestTerm (insurance.ts:57) uses strict `>` so on two terms sharing an identical endDate the FIRST wins. REACHABLE: insuranceTerms has
> only a NON-unique (policyId, endDate) index → two co-terminating terms can share an endDate; the backend orders desc(endDate) but SQLite's order among equal endDates is unspecified,
> so this FE helper decides which term renders + renews (PolicyCard). The existing property test is `>=`-tolerant → does NOT pin the tiebreak. +1 guard: two same-endDate terms,
> [A,B]→A AND [B,A]→B (first-seen regardless of order). NON-VACUOUS (a `>=` flip → last-seen). Pins the CURRENT contract; cross-read determinism (a secondary sort key) is a separate
> product call. fe validate:local EXIT 0, 714 pass (+1).*

> ~~**C443 — pin updateTermSchema's CONDITIONAL date-order refine (the partial-update both-dates / single-date-skip cells, via the REAL exported schema).**~~ — *DONE C443
> (guard OVER budget 7>6 → forced). First weighed a class-level source-scan for the #128 fromBackendExpense-skip family (bit twice, C431/C442) but REJECTED it firsthand — no
> false-positive-free syntactic signal (analytics getVehicleExpenses/getExpenseSummary/getVehicleStats return aggregated/typed data, correctly no mapper), and the class is
> currently clean. Fanned out instead: updateTermSchema (insurance/validation.ts:73-80) enforces endDate>startDate ONLY when both dates are present + skips for a single-date
> partial update (the update-vs-create distinction; the repo writes one date with no cross-check → the schema is the only order gate). Reachable via PUT /insurance/:id/terms/:termId.
> No test drove it (property suite covers only createTermSchema; the partial-update test sends no dates). +3 tests on the REAL schema: both-end>start→accept; inverted AND equal→reject;
> single-date (start/end/neither)→accept. NON-VACUOUS. be validate:local EXIT 0, 1537 pass (+3).*

> ~~**C436 — pin the 5 zero-test chart-formatters exports (FE LayerChart axis/series callbacks rendered on real charts).**~~ — *DONE C436: guard most-starved
> (6/6, at budget). 2-agent fan-out — BE scout returned the pure-fn guard surface SATURATED (the only untested export, validateLoanTerms, is DEAD defensive code behind a
> Zod schema that rejects every error-branch input → a guard would be VACUOUS; correctly rejected). FE confirmed the C430-flagged chart-formatters.ts cluster: formatDecimalAxis
> (the default decimals=1 IS what efficiency-trend Y-axes render), getXTickCount (few-points dedup clamp + 6/12 cap), formatDateTick (layerchart unknown→'' NaN guard),
> monthlyXAxisProps (12-tick budget ≠ the 6 default), getTrendLineProps (dataLength<=1 single-point enlarged-dot visibility) — all reachable + load-bearing + ZERO-test.
> Display-tier but real zero-coverage reachable invariants. +9 tests EXTENDING chart-formatters.test.ts (its home, no dup file), driving the REAL exports. NON-VACUOUS
> (each pins a flip/drop/default regression). fe validate:local EXIT 0, 706 pass (+9), svelte-check 0, build clean. The pure-util guard surface is now near-exhausted both sides.*

> ~~**C430 — close a C181/C229 coverage-theater gap: drive the REAL calculateVehicleStats through the `mpg > 0 && mpg < 150` outlier band (the suite only had a local re-implementation).**~~ —
> *DONE C430: guard most-starved actionable (last 425, starved-for 5, closest to budget). 2-agent fan-out; BE #1 was a genuine coverage-theater trap. calculateAverageMpg
> (vehicle-stats.ts:179) drops a pair outside `mpg > 0 && mpg < 150`, reached LIVE via GET /vehicles/:id/stats — but vehicle-stats.property.test.ts "covered" the band only via
> a LOCAL re-implementation (referenceMpg L43-59 / countUnfilteredPairs L64-76, each carrying their own copy of the filter); Properties 1-3 assert the COPIES, the real-export
> blocks only feed 8-40 MPG → the boundary was never driven (the C181/C229 anti-pattern). +3 guards driving the REAL export: above-band 175 MPG dropped (→ stays 30, not 102.5);
> EXACTLY-150 dropped (load-bearing `<150` not `<=150` → not 90); zero-delta dup-odometer dropped (the `mpg>0` edge → not 15). NON-VACUOUS. INTERSECTS #30 (C419) — locks today's
> (0,150) contract so a regression is detectable WITHOUT pre-deciding the [5,100]/[1,10] unification (noted in the test header). Chose this over the FE chart-formatters picks
> (getTrendLineProps/getXTickCount/formatDateTick — genuinely unpinned but lower-stakes display utils vs a money-facing metric's coverage-theater hole). One biome line-wrap
> reflow, then re-validated. be validate:local EXIT 0, 1529 pass (+3).*

> ~~**C396 — pin restore's expense-source dangling-ref rejection (validateExpenseSourceRefs — the expense-level sibling of the junction/financing checks).**~~ —
> *DONE C396: validateReferentialIntegrity hard-fails a restore if a 'reminder'-sourced expense points at a reminder NOT in the backup (backup.ts:781) — the
> C246/C339 dangling-ref class. restore-junction-refs.test.ts pinned the JUNCTION + FINANCING ref checks but NOT the expense-SOURCE one. +1 guard: seed a
> reminder-sourced expense, export, tamper expenses.csv to repoint source at a bogus reminder → restore REJECTS citing 'reminder', mutates nothing. NON-VACUOUS.
> Partially closes the C339 "validateBackupData doesn't cross-check expense source refs" note (reminder-source direction now validated AND pinned). be
> validate:local EXIT 0, 1476 pass (+1). Rejected the FE chart-formatters picks (display utils, lower-stakes than a restore data-safety guard).*

> ~~**C391 — complete the #108/#113 split-sibling SWEEP of the fuel-advanced builder family + pin buildFillupIntervals' same-date safety.**~~ — *DONE C391:
> guard at budget (6/6). Followed up the C390 flag. SWEEP (all 4 builders verified firsthand): buildSeasonalEfficiency guarded (#108/C367); buildDayOfWeekPatterns
> was the bug (#113/C390); buildFillupIntervals SAFE (accumulateIntervalBuckets `days<=0 → continue` drops a same-date split pair); buildVehicleRadar SAFE (fuel
> axis via computeEfficiencyPoint null-guards volume+mileage; cost axis sums expenseAmount, correct per-leg like costPerMile/C378). Family FULLY audited — only
> the 2 count-builders were vulnerable, both fixed. THE unpinned invariant → guard: buildFillupIntervals' split-safety (a same-date sibling must not phantom a
> 0-day interval) had only the C67 not-mutated test. +1 guard: 3-row same-date split + one real later fillup → exactly 1 interval, no phantom bucket. NON-VACUOUS.
> be validate:local EXIT 0, 1474 pass (+1).*

> ~~**C385 — pin buildLocalDate's out-of-range-hour rejection (foreign-import time-parse path) + document the same-day-wrap partial coverage.**~~ — *DONE C385:
> guard closest to budget (5/6). buildLocalDate echo-checks Y/M/D but not hh/mm/ss; normalizeForeignDate (import-mapping.ts:192) parses a foreign time segment
> with a bare parseInt||0 (no clamp), so a malformed "2024-03-15 25:00:00" feeds hh=25. The existing date echo-check INCIDENTALLY rejects an hour that rolls the
> DAY forward (hh≥24 → getDate() mismatch → null) — reachable + correct + unpinned. +2 guards (hh=25/48 → null) + 1 documenting the by-design partial coverage
> (same-day wrap mm=90 → accepted, date intact; time-of-day is analytically immaterial). NON-VACUOUS. be validate:local EXIT 0, 1470 pass (+3). Debunked the FE
> buildQueryString pick (already covered through reminder-api.test.ts:176 isActive=false-survives).*

> ~~**C380 — pin the buildSummary singular/plural month rendering (the formatMonths `=== 1` boundary, via the public API).**~~ — *DONE C380: guard closest to
> budget (5/6). buildSummary (payment-planner.ts) renders monthsSaved via the private formatMonths, which pluralizes on `months === 1`. Property 6 pinned the
> summary STRUCTURE but never the singular/plural rendering — a regression dropping the `=== 1` branch silently emits "saves 1 months" (visible grammar bug).
> +2 tests via the PUBLIC buildSummary (helper isn't exported): monthsSaved=1 → '1 month' AND not '1 months' (the load-bearing not-contains); =2 → '2 months'.
> NON-VACUOUS. fe validate:local EXIT 0, 675 pass (+2). Debunked: FE isElectricFuelType (already the ORACLE in api-transformer.property.test.ts, load-bearing-
> tested); BE analytics date-range startDate>endDate (thin characterization, would need a behavior change not a guard).*

> ~~**C375 — pin the reminder refineDateRange `endDate === startDate` equality boundary (the `<=`-not-`<` load-bearing case).**~~ — *DONE C375: guard at
> budget (6/6). refineDateRange (reminders/validation.ts:124) rejects `endDate <= startDate`, but reminder-refinements.test.ts only covered strictly-after (ok)
> + strictly-before (fail), NOT equality — exactly what the `<=` (vs `<`) is load-bearing for (a regression to `<` would silently ACCEPT a zero-duration
> start==end reminder). +1 test: endDate EQUAL startDate → fails 'endDate must be after startDate'. NON-VACUOUS. be validate:local EXIT 0, 1465 pass (+1).
> Rejected: FE getCategoryColor (already pinned C370/C234), FE getLatestTerm tiebreak (low-stakes nit), BE photo-ref retryCount===3 (by-design cap, needs a mock).*

> ~~**C369 — pin the PUT-claim termId cross-policy isolation guard (the unpinned leg of validateClaimRefs/#84).**~~ — *DONE C369: guard closest to budget (5/6)
> → highest-leverage. validateClaimRefs (insurance/routes.ts:46) gates BOTH vehicleId-ownership AND termId-on-this-policy, on create AND update — but only the
> CREATE termId leg (claims-http.test.ts:210) + the UPDATE vehicleId leg (:247) were pinned; the UPDATE termId leg was UNGUARDED. A claim re-pointed at a term
> on ANOTHER policy is a cross-policy referential-integrity violation. +1 HTTP guard: seed a 2nd policy, PUT this policy's claim at the other's valid-but-foreign
> termId → 400 'term...'. NON-VACUOUS (real foreign term id, not a missing-id 400). be validate:local EXIT 0, 1460 pass (+1). Debunked the agent's "PUT
> vehicleId cross-tenant unpinned" (already pinned :247); rejected the empty-{} rejection nicety + the FE boundary-nit adds (already representatively tested).*

> ~~**C364 — pin the REAL getVehicleDisplayName (12-site display helper) — fix a C229 coverage-theater gap.**~~ — *DONE C364: guard closest to budget (5/6)
> → highest-leverage. getVehicleDisplayName (vehicle-helpers.ts) is used across 8 components + 4 routes, yet its only "coverage" was VehicleManagement.test.ts:275,
> which RE-IMPLEMENTS the function as a local arrow and tests the COPY — never importing the real export (the C229 anti-pattern). The load-bearing
> `!vehicle → 'Unknown Vehicle'` fallback was UNGUARDED and is REACHABLE: a split/reminder/insurance reference can outlive its vehicle (#88/#97 deleted-vehicle
> family) → every consumer relies on this helper for a safe label, not a null .year deref. +1 test file (vehicle-helpers.test.ts, 5 tests driving the REAL
> export): nickname-wins, year/make/model fallback, empty-nickname-falls-through, null + undefined → 'Unknown Vehicle'. NON-VACUOUS. fe validate:local EXIT 0,
> 669 pass (+5). Rejected the BE picks (lower-value): import-csv ambiguity already pinned at the route (#102/C344); pagination hasMore already property-tested.*

> ~~**C359 — pin `formatPaymentFrequency`, the user-visible payment-frequency label rendered in NextPaymentCard.**~~ — *DONE C359: guard at budget
> (last 353, starved-for 6=budget; feature is over-budget but only-open T9 is e2e-blocked / the rest Angelo-gated → guard is the most-starved actionable).
> Vein dormant → 2-agent fan-out for a genuinely-unpinned REACHABLE invariant. REJECTED the BE agent's top pick (`normalizeDate`'s seconds-vs-ms threshold
> in analytics-charts.ts) — it self-admits today's DB path always passes a Date object, so the numeric branch is not-live → coverage-theater (C306/C341/C355
> protocol). The clean reachable pick: `formatPaymentFrequency` (financing-calculations.ts:496) — pure, ZERO test refs, rendered LIVE at NextPaymentCard.svelte:149
> with `financing.paymentFrequency` (DB column schema.ts:86 admits exactly {monthly|bi-weekly|weekly|custom}). A refactor that renames/drops/mis-cases a label
> ("Bi-Weekly") silently changes a user-facing label → genuine reachable invariant. +2 tests to next-payment-date.test.ts (the NextPaymentCard display-helper
> family's home): the 4 schema-valid labels + the unknown/'' graceful-passthrough fallback. NON-VACUOUS. fe validate:local EXIT 0, 663 pass (+2).*

> ~~**C353 — pin the mixed plug-in-hybrid MPG/mi-kWh isolation invariant (Property 6).**~~ — *DONE C353: the C352 EV fan-out flagged that a MIXED hybrid
> (gas fill-ups + electric charges on one vehicle) leans entirely on calculateVehicleStats's isElectricFuelType partition to keep MPG/mi-kWh separate — and
> the efficiency isolation was unpinned (Property 4 pins volume/cost partition, P5 the gating; neither asserts a gas row stays OUT of the mi/kWh denominator).
> +3 deterministic guards (Property 6): a 4-row interleaved mixed vehicle → averageMpg=30 (gas only), averageMilesPerKwh=4 (charge only), totals partitioned.
> NON-VACUOUS (a cross-paired gas+charge interval would be ~10000mi absurd, not 30/4). validate:local EXIT 0, 1454 pass (+3).*

> ~~**C347 — class-level completeness pin for the offline-field-dropout family (#66/#101) on offlineExpenseToBackend.**~~ — *DONE C347: the FE
> store/util veins are worked through (the 3 stores done C331/C336/C342; the rest — visibility-watch/use-google-oauth/is-mobile — are observer/OAuth/$effect-
> bound integration territory, the C163 mock-trap) + BE security-pure modules (csv-safety, encryption) comprehensive. So pinned a CLASS invariant re-found
> twice (#66 fuelType-drop, #101 missedFillup-drop): the offline outbox carries a field but offlineExpenseToBackend forgets it. The per-field tests pin one
> field each; +1 completeness test asserts EVERY user-settable OfflineExpense field round-trips together. NON-VACUOUS (a future field added to the type+form
> but forgotten in the mapper → RED). fe validate:local EXIT 0, 659 pass (+1).*

> ~~**C342 — pin appStore, the global vehicle-list + notification (toast) store (zero-coverage store).**~~ — *DONE C342: continuing the C331/C336
> zero-coverage-store sweep. Of the 3 untested FE stores, offline.svelte.ts is trivial get/set (theater to pin), so picked app.svelte.ts — the app-wide
> vehicle list + toast system. +11 (app-store.test.ts): updateVehicle ID-match (+ unknown-id no-op) + removeVehicle filter; addNotification id/timestamp/
> default-5000 + explicit override + remove/clear; the FOUR show* helpers' DISTINCT default lifetimes (success 5000 / error 8000 / warning 6000 / info 5000 —
> the user-facing toast timings); loading + reset. NON-VACUOUS. svelte-check strict needed `!`/`['key']` (noUncheckedIndexedAccess). fe validate:local EXIT 0,
> 658 pass (+11).*

> ~~**C336 — pin themeStore, the user-facing light/dark/system theme controller (zero-coverage store).**~~ — *DONE C336: scanned every BE pure-logic
> util against the suite — all covered (the cadence note holds; data-migration is a no-op stub, checkpoint a CLI script). Pivoted FE: the 3 stores
> (app/offline/theme.svelte.ts) had NO direct test. theme.svelte.ts (68 lines) is the single source of truth for dark mode (setPreference persists +
> resolves 'system' vs prefers-color-scheme + toggles the <html> dark class + swaps the PWA theme-color meta) — a regression silently breaks dark mode for
> everyone. +5 (theme-store.test.ts, new stores/__tests__/): explicit dark/light (class + theme-color + persist + current); 'system' resolves vs matchMedia
> (OS dark/light, stored pref stays 'system'); the same 'system' pref flips with the OS (not frozen). NON-VACUOUS. fe validate:local EXIT 0, 646 pass (+5).*

> ~~**C331 — pin getSyncStatusInfo, the user-facing sync-indicator precedence cascade (zero-coverage pure module).**~~ — *DONE C331: a grep of every
> non-type/non-UI-reexport src/lib/*.ts against the suite surfaced sync/sync-status.ts (58 lines) at ZERO test references. getSyncStatusInfo backs BOTH
> SyncStatusIndicator + SyncStatusInline; its branch order is a load-bearing PRIORITY CASCADE (offline > conflicts > syncing > error > success > pending >
> up-to-date), so a reorder would silently show the WRONG status ("Synced" while offline / hide a conflict behind the sync spinner). +14 (sync-status.test.ts,
> new sync/__tests__/): all 8 branches' {color,icon,text} in isolation + singular/plural conflict copy + 6 PRECEDENCE cases the per-branch test misses.
> NON-VACUOUS (reorder a pair → RED). fe validate:local EXIT 0, 641 pass (+14).*

> ~~**C325 — pin sync-manager's retry exponential-backoff + hard cap (real branching, loose coverage).**~~ — *DONE C325: the existing tests
> checked only the retryCount counter (the "max retries" bound `<= firstCount+1` too weak to pin the cap); the backoff delay (retryDelay *
> 2^retries) + the scheduling-stops-at-cap behavior were unpinned. +2 guards (setTimeout spy): a failed sync schedules at exactly 100ms
> (retryDelay * 2^0); once retries hit maxRetries no retry-family delay (100/200/400/800) is scheduled (fake timers to avoid leakage; filter
> out the 3000ms idle timer). NON-VACUOUS (off-by-one cap → 200ms retry → RED). fe validate:local EXIT 0, 622 pass (+2).*

> ~~**C321 — pin the missedFillup truthy round-trip on CSV import (bug-cycle dormant-vein scout outcome).**~~ — *DONE C321: a forced bug cycle
> certified the import-csv parse/commit/round-trip surface clean (parsers, occurrence-keyed clientId dedup, atomic+idempotent importExpenses,
> formula-injection round-trip symmetry). No defect. The unpinned invariant: the export writes missedFillup 'true'/'false', import parses
> /^(true|1|yes)$/i, but the round-trip test only used false — a regression narrowing the regex would silently import missed fillups as false,
> corrupting MPG pairing. +1 guard in import-csv.test.ts ('true'→stored 1, 'false'→0); non-vacuous. validate:local EXIT 0, 1434 pass (+1).*

> ~~**C319 — pin the settings store's state-management contracts (~12%-covered settings.svelte.ts).**~~ — *DONE C319: stores/settings.svelte.ts
> was ~12% covered (C308 pinned only error-clearing on 2 methods). +6 guards (settings-state-contract.test.ts, mocked fetch): update() replaces
> state + returns it; update() re-throws on failure; a non-preview restoreFromProvider refreshes state via this.load() (2 fetches) while a
> preview does NOT (1 fetch, read-only); reset() clears all state; unitPreferences getter falls back to defaults when null. NON-VACUOUS
> (dropping the non-preview load → RED). fe validate:local EXIT 0, 619 pass (+6).*

> ~~**C313 — pin validateAndRefreshSession, the untested security-critical session-rotation core.**~~ — *DONE C313: auth/utils.ts
> validateAndRefreshSession (used by requireAuth + POST /auth/refresh) sat at 100% func / 40% line with ZERO direct tests. +4 unit guards
> (mockable Lucia, no DB): invalid → null; FRESH → as-is, no create/invalidate (no-churn); NEAR-EXPIRY → rotate with call order
> ['validate','create','invalidate'] (create-before-invalidate); createSession throws → FAILS OPEN to the existing session (not logged out).
> Real call-order assertions, non-vacuous. Also ran the #5 stray-test sweep: clean (branch 123 ahead). validate:local EXIT 0, 1430 pass (+4).*

> ~~**C312 — pin the insurance term-cost-UPDATE premium-expense replacement (bug-cycle dormant-vein scout outcome).**~~ — *DONE C312: a
> forced bug cycle scouted 4 surfaces clean (claims-repository, insurance hooks, deleteBySource, financing-timeline). No defect. The unguarded
> invariant: a costed term auto-materializes a split premium expense (sourceType:'insurance_term'); on a term UPDATE, updateTermExpenses must
> delete the stale auto-expenses + re-create at the new cost — but no test pinned the update-REPLACES path (only create+delete). +1 HTTP guard
> in terms-http.test.ts: a 2-vehicle term @1200 → 2 even-split siblings; PUT totalCost 1800 → still exactly 2 siblings summing to 1800 (no
> stale, no missing). NORTH_STAR #2 money correctness. validate:local EXIT 0, 1426 pass (+1).*

> ~~**C307 — pin activity-tracker's two unguarded safety invariants (mid-sync eviction shield + fail-open change-check).**~~ — *DONE C307:
> sync/activity-tracker.ts (71% func / 57% line) had two SAFETY branches unpinned after the C195 ageout ratchet. +2 guards: (1)
> cleanupInactiveUsers must NOT evict a stale-but-syncInProgress user (line 129 `!syncInProgress` AND) — proven by flipping the in-memory flag
> (survives stale), then clearing it (then ages out); (2) hasChangesSinceLastSync FAILS OPEN — a throwing repo returns true (back up, don't
> silently skip), the NORTH_STAR #1 choice, so a refactor can't flip it fail-closed. validate:local EXIT 0, 1424 pass (+2).*

> ~~**C305 — pin the paid-off-financing GET /vehicles list contract (bug-cycle dormant-vein scout outcome).**~~ — *DONE C305: a forced bug
> cycle scouted SEVEN mature surfaces clean (vehicles repo, photos service/repo, expenses filtering, auth/OAuth-state + session, Sheets-header
> coverage). The one unguarded edge: vehicleRepository.findByUserId leftJoins vehicleFinancing with NO isActive filter → a paid-off
> (isActive=false) row still rides the list. Benign today (every FE consumer gates on financing?.isActive) but unpinned. Added a contract-pin
> to vehicles-list-financing-contract.test.ts: a paid-off row STILL surfaces flagged isActive:false (same reused row id), so the FE gate stays
> the documented source of truth + any future join-filter change is test-visible. validate:local EXIT 0, 1422 pass (+1).*

> ~~**C302 — drift-proof the #93 restore conflict-probe symmetry.**~~ — *DONE C302: the C300 #93 fix added userPreferences + syncState
> to detectConflicts ad-hoc (the always-present singleton collisions), but insertBackupData inserts 15 tables while detectConflicts probes
> only 8 — a future PARENT-LESS table added to inserts without a probe would silently reintroduce the #93 raw-PK-throw on a colliding
> merge. Added a 3rd source-scan test to restore-table-coverage.test.ts: every `.insert(<table>)` must be either conflict-probed or on an
> explicit CHILD_OF_PROBED_PARENT allowlist (the 7 children whose insert is unreachable on a colliding merge because a probed ancestor
> collides first). NON-VACUOUS: stripping the C300 probes flags exactly userPreferences + syncState. validate:local EXIT 0, 1421 pass (+1).*

> ~~**C296 — translation-invariance property guarding the C295/#91 coordinate-space bug class.**~~ — *DONE C296: C295 fixed the
> lease-overage absolute-odometer-vs-driven-miles mix with a single example test, but the pre-existing lease-metrics property test
> asserts only finiteness/non-negativity (would NOT catch #91 — the over-reported fee was still finite & ≥0). Added a fast-check
> property (200 runs): shifting BOTH initialMileage and currentMileage by the same constant moves only the absolute odometer baseline,
> so every driven-miles output (mileageUsed/mileageRemaining/projectedExcessMiles/projectedExcessFee/isOverMileage) must be INVARIANT
> while projectedFinalMileage moves by exactly the shift. NON-VACUOUS: reverting the fix turned it RED. lease-metrics 22/22, fe
> validate:local EXIT 0, 606 pass.*

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
> `vehicles/photo-routes.ts` 0%→covered (provider-free slice) (C228 — the vehicle-photo sub-router's LIST (GET /) + SET-COVER
> (PUT /:photoId/cover) handlers were 0%-covered; upload+thumbnail need a real storage provider [property-test territory], so +6 HTTP tests via
> createTestApp with RAW-seeded photo rows [C215/C220 pattern]: list ownership-gate/pagination/401, set-cover single-cover invariant + the
> entityType/entityId match-check [foreign photoId via my vehicle URL → 404] + foreign-vehicle 404. The C227 dedup confirmed the parent router
> supplies requireAuth+changeTracker; this pins the sub-router's own handlers.)
> NEXT high-value low spots
> **(C152 re-measure — be 82.02% line / fe 70.09% line; FE STILL the bigger gap but closing — broke 70%):**
> backend — ~~`body-limit.ts`~~ DONE C156; ~~`backup-orchestrator.ts` 0%~~ now 50% func C181 (execute() body still DI-blocked);
> ~~`analytics/routes.ts` 15%~~ now 58.82% func / 59.40% line C185 (analytics-routes-http.test.ts +8 driving the REAL routes via
> createTestApp — auth 401, the vehicle-scoped ownership-guard 404s [C109/#52 cross-tenant], the optional-vehicleId branch, the success
> envelope; ALSO certified the analytics-route ownership guards clean as a deep-review). ~~`sync/routes.ts` 50%/31%~~ now 72% func /
> 59% line C188 (sync-route-success.test.ts +7 — the success/derivation handlers the C30/C36 error tests didn't reach: GET /status flag
> derivation, GET /restore/providers sourceTypes zip/sheets logic + skip branches, POST / no-provider success; the byte/provider-bound
> paths [download, restore-from-provider/backup] deliberately left — C163 mock-trap territory). REMAINING named BE low spot:
> ~~`activity-tracker.ts` (53%/44%)~~ its PURE slice now covered C195 (cleanupInactiveUsers ageout 0%→covered, +3 — negative-window
> deterministic ageout / survives-control / empty no-op); the REST (handleInactivity/performAutoSync/performAutoBackup :64-106) is
> setTimeout + orchestrator-bound + the DB-catch branches :132-147 need a DB seam — left documented, NOT a clean unit pick. NOTE (C163):
> `restore.ts:160-246` (restoreFromSheets) is uncovered but needs a process-global Sheets-service mock — NO sync test uses mock.module
> (the C38/C91 cross-suite-flake trap), so it's NOT a clean guard pick; defer until a DI seam exists or accept the gap. **The clean BE
> route/util low spots are now largely worked through (analytics/sync routes C185/C188, backup-orchestrator C181, activity-tracker pure
> slice C195) — next guard cycles steer FRONTEND. ~~**PRIMED FE guard pick (C199 deep-review): `calculatePayoffDateFromStart`
> (financing-calculations.ts:545)**~~ — DONE C207 (+12: the month-overflow clamp [Jan31+1→Feb28, leap→Feb29, Aug31+1→Sep30], no-clamp paths,
> year-rollover incl. Dec31+2→Feb28-2025, + the real date-only-string path with tz-robust assertions; verified-in-isolation first, my reasoned
> clamp values confirmed). FE low spots (FRESH C196 measure):
> ~~the ~15% form-validation module~~ DONE C201 (it was `expense-form-validation.ts` 127-line — +19 covering amount/volume/charge bounds,
> the electric-vs-liquid unit gating, + validateMileage monotonicity); ~~`analytics-api.ts` ~36% func~~ DONE C212 (+19: the 13 method→endpoint
> wirings + getDefaultDateRange [unix-seconds, 1yr window] + buildQuery optional-param edges; the existing test covered only getSummary's fallback);
> ~~`sync-manager.ts` ~56%~~ its CLEAN slice DONE C223 (+4: determineConflictType — the duplicate-vs-modified data-safety distinction, via
> the public syncAll conflict path; remaining gap = the network/setTimeout-retry paths, the C163 mock-trap territory — left),
> ~~`auth.ts` ~56%~~ DONE C217 (+4: requireAuth — the previously-untested per-page guard's sync authed/unauthed branches + BOTH
> loading-poll paths via fake timers; the existing test covered only route-classification + handleRouteProtection);
> `settings.svelte.ts` ~11% is the filed handleError arch pick (deferred). `expense-helpers.ts` category-display maps DONE C234 (+6:
> categoryLabels/getCategoryIcon/getCategoryColor exhaustiveness — every ExpenseCategory maps to a label/icon/color, no extra/missing key, +
> the unknown-category fallback; so a new category without a map entry fails CI instead of rendering blank).
> `settings/routes.ts validateStorageConfig` 4 branches DONE C239 (+4 HTTP via raw-seeded providers: non-owned-provider → 400 cross-tenant-routing
> guard, no-category-settings → 400, default-category-disabled → 400, consistent → 200; the C70 Zod-v4-exhaustive-record trap needed an all-4-category
> map helper).
> `providers/routes.ts` DELETE-cleanup side effects DONE C245 (+2 HTTP via the s3 seam: deleting a storage provider NULLS its storageConfig.defaults
> pointer + removes its providerCategories & backupConfig.providers entries [cleanupStorageConfig/cleanupBackupConfig, was 0 e2e coverage]; a
> 2-provider case proves the scrub is targeted, not over-broad).
> `sync/routes.ts` backups download+list slices DONE C250 (+3 HTTP: GET /backups/download → real ZIP w/ attachment headers + matching
> Content-Length [own-data export, no provider] + anon 401; GET /backups/providers no-providers → 200 []. The byte/provider-bound restore paths
> stay the C163 mock-trap territory).
> `providers/.../registry.ts` createProviderInstance google-photos/s3 validation branches DONE C254 (+5: GP happy [cached albumId] + missing-
> refreshToken throw; S3 happy + missing-creds throw + missing-config throw — the credential/config integrity gates; pure-construct, no DB/network).
> `providers/routes.ts` GET /pending/:nonce DONE C257 (+4 HTTP: own-nonce → 200+email, unknown → 404, ANOTHER-user's-nonce → 404 [the userId:nonce
> cross-user isolation], anon → 401; seeded via a post-harness dynamic-import of storePending for the same-instance Map, ran clean in the full suite).
> `providers/routes.ts` PUT credentials-re-encrypt + auth-domain-guard DONE C260 (+2 HTTP: PUT new credentials → 200, response never echoes the
> secret + the stored DB blob doesn't contain the plaintext [encrypted-at-rest]; PUT an auth-domain provider → 400 via the live route).
> `sync-worker.ts processSingleRef` path-resolution resilience branches DONE C261 (+2 unit, the arch-dry-pivot pick: a throwing resolveProviderFolderPath
> is swallowed → upload still proceeds with empty pathHint + ref ends ACTIVE-not-failed [NORTH_STAR #1 no-silent-loss]; unknown entityType → category
> undefined → resolve skipped via `if (category)`, upload still proceeds. Every prior sync-worker test resolved the path cleanly, leaving both unpinned).
> `utils/client-ip.ts getClientIp` trusted-proxy + fallback branches DONE C265 (+3 unit, the rate-limit-key spoof defense: trusted-proxy-but-no-XFF →
> fall through to socket IP; trusted-proxy-but-empty/whitespace-XFF → fall through [not key on '']; no-socket fallback with a MULTI-hop XFF → leftmost+trim.
> The existing test pinned the 4 headline trust rules but left these 3 — all security-meaningful, since a wrong key pools/splits rate-limit buckets).
> `no-utc-date-input.test.ts` committed source-scan guard for the #87 UTC date-input class DONE C271 (+2; scans product .svelte/.ts for
> `.toISOString().split('T')[0]`/`.slice(0,10)` — toDateInputValue never matches). CAUGHT A RESIDUAL: odometer-edit page :69 still used the UTC idiom
> (the EDIT page C267's sweep missed) → reloaded a stored noon-local date one day earlier for +offset users; FIXED via toDateInputValue. NON-VACUOUS (RED on the residual pre-fix).
> `settings/routes.ts` POST /backup + /restore endpoints DONE C277 (+3 HTTP; the two zero-coverage settings endpoints — settings was the thinnest route
> module): POST /backup → 200 + sync_state.last_backup_date null→timestamp via ctx.sqlite (proves updateBackupDate landed, a backup-status UI reads it);
> POST /restore → 200; both anon → 401 (auth-chain pin). NON-VACUOUS.
> `auth-provider-repository.ts updateProfile` cross-tenant write defense DONE C282 (+1; the OAuth-identity store, thinnest auth module). Its property-test
> covered 6 methods + delete's cross-tenant guard, but updateProfile had only the happy path → +1: attacker rewriting another user's google profile via
> updateProfile(id, wrongUserId) is a no-op (victim's displayName/email unchanged) — the (id,userId,domain='auth') predicate. NON-VACUOUS.
> `split-service.ts computeAllocations` percentage penny-residue + over-100% clamp DONE C287 (+3; thinnest service module, money math). Property tests pin
> sum/fairness/count but not the deterministic percentage edges: the LAST vehicle absorbs the rounding residue (33/33/34 → [33,33,34]); the Math.max(0,…)
> clamp (a non-last-overshoot config like 60/60/10 → last leg clamps to 0 not −20, since computeAllocations doesn't re-validate). NON-VACUOUS.
> analytics `/fuel-stats` + `/fuel-advanced` cross-tenant ownership guard DONE C290 (+4; the 2 uncovered optional-vehicleId endpoints — C185 pinned
> fuel-efficiency + the required-vehicleId ones, not these): each → omitted-vehicleId 200 all-fleet + FOREIGN-vehicleId 404 (no cross-tenant leak). These
> REQUIRE startDate+endDate (zValidator 400s before the guard otherwise) — supply a unix-seconds range to reach the guard branch. NON-VACUOUS.
> **NEXT FE guard pick (no primed): the FE pure/service modules are now
> essentially all covered — remaining FE gap is the components/routes deficit (largely eyes-on) + the network/timer-bound tails (mock-trap, low-value). vehicle-helpers.ts is the lone untested FE util but it's a single trivial display-name fn (theater — skip).** The components/routes deficit is
> the bulk + largely eyes-on.** FRONTEND — the FE SERVICE layer is now FULLY covered (C137/C143/C149/C163);
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
> **#127 (HIGH, data-safety / NORTH_STAR #1 — found C428 on a restore deep-review; MITIGATION landed C428, general fix ESCALATED) — replace-mode restore wipe is
> NON-ATOMIC with the insert: a mid-restore insert failure leaves the account WIPED (total data loss).** restore.ts:125 `db.transaction(async tx => { deleteUserData;
> insertBackupData })` — bun-sqlite's ASYNC-callback transaction does NOT roll back on a thrown insert (the C151 footgun, firsthand-confirmed in the ledger). A schema+ref-valid
> backup violating a DB UNIQUE index validateBackupData misses (dup non-null clientId / licensePlate, a corrupt download) → wipe commits, 2nd insert throws, data gone.
> Worse: ANY transient insert failure has the same effect. **MITIGATION DONE C428:** validateUniqueConstraints rejects a dup-clientId/licensePlate backup BEFORE the wipe (the
> insert can't fail on it → wipe never runs), +3 guards, closing the concrete reachable trigger. **GENERAL FIX ESCALATED C428 (arch rule-6 — a transaction-semantics change
> every `async (tx)` in the codebase shares):** make wipe+insert atomic without the broken async rollback (a synchronous bun:sqlite tx for restore / a codebase-wide
> async-tx-safety wrapper). The transient-insert-failure window stays open until that lands. NORTH_STAR #1 crown-jewel; awaiting Angelo's fix-approach pick.

> **#129 (MED, data-integrity / account-confusion — found C433 on an auth deep-review; loop-fixable, NOT yet fixed) — the OAuth login callback silently overwrites
> users.email with the provider's reported email on EVERY login.** updateExistingUserProfile (auth/routes.ts:176, reached from the generic callback :441) sets users.email =
> userInfo.email on every successful login where the provider identity (providerType+providerAccountId, the STABLE key) already maps to a user. The email is mutable on the
> provider side, so a user changing their GitHub/Google primary email → next VROOM login silently changes their VROOM login email to a value they never set here. The
> UNIQUE-constraint catch (:193-209) correctly prevents COLLISION with another user's email (keeps old email, updates only displayName) → NOT a cross-user takeover, bounded to
> within-account drift. REACHABLE (provider email change → next login). The collision/email-update branch (:193-209) is UNTESTED — no test drives updateExistingUserProfile.
> Likely fix is a product/direction nuance (don't sync email on login at all / sync only if unset / surface a "your email changed" notice) → consider a quick Angelo confirm
> before fixing, OR a minimal guard that pins the collision branch first. Lower priority than a money/data-loss bug; queued.

> ~~**#133 (MED, correctness/UX — found C441, FIXED C442; the #128 fromBackendExpense-skip class on the fuzzy-conflict path) — sync-manager checkForExistingExpense returned RAW
> backend rows, so serverExpense.amount was always undefined.**~~ — *DONE C442: mapped the GET rows through fromBackendExpense (one edit, established pattern → fixes amount +
> volume→charge + category); the fix EXPOSED + corrected two latent test-masking mocks (conflict test + C223 classifyAgainst both fed frontend-shaped rows). NON-VACUOUS (reverting
> the source turns 3 duplicate-classification tests RED). fe validate:local EXIT 0, 707 pass. The SECONDARY note below (dropped date/amount query params → fuzzy pre-check scans only
> page 1) stays OPEN as a multi-file/backend-schema change, NOT a one-edit fix. Original grounding kept for the audit trail:* sync-manager.ts:219-234 does a bare `apiClient.get<{date,amount,tags}[]>` on
> GET /expenses (which returns the backend shape: `expenseAmount`, not `amount`) and never maps through fromBackendExpense. Downstream: determineConflictType (:241) computes
> `Math.abs(local.amount - server.amount)` → `local.amount - undefined = NaN` → amountMatch ALWAYS false → a genuine duplicate is mis-classified 'modified'; AND
> SyncConflictResolver.svelte:174 renders `formatAmount(serverExpense.amount)` = `formatAmount(undefined)` → blank server amount in the resolve dialog (+ an electric row's kWh
> stays in volume not charge). Reachable on a tag-overlap conflict during sync. CLEAN one-edit fix: map the response array through fromBackendExpense before .find()/return (the
> established pattern, fixes amount + volume→charge + category at once). MED — bounded by clientId idempotency (the durable dedup still prevents actual dup rows; this is the
> secondary fuzzy-match/UX layer). A guard pinning serverExpense.amount (non-undefined, == backend expenseAmount) is also a fresh coverage add (no test drives
> checkForExistingExpense/determineConflictType today). SECONDARY NOTE (NOT this fix — multi-file/product): the date/amount query params at :224 are silently dropped by the
> backend schema, so the fuzzy pre-check only scans page 1 of the vehicle's expenses; correcting it needs a backend filter/endpoint change.

> ~~**#136 (MED, data-safety / NORTH_STAR #1 — found+fixed C446 on a 2-agent bug-hunt; the #43/#44 backup-honesty family but a clean code fix) — the activity middleware armed the
> inactivity timer ONLY for enabled-ZIP providers, so a Sheets-only-sync user got NO auto-backup-on-inactivity.**~~ — *DONE C446: activity.ts computed hasSyncEnabled via
> `.some((p) => p.enabled)`, but the orchestrator fans out on its OWN exported predicate filterEnabledProviders = `s.enabled || s.sheetsSyncEnabled === true`. A Sheets-only-sync
> provider (enabled:false, sheetsSyncEnabled:true) + syncOnInactivity NEVER armed the timer → recordActivity never called → auto-backup silently never fired (changeTracker still
> marks data changed → the user thinks sync is active). FIX (one expr, ONE source of truth): routed the middleware through filterEnabledProviders().length > 0. +1 HTTP-harness guard
> (spy recordActivity on the singleton, Sheets-only config), PROVEN NON-VACUOUS (revert → never called). Fixed the C291/C300 dynamic-import trap + a Zod cap (minutes max 30). be
> validate:local EXIT 0, 1538 pass (+1).*

> ~~**#137 (MED, correctness→money — found C446, FIXED C448; the #76/C244 class's import write site) — CSV import persisted stray fuel-only fields on a non-fuel imported
> row.**~~ — *DONE C448: parseRow parsed mileage/volume/fuelType for EVERY category + returned them verbatim; importExpenses inserts verbatim (no clearFuelFieldsIfNotFuel, the
> guard POST/#76 + PUT/#130 apply). A foreign-tracker import (Drivvo/Fuelio log odometer on a Service/maintenance row) → category=maintenance, mileage=120000 inserted → poisons
> getCurrentOdometer's cross-category MAX(odometer) UNION → wrong reminder firing + inflated lease-overage $. FIX: extracted clearImportedFuelFields (nulls the fuel-only fields for
> a non-fuel row; fuel passes through), routed parseRow's return through it — the extraction ALSO cleared a Biome cognitive-complexity ceiling parseRow tripped (C280 precedent) +
> made it ONE source of truth for the import-side clear. +2 guards (non-fuel-with-mileage → NULL [non-vacuous]; genuine fuel → kept). be validate:local EXIT 0, 1540 pass (+2).*

> ~~**#138 (MED, correctness/date — found C446, FIXED C449; the #87/#131 UTC-date family on the lone hold-out forms) — InsuranceTermForm (+ ClaimsSection sibling) stored term/claim
> dates at UTC-midnight → displayed a day early for Americas users.**~~ — *DONE C449: InsuranceTermForm save sent raw "YYYY-MM-DD" → z.coerce.date() → UTC midnight → formatDate (local)
> showed the prior day; reload sliced `.split('T')[0]` (UTC). Firsthand-found the SAME round-trip bug in ClaimsSection (saves via dateOnlyToISO, reloads via `.split('T')[0]`) → fixed
> both. FIX (mirror #131): save through dateOnlyToISO + reload through toDateInputValue on both forms. GUARD: generalized no-utc-date-input.test.ts ISO_STRING_DATE_SLICE to ALSO match
> `.split('T')[0]` (it only matched `.slice(0,10)`, the exact reason both forms slipped past) + added claimDate. PROVEN non-vacuous + false-positive-free. fe validate:local EXIT 0, 713
> pass. The #87/#106/#131/#138 UTC-date family is now closed across ALL date-only forms, the source-scan covering both antipattern forms.*

> ~~**#139 (MED, money/correctness — found+fixed C453 on a 2-agent bug-hunt; the #92/#117 0%-APR class, 3rd site) — a 0%-APR loan was silently excluded from /analytics/financing
> loanBreakdown.**~~ — *DONE C453: buildLoanBreakdown (analytics/repository.ts:902) filtered `&& f.apr` (truthy), so an apr===0 dealer-promo loan (schema .min(0)-valid) was dropped →
> if it's the user's only loan, loanBreakdown=[] → FinancingAnalytics gates the whole Interest-vs-Principal chart on length>0 → renders nothing for an actively-paid-down 0% loan.
> The amortization helper handles 0% fine (interest=0, payment→principal). FIX (one edit): drop `&& f.apr` (financingType==='loan' already excludes leases; apr coalesced to 0 for
> the walk). +1 HTTP-harness guard (0%-APR loan → loanBreakdown non-empty, all interest===0, some principal>0), PROVEN NON-VACUOUS. be validate:local EXIT 0, 1543 pass (+1).*

> ~~**#140 (MED-HIGH, money/UX correctness — found C453, FIXED C455; the #64/#110/#115 annual-vs-total class on the ONE card #115 missed) — LeaseMetricsCard compared LIFETIME
> driven miles against the bare ANNUAL mileageLimit.**~~ — *DONE C455: LeaseMetricsCard.svelte used `financing.mileageLimit` (ANNUAL) as the burn-bar denominator (:34), displayed
> limit (:66), + limitOdometer base (:48) while leaseMetrics.mileageUsed is LIFETIME — for an on-pace 36-mo/12k-yr lease at 24k driven it showed "24k/12k, 100% RED" while the same
> card's "left" figure (already routed through leaseTotalMileageAllowance) said "12k left". FIX (one coherent change): added a totalMileageAllowance = leaseTotalMileageAllowance(financing)
> derived, routed all 3 display lines through it — now internally consistent. The risky math is the already-unit-tested helper; mechanical re-point. fe validate:local EXIT 0, 714 pass.
> EYES-ON: card renders only for a lease WITH a mileageLimit (demo seed has none) → "code-complete, eyes-on pending" (verifiable by inspection). Closes the annual-vs-total class
> across BOTH cards (PaymentMetricsGrid C398 + LeaseMetricsCard C455).*

> ~~**#142 (MED, correctness/feature-disabling — found+fixed C459 on a 2-agent bug-hunt) — mileage notifications (dueDate=NULL) sorted LAST + truncated out of the feed.**~~ —
> *DONE C459: findNotifications (reminders/repository.ts:468) ordered by desc(dueDate), but createMileageNotification inserts dueDate=NULL (milestone in dueOdometer) → NULLs sort LAST
> under DESC → a just-due mileage notification renders below year-old time ones, AND past limit(100) the mileage axis is invisible entirely (feature-disabling). FIX: orderBy
> desc(createdAt) (non-null recency axis spanning both types). +1 guard (a later-created mileage notif sorts first); updated the existing "newest-first" test from dueDate-desc (the
> buggy contract) to createdAt-desc. NON-VACUOUS. be validate:local EXIT 0, 1549 pass (+1).*

> **#143 (LOW, cosmetic/grammar — found+filed C459 on an FE bug-hunt; clean one-edit, NOT fixed) — formatRelativeTime renders "1 weeks/months/years ago" at the bucket boundaries.**
> formatters.ts:115-117: `${Math.floor(days/7)} weeks ago` etc. emit "1 weeks ago" (day 7-13), "1 months ago" (30-59d), "1 years ago" (365-729d) — no singular form. Rendered by
> RecentActivityCard / VehicleCarousel / SyncStatusInline on real timestamps. Clean one-edit: the `n>1?'s':''` idiom already used in frequencyLabel + getSyncStatusInfo. NOTE the existing
> formatters.test.ts:206 CODIFIES the wrong output ("1 years ago") → the fix flips that assertion too. LOW (no data/money), near the eyes-on boundary but unit-testable; queued.

> **#135 (LOW, hygiene/growth — found+filed C445 on the sync deep-review; NOT fixed, a reaping-lifecycle behavior call) — the SyncManager path never reaps synced rows from
> localStorage.** syncManager.syncAll + resolveConflict only markExpenseAsSynced (sets synced:true, row STAYS in localStorage); they never removeOfflineExpense/clearSyncedExpenses.
> Contrast the legacy syncOfflineExpenses (offline-storage.ts), which clearSyncedExpenses() after its loop. So through the SyncManager entry point (the one auto-sync + the manual
> button drive) synced rows accumulate indefinitely. NOT a correctness bug — getPendingExpenses filters !synced, so a synced row is never re-POSTed/re-conflict-checked (the #134
> fix relies on exactly this) — purely unbounded localStorage GROWTH + divergence between the two sync entry points. Fix is a behavior call: reap synced rows after a successful
> syncAll (mirror syncOfflineExpenses' clearSyncedExpenses) / keep a short history then prune / leave as-is. LOW; queued.

> ~~**#132 (MED-HIGH, data-safety / NORTH_STAR #1 — found+fixed C441 on a 2-agent bug-hunt; the #93/C300 raw-UNIQUE-throw class on a third table) — merge-restore
> detectConflicts didn't probe `reminders`, so a surviving vehicle-less reminder in a backup threw a raw UNIQUE error instead of a clean conflict.**~~ — *DONE C441:
> detectConflicts (restore.ts:273) probed 8 tables but NOT `reminders`, while insertBackupData inserts it (:469). reminders is userId-owned with its own id PK + NOT FK'd to
> vehicles (the link is the reminder_vehicles junction, onDelete:cascade), so it SURVIVES deletion of all its vehicles (the #97 state). A merge restore of a backup carrying
> that surviving reminder slipped past conflict detection → insert(reminders) against the existing id PK → `UNIQUE constraint failed: reminders.id` → whole restore aborts raw
> (the #93/C300 failure on a third table). The restore-table-coverage drift-guard MISSED it (false "child of vehicles" exemption — reminders has no vehicle FK). FIX (one probe,
> mirrors C300): added reminders to the probe array (userId-scoped, id PK); corrected the guard's exemption. +1 guard (restore-merge-reminder-collision.test.ts): create
> vehicle+reminder → export → DELETE vehicle (#97) → merge-restore reports a table==='reminders' conflict. PROVEN NON-VACUOUS both ways (green with the probe, RED without —
> keys on the reminders-TYPED conflict since the C300 prefs row also collides). be validate:local EXIT 0, 1534 pass (+1).*

> ~~**#131 (LOW, correctness/date — found C434, fixed C437; the #87/#106 UTC-date family, on the form the guard missed) — ReminderForm read stored dates via UTC `.slice(0,10)`,
> shifting the date back an edit-open for UTC+13/+14 users.**~~ — *DONE C437: ReminderForm.svelte:116-117 reloaded via `r.startDate.slice(0,10)`, but the save path persists via
> dateOnlyToISO → NOON LOCAL; for a UTC+13/+14 user noon-local lands on the PRIOR UTC day → `.slice(0,10)` returns the previous day → the start/end silently shifted back every
> edit-open. FIX (one edit, mirrors C267/C268/C271): route both reload lines through toDateInputValue(new Date(field)) — already imported + used on the create path. GUARD (form is
> eyes-on-blocked → source-scan net): extended no-utc-date-input.test.ts with +1 ISO_STRING_DATE_SLICE regex (a date-typed property access .slice(0,10)) + a 2nd offender-scan test —
> the existing regex matched only `.toISOString().slice(0,10)` and missed the bare-string-field form. PROVEN non-vacuous + false-positive-free (matches the pre-fix line; skips the
> safe dateStr-local-parse + tags-cap slices). fe validate:local EXIT 0, 707 pass (+1).*

> ~~**#130 (MED, data-integrity/money-adjacent — found+fixed C434 on a 2-agent bug-hunt; the #76/C244 THIRD leg) — PUT /expenses/:id writes a stray mileage onto an
> ALREADY-non-fuel row when category isn't resent, poisoning getCurrentOdometer.**~~ — *DONE C434: clearFuelFieldsIfNotFuel (routes.ts:164) returns data UNCHANGED when
> data.category===undefined; the PUT called it as clearFuelFieldsIfNotFuel(updateData), so a PUT writing {mileage:99999} onto a maintenance row WITHOUT resending category skipped the
> clear → the stray mileage persisted → getCurrentOdometer's MAX(odometer) UNION (no category filter) reads it cross-category → wrong mileage-reminder firing + inflated lease-overage
> money. C244 covered POST-with-category + PUT-that-SWITCHES-category but NOT this third leg. FIX (one edit, residual leg of the decided #76 arc): added an optional effectiveCategory
> param (defaults to data.category → POST byte-identical); the PUT passes the already-computed finalCategory. Genuine fuel edit untouched. +1 guard (a maintenance row PUT
> {mileage:99999,volume,fuelType} no-category → all nulled). NON-VACUOUS. be validate:local EXIT 0, 1532 pass (+1).*

> ~~**#128 (LOW, correctness / FE→BE seam, NORTH_STAR #3 — found+fixed C431 on a 2-agent bug-hunt) — reminderApi.getMaterializedExpenses returned RAW backend-shaped rows
> typed as Expense[], the one expense read that skips fromBackendExpense.**~~ — *DONE C431: bug+arch both AT budget; bug's only OPEN item (#127) is escalated, so a fresh
> BE+FE bug-hunt confirmed the swept surface has no currently-reachable unfixed defect + surfaced this latent one. getMaterializedExpenses (reminder-api.ts:77) did a bare
> apiClient.get<Expense[]> on GET /reminders/:id/expenses, but the route returns RAW findBySource rows (backend shape: expenseAmount, un-split volume) — EVERY other expense
> read maps through fromBackendExpense (expenseAmount→amount, volume→volume|charge by isElectricFuelType). So a consumer reading expense.amount gets undefined + an electric
> charge's kWh stays in volume. LATENT (the sole consumer, recurring-expenses T6, is eyes-on-blocked/unbuilt) — fixing now means T6 "just works" when it lands. FIX (mirrors
> expense-api.getExpense): get<BackendExpenseResponse[]> then data.map(fromBackendExpense). The EXISTING test CODIFIED the bug (fed {amount}, asserted pass-through) — rewrote
> it to feed BACKEND-shaped rows (+ an electric volume=30 row) + assert the transform. NON-VACUOUS (pre-fix amount undefined, charge unset). fe validate:local EXIT 0, 697 pass.*

> **LATENT-HARDENING (filed C431, NOT yet reachable — defer unless a sheet grows) — google-sheets-service.ts:604 computes the end-column letter as
> `String.fromCharCode(64 + headers.length)`, valid only for ≤26 columns.** The largest sheet (reminders) is 25 cols today → 'Y', so it works; but adding a 27th column to any
> SHEET_HEADERS array yields '[' → an invalid A1 range `A1:[26` → that backup write throws (and the `A:Z` clear one line up shares the 26-col ceiling, silently leaving a 27th
> column's stale data). sheets-header-coverage.test.ts pins column PRESENCE but not this count ceiling. Clean fix = an index→A1 multi-letter helper. Not a live bug (no current
> input triggers it) → filed, not auto-fixed.

> ~~**#126 (MED, correctness/units / NORTH_STAR #1 — found+fixed C427 on a cross-vehicle deep-review; the C413 sweep's missed twin) — the CONVERTED/trend analytics
> efficiency builders contaminated gas-MPG with PHEV charge mi/kWh.**~~ — *DONE C427: C411/C413 fixed the gas/charge partition (gasEfficiencyPoint) on the analytics-charts
> builders + computeMpgAndCostPerMile, but the repository.ts CONVERTED/trend builders still used computeEfficiencyPoint (accepts electric) at 4 sites —
> computeConvertedEfficiencyValues, buildConvertedEfficiencyTrend, getFuelEfficiencyTrend, buildConvertedFuelEfficiencyComparison. A PHEV charge (kWh→~mi/kWh) leaked into
> the gas-MPG average; WORSE on the converted path, convertEfficiency then converts that mi/kWh AS IF mi/gal → garbage. The comparison case is a BRANCH-PARITY gap (its
> skipConversion twin already used gasEfficiencyPoint → same chart flips correct↔polluted on a fleet units-mismatch). FIX: routed all 4 through gasEfficiencyPoint
> (electric excluded BEFORE conversion); dropped the unused computeEfficiencyPoint import. +1 guard (a PHEV trend returns only the gas point). NON-VACUOUS. be validate:local
> EXIT 0, 1523 pass. The C411→C413→C427 arc now covers the gas/charge partition across BOTH the analytics-charts builders AND the repository converted/trend paths.*

> ~~**#125 (MED, money/data-safety / NORTH_STAR #1 — found+fixed C422 on an expense-validation deep-review) — PUT /expenses/:id skipped the financing-source
> verification POST enforces, letting a forged source_id='financing' link corrupt the displayed loan balance.**~~ — *DONE C422: the POST handler verifies a
> `sourceType:'financing'` link points at the vehicle's ACTIVE financing (exists + isActive + sourceId===financing.id), but PUT wrote `{sourceType:'financing',
> sourceId:<arbitrary>}` verbatim (it had the #61 vehicle re-check + #76 fuel-clear + #109 both-or-neither, but NOT this). computeBalance sums EXACTLY
> `source_type='financing' AND source_id=id` (originalAmount − SUM), so a forged/mismatched link mis-attributes the expense as a loan payment → understates the balance +
> wires the row into the financing cascade-cleanup (#62 class). DISTINCT from #109 (asymmetric) + the enum restriction. FIX (atomic + arch-clean): extracted
> assertFinancingSourceValid(sourceType, sourceId, vehicleId), shared by POST + PUT (keyed on sourceType, final vehicleId). +3 guards (forged→400 [200 pre-fix], valid→200,
> mismatched-id→400). NON-VACUOUS. be validate:local EXIT 0, 1521 pass (+3). Vehicle write-path CERTIFIED CLEAN the same cycle (C338/C366 corroborated).*

> ~~**#124 (MED, money/correctness / NORTH_STAR #1 — found+fixed C417 on an import-mapping bug scout) — normalizeDecimal corrupted a US-format number with BOTH
> separators (1,234.56 → 1.23456, a ~1000x money under-count).**~~ — *DONE C417: normalizeDecimal (import-mapping.ts:145) on `hasDot && hasComma` hard-assumed EUROPEAN
> (strip dots, comma→decimal), but the dot-AFTER-comma ordering of US `1,234.56` is UNAMBIGUOUSLY US → it stripped the dots → 1.23456. Applied unconditionally to `amount`
> (:295) on every import incl. the US Fuelly preset (mdy/miles/US-gallons, NO decimal flag) → a $1,234.56 expense imported as $1.23. DISTINCT from the product-gated #24
> (lone-comma IS ambiguous; both-separators is NOT — provably wrong regardless of locale). FIX: the decimal separator is whichever appears LAST (lastIndexOf); strip the
> other as thousands — handles BOTH 1.234,56 (EU) AND 1,234.56 (US). +2 guards (US + multi-group); the existing EU test stays green. NON-VACUOUS. be validate:local EXIT 0,
> 1508 pass (+2). Also CORRECTED a stale grounding note: there is NO "per-mapping decimalComma flag" — normalizeDecimal runs unconditionally. (TCO/depreciation CERTIFIED
> CLEAN the same cycle, C361 corroborated.)*

> ~~**#123 (LOW-MED, reliability/data-safety / NORTH_STAR #1 — found+fixed C416 on a storage-provider deep-review; the #103/C349 sibling on the UPDATE path) — PUT
> /providers/:id bypassed the S3-config fail-fast CREATE has, persisting a bricked provider.**~~ — *DONE C416: PUT /providers/:id (routes.ts:406-408) wrote body.config
> verbatim with NO provider-type validation, while CREATE fail-fasts an incomplete S3 config (resolveProviderCredentials, the C349 fix). Editing an S3 provider (the edit
> form's canSave doesn't require region) to a config missing endpoint/bucket/region persisted a 200 + a row that throws at buildS3Provider on every later test/upload/sync
> — the #103/C349 footgun C349 only closed on CREATE. FIX (atomic + arch-clean, ONE source of truth): extracted validateStorageProviderConfig(providerType, config) from
> resolveProviderCredentials's inline S3 block; called from BOTH CREATE + the PUT handler (against the existing provider's type). GUARD: flipped the existing PUT test
> (which codified the bug — {config:{changed:true}}→200) to a complete config + a NEW 400 guard (incomplete PUT rejected, original config survives). NON-VACUOUS. be
> validate:local EXIT 0, 1506 pass (+1 net). Auth/session/OAuth CERTIFIED CLEAN the same cycle (3rd confirmation, C341/C372/C416).*

> ~~**#120 (LOW-MED, UX-correctness / NORTH_STAR #2-3 — found+fixed C410 on a route-load/display deep-review) — OfflineExpenseCards rendered a RAW ISO date string
> instead of a formatted date.**~~ — *DONE C410: OfflineExpenseCards.svelte rendered `{expense.date}` raw at :58 (pending) + :108 (synced); the offline-first save
> stores `date` as a full ISO timestamp (dateOnlyToISO → noon-local), so /expenses showed `2024-03-15T17:00:00.000Z` next to a clean formatCurrency amount, while every
> other date in the app uses formatDate → "Mar 15, 2024". FIX: import formatDate + `{formatDate(expense.date)}` at both sites (handles the ISO-timestamp + date-only
> forms). formatDate contract already pinned (formatters.test.ts:96/187) → wiring fix to a tested helper. EYES-ON offline-state-blocked (the cards need a client-side
> IndexedDB queue the screenshot harness can't seed). fe validate:local EXIT 0, 690 pass / svelte-check + build clean.*

> ~~**#121 (LOW, data-safety / NORTH_STAR #1 — found C410 on an offline-sync deep-review) — retrySingleExpense silently dropped a conflict result.**~~ — *DONE C424:
> retrySingleExpense (sync-manager.ts:261) acted ONLY on result.success — a {success:false, conflict} on a retry was NOT pushed to syncConflicts.current (the main loop
> does, :154) → no SyncConflictResolver dialog, expense stuck pending, retryCount never cleared. FIX (mirror the main loop): on result.conflict, APPEND to
> syncConflicts.current (not replace — the retry runs async after syncAll returned; dedup by expense id) + clear retryCount + set syncState 'error'. The timing-race caveat
> was about the TRIGGER, not the fix — the LOGIC is deterministically testable: +1 guard driving the REAL retry path with FAKE TIMERS (attempt-1 create fails → schedules
> retry → retry conflict-check returns an existing row → advanceTimersByTimeAsync fires it → syncConflicts.current has it + retryCount cleared). NON-VACUOUS (pre-fix []).
> fe validate:local EXIT 0, 697 pass (+1). The durable DB clientId dedup means no DOUBLE-apply regardless; this closed the stuck-pending + no-signal half.*

> ~~**#118 (MED, data-safety / NORTH_STAR #1 — found+fixed C408 on a split/tag bug scout; the #104/C352 CSV round-trip class, on the boundary that fix missed) — the
> split-expense create schema's tags bypassed the separator-rejection, re-opening the silent tag-split-on-round-trip.**~~ — *DONE C408: createSplitExpenseSchema
> (validation.ts:80) had `tags: z.array(z.string()).optional()` — a bare array bypassing the tagElementSchema separator-refine (#104/C352) the regular create/update
> boundaries enforce. A split tag `road; trip` (FE forwards verbatim → createSiblings persists onto every sibling) round-trips into TWO tags via export ('; '-join) →
> import (/[;,]/-split). #104/C352 fixed this "at the write boundary" but only on the regular schemas; the split-create schema is a separate def it missed. FIX (atomic +
> arch-clean): lifted tagElementSchema from routes.ts INTO validation.ts (ONE source of truth; routes→validation import direction, no cycle), routed the split tags
> through it, re-imported into routes.ts (regular boundaries unchanged). +4 guards (split-create rejects ';'/','/empty tag; control passes). NON-VACUOUS. be
> validate:local EXIT 0, 1496 pass (+4). The split-UPDATE path was already safe (reuses firstOld.tags).*

> ~~**#119 (MED, correctness/units / NORTH_STAR #1 — found C408 on an EV/unit bug scout) — a plug-in hybrid's CHARGE sessions contaminated the analytics Fuel Stats
> "MPG" card.**~~ — *DONE C411: computeMpgAndCostPerMile (analytics-charts.ts:311) pushed every computeEfficiencyPoint into mpgValues, and computeEfficiencyPoint accepts
> electric rows (electric-aware band), so a charge session's ~3 mi/kWh (kWh in `volume`) landed in the SAME array as ~40 mi/gal gas points → fuelConsumption (the
> FuelStats card, labeled mi/gal) blended them. FIX (SURGICAL — NOT the scouted blanket `if(electric)return`, which would have wrongly dropped charge from COST too):
> gate the mpgValues.push on `!isElectricFuelType(current.fuelType)` ONLY; costPerMileValues stays unfiltered (cost/mile = total energy spend / total miles, the
> C378-certified invariant — dropping charge cost would UNDER-report spend). +3 guards (mpgValues gas-only [len 1, RED pre-fix]; costPerMileValues keeps the charge $/mi;
> gas-only control). NON-VACUOUS. be validate:local EXIT 0, 1499 pass (+3).*

> ~~**#122 (MED, correctness/units / NORTH_STAR #1 — found C411, the #119 sibling-builder sweep) — the gas-MPG efficiency builders mixed a PHEV's charge mi/kWh into
> their average.**~~ — *DONE C413: firsthand verification WIDENED the scope from the filed 3 to 5 gas-MPG aggregators (computeMpgAndCostPerMile [#119/C411],
> buildMonthlyConsumption, addSeasonalEfficiencyData, computePerVehicleFuelEfficiency→vehicleRadar, buildFuelEfficiencyComparison) + confirmed the label is always
> gas-derived (getFuelEfficiencyLabel=distance/volume) so excluding electric is correct (not an EV regression). FIX (arch-clean — ONE source of truth, not 5 inline gates):
> extracted `gasEfficiencyPoint(current, previous)` (computeEfficiencyPoint but null for an electric current row); routed all 5 through it (incl. replacing C411's inline
> gate). cost-per-mile still uses computeEfficiencyPoint directly (spans all energy, C378). +3 guards (gas→point/electric→null; monthly + seasonal efficiency = the gas
> 30 MPG, not the diluted 17). NON-VACUOUS. be validate:local EXIT 0, 1502 pass (+3). The C367→C390→C391→C411→C413 per-builder-then-sweep arc on the split/charge analytics class is now complete.*

> ~~**#117 (MED, money/correctness / NORTH_STAR #1 — found C404 on a financing-planner deep-review scout; the #92 symptom re-manifested at the planner layer) — a
> 0%-APR loan in the Payment Planner always shows "0 mos / $0 saved" no matter the extra payment.**~~ — *DONE C405: baseline = `minimumPayment > 0 ? minimumPayment :
> financing.paymentAmount` in computePlannerState (primary + secondary-delta), so a 0%-APR loan (minimumPayment=0) uses its real contractual payment as the baseline
> instead of $0 (which tripped the negative-am guard → 0 months → monthsSaved 0). +5 guards (0%-APR $500-vs-$400 → monthsSaved=6 RED pre-fix; monotonic; apr>0
> unchanged). NON-VACUOUS. fe validate:local EXIT 0, 690 pass (+5). The ORIGINAL filed analysis below, for grounding:* computePlannerState (payment-planner.ts:64-66)
> builds the baseline as `{ ...financing, paymentAmount: minimumPayment }` + calls calculateExtraPaymentImpact. For a 0%-APR loan calculateMinimumPayment returns null
> → PaymentPlannerDialog passes `minimumPayment ?? 0 = 0` → the baseline amortization is simulateAmortization(balance, 0, 0) → first iteration principal=0 trips the
> negative-am guard → original.months=0 → monthsSaved=max(0, 0−accelerated)=0 + interestSaved=0. So a user paying $500 instead of $400 on a $12k 0%-APR loan (genuinely
> 30→24 months) sees "0 mos / $0 saved". The C297 fix lives one layer DOWN in calculateExtraPaymentImpact (0%-APR runs the loop), but the planner defeats it by feeding
> minimumPayment=0 as the baseline. Reachable: NextPaymentCard "Change Payment" (no apr guard) + FinanceTab renders PaymentPlannerDialog for ANY loan (apr=0 only adds an
> "APR Not Set" alert). FIX (atomic): baseline = `minimumPayment > 0 ? minimumPayment : financing.paymentAmount` (the real contractual payment) in computePlannerState +
> the secondary-delta branch (:70-71); apr>0 paths (minimum>0) byte-unchanged. The 0%-loan-opens-planner path has NO test → add one with the fix. fe-only, money-facing.

> ~~**#115 (MED, money/correctness / NORTH_STAR #1 — found+fixed C398 on a forced bug-cycle FE calc scout; the #64/#91/#110 annual-vs-total lease class) —
> PaymentMetricsGrid's "Mileage Overage" card compared LIFETIME driven miles against the bare ANNUAL mileageLimit, over-reporting the overage + $ fee ~Nx.**~~ —
> *DONE C398: bug OVER budget (4>3) → forced. PaymentMetricsGrid.svelte:62 did `Math.max(0, mileageUsed − financing.mileageLimit)`, but `mileageUsed` (FinanceTab:157)
> is LIFETIME driven miles (currentOdometer − initialMileage) while `mileageLimit` is the ANNUAL allowance (schema + form label "Annual Mileage Limit"; the sibling
> calculateLeaseMetrics:458 correctly scales `× leaseYears`). So a 36-mo/12k-yr lease (36k total) driven 30k showed "18,000 over" + a phantom fee here, while
> LeaseMetricsCard on the SAME Finance-tab screen showed 0 — two contradicting figures, this one inflated ~Nx. The exact #64/#91/#110/C198/C374 class, Angelo-approved
> on the sibling card (C157/C198) → a known-correct invariant the loop lands autonomously. FIX (atomic + arch-clean): extracted the `annual × termMonths/12`
> total-allowance math (inline ONLY at calculateLeaseMetrics:458-459) into shared `leaseTotalMileageAllowance(financing)` + a pure `calculateLeaseOverage(financing,
> mileageUsed)` in financing-calculations.ts (the audited, UNIT-TESTABLE module); routed BOTH calculateLeaseMetrics AND the .svelte card through it (ONE source of
> truth). NOTE the card is CURRENT overage, LeaseMetricsCard the PROJECTED end-of-lease excess — different metrics, but both must use the term-scaled total. +12 guards
> (term-scaling, 0-term fallback, no-limit; under-total→0 [the bug case, RED pre-fix], over→excess×fee, longer-term, agrees-with-metrics, no-fee, non-lease, no-limit).
> NON-VACUOUS. fe validate:local EXIT 0, 686 pass (+12). The paired BE finding (split null-mileage siblings break the consecutive-fillup PAIRING adjacency → dropped
> efficiency points) is REAL + reachable but a ~10-site arch change → noted below for a future arch cycle, not self-fixed.*
> NOTE (filed C398, arch — efficiency-pairing adjacency): a split FUEL expense creates one sibling PER VEHICLE with volume=null AND mileage=null (createSiblings,
> split-service.ts). queryFuelExpenses returns all category='fuel' rows with no volume filter, and sortByVehicleThenDate interleaves the split sibling chronologically.
> The consecutive-fillup pairing loop (forEachVehiclePair, analytics-charts.ts:258, + ~9 inlined copies: computeMpgAndCostPerMile, buildMonthlyConsumption,
> addSeasonalEfficiencyData, computePerVehicleFuelEfficiency, buildFuelEfficiencyComparison, accumulateCostPerMile, repository's computeConvertedEfficiencyValues /
> buildConvertedEfficiencyTrend / buildConvertedFuelEfficiencyComparison) then pairs the null-mileage sibling with the real fillups around it → those pairs are
> rejected by computeEfficiencyPoint (null mileage), and the VALID real-fillup→real-fillup window straddling the split is never paired → a legitimate efficiency point
> is silently dropped (undercount — the OPPOSITE failure mode from the #108/#113 COUNT overcount). The value math is correct (null rows can't produce a point); the bug
> is purely lost ADJACENCY. Reachable (a household logging joint fill-ups as splits) but the clean fix is to route all pairing sites through forEachVehiclePair + a
> `volume != null && volume > 0` pre-filter there — a multi-site arch change, not a one-cycle bug fix. NOT a single-line global fix because the pairing is duplicated.
>
> ~~**#114 (MED, correctness/data-hygiene / NORTH_STAR #1 — found+fixed C394 on an odometer/reminder bug scout; the #107/bug-#12 endDate family on the
> mark-serviced path) — mark-serviced re-arm ignored endDate, re-arming a bounded reminder forward + leaving it active past its end.**~~ — *DONE C394: the
> mark-serviced time-axis re-arm (routes.ts:119) advanced nextDueDate past now + WROTE it but never checked endDate, so a bounded reminder serviced AFTER its end
> was re-armed to a future date + left is_active=1 (lives past its end, fires again) — the exact bug trigger-service fastForwardPastNow guards (C362/#107), missed
> on mark-serviced. FIX: mirror C362 — if endDate && advanced-nextDue > endDate → deactivate the whole reminder + return inactive. The branch pushed the handler
> over Biome's complexity cap → extracted advanceToFirstFutureDue helper (bonus arch-clean). +1 guard (start+end-in-past reminder serviced → is_active=0).
> NON-VACUOUS. be validate:local EXIT 0, 1475 pass (+1). The paired (A) api-client fan-out: apiClient.raw() bypasses fetchOrThrow → export/backup errors show
> "status N" not the backend message — a real UX-transparency gap, noted below (not a data defect).*
> NOTE (filed C394, UX-transparency — low priority): apiClient.raw() (api-client.ts) returns a naked Response bypassing fetchOrThrow's error-envelope parsing, so
> its two callers (expense-api.ts export, settings.svelte.ts downloadBackup) `throw new Error("...status N")` on a non-ok — surfacing the HTTP status, NOT the
> backend's structured error message (e.g. a 403 "permission denied" reason). Not data loss + not all-paths (only the 2 binary/CSV-download callers that need raw
> Response for the blob); a hardening cycle could parse the error body before throwing (mirror fetchOrThrow). Lower than a live correctness bug.

> ~~**#113 (MED, correctness/units / NORTH_STAR #1 — found+fixed C390 on a fuel-advanced builder bug scout; the #108 sibling) — buildDayOfWeekPatterns
> overcounted fillupCount + skewed avgCost/avgVolume for a split fuel fillup.**~~ — *DONE C390: buildDayOfWeekPatterns (analytics-charts.ts:803) did `entry.count++`
> unconditionally + divides avgCost/avgVolume by it. A split fuel expense creates one sibling per vehicle with volume=null (queryFuelExpenses has no volume
> filter), so one split fillup inflated the day's count by N AND skewed avgVolume (totalGallons/N) + avgCost (per-row). The EXACT #108 class buildSeasonalEfficiency
> already guards at :644 (C367) — missed on this sibling. FIX: same volume-bearing guard (`continue` on null/≤0). +2 guards (split→1, zero-volume→0). NON-VACUOUS.
> be validate:local EXIT 0, 1473 pass (+2). The paired (A) restore-round-trip fan-out: photoRefs providerId validated without a userId scope (restore.ts:525) —
> real defense-in-depth gap but needs a TAMPERED backup ZIP → noted below, not the clean within-app defect.*
> NOTE (filed C390, defense-in-depth — ARCC/credentials-adjacent, same class as the C339/C387 notes): restore.ts:525 validates a backup's photoRefs.providerId
> values against userProviders WITHOUT a userId scope (`where(inArray(userProviders.id, providerIds))`), so a hand-tampered backup ZIP whose photoRefs.csv
> references ANOTHER user's providerId would pass validation → a cross-tenant photo→provider link. The app NEVER writes a cross-tenant providerId (refs are created
> co-owned via getBackupProviders, C348/C387), so this is only reachable via a tampered self-backup — lower than a live bug. A hardening cycle could add
> `eq(userProviders.userId, userId)` to that query (one-line, behavior-preserving for honest backups). ARCC SAX-05 Outcome-2 (tenant validation at data-access
> boundaries) grounds it.

> ~~**C387 — reminder mark-serviced CERTIFIED CLEAN; provider cross-tenant claim DEBUNKED (ARCC-consulted); pinned the backup-provider tenant-isolation invariant.**~~
> — *DONE C387: bug forced (4>3). 2-agent fan-out. (A) mark-serviced re-arm CLEAN (both axes correct, #83 loop, defensive). (B) the agent's "crafted PhotoRef →
> getProviderInternal uses another user's credentials" — CREDENTIALS+cross-tenant domain → queried ARCC FIRST (SAX-05 Outcome-2 confirms background-job tenant
> validation is a real pitfall). Then DEBUNKED firsthand (C21/C60): both real photo_ref creation sites derive providerId from the user's OWN providers
> (getBackupProviders(userId) routes through findOwnedProvider/C348, skips non-owned; provider-create uses the owned id) → every ref is co-owned by construction
> → getProviderInternal's id-only lookup (@internal, no-auth-context by design) is safe; the "attacker inserts a PhotoRef" needs direct DB write = out of threat
> model. NOT a defect. THE unpinned invariant → pinned: getBackupProviders SKIPS a config-listed-but-not-owned provider. +1 guard (registry.test.ts). ARCC-grounded
> defense-in-depth note filed (a sync-worker co-ownership assertion is an arch change, not self-fixed). be validate:local EXIT 0, 1471 pass (+1).*
> NOTE (filed C387, defense-in-depth — ARCC SAX-05 Outcome-2): the photo-sync worker resolves storage credentials via getProviderInternal (id-only, no userId
> scope) because it runs without an auth context. Today this is SAFE — every photo_ref's providerId is co-owned with its photo by construction (refs are only
> created from getBackupProviders(userId), C348-scoped). But ARCC flags "missing tenant validation in background jobs" as a pitfall: a future ref-creation path
> that doesn't go through getBackupProviders, OR a direct-DB-write threat model, would break the assumption. A hardening cycle could add a co-ownership assertion
> in the worker (photo.userId === providerRow.userId before credential use) — needs the worker to load the photo's userId + the provider's userId, an arch change.

> ~~**C383 — CSV export CERTIFIED CLEAN; #112 found but DESIGN-GATED (escalated); pinned the full export→import round-trip.**~~ — *DONE C383: bug forced (5>3).
> 2-agent fan-out. (A) CSV export→import CERTIFIED CLEAN — every field round-trips (verified firsthand). (B) surfaced #112: CrossVehicleTab colors series via
> `CHART_COLORS[i % 5]` but only 5 --chart-N tokens exist → a 6th vehicle reuses --chart-1 (chart misleading). Reachable (multi-vehicle; #94 fleet=6) but the
> fix is a DESIGN call (extend palette / generate hues / accept) → ESCALATED to Angelo, not self-invented. THE unpinned invariant → pinned: NOTHING drove a
> create→EXPORT→import→re-read asserting EVERY field survives together (NORTH_STAR #1 crown jewel). +1 HTTP guard (import-csv.test.ts): a populated fuel expense
> create→export→WIPE→import → all 10 fields intact. NON-VACUOUS. be validate:local EXIT 0, 1468 pass (+1).*

> ~~**C378 — bug cycle CERTIFIED CLEAN (no new defect); pinned the costPerMile cost/miles-consistency invariant.**~~ — *DONE C378: bug forced (4>3). 2-agent
> fan-out, BOTH "bugs" debunked firsthand (C21/C60): (A) "costPerMile includes untracked charge cost" is BY-DESIGN-CORRECT — numerator+denominator are
> consistent (both span all mileage rows); trackCharging gates the EFFICIENCY display, not cost; the agent's drop-cost-keep-miles "fix" would UNDER-report
> spend. (B) sync-manager "tagsMatch partial-overlap → silent drop" is NOT data loss — a 'duplicate' classification is surfaced to the USER via
> SyncConflictResolver for keep_local/keep_server/merge; conflictType only changes the label, the local is preserved → cosmetic. THE unpinned invariant →
> pinned: vehicle-stats.property.test.ts pins totals/flag-gating/isolation but NOT that costPerMile is the consistent total-energy/total-miles ratio INDEPENDENT
> of the flags (what the agent's "fix" would break). +1 (Property 7): costPerMile == (fuelCost+chargeCost)/20060, IDENTICAL across all 4 flag combos.
> NON-VACUOUS. be validate:local EXIT 0, 1466 pass (+1).*

> ~~**#110 (MED, money/correctness / NORTH_STAR #1 — found+fixed C374 on a lease-metrics bug scout) — calculateLeaseMetrics over-reported the projected
> excess-mileage fee for a lease stored with NO endDate.**~~ — *DONE C374: calculateLeaseMetrics (financing-calculations.ts:430) derived a missing endDate as
> `startDate + termMonths × 30 days`. endDate is NULLABLE (schema.ts:95; FE type endDate?), so a no-end lease hits this — and ×30 runs ~0.4 days short per month
> (36-mo lease ended ~16 days early) → understated daysRemaining → inflated the milesPerDay burn rate → OVER-reported the excess FEE. FIX: addMonthsClamped(
> startDate, termMonths) — calendar months, the helper calculatePayoffDate (:254) already uses. +1 guard (no-endDate 36-mo lease: daysRemaining matches the
> calendar end ±1 AND > 36×30). NON-VACUOUS. fe validate:local EXIT 0, 670 pass (+1). Debunked the paired (B) backupConfig "orphan persists" → the filed #100
> race (not new); noted storageConfig validates the MERGED result while backupConfig validates only INCOMING (hardening inconsistency, not a live bug).*

> ~~**C371 — bug cycle CERTIFIED CLEAN (no new defect); pinned the unpinned multi-tag CSV-import round-trip.**~~ — *DONE C371: bug forced (4>3). 2-agent
> fan-out, BOTH "bugs" debunked firsthand (C21/C60): (A) buildMonthlyConsumption volume-pooling-without-conversion IS the already-filed #94 class (escalated
> C328); (B) "parseTags should reject a tag containing ;/," is by-design-WRONG — the exporter joins tags with '; ' and import splits on /[;,]/, so a delimiter
> is always a separator (and #104/C352 bars a tag from containing ;/, at the write boundary); the proposed reject would break normal multi-tag import. THE
> unpinned reachable invariant → pinned (dormant-vein protocol, no manufacture): the round-trip test imported a `road; trip` cell but only asserted amounts, never
> the tags ARRAY. +1 HTTP guard (import-csv.test.ts): semicolon + quoted-comma multi-tag cells → the correct trimmed arrays. NON-VACUOUS. be validate:local
> EXIT 0, 1461 pass (+1).*

> ~~**#108 (MED, correctness/units / NORTH_STAR #1 — found+fixed C367 on an analytics chart-assembly bug scout; the #56/#18/C97 split-sibling overcount
> class) — buildSeasonalEfficiency inflated a season's fillupCount by N for a single split fuel fillup.**~~ — *DONE C367: buildSeasonalEfficiency
> (analytics-charts.ts:641) did `entry.fillupCount++` UNCONDITIONALLY per row. queryFuelExpenses selects ALL category='fuel' rows with NO volume filter, and a
> split fuel expense creates one sibling per vehicle each with volume=null (createSiblings never sets volume — verified: 0 volume refs in split-service.ts). So
> a single split fillup overcounted the season's fillupCount by N — the exact #56/#18 row-overcount on the seasonal surface (fuel-advanced is public). FIX:
> count only volume-bearing rows (`continue` on volume null/≤0), mirroring computeAverageCosts (#56, :434) + the fuel-stats COUNT (C97). +2 guards (split
> fillup → 1 not 3; zero-volume → 0). NON-VACUOUS. be validate:local EXIT 0, 1459 pass (+2). Debunked the paired (B) photo-sync "retryCount<3 → silent loss":
> bounded retry is by-design + the loss path needs deactivating the primary provider post-failure → the #43/#44 fail-open family, already escalated.*

> ~~**#107 (MED, correctness/data-safety / NORTH_STAR #1 — found+fixed C362 on a reminder-trigger bug scout; the bug #12 family on fast-forward's EXIT
> boundary) — fastForwardPastNow left a bounded reminder ACTIVE when its endDate fell in the period straddling now.**~~ — *DONE C362: the in-loop
> `nextDue > endDate` check (trigger-service.ts:281) runs only at the top of `while (nextDue <= now)`, so the FINAL advance that steps nextDue PAST now and
> exits is never tested against endDate. A bounded reminder lapsed past maxCatchUp (=12) into fastForwardPastNow, whose endDate lands in the straddling period
> (lastStep ≤ endDate < final nextDue), was written FORWARD of its endDate yet left is_active=1 → fires again next trigger. VERIFIED firsthand (C21/C60):
> traced the maxCatchUp→fastForward handoff (:454) + the reachable window. FIX: mirror the in-loop guard once AFTER the loop, before the write — deactivate
> instead of advancing past endDate. +1 HTTP guard (monthly reminder, endDate≈now → exercises ONLY the exit guard; is_active=0 after trigger). NON-VACUOUS
> (RED pre-fix). be validate:local EXIT 0, 1455 pass (+1). Debunked the paired (A) split fan-out: "duplicate vehicleId not rejected → metrics inflated 100%"
> is FALSE (two self-consistent legs sum to the entered total; no double-count) — a validation nicety, not a money bug.*
> ~~NOTE (filed C362, test-quality): insurance-repository.property.test.ts "Property 1" FLAKY — same-endDate tiebreak ambiguity + tight 5s timeout.~~ —
> *RESOLVED C363 (infra): root cause was the test's strict-`>` reference loop disagreeing with the impl's single-key `ORDER BY end_date DESC LIMIT 1` on an
> end_date tie (validTermInputArb's endDate=startMs+gapMs can collide); the spurious failure then shrank 47× against a real DB, blowing the 5s timeout. Fixed
> by asserting the tie-tolerant contract (returned end_date IS the max + the pair is a real created term at that max) + 20s headroom + a deterministic
> same-end/different-start tie test. Stress-verified 6× → 16 pass/0 fail. be validate:local EXIT 0, 1456 pass (+2).*

> ~~**#106 (MED, correctness / NORTH_STAR #2 — found+fixed C358 on a date/timezone-util deep-review; the #87/#39 off-by-one family) — the expense-list
> date-range filter EXCLUDED an expense logged on the chosen END day.**~~ — *DONE C358: filterExpenses did `new Date(expense.date) <= new Date(endDate)`,
> but the DateRangePicker binds a date-only 'YYYY-MM-DD' → `new Date('2024-06-15')`=midnight UTC, so an expense stored that day (noon-local) was excluded
> from a range whose end IS that day. FIX: parse bounds as LOCAL calendar days (localDayStart), end = local-midnight of the day AFTER endDate (exclusive) so
> the whole end day is included. +2 guards (noon-on-end-day included; YYYY-MM-DD closed range includes both boundaries); the 3 existing full-ISO tests still
> pass. NON-VACUOUS. fe validate:local EXIT 0, 661 pass (+2). The paired offline fan-out: #100-family (concurrent-tab) + #79 (stuck queue) re-surfaced (not
> new); the "currency dropped in offlineExpenseToBackend" is a latent #66/#101 sibling but currency is NOT user-settable offline → NOTED, not fixed.*

> ~~**C355 — reminder mark-serviced/re-arm + vehicle-stats cost/period CERTIFIED CLEAN (bug-cycle dormant-vein scout, no defect).**~~ — *DONE C355: bug at
> budget (3=3) → forced. 2-agent fan-out. (A) mark-serviced re-arm CERTIFIED CLEAN (both axes, anchor-to-current-odometer, multi-period-overdue→future,
> ownership-scoped — all comprehensively pinned in mark-serviced.test.ts). The "mark-serviced↔trigger double-advance race" is the #100 un-serialized-write
> architecture family (noted under #100, not separately filed); the "stale unread notification" is product-gated (notification is history). (B) vehicle-stats
> NO new defect — the period-cost-over-all-time-span mixing is the filed #45; clamp/div-guard/single/refund/boundary all clean+pinned. NO reachable atomic
> defect, NO unpinned reachable invariant → certification only (C306/C345/C350 precedent). Docs-only.*

> ~~**#104 (MED, data-safety / NORTH_STAR #1 — found+fixed C352 on a CSV-export deep-review) — a tag containing the CSV delimiter (; or ,) silently
> round-trip-split on export→re-import.**~~ — *DONE C352: export joins tags with '; ' (routes.ts:431), import splits on /[;,]/ (import-csv.ts:169), but
> tags were length-validated only — so a tag like "oil; filter" round-tripped into ["oil","filter"] (silent data loss). FIX: reject ';'/',' in a tag at the
> write boundary via a refine, factored into a shared tagElementSchema (the create base + the update override each had their own tags element — the override
> drops the base .default([]) for the C34 .partial() clobber, so it needed the refine too; the dedup puts the rule in ONE place). +4 HTTP guards
> (create-;/create-,/update-delimiter → 400 + nothing persisted/stored-survives; normal tag = control). NON-VACUOUS. validate:local EXIT 0, 1451 pass (+4).
> The paired EV-math fan-out findings were debunked (averageMilesPerKwh-reads-volume is correct-by-design; costPerMile-pools-hybrid is product-gated) — no fix.*

> ~~**#103 (LOW-MED, reliability / NORTH_STAR #1-adjacent — found+fixed C349 on a provider-credential-CRUD deep-review) — an S3 provider created with an
> incomplete config persisted a broken 201 row that threw on EVERY use.**~~ — *DONE C349: createProviderSchema's `config: z.record(...)` is shape-open, so an
> S3 create missing endpoint/bucket/region (or no config) persisted + auto-populated storageConfig, then every test/sync threw at buildS3Provider:62 — a
> fail-late footgun. FIX: fail-fast in resolveProviderCredentials (reject the incomplete S3 config before encrypt/persist, mirroring the google-drive nonce
> gate + the use-time check; google-photos needs only credentials.refreshToken). +2 HTTP guards (incomplete→400+nothing-persisted, no-config→400) + fixed 2
> existing S3-create test helpers to send valid config. NON-VACUOUS. validate:local EXIT 0, 1446 pass (+2). The paired claims-fan-out finding
> (claim vehicleId not in its termId's coverage junction) is PRODUCT-SEMANTICS-GATED — #84/C247 validated the security props, coverage-consistency is loose
> by design (real insurance is messy) — NOT self-fixed.*

> ~~**C345 — expense read-path (filter/search/pagination) + odometer + sync-worker CERTIFIED CLEAN (bug-cycle dormant-vein scout, no defect).**~~ — *DONE
> C345: bug OVER budget (4>3) → forced. 2-agent fan-out. (A) expense LIST/FILTER/SEARCH/PAGINATION — CERTIFIED CLEAN (cross-tenant scoped, LIKE-escaped #41,
> pagination/hasMore/stable-tiebreak correct, sortBy enum-allowlisted; redundant-clamp + empty-CSV-tag both by-design-safe). (B) both agent "REAL DEFECTs"
> debunked firsthand: backward-odometer-accepted is BY-DESIGN (correction/2nd-vehicle/historical; getCurrentOdometer MAX() can't be corrupted; warn = a
> product feature), and the sync-worker no-active-source ref `return`-without-burning-a-retry is CORRECT resilient behavior (not a failure — marking it
> failed would wrongly exhaust retries) AND already pinned (sync-worker.test.ts:227/:238). NO reachable defect, NO unpinned invariant → certification only
> (C306/C327/C334/C341 precedent; a manufactured test = coverage-theater). Docs-only.*

> ~~**#102 (MED, data-safety / NORTH_STAR #1 — found+fixed C344 on a native-CSV-import deep-review) — an ambiguous "year make model" vehicle name
> silently misattributed every imported row to the last-seen matching car.**~~ — *DONE C344: buildImportPlan built vehicleByName with `set("year make
> model", id)`; two vehicles legally sharing that string (distinct nicknames, no unique constraint) → the 2nd overwrote the 1st → a CSV row using that
> name form attached to the LAST-seen vehicle with no signal. FIX: collision-aware map (a key seen twice → null = AMBIGUOUS) + resolveImportVehicleId
> rejects an ambiguous name with a clear "give them distinct nicknames" per-row error; extracted the resolver (kept parseRow under the complexity cap). +2
> HTTP guards (shared name errors imported:0; a unique nickname still resolves — targeted, not blanket). NON-VACUOUS. validate:local EXIT 0, 1444 pass (+2).*

> ~~**C341 — analytics chart-builders + auth/session/OAuth CERTIFIED CLEAN (bug-cycle dormant-vein scout, no defect; +2 invariant guard).**~~ — *DONE
> C341: bug at budget (3=3) → pick. 2-agent fan-out (analytics-charts last deep C67; auth last C225). Every agent "REAL DEFECT" debunked firsthand:
> buildMonthlyConsumption NaN-key NOT reachable (date .notNull() + `if(!d)continue` + the `if(entry)` guard); buildGasPriceHistory String(epochMs) is a dead
> branch (mode:'timestamp'→Date); unsorted-input is the documented caller-sorts convention (#75); the auth findings are all security-POLICY/PRODUCT calls
> (email_exists/account_conflict enumeration UX, Google email_verified policy — ARCC+Angelo, not a loop fix) or behavior-identical hygiene (maxAge==config).
> NO reachable atomic defect → certification (C306/C327/C334 precedent). +2 non-theater guard pinning buildMonthlyConsumption's `if(entry)` invariant (the
> efficiency loop only AUGMENTS volume-created months, never creates a phantom one). NON-VACUOUS. validate:local EXIT 0, 1442 pass (+2).*

> ~~**#101 (MED, data-safety / NORTH_STAR #1+#2 — found+fixed C339 on a deep-review of the offline-sync path; same family as #66) — an offline fuel
> fill-up logged with "missed previous fill-up" checked silently DROPS the flag on sync.**~~ — *DONE C339: OfflineExpense had no `missedFillup` field,
> offlineExpenseToBackend didn't map it, and both ExpenseForm addOfflineExpense call sites (:579/:621) omitted it — while the form collects it (:1230) and
> the ONLINE create path sends it (:517). So a missed offline fill-up synced as a NORMAL one → calculateAverageMpg pairs it across the unlogged gap →
> inflated/garbage MPG. FIX (4 edits): added missedFillup? to OfflineExpense + mapped it in offlineExpenseToBackend (the C205 single-source boundary) +
> carried it at both form sites. GUARD: +1 round-trip test (true AND false survive) in offline-storage.test.ts, the #66 sibling. NON-VACUOUS. frontend
> validate:local EXIT 0, 647 pass.*

> ~~**C338 — vehicle write-path CERTIFIED CLEAN; settings lost-update race FILED+ESCALATED (#100, architecture-gated).**~~ — *DONE C338: bug OVER
> budget (4>3) → forced. 2-agent fan-out (vehicle write-path + settings/sync-state). (A) vehicle routes/repo/photo-routes — NO defect: clear-field
> null-vs-undefined correct (.nullish()), cross-tenant scoped, plate-uniqueness per-tenant (#80 follow-through correct), cover-photo entityId-gated;
> the one flag (photo ops check entityId not userId) is a defense-in-depth gap MASKED by the entityId check (guarded), and unitPreferences-retroactivity
> is the filed #85 class. (B) settings — found a REAL but ARCHITECTURE-GATED defect: userPreferences writes are un-serialized read-modify-write (PUT
> /settings + 5 sites) → lost-update race under concurrent edits (#100). VERIFIED firsthand. NOT a clean one-cycle fix (needs optimistic-version+migration
> / transactional-merge vs the C151 async-tx footgun / serial queue) → FILED + ESCALATED, no manufactured test (a timing test would be flaky; #82 pins the
> sequential merge). Docs-only cycle (file+escalate+cert), no source touched — the C337 gate is the last code state.*

> ~~**C334 — insurance write path + unit-conversion/import-mapping CERTIFIED CLEAN (bug-cycle dormant-vein scout, no defect; +2 guard).**~~ — *DONE
> C334: bug OVER budget (4 > 3) → forced. 2-agent fan-out on un-recently-audited surfaces. (A) insurance routes/repo/validation/hooks/claims — every
> agent "finding" a FALSE ALARM (term-update replaces the WHOLE split group; empty-coverage Zod-rejected; cross-policy termId guarded C247; premium
> cross-tenant gated in addTerm) or PRODUCT-GATED (claim payout > coverageLimit — legitimately real, a product call). (B) unit conversions sound +
> property-tested (round-trip invertible, mpg↔L/100km inverse, no div-by-zero); import-mapping clean (date echo-check, non-finite→row-error, unmapped
> surfaced). applyMapping's `target={}` default VERIFIED NOT a bug (sole caller returns {} or both-units; {} = documented don't-guess pass-through). NO
> atomic defect → certification (C306/C327 precedent). +2 non-theater guard: mapMileage/mapVolume guard each field's conversion on its OWN `from && to`, so
> a PARTIAL target would convert one axis + pass the other through in the same row (NORTH_STAR #2) — pinned both partials. NON-VACUOUS. validate:local EXIT
> 0, 1440 pass (+2).*

> ~~**#99 (MED, correctness / NORTH_STAR #2 — found+fixed C330 on a forced bug-cycle financing-math scout; sibling of #90/#91/#92) — financing
> date projections shifted a payment/payoff/lease-end date into the WRONG month for any 29th–31st contract.**~~ — *DONE C330: THREE sites in
> financing-calculations.ts advanced months via bare `Date.setMonth(getMonth()+n)`, which rolls a day-of-month overflow into the FOLLOWING month
> (Aug 31 + 1mo → Oct 1 not Sep 30; May 31 + termMonths → the month after the intended lease end): calculatePaymentDate (amortization-schedule +
> extra-payment payoff dates), calculateNextPaymentDate (the NextPaymentCard "due" date), calculatePayoffDate (lease end = start + termMonths). The
> correct clamp already lived inline in calculatePayoffDateFromStart (detect the rolled day → setDate(0) to the target month's last day) but wasn't
> shared. FIX (atomic + arch-clean): extracted ONE `addMonthsClamped(date, months)` helper (single source of truth) + routed all three through it; the
> iterative next-payment loop anchors on baseDate + re-derives (base + N months) each step so the day can't "stick" lower after a short month. GUARD:
> rewrote next-payment-date.test.ts's month-end block (it had CHARACTERIZED the buggy rollover → now asserts the clamp) + new
> financing-month-overflow-clamp.test.ts (+5, the lease-end clamp had ZERO prior coverage). NON-VACUOUS. frontend validate:local EXIT 0, 627 pass (+5
> net). Pure-util fix; the .svelte consumers render the corrected dates (visual eyes-on, the VALUE pinned).*

> ~~**C327 — photos upload/serve/delete + provider sync-worker CERTIFIED CLEAN (bug-cycle dormant-vein scout, no defect).**~~ — *DONE C327:
> audited two NORTH_STAR #1 surfaces firsthand. Upload: ownership + mime-allowlist + size + capability gate + #34 atomicity compensation.
> Serve: ownership + entityType/entityId match + nosniff (C133/#77). Sync-worker: shouldSkipDueToBackoff (30*2^retryCount) + failure→failed+
> retryCount++ (self-throttles via backoff; surfacing a perma-failed ref is a #79-class product call). Coverage already comprehensive
> (sync-worker backoff boundaries + success/failure status, photo-serve-headers). No defect, no unpinned invariant — certification only
> (C306/C323 precedent). No code change.*

> ~~**#96 (LOW, robustness — found+fixed C315 on a forced bug-cycle middleware scout) — idempotency middleware would turn a non-JSON 2xx
> response into a 500.**~~ — *DONE C315: after next(), idempotency.ts did `await c.res.clone().json()` UNCONDITIONALLY to cache the body —
> a 2xx NON-JSON body (CSV/binary/204) makes .json() throw, escaping the middleware → errorHandler → 500 on a successful response. Latent
> today (all 3 idempotency-mounted sync routes return c.json) but a footgun for any future non-JSON idempotent route. FIX: gate on 2xx FIRST,
> then try/catch the parse — a non-JSON 2xx is left uncached (dup safely re-runs). GUARD: +1 test (2xx CSV → 200 not 500, not cached);
> non-vacuous (pre-fix throws → 500). validate:local EXIT 0, 1431 pass (+1).*

> ~~**#95 (LOW, UX-correctness — found+fixed C308 on a forced bug-cycle FE scout) — settings store cleared a stale `error` on only 2 of
> 9 async ops → a succeeded retry kept showing a phantom error.**~~ — *DONE C308: load()/update() reset error on entry, but the other 7
> async ops (downloadBackup/uploadBackup/executeSync/listBackupsFromProvider/listAllBackups/restoreFromProvider/loadRestoreProviders) did
> not, so a failure left a stale error that a later succeeding op never cleared. Masked today (settings/+page.svelte gates loadError on
> `&& !settings` = initial-load only) but a latent footgun for any future ungated consumer. FIX: `error = null` on entry to all seven.
> GUARD: settings-error-clearing.test.ts (+3, the store's first test) — succeeded retry clears, failing op still sets; non-vacuous
> (reverting one → RED). fe validate:local EXIT 0, 613 pass (+3).*

> ~~**#93 (MED, data-safety / NORTH_STAR #1 — found+fixed C300 on a sync/restore deep-review) — merge-mode restore threw a raw PK
> violation on the always-present userPreferences/syncState collision instead of a clean conflict.**~~ — *DONE C300: detectConflicts
> (restore.ts) probed only 6 tables but insertBackupData inserts 15 — incl. userPreferences + syncState (PK = userId). The importer
> ALWAYS has a prefs row (getOrCreate) and a backup ALWAYS carries one, so a merge whose 6 probed tables didn't collide slipped past
> detection into insert(userPreferences) against the existing PK → `UNIQUE constraint failed: user_preferences.user_id`, an unhandled
> throw rolling back the whole restore. The existing tenant-scope test masked it (its merge backups also self-collided on a vehicle,
> short-circuiting first). FIX: probe userPreferences + syncState like any owned table (scope eq(userId); conflict id = userId);
> generalized the probe loop with per-entry idColumn/idField. GUARD: restore-merge-prefs-collision.test.ts isolates the case (export
> → delete vehicle → only prefs collides → merge); RED before (raw UNIQUE throw), GREEN after (clean conflict). validate:local EXIT 0,
> 1418 pass (+1).*

> ~~**#92 (MED, correctness / NORTH_STAR #2 — found+fixed C297 on a forced bug cycle) — calculateExtraPaymentImpact treated every
> 0%-APR loan as inert → "0 mos saved" in the payment planner for an interest-free loan an extra payment clearly shortens.**~~ — *DONE
> C297: the early guard `financingType !== 'loan' || !financing.apr || financing.apr <= 0` (financing-calculations.ts) lumped every
> 0%-APR (or no-APR-entered) loan in with leases/own and returned a flat {monthsSaved:0, interestSaved:0}. A 0% loan is interest-free
> but NOT inert — extra payments retire principal faster, shortening the term. PaymentPlannerDialog.svelte:153 renders monthsSaved
> ("{n} mos"), so a common 0% dealer-financing loan wrongly showed "0 mos". FIX: bail early only for NON-loans; let 0%-APR loans run
> the amortization loop (which already handles rate 0 → full payment to principal) with monthlyRate 0. GUARD: extra-payment-zero-apr.test.ts
> (+4) — $12k @ 0% / $500/mo + $500 extra → exactly 12 months saved, $0 interestSaved; monotonic; positive-APR unaffected; lease inert.
> NON-VACUOUS (old guard → RED). frontend validate:local EXIT 0, 610 pass (+4).*

> ~~**#91 (MED, correctness / NORTH_STAR #2 — found+fixed C295 on a financing/analytics money-math deep-review; sibling to #64) —
> lease-overage projection compared an ABSOLUTE odometer against a DRIVEN-miles budget → phantom excess fee on any used-car lease.**~~
> — *DONE C295: in `calculateLeaseMetrics` (financing-calculations.ts), `totalMileageAllowance`/`mileageUsed`/`mileageRemaining` all
> live in driven-miles space (current − initial), but `projectedFinalMileage` is an ABSOLUTE odometer reading; the excess compared
> the absolute reading DIRECTLY against the driven budget → over-reported projectedExcessMiles + the $ fee by exactly `initialMileage`.
> A 40k-mi car leased + driven on-pace showed a ~$10k phantom fee at $0.25/mi. #64 (C198) fixed the allowance SCALING but left this
> coordinate-space mismatch. FIX: project DRIVEN miles (projectedFinalMileage − initialMileage) before comparing to the budget. GUARD:
> +1 lease-metrics test (40k-initial / 52k-current on-pace → exactly $0 excess; pre-fix $10k → non-vacuous). Fields not rendered yet
> (latent contract) → pure-logic util, no UI moved. frontend validate:local EXIT 0, 605 pass (+1).*

> ~~**#90 (MED, correctness / NORTH_STAR #2 — found+fixed C293 scouting the financing module on a forced bug cycle; the sibling to
> C240) — create-or-replace financing leaves STALE cross-type fields when a vehicle's financing TYPE changes.**~~ — *DONE C293:
> `POST /vehicles/:id/financing` REUSES the existing row via `update(...financingData, isActive:true, endDate:null)` (routes.ts:156,
> "the vehicle's financing is now THIS"), but `update()` SKIPS `undefined` keys and the cross-type fields are all `.optional()` —
> loan-only `apr`, lease-only `residualValue`/`mileageLimit`/`excessMileageFee`, schedule `paymentDayOfMonth`/`paymentDayOfWeek`. So
> switching lease↔loan without re-sending the prior type's fields left them stale → a `financingType:'loan'` row carrying a lease
> `mileageLimit`, consumed by FE lease-metrics (financing-calculations.ts:419-433) + the Sheets export (all 3 lease columns) →
> self-contradictory data. FIX: coalesce every optional cross-type/schedule field to `null` in the replace path so the reused row
> mirrors a fresh `create()` (absent nullable columns → NULL). GUARD: refinance-cross-type-field-reset.test.ts drives the REAL POST
> over createTestApp in both directions; RED before (18000/6.5 lingered), GREEN after. validate:local EXIT 0, 1415 pass (+2).*

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
- **#22 (MED, hardening — ESCALATED to Angelo C196, approach-gated) — zip-bomb guard trusts the attacker-declared `header.size`.**
  `backup.ts:469` sums `e.header?.size` from the ZIP central directory (attacker-controlled) and checks it before `getData()`. A
  forged archive can declare a small size while the deflate stream inflates large. The 50MB COMPRESSED bodyLimit (routes.ts:209) is
  the real backstop on the UPLOAD path — but the provider DOWNLOAD path has no such cap. VERIFIED C108 + re-assessed firsthand C196:
  AdmZip `getData()` inflates the whole entry in-memory synchronously, so a post-inflation length check is TOO LATE (the OOM already
  happened) → NOT a clean single-cycle fix. ESCALATED C196 — direction call: (1) compression-ratio cap pre-inflation (cheap, no dep),
  (2) streaming/bounded-inflation lib (real protection, bigger), or (3) add the compressed bodyLimit to the download path + treat as
  won't-fix. Also unresolved without AdmZip-internals spelunking: whether it already cross-checks header.size vs the inflated length
  (which would partly defeat the attack). Awaiting Angelo's approach pick; not loop-decidable.
- ~~**Mileage Findings A/B (→ #71, MED → delayed-fire only, NOT lost) — no IMMEDIATE recheck on PUT-update.**~~ — *DONE C214: editing an
  expense's mileage (expenses/routes.ts PUT /:id) or a manual odometer entry (odometer/routes.ts PUT /:id) to push a vehicle past a milestone
  did NOT call `recheckMileageReminders` (recheck was wired only on CREATE) → the crossed reminder fired only on the next /trigger/login, so the
  D5 "fires the moment crossed" guarantee silently didn't hold for EDITS. VERIFIED firsthand (create :573/:131 recheck; both PUTs did not). FIX
  (mirror the create-path best-effort recheck, never-throws/idempotent): expense PUT → recheck on the UPDATED vehicleId when mileage != null
  (also handles a vehicle-reassign edit); odometer PUT → unconditional recheck. +2 HTTP tests (edit odometer/expense mileage up across a
  milestone fires); NON-VACUOUS (RED with the fix reverted, the 5 create-path tests stayed green). green→green backend validate:local EXIT 0,
  1291 pass (+2). (The 5 hunted mileage defect classes — double-fire, boundary, cross-vehicle, stale, throw — were CERTIFIED CLEAN at C108.)*
- ~~**#72 (LOW, defense-in-depth — found C215 via a deep-review of the photos list/pagination path) — `findByEntityPaginated` was the lone
  photo read-method NOT userId-scoped.**~~ — *DONE C215: it filtered `(entityType, entityId)` ALONE on both count + data legs, even though
  photos carries user_id + every sibling (findByUser/countByUser/findIdsByUser) scopes it (the C168/#48 + C180 + C192 tenant-scope-at-the-read
  class). NOT a live leak (the route's validateEntityOwnership — an exhaustive switch with a throwing default — proves ownership before the
  query), but a latent boundary; directly fixable here (photos HAS a userId column, unlike financing's no-column case at C206). FIX: threaded a
  userId param + ANDed `eq(photos.userId, userId)` into the shared whereClause + threaded userId through the one caller (listPhotosForEntity).
  +2 tests (the cross-tenant case — two users' photos on the SAME entityType+entityId, raw-seeded, foreign excluded from count & data; + an
  owner over-filter control); NON-VACUOUS (RED with the scope reverted). green→green backend validate:local EXIT 0, 1293 pass (+2). The rest of
  the photos list/serve/delete path CERTIFIED CLEAN (ownership gated, batch userId-scoped, nosniff/CORP headers correct).*
- ~~**#73 (MED, UX-breaking — found C218 via a fresh hunt of the reminders WRITE-path validation) — a split-config-only reminder UPDATE
  (omitting vehicleIds) falsely 400'd.**~~ — *DONE C218: `refineSplitConfig` (validation.ts:133) compares the split's vehicle IDs against
  `data.vehicleIds`, but `updateReminderSchema` is `.partial()` + FE `reminderApi.update` takes vehicleIds OPTIONAL — so a PUT changing ONLY
  the split config (omitting vehicleIds) → `data.vehicleIds` undefined → `new Set(undefined)`=∅ → the match check (0 vs N) ALWAYS failed →
  `zValidator(updateReminderSchema)` (runs BEFORE the handler's merged re-parse) 400'd every legitimate split-config-only edit. VERIFIED
  firsthand. FIX (mirror the other refiners' presence-guards): wrap the MATCH check in `if (data.vehicleIds)` — a cross-field invariant
  meaningful only when both present; the route's merged `createReminderSchema.parse(merged)` still catches a genuine mismatch against the full
  object. The percentage/absolute SUM checks (vehicleIds-independent) stay unconditional. +4 tests (the #73 regression accepted; sum-check still
  fires without vehicleIds; both-sent mismatch still fails; both-sent match accepted); NON-VACUOUS (RED with the guard reverted). green→green
  backend validate:local EXIT 0, 1300 pass (+4).*
- ~~**#74 (MED, data-safety / NORTH_STAR #1 — found C220 via a deep-review of changeTracker wiring completeness) — the photos route was the LONE
  mutating module missing `changeTracker`, so a photo-only change didn't re-trigger the next auto-backup.**~~ — *DONE C220: of 12 route modules,
  changeTracker is on 8; the 4 without are analytics (read-only ✓), auth (sessions ✓), sync (the backup itself, circular ✓) — and PHOTOS, which
  has POST upload + DELETE. VERIFIED end-to-end: photos + photo_refs ARE in the backup payload (backup.ts:368/414), and the orchestrator SKIPS
  when !hasChangesSinceLastSync (backup-orchestrator.ts:70-76) → a photo-only change between backups never bumped lastDataChangeDate → silently
  excluded from the next auto-backup until some OTHER tracked mutation bumped it (the #42 silent-backup-gap class). FIX: added `routes.use('*',
  changeTracker)` to photos/routes.ts (mirrors the 8 siblings; fire-and-forget after 2xx → no response-behavior change, photos-http suite green).
  GUARD: +3 source-scan (photo-change-tracker.test.ts — the C133 photo-serve-headers precedent, since a full upload/delete needs a real storage
  provider; pins import + routes.use + the mutating endpoints); NON-VACUOUS (RED with the routes.use removed). green→green backend validate:local
  EXIT 0, 1303 pass (+3). changeTracker itself CERTIFIED CLEAN (2xx-gate, mutating-method filter).*
- ~~**#75 (LOW, defensive-correctness — found C222 hunting the vehicle-stats math) — `calculateAverageMpg` silently depended on caller
  date-ordering.**~~ — *DONE C222: it pairs CONSECUTIVE fillups (current − previous) for per-segment distance, correct ONLY on chronological
  input, but neither sorted nor documented that (the C168/#48 "helper trusts the caller" class, applied to math). The sole production caller
  (vehicles/routes.ts:348) DOES sort → no LIVE bug today, but a future consumer of this pure util would get silently-WRONG MPG (out-of-order
  segments mis-paired). FIX (behavior-preserving — sorting an already-sorted copy is idempotent; closes the class): sort `[...unorderedExpenses]`
  by date inside calculateAverageMpg. +3 tests (chronological avg=31; SHUFFLED + reversed yield the SAME 31); NON-VACUOUS (RED with the sort
  reverted). green→green 1309 pass (+3). (calculateMileageStats uses Math.max — order-independent, untouched.)*
- ~~**#76 (LOW, data-hygiene — found C226 hunting the expense-form category switch) — switching an expense away from `fuel` left stale
  volume/charge/fuelType/mileage in form-state, riding onto a non-fuel row.**~~ — *DONE C226: ExpenseForm's `selectCategory` reset the
  financing source on switch-away-from-financial but NOT the fuel fields on switch-away-from-fuel — the inputs hide (showFuelFields) but
  formData values PERSIST + ride along on submit. Inert in analytics (every fuel query filters category='fuel' — a stray volume on a misc row is
  never read), BUT a real hygiene leak + a stray `mileage` feeds getCurrentOdometer cross-category (no category filter). VERIFIED UI-reachable.
  FIX (decision-free, mirrors the existing financing-reset idiom in the same handler): clear volume/charge/fuelType/mileage/missedFillup when
  categoryValue !== 'fuel'. +1 source-scan guard (the C133/C220 precedent — selectCategory is Svelte component state, not unit-testable without
  mount; pins the clear-block); NON-VACUOUS (RED with the block reverted). green→green FE 585 pass (+1). CAVEAT: the full
  select→clear→submit round-trip is eyes-on/Playwright-blocked → code-complete/source-pinned/eyes-on-pending. ALSO certified clean this cycle:
  the insurance-CLAIM write path (ownership-gated, writes id+policyId-scoped [C155 clean], findOwnerUserId is the correct owner-resolver).*
  **BACKEND HALF DONE C244:** the FE clear was client-side only — the backend wrote POST/PUT verbatim, so a direct API caller (or stale client)
  could persist a non-fuel row with stray volume/fuelType/missedFillup + a `mileage` that poisons getCurrentOdometer cross-category. Added pure
  `clearFuelFieldsIfNotFuel` (nulls the 4 backend fuel columns when category is non-fuel) on both POST + PUT; +3 HTTP tests (read-back via
  ctx.sqlite), NON-VACUOUS. Server-side enforcement now mirrors the FE C226 semantics. green→green 1350 pass (+3).
- ~~**#78 (MED, write-scope + DI + atomicity — found C229 scouting the photo write-paths) — `PhotoRepository.setCoverPhoto`: id-alone second UPDATE,
  getDb()-singleton-bound (untestable), and an unset-then-throw that couldn't roll back.**~~ — *DONE C229: the method's first UPDATE unset covers
  scoped by (entityType,entityId) but the second (set-cover) UPDATE keyed on `photoId` ALONE (the C63/#192 + C72/#215 class — a foreign-entity id
  would clear the named entity's cover AND flag the foreign photo, entity left cover-less). It ALSO used the module-level `transaction()` helper
  (binds the getDb() singleton, ignores `this.db` — the lone repo method that did) so it was untestable via a constructed repo → the 2 photo
  "property" tests only drive a reference model, never the real method (the C181 coverage-theater pattern). FIX (one coherent change): VALIDATE the
  (id,entityType,entityId) match BEFORE any write (the C151 bun:sqlite async-txn footgun means a throw after the unset wouldn't roll it back, so
  validate-first is what actually guarantees no-mutation on a bad id), switch to `this.db.transaction` (DI-consistent with expenses/insurance;
  404 propagates instead of a wrapped 500; production this.db===getDb() so behavior-preserving). +3 direct-repo tests over a migrated in-memory DB
  (set-cover-entity-scope.test.ts — closes the coverage-theater gap). NON-VACUOUS (foreign-entity + unknown-id RED pre-fix). green→green 1319 pass (+3).*
- **#112 (LOW, UI-legibility / NORTH_STAR #2-adjacent — found C383 bug scout; ESCALATED to Angelo C383, DESIGN-gated) — cross-vehicle analytics charts
  reuse a color on a fleet of ≥6 vehicles.** CrossVehicleTab (fuel-efficiency comparison) assigns each series a color via `CHART_COLORS[i % CHART_COLORS.length]`,
  but the design system defines exactly 5 `--chart-N` tokens (app.css) → a 6th vehicle reuses `--chart-1`, identical to vehicle 1, so two lines share a color and
  the chart can't distinguish them. VERIFIED firsthand: reachable (VROOM is explicitly multi-vehicle/household; #94's fleet has 6 members). The modulo IS the
  correct way to cycle a BOUNDED palette — the real fix is a DESIGN call, so escalated rather than self-inventing hues. DECISION (send_message'd Angelo): (a)
  extend the palette with designer-chosen a11y-contrast-safe `--chart-6/7/8…` tokens, (b) generate distinct hues programmatically (HSL rotation) for N>5 series,
  or (c) accept as a known limitation (most households ≤5 vehicles). Not loop-decidable — awaiting Angelo. Lower priority than the standing escalations.
- **#79 (LOW, data-hygiene / NORTH_STAR #1-adjacent — found C231 deep-review; ESCALATED to Angelo C231, product-gated) — a malformed fuel offline
  entry is stuck in the outbox FOREVER.** `syncOfflineExpenses` (offline-storage.ts:177-187) `continue`-skips a fuel entry missing volume/charge or
  mileage → it's never `markExpenseAsSynced`'d → the trailing `clearSyncedExpenses()` (drops only synced===true) leaves it PENDING, silently
  re-skipped on every future sync with no user signal (a user write that never lands + no notification). VERIFIED firsthand + pinned by a
  characterization test (C231 — the existing malformed-fuel test only asserted "not POSTed", never the entry's fate). DECISION (send_message'd
  Angelo): (a) drop it + toast "couldn't sync N entries", (b) move to a surfaced "failed/needs-attention" bucket, or (c) leave-as-is IF the
  ExpenseForm already blocks queuing an invalid fuel entry offline (worth confirming). Not loop-decidable — awaiting Angelo. (Both audited surfaces
  this cycle — split-service allocation math + offline-outbox idempotency — were CERTIFIED CLEAN.)
- **#88 (MED, data-integrity / NORTH_STAR #1 — found C288 bug scout; ESCALATED to Angelo C288, product-gated) — a SPLIT recurring-expense reminder
  naming a DELETED vehicle leaves a partial/inconsistent group every trigger.** `reminder.expenseSplitConfig` is a JSON blob (NOT a FK); the
  `reminder_vehicles` junction IS FK-cascade-cleaned on a vehicle delete, but the config isn't → the deleted vehicle's id persists in it. On the next
  trigger, `createSiblings` inserts siblings one-by-one; the deleted vehicle's leg FK-violates `expenses.vehicle_id`. SHARPER: a throw escaping the async
  tx callback after the prior sync insert does NOT roll back (the C151 better-sqlite3 footgun) → the surviving vehicle's leg PERSISTS as a partial group
  (groupTotal=$100, one $50 leg) while the deleted leg never lands — repeating every trigger, no user signal. Per-reminder try/catch contains it (recorded
  `skipped`, run stays 200). VERIFIED + pinned by a characterization test (C288, trigger-expense.test.ts: deleted vehicle never gets a leg, reminder
  reported skipped, independent reminders still fire, run 200). DECISION (send_message'd Angelo): on vehicle-delete (a) drop it from the config +
  re-normalize the remaining percentages, (b) convert to single-vehicle if one remains, (c) deactivate the reminder + notify, or (d) other. Not
  loop-decidable — awaiting Angelo.
- **#98 (MED, data-safety / NORTH_STAR #1 — found C324 bug scout; ESCALATED to Angelo C324, product/arch-gated) — sync-manager keep_local
  "overwrite" is a silent no-op on a genuine clientId collision, dropping the user's local edit.** resolveConflict's keep_local (and
  merge→keep_local) POSTs the local expense to the CREATE endpoint with `{ ...backendExpense, clientId, forceOverwrite: true }`. The backend
  NEVER handles forceOverwrite (Zod strips unknown keys) + createIdempotent dedups on (userId, clientId). On a real clientId collision the
  create returns the existing row UNCHANGED → the local edit is NOT applied, yet the FE markExpenseAsSynced + returns true (silent loss). Works
  by accident only when the fuzzy pre-check (checkForExistingExpense) flags DISTINCT rows whose clientId is new. The FE code/comment/test all
  imply an overwrite that doesn't exist. Tangled with the C223-pinned fuzzy conflict-detection design. VERIFIED + characterization-pinned
  (C324, sync-manager.test.ts: keep_local POSTs to /api/v1/expenses (create) with the local clientId, not a dedicated overwrite/PUT) + a
  warning comment on resolveConflict. DECISION (send_message'd Angelo): (a) real upsert / PUT-on-collision server path, (b) drop the fuzzy
  pre-check + conflict UI, trust clientId idempotency (keep_local = plain idempotent POST), or (c) at minimum detect the no-op + surface it
  instead of falsely reporting success. Not loop-decidable — awaiting Angelo.
- **#97 (LOW-MED, data-hygiene / NORTH_STAR #1-adjacent — found C318 bug scout; ESCALATED to Angelo C318, product-gated; same family as #88) —
  a reminder linked to ONLY the deleted vehicle is left vehicle-less but still active, silently never firing.** `reminder_vehicles.vehicleId`
  is onDelete:'cascade', so deleting a vehicle drops its junction row. A single-vehicle reminder then has ZERO vehicles: the row survives +
  stays is_active, but `processReminder` skips it every trigger with reason 'no_vehicles' — a never-firing orphan still shown active, no user
  signal. (Multi-vehicle reminders keep their remaining vehicles — unaffected.) Distinct from #88 (split-config blob) but the same "reminder
  orphaned on vehicle delete" family. VERIFIED + pinned by a characterization test (C318, vehicle-delete-cascade.test.ts: junction 0, reminder
  is_active=1, trigger skips no_vehicles). DECISION (send_message'd Angelo): on vehicle-delete, for any reminder left with zero vehicles —
  (a) deactivate it (+ notify), (b) delete it outright (can never fire), (c) surface it in a "needs attention / no vehicle" UI bucket, or
  (d) block deleting a vehicle that's the sole target of an active reminder. Not loop-decidable — awaiting Angelo.
- **#100 (MED→arch-gated, data-safety / NORTH_STAR #1 — found C338 bug scout; ESCALATED to Angelo C338, architecture-gated) — userPreferences
  writes are un-serialized read-modify-write → a lost-update race can silently drop a sibling config under concurrent edits.** `PUT /settings`
  (settings/routes.ts:255-292) does getOrCreate → JS-spread merge (mergeUnitPreferences / mergeStorageConfig / mergeBackupConfig) → update, with NO
  transaction / lock / optimistic version. The same read-merge-write on userPreferences repeats at 5+ sites (provider create routes.ts:340/:524,
  cleanupStorageConfig:419, cleanupBackupConfig:448). So two near-simultaneous writes that each read the same base row clobber each other on write
  (last-writer-wins): e.g. a provider-DELETE (cleanupBackupConfig) racing a settings PUT, or two settings PUTs naming different backup providers →
  one provider's settings silently lost. The #82/C237 per-provider MERGE fixed the wholesale-wipe WITHIN one request, but can't help across two
  interleaved requests. VERIFIED firsthand (C21/C60): the read-modify-write is genuinely un-serialized. SEVERITY tempered by deployment: VROOM is a
  self-host single-user/household PWA, so the concurrent-same-user window is narrow (double-submit across two devices) — but it IS a NORTH_STAR #1
  silent-loss class. NOT a clean one-cycle fix: the remedies are all bigger than an atomic edit + cross-cutting — (a) optimistic-version column +
  migration + stale-write reject, (b) wrap each read-merge-write in a transaction with BEGIN IMMEDIATE semantics (Drizzle/bun:sqlite doesn't cleanly
  expose this + the C151 async-tx footgun bites: the merge awaits validateStorageConfig/validateBackupConfig DB reads), or (c) a per-user serial
  queue. NO characterization test added — a timing-dependent concurrency test would be flaky (worse than none); the #82 sequential-merge test already
  pins the within-request merge. DECISION (send_message'd Angelo): which concurrency model — optimistic-version / transactional-merge / accept-the-risk
  (document as a single-user-deployment non-issue). Not loop-decidable — awaiting Angelo. **C355 ADDENDUM (same family):** reminder mark-serviced
  (reminders/routes.ts markServiced) is ALSO an un-serialized read-modify-write — its UPDATE is scoped (id, userId) with NO CAS, while the auto-trigger
  advance uses advanceNextDueDateTx with a CAS on nextDueDate. A mark-serviced racing an in-flight trigger advance could double-advance / clobber a re-arm.
  Same architecture-gated remedy as #100 (whichever concurrency model is chosen should cover both); folded in here, not separately filed.
- **#94 (MED, correctness / NORTH_STAR #2 — found C301 bug scout; BROADENED to a CLASS C328 deep-review; ESCALATED to Angelo C301+C328,
  semantics-gated) — the fleet-wide analytics SUMMARY + fuel-advanced paths pool UNIT-BEARING quantities across vehicles WITHOUT per-vehicle
  conversion.** `GET /analytics/fuel-stats` (no vehicleId, the DEFAULT summary path, analytics-api.ts:146), `GET /analytics/summary`, and
  `GET /analytics/fuel-advanced` aggregate across ALL vehicles. Vehicles carry PER-VEHICLE `unitPreferences` (vehicles.unit_preferences), and
  distance/volume are STORED in each vehicle's native unit — PROVEN firsthand C328 by the correct contrast `getCrossVehicle` (repository.ts:
  1500/1531-1532: threads vehicleUnitsMap+userUnits, `skipConversion = allVehiclesMatchUnits`, `convertDistance(...)` per vehicle BEFORE
  pooling). The summary builders receive NO units. CLASS MEMBERS (all verified firsthand vs source C328, same no-conversion mechanism):
  (1) `distance.totalDistance` + `averageCost.best/worstCostPerDistance` (buildFuelStatsFromData :1383-1409 / :1375 — the original #94, C301);
  (2) `volume.currentYear/Month` + `fillupDetails` avg/min/max (gal+L, same fn :1357-1372 — pinned C328); (3) `buildMonthlyConsumption`
  volume + efficiency (:314-352); (4) `buildSeasonalEfficiency` mi/gal+km/L (:608-655); (5) `buildVehicleRadar` efficiency + distance
  normalizeScore over mixed units (:709-784); (6) `buildDayOfWeekPatterns` volume (:787-812) — (3)-(6) via getSummary/getFuelAdvanced →
  buildFuelAdvancedFromData, also units-less. So a mixed mi+km / gal+L fleet shows a garbage pooled distance/volume + blended $/mi-vs-$/km on
  the headline view. The per-vehicle CHARTS (computeConvertedTotalDistance) + getCrossVehicle already convert; only these summary/advanced
  builders don't. Distinct from #45 (period-scoping). VERIFIED + pinned by characterization tests (distance C301 + volume C328 in
  fuel-stats-fleet-distance-pooling.test.ts — raw-sum proof shape). NOTE the C328 fan-out ALSO certified per-vehicle `calculateVehicleStats`
  CLEAN (every ratio div-guarded, comprehensively property-tested) — the defect is purely cross-vehicle pooling. DECISION (send_message'd
  Angelo, broadened C328): the fix is now ONE coherent change across all 6 members — (a) thread vehicleUnitsMap+userUnits into the summary +
  fuel-advanced builders and convert each vehicle to the user-global unit before pooling (mirror getCrossVehicle / the per-vehicle chart path),
  (b) emit fleet scalars only when all vehicles share a unit else per-vehicle, or (c) require vehicleId for unit-bearing scalars. Not
  loop-decidable — awaiting Angelo.
- ~~**#80 (MED, tenant-isolation + info-leak — found C233 hunting the vehicles write-path) — license-plate uniqueness was enforced GLOBALLY across
  all tenants.**~~ — *DONE C233: `findByLicensePlate(plate)` queried `WHERE license_plate = ?` with NO userId, backing the plate-uniqueness check on
  BOTH create + update → a user adding a plate ANOTHER tenant owns got a cross-tenant FALSE 409 (two users may legitimately share a plate:
  reissued/sold-then-rebought) AND the 409 was an enumeration oracle (probe any plate system-wide). KEY: a TWO-LAYER defect — migration 0000's
  `vehicles_license_plate_idx` is also a GLOBAL unique index, so the route fix alone turned the collision from a 409 into a 500. FIX: (1) userId
  param on findByLicensePlate + threaded through both routes; (2) migration 0005 (low-risk index swap, no data rebuild) DROP the global index +
  CREATE composite `(user_id, license_plate)` partial unique; journal idx 5 + schema.ts updated (was absent there — fixed drift too). +3 HTTP tests
  (cross-tenant CREATE→201, same-user dup→409, cross-tenant UPDATE→200); NON-VACUOUS (both cross-tenant cases RED pre-fix: 409 then 500). green→green
  1322 pass (+3).*
- ~~**#81 (MED, reliability / NORTH_STAR #1-adjacent — found C235 deep-review of the analytics read-path) — `Math.max(...arr)` argument-spread
  crash-class.**~~ — *DONE C235: `Math.max(...mileages)` / `Math.min(...arr)` spreads each element as a function arg → a heavy logger's UNBOUNDED
  analytics arrays (queryFuelExpenses/queryAllExpenses have no LIMIT; the all-time 'all' period no range filter) overflow the engine argument cap
  → `RangeError: Maximum call stack size exceeded` crashes the analytics request. 18 sites: analytics/repository.ts (4, incl. cross-fleet total
  distance on every summary), analytics-charts.ts (12, radar + best/worst), vehicle-stats.ts (1, per-vehicle latestMileage). FIX: spread-safe
  `maxOf`/`minOf` (O(n) reduce) in calculations.ts + swept all 18 → behavior-IDENTICAL (return ±Infinity on [] exactly like Math.max/min, so the
  existing length-guards are unchanged). +6 tests (array-min-max.test.ts: correctness + Math.max/min identity + 50-trial parity + a 500k-element
  no-spread regression). green→green 1328 pass (+6), every existing analytics/vehicle-stats test passed UNCHANGED through the swap.*
- ~~**#82 (MED, data-safety / NORTH_STAR #1 — found C237 hunting the settings write-path) — PUT /settings wrote `backupConfig` WHOLESALE while
  storageConfig was merged.**~~ — *DONE C237: backupConfig = { providers: Record<id, settings> }; the schema requires the full map + the handler
  wrote it wholesale (`...(backupConfig && { backupConfig })`) → a client PUT-ing only the provider it's editing WIPED every other provider's
  backup settings (retentionCount/sheetsSyncEnabled/folderPath). The frontend MITIGATES (ProviderForm spreads the full map) but the backend
  contract was fragile — a partial sender (future client / direct API / stale-load race) lost data, and storageConfig already merges server-side
  (the asymmetry was the bug). FIX: `mergeBackupConfig` (mirrors mergeStorageConfig) merges per-provider — a named entry is replaced wholesale
  (fixed-shape, editor sends complete) but un-named providers preserved; validateBackupConfig still gates incoming ownership. +2 HTTP tests
  (partial PUT preserves the un-named provider [the regression]; named entry replaced wholesale); NON-VACUOUS (preserve fails RED pre-fix).
  green→green 1330 pass (+2).*
- ~~**#83 (MED, UX/correctness — found C241 hunting the reminders mark-serviced path) — time-axis re-arm advanced nextDueDate only ONE period.**~~ —
  *DONE C241: POST /:id/mark-serviced time axis did a SINGLE `advanceReminderDueDate(reminder, reminder.nextDueDate)` → a reminder serviced when
  MULTIPLE periods overdue (monthly serviced 5 months late, or any long-lapsed startDate-anchored due date) advanced to a date STILL <= now → stayed
  overdue + re-fired on the next trigger (user serviced it, app keeps nagging). The trigger path already advances to-future (catch-up +
  fastForwardPastNow); mark-serviced didn't. FIX (mirror fastForwardPastNow, NOT the maxCatchUp-capped loop — that's a materialization budget;
  mark-serviced creates nothing): `while (nextDue <= now)` advance + strict-advance backstop (throw on non-progress, the bug #13 guard). +1 HTTP test
  (2020 monthly reminder serviced now → next_due_date strictly future); NON-VACUOUS (old single-advance → 2020-02 ≪ now → RED). green→green 1344 pass (+1).*
- ~~**#84 (MED, within-tenant integrity + cross-tenant FK — found C247 hunting the insurance CLAIM write-path) — claim create/update wrote
  vehicleId/termId verbatim, unvalidated.**~~ — *DONE C247: createClaimSchema/updateClaimSchema accept optional `vehicleId`+`termId` links, but POST
  `/:id/claims` + PUT validated ONLY policy ownership then passed the data to the repo which writes them verbatim → a user could attach a claim to a
  vehicle they don't own (cross-tenant FK) or a term from a DIFFERENT policy (even another tenant's). FIX: `validateClaimRefs(data, policyId, userId)`
  — vehicleId → validateVehicleOwnership; termId → findById(policyId).terms membership (else 400). Wired into create + update (present-fields only).
  +4 HTTP tests (foreign vehicle→404, foreign term→400, own-vehicle+term→201 control, PUT-repoint→404); NON-VACUOUS. green→green 1357 pass (+4).*

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
  **SECOND SITE (found C275 deep-review of vehicle-stats):** `vehicle-stats.ts:179` `calculateAverageMpg` filters segment MPG with an INLINE `mpg > 0 && mpg < 150` bound — same unit-unaware class, applied to the native stored value before any conversion (a metric km/L vehicle's realistic efficiency is mis-shaped: ~4 km/L wrongly kept/dropped vs the 150 imperial ceiling). NOT a literal-constant reuse of analytics-charts' MIN/MAX_VALID_MPG — it's a separate hardcoded 150. When #30's scope call lands, this site must be swept too (a fix touching only analytics-charts would leave the per-vehicle averageMpg outlier-cull mis-calibrated). The rest of calculateVehicleStats CERTIFIED CLEAN C275 (fuelType partition, #46 negative-clamp, #75 order-independence, tracking-flag gating — all comprehensively property-tested).
  **ESCALATED C419 (the scope call, sharpened to a concrete band decision):** beyond the unit-awareness question, the two sites use DIFFERENT bands — analytics-charts [5,100] gas / [1,10] electric (documented, min+max) vs the inline (0,150) (no min, no electric band) at calculations.ts:62 + vehicle-stats.ts:179 — so the SAME car's outlier pair (4 or 120 MPG) counts on the per-vehicle stats card but is filtered from the Analytics Fuel Stats card → two different averages. send_message to Angelo: (a) unify on [5,100]/[1,10] [recommended — documented + matches charts] / (b) unify on (0,150) / (c) discuss. GUARD-PINNED C419: the only prior band coverage RE-IMPLEMENTED isRealisticEfficiency locally (C229 theater trap) → +6 tests driving the EXPORTED computeEfficiencyPoint pin the real [5,100]/[1,10] boundaries (gas 100/101/5/4, electric 10/11) so a band drift is RED. When Angelo picks, unify both paths + flip the guard to the chosen values.
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
- ~~**#34 (MED) — photo upload is not atomic.**~~ — *DONE C280: `uploadPhotoForEntity` did bytes→photo row→ref with no compensating
  delete, so a DB failure after `provider.upload` orphaned the external bytes (no DB row → never reconcilable/deletable through the app).
  FIX: extracted `persistUploadedPhotoOrCleanup` wrapping the 2 inserts in try/catch + best-effort `provider.delete(storageRef.externalId)`
  before re-throwing (failed cleanup logged, never masks the original error); no new DI seam (provider already in scope). +3 source-scan
  guard (upload-compensating-delete.test.ts — the C133/C220 precedent; a real upload needs live provider bytes). green→green 1395 pass (+3).
  (#33, the DELETE-side external-byte orphan reconcile/retry queue, remains the larger filed follow-on.)*
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
- **#85 (MED, needs a product decision — found C252 deep-review of getSummary/getFuelStats; ESCALATED to Angelo C252) — fuel-stats "This/Last Year"
  is range-relative, not calendar-year.** buildFuelStatsFromData (repository.ts:1340-1341): `currentYearFillups` = ALL fillups in the client-supplied
  range (no year filter); `previousYearFillups` = the immediately-preceding equal-length window. But FuelStatsTab.svelte:170/174 labels them
  "This Year"/"Last Year" — while the sibling "This/Last Month" numbers ARE true calendar months (getMonth()). The analytics range is whatever the
  dashboard requests (default all / 7d / 30d / 90d / 1y), almost never a calendar year → e.g. a 30d view shows "This Year" = last 30 days + "Last
  Year" = the prior 30 days. The #9 interestPaidYtd-rename class; same family as #45 (period-scoped stats). DECISION (not loop-decidable — changes a
  headline figure + the FE↔BE contract): (a) make it true calendar-YTD vs prior calendar year (like getYearEnd), (b) relabel "This/Last Period", or
  (c) only show the year row when the range is ~1yr. VERIFIED C252; rest of the getSummary path CERTIFIED CLEAN.
- ~~**#86 (MED, correctness / NORTH_STAR #2 — found+fixed C262 scouting fuel-stats during a forced bug cycle) — fuel-stats "This/Last Month" counted
  cross-year.**~~ — *DONE C262: buildFuelStatsFromData (repository.ts:1342-1356) filtered currentMonth/prevMonth fillups + gallons on `getMonth() ===
  currentMonth` with NO year check; fuelRows spans the whole requested range (default 'all' = multi-year) → a prior-year same-month fillup folded into
  "This Month" (3 years of Jan data → triple-counted). The FE labels these true calendar "This/Last Month" alongside the now-derived currentMonth → the
  contamination is unambiguous (DISTINCT from the product-gated #85, which only concerns the year ROW's labeling). FIX: derive currentYear + prevMonthYear
  (Jan→prev-year rollover) + inCurrentMonth/inPrevMonth predicates matching BOTH month AND year; applied to all 4 month figures. +2 deterministic
  regression tests (dates relative to now → host-independent): prior-year same-month excluded from This Month; Last Month rolls to prev-year in January.
  NON-VACUOUS. green→green 1376 pass (+2); existing single-year fuel-stats property tests UNCHANGED.*
- ~~**#87 (MED, correctness / NORTH_STAR #2 — surfaced by the C267 arch extract, fixed C268) — `toDateInputValue` read the UTC calendar date → date-input
  off-by-one + broken stored-date round-trip.**~~ — *DONE C268: the helper used `new Date(x).toISOString().slice(0,10)` (UTC). Harms: (a) a negative-offset
  user editing late in the day saw TOMORROW pre-filled; (b) the worse one — `dateOnlyToISO` persists date-only values at NOON LOCAL, and noon-local in a
  positive offset is the PREVIOUS day in UTC, so a saved purchaseDate/financing.startDate reloaded one day EARLIER in the edit form. FIX: read LOCAL
  components (getFullYear/getMonth+1/getDate, zero-padded) — the forward partner to dateOnlyToISO; noon ± any real offset never crosses local midnight, so
  the round-trip is now exact in every tz. Tests rewritten UTC→LOCAL + host-tz-independent + a round-trip-in-every-tz case (NON-VACUOUS — fails under the
  old UTC version for a positive-offset host). green→green fe 596 pass; all 9 C267 call sites benefit from the one chokepoint.*
- ~~**Insurance TERM write-path #84-class scout (C272)**~~ — *DONE C272 (bug-cycle scout, CERTIFIED CLEAN + guard): the term/coverage write paths
  (create/addTerm/updateTerm) are PROTECTED — the repo's private validateVehicleOwnership gates all three before junction insert (repository.ts:175/407/541),
  so a term's vehicleCoverage.vehicleIds can't reference a foreign vehicle (#84/#61 cross-tenant FK). create()'s guard was property-tested but the
  addTerm/updateTerm HTTP paths were unpinned → +4 HTTP tests (terms-http.test.ts): POST /insurance + POST /:id/terms + PUT /:id/terms/:termId with a
  foreign vehicleId → 404, zero junction rows planted (PUT keeps original coverage); + owned-vehicle control. NON-VACUOUS. green→green 1385 pass (+4). Also
  re-confirmed financing PATCH/payoff/refinance clean (C240). NO live defect — bug vein still exhausted.*
- ~~**Odometer write-path scout (C284)**~~ — *DONE C284 (bug-cycle scout, CERTIFIED CLEAN + guard): odometer DELETE does NOT recheckMileageReminders
  (POST/PUT do) — VERIFIED CORRECT (processMileageReminder fires only on a forward crossing + dedups, never un-fires; a DELETE can only LOWER the odometer →
  nothing to re-evaluate). expenses source/clientId queries all userId-scoped, idempotency CAS clean. THE finding → guard: the downward-safe invariant was
  unpinned → +1 HTTP test (cross 35000 fires; DELETE the highest reading → notification SURVIVES, /trigger does NOT re-fire). NON-VACUOUS. 1401 pass (+1). NO live defect.*
- ~~**Reminder mark-serviced re-arm scout (C276)**~~ — *DONE C276 (bug-cycle scout, CERTIFIED CLEAN + guard): the two-axis re-arm (POST /:id/mark-serviced)
  is sound by domain semantics — TIME axis schedule-anchored (advance from nextDueDate; #83 overdue fast-forward correct+tested), MILEAGE axis usage-anchored
  (reset to current odometer + interval); axis difference INTENTIONAL. Comprehensively pinned (mileage anchor, no-longer-due-at-trigger, #83 overdue catch-up,
  both-axis, cross-tenant 404) EXCEPT the EARLY-service branch — every time test seeds a PAST startDate (overdue loop runs), so servicing when nextDueDate is
  already FUTURE (loop skips, single advance) was uncovered. +1 HTTP test: yearly reminder anchored 2099 (host-independent) serviced early advances exactly
  one year forward (Δ 364–367 days), stays future. NON-VACUOUS. green→green 1389 pass (+1). NO live defect.*
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
- **#51 (LOW, consistency — ESCALATED to Angelo C189) — an active policy with NO terms inflates activePoliciesCount while contributing $0.**
  analytics/repository.ts:911 `if (!latestTerm) continue;` skips a term-less policy for premium/vehicle entries, but
  activePoliciesCount is the raw count of active policies (:~1702) → the card can show "1 active policy / $0.00 / empty details" —
  internally inconsistent. Arguably intentional (it IS active). VERIFIED C150 + re-confirmed firsthand C189. **ESCALATED C189
  (send_message): product-semantics call — count-only-with-term / surface-"no current term" / leave-as-is. Awaiting Angelo; not
  loop-decidable.**

**NEW — surfaced + verified-against-source by the C189 inline deep-review of the expense WRITE path (expenses/routes.ts POST/PUT; bug-cycle pivot when the queue was all weak/gated). The create/update validation asymmetry class (the create path guards a thing the update path doesn't):**
- ~~**#61 (MED, within-tenant integrity) — expense PUT didn't re-validate a CHANGED vehicleId.**~~ — *DONE C189: POST /expenses
  validateVehicleOwnership(vehicleId) (:533) but PUT /:id `update(id, updateData)` (:641) wrote a changed vehicleId through UNVALIDATED
  → a user could reassign their (owned) expense to a vehicle they DON'T own (stays their row, references a non-owned vehicle →
  corrupts their analytics attribution; within-tenant, all reads userId-scoped so NOT a cross-tenant leak). FIX: when
  updateData.vehicleId is present AND differs, validateVehicleOwnership (mirror create). +3 tests (foreign→404 + no bad write;
  own-second→200; no-vehicleId→200). green→green 1256 pass (+3).*
- ~~**#62 (MED, latent integrity — filed C189) — expense create/PUT only validate the `financing` sourceType, not `insurance_term`/`reminder`.**~~
  — *DONE C190 (Option A): VERIFIED firsthand that `insurance_term` expenses are created via `expenseRepository.createSplitExpense`
  (insurance/hooks.ts:33) + `reminder` expenses via a direct tx.insert/createSiblings (trigger-service.ts:160/186) — BOTH bypass the
  POST/PUT route, so the route enum accepting those was pure over-permissiveness (only `financing` is legitimately route-set + already
  validated :536). FIX: `sourceType: z.enum([financing,insurance_term,reminder])` → `z.literal('financing')` on the route create/update
  schema. Confirmed NO test POSTs those via the route + the 2 traceability reads stayed green (system DB-direct writes unaffected). +4
  tests (POST reminder/insurance_term→400, PUT reminder→400, no-source create→201). green→green 1260 pass (+4).*

**NEW — surfaced + verified-against-source by the C191 inline deep-review of providers/routes.ts (credential-CRUD vein, the 57.52%-line low spot). CERTIFIED CLEAN firsthand: credentials never leak (formatProviderResponse omits; GET/POST/PUT all route through it — C91/C132 held); PUT preserves the encrypted blob on a credential-less update (no clobber) + re-encrypts when present; every mutation ownership-scoped via findOwnedProviderOrThrow (id AND userId); auth-provider guard on PUT/DELETE; storage/backup config cleanup on delete; deleteByProvider transitively safe (FK to an already-proven-owned provider). ONE finding:**
- ~~**#63 (LOW, defense-in-depth) — provider PUT/DELETE destructive writes key on `id` alone, not `id AND userId`.**~~ — *DONE C192:
  providers/routes.ts PUT update (:404) + DELETE (:484) keyed `where(eq(userProviders.id, id))` alone; findOwnedProviderOrThrow guarded
  one layer up (not exploitable), but the C109/#52 tenant-scope-at-the-write class. FIX: ANDed `eq(userProviders.userId, user.id)` into
  BOTH write predicates (behavior-identical today — the guard proves ownership; mirrors C155 split + C168/C180 odometer). +3 tests via
  a raw-seeded COEXISTING foreign provider (foreign DELETE→404 + row SURVIVES; foreign PUT→404 + displayName UNCHANGED; own delete→204)
  — pins the WRITE PREDICATE itself, not just the guard. green→green 1263 pass (+3).*
- ~~**#64 (MED-HIGH, displayed-$ — found C198 via a fresh FE-money hunt) — lease excess-mileage projection treated the ANNUAL
  mileageLimit as the whole-lease allowance.**~~ — *DONE C198: `calculateLeaseMetrics` (frontend financing-calculations.ts:369)
  compared the lifetime mileageUsed + projectedFinalMileage against `financing.mileageLimit` directly, but that field is the ANNUAL
  limit (form labels it "Annual Mileage Limit" + schema comment agrees). A 36-mo lease at 12k/yr (36k total) driven a normal 30k showed
  ~18k PHANTOM excess miles × per-mile fee = thousands of $ fake excess fees on FinanceTab/LeaseMetricsCard. Backend doesn't touch
  these fields → FE-only. FIX: totalMileageAllowance = mileageLimit × (termMonths/12), used in all 3 comparisons. VERIFIED the annual
  semantics firsthand before acting + reconciled the existing lease-metrics.test.ts (which had BAKED IN the bug — its 36000 fixture
  treated annual-as-total) to a realistic 12000/yr fixture + a #64 describe (annual×years scaling). green→green FE 516 pass (+6).*
- ~~**#65 (MED-HIGH, offline data-safety / NORTH_STAR #1 — found C202 via a fresh FE offline/sync hunt) — legacy-entry clientId backfill
  minted a FRESH random UUID on every read → defeated offline-POST idempotency → duplicate expense rows.**~~ — *DONE C202:
  `loadOfflineExpenses` (offline-storage.ts:48-58) backfilled a pre-v3 entry's missing clientId with `expense.clientId ?? crypto.randomUUID()`
  but RETURNED the migrated array WITHOUT persisting it, and the migration re-runs on every read of a not-yet-persisted legacy entry — so a
  DIFFERENT UUID was minted each call. clientId IS the offline-create idempotency key (offline-storage.ts:160 / sync-manager.ts:222), so a
  legacy entry whose first sync POST committed server-side but lost its response got re-read with a fresh key on the next run → the server's
  clientId-dedup couldn't match → a DUPLICATE expense row + double-counted TCO (the doc comment lines 11-12 explicitly promise a STABLE key —
  the code broke its own contract). VERIFIED firsthand vs source (both consumer paths read pending → POST clientId). FIX (deterministic,
  minimal, behavior-preserving for v3, NO write-on-read side-effect — the entry's own `id` is already stable+unique per entry):
  `clientId: expense.clientId ?? expense.id`. Same key every read → server dedups correctly. Confirmed the existing sync-manager/
  sync-offline-expenses tests tolerate it (no write-on-read added). +2 guards in offline-storage.test.ts (the load-bearing read-twice→
  SAME-clientId stability invariant + an existing-key-never-re-minted control). green→green FE validate:local EXIT 0, 537 pass (+2);
  prettier + eslint clean.*
- ~~**#66 (HIGH, offline data-safety + EV-correctness / NORTH_STAR #1+#2 — found C204 via a fresh deep-review of the FE api-transformer
  seam) — an offline-created ELECTRIC charging expense silently dropped its `charge` on sync (fuelType never carried in the outbox).**~~ —
  *DONE C204: `toBackendExpense` (api-transformer.ts) decides the charge↔volume mapping SOLELY via `isElectricFuelType(fuelType)`, but the
  `OfflineExpense` type had NO fuelType field, BOTH ExpenseForm.svelte addOfflineExpense sites (:565/:605) omitted it, and the 2
  sync-transform callers (offline-storage syncOfflineExpenses + sync-manager) called toBackendExpense WITHOUT it. So an offline electric
  expense (charge set, fuelType absent) → `isElectricFuelType(undefined)`=false → the volume-only else-branch → volume undefined → the
  CHARGE silently vanished from the POST (broken mi/kWh + cost/charge); AND every offline-synced expense lost its fuelType label. The
  offline fuel-validation (volume OR charge) admits a charge-only electric entry straight into the lossy transform. VERIFIED firsthand
  end-to-end. FIX (root-cause, threads fuelType end-to-end): added `fuelType?` to OfflineExpense + carried it through all 4 propagation
  sites (both outbox objects + both sync toBackendExpense callers + resolveConflict keep_local). +5 guards (api-transformer: the
  discriminant regression [electric-without-fuelType drops charge] + with-fuelType maps charge→volume + Level-2(AC) + liquid negative
  control; offline-storage: outbox persists fuelType). green→green FE validate:local EXIT 0, 542 pass (+5); prettier + eslint clean.
  CAVEAT: root-cause fixed + unit-pinned; the offline→sync→render E2E for an electric charge is Playwright-eyes-on-BLOCKED here → lands
  code-complete/eyes-on-pending per the feature-DoD rule.*
- ~~**#67 (MED-HIGH, data-correctness — found C206 via a fresh hunt of the financing WRITE path) — re-financing a paid-off vehicle
  silently produced an INACTIVE financing record.**~~ — *DONE C206: `POST /vehicles/:id/financing` is a create-or-REPLACE keyed on
  vehicleId; when a prior row exists it reuses it via `update(existing.id, {...financingData})`. `isActive` is .optional() in the create
  schema (a .notNull().default(true) col → drizzle-zod omits it) AND the VehicleForm financing payload (VehicleForm.svelte:420-449) never
  sends it → re-financing a vehicle whose prior financing was paid off (isActive=false via PUT /payoff or DELETE) reused that row and LEFT
  isActive=false → the new ACTIVE loan/lease was silently dropped from findActiveFinancing + loanBreakdown/analytics (:863 filters
  f.isActive) + the FE's `vehicle.financing?.isActive` gate → the user's real financing vanished from TCO/analytics. VERIFIED firsthand
  end-to-end. FIX (root-cause, behavior-preserving for the normal edit): on the upsert update branch set `isActive: true` + `endDate: null`
  (mirrors create()'s default; a still-active record stays active = idempotent; clears a stale payoff/lease-end date). +2 HTTP tests
  (financing-get-contract.test.ts: the #67 regression payoff→re-finance→active + an already-active idempotent control); NON-VACUOUS —
  confirmed it fails RED with the fix reverted then green restored. green→green backend validate:local EXIT 0, 1274 pass (+2).
  NOTE (latent, NOT fixed — C21/C77, filed for a future cycle): the same loan↔lease upsert leaves STALE type-specific columns (e.g. `apr`
  on a record switched loan→lease, since the .optional() field is absent from the payload → drizzle .set() skips it). Latent only — every
  read gates on `financingType` (analytics :806/:864, FE lease-metrics), so no displayed-value bug today; a defensive null-the-other-type's
  fields on switch would close it if desired.*
- ~~**#68 (HIGH, data-safety / NORTH_STAR #1 — found C209 via a deep-review of the restore coercion surface) — restore coerceRow truncated a
  thousands-separated number (parseInt stops at the comma).**~~ — *DONE C209: `coerceRow` (backup.ts:70), the per-field type coercion EVERY
  restored row flows through, used `Number.parseInt(strVal, 10)` on INTEGER columns — which STOPS at the first non-digit. The Google Sheets
  restore reads cells via `values.get` with NO valueRenderOption → defaults to FORMATTED_VALUE (google-sheets-service.ts:622), so a
  thousands-separated odometer/mileage comes back as "12,345" → parseInt → 12 (a 1000x SILENT corruption; 12 is not NaN so it passed through;
  mileage/odometer/initialMileage all confirmed `integer`). REAL branch had the same hazard (parseFloat("1,234.56")→1). The CSV path writes
  raw integers with NO separators (convertToCSV:451) so a VROOM-own round-trip never hit it — but the Sheets path does. VERIFIED firsthand
  end-to-end. FIX (minimal, complete, behavior-preserving for valid input): strip grouping commas + a STRICT whole-string parse
  (`Number(strVal.replace(/,/g,''))` — rejects a "12abc" tail to NaN→null, matching the garbage→null contract; Math.round on INTEGER so a
  Sheets "12345.0" lands whole). Did NOT unilaterally switch the Sheets read to UNFORMATTED_VALUE (deeper, separate) — the coercion-layer fix
  is complete + covers CSV too. +5 tests; NON-VACUOUS (confirmed RED with the fix reverted). DE-RISKS the money-cents migration (the C146-named
  parseInt crux). green→green backend validate:local EXIT 0, 1279 pass (+5).*
- ~~**#70 (MED, data-correctness — found C210 via the insurance route surface) — GET /insurance/expiring-soon `days` param unguarded → NaN →
  Invalid Date → silently zero expiring policies.**~~ — *DONE C210: `days` was `Number.parseInt(c.req.query('days')||'30',10)` with NO
  finite-guard, UNLIKE its sibling `limit` two lines down (guarded). `?days=<non-numeric>` → NaN → `endDate = new Date(now + NaN)` = Invalid
  Date → findExpiringTerms' `between(endDate, now, InvalidDate)` matched NOTHING → the renewal nag silently showed ZERO expiring policies
  (NORTH_STAR #2 — the C189 create/update-asymmetry class applied to sibling params). VERIFIED firsthand. FIX (mirrors the sibling):
  `Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays,1),366) : 30`. +4 HTTP tests (new expiring-soon-http.test.ts: default finds
  a ~20-day term; the `?days=abc` regression falls back to 30 + still finds it; `?days=45` honored; `?days=99999` clamps to 366); NON-VACUOUS
  (RED with the guard reverted). green→green backend validate:local EXIT 0, 1283 pass (+4).*
- **#69 (MED, consistency — found + ESCALATED C210, NOT auto-fixed; it's a semantics call) — a monthly-only insurance term shows in analytics
  but is ABSENT from TCO.** A term can carry its premium as `totalCost` (lump) OR `monthlyCost` (recurring). Analytics counts both (via
  `effectiveMonthlyPremium`, analytics-charts.ts:176 returns monthlyCost directly when totalCost is null), but the expense-materialization hook
  `createTermExpenses` (insurance/hooks.ts:28) + both call sites (routes.ts:84/:176) gate on `totalCost > 0` → a monthlyCost-only term
  materializes NO expense row → its premium is ABSENT from vehicle TCO/$-per-month while showing in the analytics insurance card (same cost, two
  headline numbers). VERIFIED firsthand (schema both nullable :137-138; both cost shapes reachable). ESCALATED C210 (send_message) — semantics
  call: materialize monthlyCost×term-months as one lump (TCO==analytics) / N monthly rows across the term / leave analytics-only + document.
  Awaiting Angelo; not loop-decidable (the C167 audit certified the totalCost-path materialization clean but never considered the monthlyCost-only
  shape).*

> [stray prior-edit run-on — the C155 deep-review block header, preserved for the audit trail:] (expenses-repository query/filter/search/pagination/aggregation + fuel-stats/efficiency math). KEY: agent A CERTIFIED the entire filter/sort/pagination/aggregation core CLEAN (the search OR is pre-parenthesized + AND-joined with the userId scope → can't widen past tenant; count==rows WHERE; allowlisted sort with id tiebreaker; split SUM not double-counted since siblings carry per-share expenseAmount; every read userId-scoped). #52 (real, security) FIXED in-cycle; #53 filed. Fuel-stats agent (delayed event, triaged post-C155): its Finding 1 → **#54 (HIGH, VERIFIED firsthand)** filed below; its div-guard/split-sibling checks matched my C155 pre-read (isFillup volume>0, fillupDetails length-guards, per-vehicle distance — clean).**
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
16. **mark-serviced advances nextDueDate one period even from an overdue date** — `routes.ts:115`
    advanceReminderDueDate from the CURRENT (possibly past) nextDueDate advances by ONE period, so marking
    an overdue reminder serviced without first running /trigger can leave it still in the past
    ("bounces" through past periods, re-firing). Matches the trigger's one-period model + assumes a
    trigger ran first. SEMANTICS CALL: catch-up to >= now, or assert/leave-as-is. (needs decision)
    **RE-CONFIRMED present C197** (the mark-serviced/mileage-re-arm deep-review); still decision-gated.
    *(C197 also CERTIFIED CLEAN the rest of that vein: the mark-serviced MILEAGE axis's `vehicleIds[0]`
    single-vehicle assumption is SAFE — the "must be exactly one vehicle" D4 rule is enforced at validation
    create+update [refineMileageTrigger], so a mileage reminder provably has 1 vehicle; the apparent
    asymmetry vs the trigger's length-check was a FALSE POSITIVE. mark-serviced anchoring is consistent with
    resolveMileageFields create-seed + self-corrects via recheck.)*
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
- ~~**Dedup-surface CERTIFIED EXHAUSTED (C457, docs-only — no manufactured churn).**~~ — *DONE C457 (arch OVER budget, forced). rule-7 fan-out returned a clean "nothing worth doing":
  every dedup candidate is behavior-changing / untested-path / churn; every dead-code candidate is test-entangled (coverage-dropping delete — the C438 anti-trap). Firsthand-verified the
  two getCategoryColor fns (chart-colors.ts:47 vs expense-helpers.ts:103) are FALSE-DRY (different output domains: CSS var(--chart-N) vs Tailwind classes) → reject. Per the dormant-vein
  protocol (arch analogue of the C402/C420 bug cert), recorded a CERTIFICATION rather than manufacture churn / a coverage-negative delete. The standing dead-ends (FE photo-CRUD + OAuth-ctor
  untested paths; requireAuth + insurance getActive/getCurrentTermDates test-entangled deletes) — next forced-arch should fan out FRESH (new dups surface as product grows), not re-scout these.*

- ~~**Collapse the byte-identical insurance term-create schema — createPolicyTermSchema → createTermSchema (2 sources of truth → 1, done C451).**~~ —
  *DONE C451 (arch OVER budget 7>5, forced): createTermSchema (validation.ts:40-47) + createPolicyTermSchema (:85-92) were BYTE-IDENTICAL (`z.object({...baseTermFields,
  vehicleCoverage}).refine(endDate>startDate,{message})`). One is embedded in createPolicySchema.terms (POST /insurance), the other re-exported as addTermSchema (POST /:id/terms) —
  a policy-create term + add-term term validated by two separately-maintained copies, a divergence-bug vector in a money-facing path. Deleted createPolicyTermSchema, pointed
  createPolicySchema.terms at createTermSchema (identical schema + message → behavior-preserving). green→green via the policy-create HTTP tests + the add-term path + C443 unit tests
  (no test touched). be validate:local EXIT 0, 1540 pass.*

- ~~**Extract isIncompleteFuelExpense — ONE source of truth for the byte-identical fuel-completeness sync guard (2 inline sites → 1, rule-7 fan-out, done C444).**~~ —
  *DONE C444 (arch OVER budget, forced): the predicate `category==='fuel' && ((!volume && !charge) || !mileage)` was hand-inlined BYTE-IDENTICAL at syncOfflineExpenses
  (offline-storage.ts, warn+continue) + sync-manager.syncSingleExpense (return error) — the EXACT offline↔sync fan-out whose drift caused #66/#101, the same pair C205/C426/C432
  already collapsed for the mapping/pending-filter/mark-synced helpers; this was the leftover. Exported isIncompleteFuelExpense from offline-storage.ts (next to offlineExpenseToBackend);
  routed both sites, each keeping its own action. rule-3 green→green (sync-offline-expenses + sync-manager suites drive both branches). Hit + fixed the C163/C426 mock-trap (passed the
  REAL pure predicate through the sync-manager offline-storage mock, not a stub). +5 predicate-pin tests. fe validate:local EXIT 0, 712 pass (+5). The offline↔sync duplicated-rule
  family is now FULLY collapsed. (BE alt: an 8-line insurance term-create schema collapse — valid but thinner; left for a future arch cycle if the FE surface dries up.)*

- ~~**Delete dead exported helper deriveLastBackupDate (zero references anywhere incl. tests, rule-7 fan-out, done C438).**~~ —
  *DONE C438 (arch OVER budget, forced). BOTH scouts' top picks REJECTED firsthand: (a) FE's calculatePayoffDateFromStart→addMonthsClamped merge is the C337/C330 BEHAVIOR-CHANGE trap
  (addMonthsClamped preserves time-of-day via `new Date(date)`; calculatePayoffDateFromStart constructs at local-midnight `new Date(y,m,d)` — dates stored at noon-local, so the two differ
  in time-of-day; rule-2 violation masked by Y/M/D-only tests); (b) BE's calculateAverageMPG merge is the escalated #30 band-divergence (behavior-changing). Cleanest survivor = dead-code
  delete: deriveLastBackupDate (backup.ts:150), exported but ZERO references anywhere incl. tests (a stranded "last-backup summary" helper that never shipped). Deleting dead code = explicit
  arch payoff (rule 5), behavior-preserving, coverage-neutral-to-positive. Chose it over the insurance dead-methods candidate (entangles ~120 test LOC + drops coverage). −15 LOC,
  BackupConfig import retained. be validate:local EXIT 0, 1532 pass (unchanged — confirms dead). Dedup surface now near-exhausted both sides (remaining dups behavior-changing or untested-path).*

- ~~**Collapse SyncManager's private markExpenseAsSynced + dead clearSyncedExpenses → the canonical offline-storage exports (cross-file dup + dead-code delete, rule-7 fan-out, done C432).**~~ —
  *DONE C432 (arch OVER budget, forced): sync-manager.ts had a PRIVATE markExpenseAsSynced (:247, byte-identical to offline-storage.ts:160) + a PUBLIC async clearSyncedExpenses
  (:330, near-identical to :169) with ZERO callers (grep-confirmed dead). The SAME offline-storage↔sync-manager divergence channel that produced #66/#101 (and that C426
  getPendingExpenses + C205 offlineExpenseToBackend already collapsed) — these two queue-mutators were the leftover. Routed the 4 `this.markExpenseAsSynced` callers to the
  imported canonical fn, deleted the private method + the dead public one, dropped the now-unused loadOfflineExpenses/saveOfflineExpenses imports. rule-2 behavior-preserving;
  rule-3 green→green (offline-storage.test.ts:259/296 anchor the canonical fns; sync-manager.test.ts:94 drives the routed call over its existing markExpenseAsSynced mock — no
  test touched). fe validate:local EXIT 0, 697 pass, svelte-check 0, build clean. −16 LOC. BE scout returned a clean "nothing worth doing" (remaining BE dups are
  untested-path [OAuth2-client ctor, analytics catch/log/rethrow] or churn/false-DRY).*

- ~~**Collapse the duplicated getPendingExpenses — sync-manager's private copy → the canonical exported one (cross-file dup, 2 sites → 1, rule-7 fan-out, done C426).**~~ —
  *DONE C426: sync-manager.ts:128-130 had a PRIVATE getPendingExpenses byte-identical to the EXPORTED offline-storage.ts:156 (`loadOfflineExpenses().filter(e => !e.synced)`).
  `!synced` is the contract for "which offline expenses to sync" — a divergent copy desyncs what sync-manager attempts vs what the store considers pending. Deleted the private
  method, imported the canonical one, routed both call sites. Rule-2 behavior-preserving; rule-3 green→green (offline-storage + sync-manager tests). Had to add the missing
  getPendingExpenses to the sync-manager test's offline-storage mock, mirroring the real impl over the mocked loader (C163 mock-trap discipline). fe validate:local EXIT 0,
  697 pass. Chose this FE cross-file dup over the BE toTimeMs candidate (4 identical lines within ONE comparator — local/cosmetic).*

- ~~**Extract sortExpensesByDate — ONE source of truth for the chronological pairwise-order sort (3 byte-identical sites → 1, rule-7 fan-out, done C421).**~~ —
  *DONE C421: the date-ascending comparator `[...x].sort((a,b) => new Date(a.date).getTime() − new Date(b.date).getTime())` was BYTE-IDENTICAL at calculateAverageMPG
  (calculations.ts:42), calculateAverageMilesPerKwh (:93), the /stats handler (vehicles/routes.ts:343) — all feed PAIRWISE consecutive-row calcs, so an unsorted/
  wrong-direction/in-place copy silently mis-pairs into garbage (the #75/C222 class). Extracted sortExpensesByDate<T extends {date: Date|string}> (copy, never mutates) into
  calculations.ts; routed all 3. Rule-2 behavior-preserving; rule-3 green→green (the #75/C222 + calculations sort tests drive 2 of the 3 callers). +4 helper tests. be
  validate:local EXIT 0, 1518 pass (+4). FE fan-out: certified well-factored (only trivial 1-liners).*

- ~~**Extract resetSplitAllocations — ONE source of truth for the split-method allocation reset (2 byte-identical form copies → 1, rule-7 fan-out, done C415).**~~ —
  *DONE C415: the ENTIRE resetAllocationsForMethod (even→[], absolute→{amount:0}, percentage→{percentage: round(100/N,1dp)}) was BYTE-IDENTICAL in ExpenseForm (:767) +
  InsuranceTermForm (:166). The 100/N rounded-to-1-decimal seed is load-bearing — a divergent copy (2-decimal round) → the same multi-vehicle split with different
  per-vehicle percentages by form. Extracted pure resetSplitAllocations(method, vehicleIds) into expense-helpers.ts (tested pure-util home both import); routed both to a
  one-line call. Rule-2 behavior-preserving; rule-3: forms are eyes-on-blocked so the net is the helper + its OWN test (+6, reset-split-allocations.test.ts incl. the
  100/3→33.3 1-decimal pin); svelte-check verified the wiring. fe validate:local EXIT 0, 696 pass (+6). BE scout found no clean byte-identical dup (well-deduped); the
  MAX_VALID_MPG 100-vs-150 band divergence it flagged is a behavior-change → NOT arch (noted for a possible bug/direction cycle).*

- ~~**Extract hasReminderEndedBy — ONE source of truth for the endDate-boundary predicate (4 inline trigger-service.ts sites → 1, rule-7 fan-out, done C409).**~~ —
  *DONE C409: the predicate `reminder.endDate && nextDue > reminder.endDate` was hand-inlined BYTE-IDENTICAL at 4 sites — fastForwardPastNow in-loop (:281) + post-loop
  (:303), processReminder in-loop break (:447) + natural-exit (:473). THE bug-#12 family the loop kept re-finding (#107/C362, #114/C394, #116/C399) — a divergent copy
  (`>=`/`>` slip, or dropping the null-guard) is that exact defect class. Extracted pure `hasReminderEndedBy(reminder, nextDue): boolean` (sibling to getAnchorDay);
  callers keep their own action (break vs deactivate+return). Rule-2 behavior-preserving; rule-3 green→green: trigger-fastforward-enddate + trigger-expense drive all 4 —
  GREEN before AND after, no test touched. be validate:local EXIT 0, 1496 pass (unchanged). rule-7 fan-out DEBUNKED both proposed candidates firsthand (FE DAY_MS =
  churn, rejected C403; BE calculateAverageMPG = NO production caller, "merge" = delete-a-tested-export or couple-to-test-scaffolding) → declined rather than manufacture churn.*

- ~~**Extract isFillup — ONE source of truth for the volume-bearing-fillup predicate (3 inline analytics-charts sites + 1 local repository def → 1, rule-7 fan-out, done C403).**~~ —
  *DONE C403: the split-sibling guard `r.volume != null && r.volume > 0` was hand-inlined BYTE-IDENTICAL at computeAverageCosts (:434), buildSeasonalEfficiency (:644),
  buildDayOfWeekPatterns (:807) + re-defined locally in analytics/repository.ts buildFuelStatsFromData (:1353). It guards the #56/#18/#108/#113 SPLIT-SIBLING OVERCOUNT
  class (a split fuel expense creates one volume=null sibling per vehicle; counting raw rows overcounts one split fillup as N) → a divergent copy silently reintroduces
  the overcount on one surface (real latent bug). Exported `isFillup` from analytics-charts.ts (typed Pick<FuelExpenseRow,'volume'>, where the type already lives +
  repository.ts already imports — no cycle); routed all 4. Rule-2 behavior-preserving; rule-3 green→green: analytics-charts-unpinned.test.ts (#108/#113/#56 guards) +
  fuel-stats-fleet-distance-pooling.test.ts (#18 COUNT) drive all 4 — GREEN before AND after, no test touched. be validate:local EXIT 0, 1490 pass (unchanged). FE
  fan-out returned only a contrived test-only MS_PER_DAY dup → REJECTED (churn-for-churn, rule 5).*

- ~~**Extract chunk() + SQLITE_BATCH_SIZE — ONE source of truth for the batched-IN-clause loop (4 photo/photoRef sites → 1, rule-7 fan-out, done C397).**~~ —
  *DONE C397: the batched-IN loop `for (i += 500) { ids.slice(i, i+500); inArray(col, batch) }` + the magic 500 was hand-rolled BYTE-IDENTICAL at 4 sites
  (photo-repository findByEntities/deleteByEntities, photo-ref-repository findAllByPhotos/deleteByPhotos — cascade-delete fan-outs; 2 destructive). A divergent
  stride/limit copy drops/double-processes a batch on a cascade DELETE (data loss). Bodies differ (select-photos/select-refs/delete) so the clean collapse is the
  CHUNKING: a pure chunk<T>(items, size=SQLITE_BATCH_SIZE) + shared constant, NOT a batchSelect/batchDelete pair (type churn). Rule-3: the 4 methods had NO test
  net → increment = the pure helper + its characterization test (safety net) + route the 4 sites to `for (const batch of chunk(ids))` (behavior-preserving). +1
  test file (chunk.test.ts, 7 tests incl. the flatten-round-trips data-loss guard). be validate:local EXIT 0, 1483 pass (+7). FUTURE: the google-sheets-service:500
  + backup.ts:373 sibling copies remain (C163 mock-trap territory) — a later cycle could route them too once their seam is testable.*

- ~~**Route buildFuelStatsFromData's inline per-vehicle distance onto the existing computeConvertedTotalDistance (2 sites → 1, rule-7 fan-out, done C392).**~~ —
  *DONE C392: buildFuelStatsFromData (repository.ts:1404) inlined the per-vehicle mileage group→max−min→sum, BYTE-IDENTICAL to the existing private
  computeConvertedTotalDistance (:511) under skipConversion=true — the inline code's own comment even said "Mirrors the grouped computeConvertedTotalDistance".
  A divergent copy (a null-mileage filter / `< 2` change on one) skews the per-vehicle distance total vs the year-end path (both feed cost-per-distance money
  analytics). The shared method ALREADY has the skipConversion flag → pure call-the-existing-helper collapse, no new helper/param. Routed →
  computeConvertedTotalDistance(fuelRows, new Map(), DEFAULT_UNIT_PREFERENCES, true). Behavior-preserving. Rule-3 green→green:
  fuel-stats-fleet-distance-pooling.test.ts + year-end.property.test.ts drive both — GREEN before AND after. validate:local EXIT 0, 1474 pass. (FE fan-out: clean
  "none" — heavily deduped.)*

- ~~**Extract monthsBetween — ONE source of truth for the calendar-month-diff in two analytics money denominators (2 sites → 1, rule-7 fan-out, done C386).**~~ —
  *DONE C386: the month-diff `(now.getFullYear()−X.getFullYear())*12 + (now.getMonth()−X.getMonth())` was BYTE-IDENTICAL at the financing monthsElapsed
  (repository.ts:836 → monthsRemaining) + the all-time TCO ownershipMonths (:1891 → costPerMonth=total/months). Different clamps (max(0,…) vs max(1,…)), so the
  shared part is the unclamped diff. A divergent copy (dropped *12 / flipped subtraction) would skew one money denominator vs the other. Extracted
  monthsBetween(from, to) as a sibling to monthsOwnedInYear/toDate; callers keep their own clamp. Behavior-preserving. Rule-3 green→green:
  per-vehicle.property.test.ts (monthsRemaining + costPerMonth) + vehicle-tco-zero-state.test.ts (≥1 clamp) drive both sites — GREEN before AND after.
  validate:local EXIT 0, 1470 pass. Rejected the FE dead calculateDaysUntil delete (4×-deferred — deleting a TESTED export is net-negative coverage).*

- ~~**Extract ExpenseRepository.sourceScope — ONE source of truth for the source-linked-expense tenant predicate (4 sites → 1, rule-7 fan-out, done C381).**~~ —
  *DONE C381: the triple-predicate `and(eq(sourceType), eq(sourceId), eq(userId))` was BYTE-IDENTICAL at 4 sites in expenses/repository.ts — findBySource,
  deleteBySource's read + its destructive delete-write, clearSource's update. These act on AUTO-MATERIALIZED expenses (reminder/insurance/financing cascade
  cleanup), so a divergent copy dropping userId = one user's source delete/deactivate wiping/nulling ANOTHER user's expenses (cross-tenant destructive write,
  C109/#57/#62; 2 of 4 sites destructive). Extracted `private sourceScope(...): SQL | undefined`, routed all 4. Behavior-preserving (identical SQL). Rule-3
  green→green: delete-reminder-cascade + premium-expense-hook + financing-deactivate-hook + refinance-balance-reset drive all three source paths — GREEN before
  AND after. validate:local EXIT 0, 1466 pass. Rejected the FE dead calculateDaysUntil delete (thrice-deferred — deleting a tested export < collapsing a live
  4-site cross-tenant-boundary duplicate).*

- ~~**Extract assertVehiclesOwned — ONE source of truth for the cross-tenant vehicle-ownership query (2 repos → 1, rule-7 fan-out, done C376).**~~ —
  *DONE C376: the expense split repo (repository.ts:611) + insurance repo (repository.ts:103) each ran a private validateVehicleOwnership with a BYTE-IDENTICAL
  core `select id from vehicles where userId AND id IN (ids)` → throw NotFoundError if any unowned (behavior-equivalent: empty→no-op, dupes via Set, missing→throw).
  Differences only the splitConfig-extraction + the dbOrTx tx-handle. The C109 cross-tenant auth boundary — a divergent copy dropping userId = a cross-tenant
  vehicle write into a split/term. Extracted assertVehiclesOwned(handle, vehicleIds, userId) into a NEW dependency-free utils/vehicle-ownership.ts (no cycle);
  both privates delegate. Deliberately NOT routed through validateVehicleIdsOwned (throws ValidationError not NotFoundError → would change the observable error,
  arch rule 2). Behavior-preserving. Test-anchored: split + insurance ownership suites GREEN before AND after. validate:local EXIT 0, 1465 pass. Rejected the FE
  dead calculateDaysUntil delete (twice-deferred — deleting a tested export < collapsing a live cross-tenant-boundary duplicate).*

- ~~**Route expense-form-validation's 3 hand-built local-date strings onto the canonical toDateInputValue (3 sites → 1, rule-7 fan-out, done C370).**~~ —
  *DONE C370: expense-form-validation.ts built a local YYYY-MM-DD string BYTE-IDENTICAL at 3 sites (future-date check :44, mileage entriesBefore :103,
  entriesAfter :116) while ALREADY importing + using toDateInputValue (:2/:96). toDateInputValue (formatters.ts:97) is byte-equivalent AND the #87 timezone-fix
  locus (reads LOCAL calendar parts) — a divergent hand-built copy silently re-introduces the UTC-midnight #87/#6/#61 bug on the date-validation surface. Routed
  all 3 onto it. Behavior-preserving (byte-equivalent). Rule-3 green→green: expense-form-validation-date.test.ts (date-format + mileage ordering) pass UNCHANGED.
  fe validate:local EXIT 0, 669 pass. Rejected: the BE analytics new Date(range*1000)×3 (thin 2-line pair); the FE dead calculateDaysUntil delete (deleting a
  tested export < collapsing a live triplicate onto the #87-critical canonical helper).*

- ~~**Extract odometerRepository.vehicleScope — ONE source of truth for the odometer tenant+vehicle predicate (6 sites → 1, rule-7 fan-out, done C365).**~~ —
  *DONE C365: odometer/repository.ts repeated the raw-SQL tenant scope `vehicle_id = ${vehicleId} AND user_id = ${userId}` at SIX sites — getHistory's data
  query (2 UNION legs) + count query (2 subqueries) + getCurrentOdometer's MAX-UNION (2 legs). The #48/#52/C109 comments manually plead "scope BOTH legs" — a
  divergent copy dropping user_id on any leg = a cross-tenant history leak OR a poisoned maintenance mileage trigger (D2). Extracted `private vehicleScope(
  vehicleId, userId): ReturnType<typeof sql>`, routed all 6 (expense legs keep their `AND mileage IS NOT NULL` suffix). Rule-3 green→green verified FIRST:
  get-current-odometer.test.ts (both-source MAX, NULL-mileage exclusion, per-vehicle + #48 userId cross-tenant @:129) + odometer-history.property.test.ts pass
  UNCHANGED before AND after. Behavior-preserving (identical SQL). validate:local EXIT 0, 1456 pass. Rejected the FE calculateDaysUntil↔getDaysRemaining
  collapse (crosses 2 modules into a new file + differing input type/name → thinner collapse, more churn; deferred).*

- ~~**Extract groupOwnedBy — ONE source of truth for the split-expense tenant-scope predicate (6 sites → 1, rule-7 fan-out, done C360).**~~ — *DONE C360:
  the split-group ownership predicate `and(eq(expenses.groupId, groupId), eq(expenses.userId, userId))` was copied BYTE-IDENTICAL at SIX sites in
  expenses/repository.ts — four reads (findIdsByGroupId, getSplitExpense, delete-read, update-read) AND TWO destructive delete-writes (deleteSplitExpense,
  updateSplitExpense). Two C109 comments manually pleaded "keep ownership + deletion on the SAME predicate" — a divergent copy dropping the userId scope is a
  cross-tenant read or (worse) cross-tenant DELETE. Extracted `private groupOwnedBy(groupId, userId): SQL | undefined` (and+eq) and routed all 6 → the
  defense-in-depth boundary is enforced STRUCTURALLY now, not by comment. Behavior-preserving (identical SQL). Test-anchored: delete-split-child +
  split-service.property drive every routed path — GREEN before AND after. validate:local EXIT 0, 1454 pass. Rejected (firsthand, C21/C60): the FE
  "dead getCategoryColor/categoryLabels/getCategoryIcon" claim (FALSE — all live across 5 components + 2 routes, the C234 category-map trio); the BE
  Number(x)||0 coercion (idiomatic, variadic helper = churn); the test-only formatters rework (low leverage).*

- ~~**Extract computeAverageEfficiency — ONE source of truth for the analytics efficiency-average + empty→null guard (rule-7 fan-out, done C354).**~~ —
  *DONE C354: getQuickStats/getYearEnd/getSummary computed avgEfficiency as a BYTE-IDENTICAL 4-liner (values.length>0 ? reduce(sum)/len : null) at 3 sites,
  all off the same computeConvertedEfficiencyValues()→number[]. Extracted private computeAverageEfficiency(values)→number|null (sibling helper), routed all 3
  through it — the empty→null div-by-zero guard now lives once. −9 LOC. Analytics property/HTTP suites GREEN before AND after. validate:local EXIT 0, 1454
  pass. Rejected: the FE shared-photoApi (2 services, different naming, overlaps the rejected photo-FormData dedup).*

- ~~**Extract findOwnedProvider — ONE source of truth for the tenant-scoped provider lookup in the storage registry (rule-7 fan-out, done C348).**~~ —
  *DONE C348: getDefaultProvider/getBackupProviders/getProvider ran a BYTE-IDENTICAL `this.db.select().from(userProviders).where(and(eq(id), eq(userId)))
  .limit(1) → row[0]` (3 sites), differing only in caller null/status handling. Extracted private findOwnedProvider(providerId, userId) → UserProvider|null;
  callers keep their own throw/skip. Left getProviderInternal alone (id-ALONE no-auth variant, deliberately not routed). A divergent copy dropping the userId
  predicate = a cross-tenant read, so one source keeps the ownership scope in lockstep. −18 LOC. registry.test.ts (23 tests) GREEN before AND after.
  validate:local EXIT 0, 1444 pass. Rejected: the FE photo-upload-FormData ×4 (3-liner churn) + the cross-file backup.ts/registry.ts dedup (different
  db-access → would need two helpers, not a real collapse).*

- ~~**Extract deactivateFinancing — ONE source of truth for the financing deactivation write + side-effect (rule-7 fan-out, done C343).**~~ — *DONE
  C343: the payoff (PUT /:id/payoff) + delete (DELETE /:id) routes ran a BYTE-IDENTICAL `update({isActive:false, endDate}) + onFinancingDeactivated` pair,
  differing only in the response message + whether the updated row is echoed — a money/lifecycle drift risk (a future deactivation-cleanup change lands
  twice). Extracted `deactivateFinancing(financingId, userId) → VehicleFinancing` into hooks.ts (composes the repo write + the existing hook); routed both
  sites through it. No import cycle (repo doesn't import hooks). −10 LOC. Test-anchored: financing-deactivate-hook.test.ts drives BOTH routes — GREEN before
  AND after. validate:local EXIT 0, 1442 pass. Rejected the FE settings-store try/catch wrapper (the PERMANENTLY-rejected skeleton — bodies differ, churn).*

- ~~**Extract buildQueryString — collapse the 2 service-layer query-string builders onto one shared helper (rule-7 fan-out, done C337).**~~ — *DONE
  C337: analytics-api `buildQuery` was already the generic URLSearchParams + `value != null` + `qs ? '?'+qs : ''` form; reminder-api `buildReminderQuery`
  repeated that convention by hand. Extracted `buildQueryString` to new services/api-utils.ts + routed both through it. KEY behavior-preservation
  (verified firsthand): buildReminderQuery TRUTHY-drops vehicleId/type (empty string omitted) but isActive SURVIVES when false — mapped `vehicleId ||
  undefined` (+type) so the `!= null` shared filter doesn't start keeping empty strings, isActive passed as-is. Test-anchored: reminder-api.test.ts pins
  isActive=false-survives + empty-filter → '' — GREEN before AND after. −9 LOC. fe validate:local EXIT 0, 646 pass (unchanged). Rejected the BE
  recheckMileageReminders wrapper (thin — wraps a 1-line call + a guard that legitimately differs by call site).*

- ~~**Collapse computeBalance onto computeBalances — ONE source of truth for the financing-payment money query (rule-7 fan-out, done C332).**~~ —
  *DONE C332: computeBalance + computeBalances both ran the financing-payment money query (originalAmount lookup + `WHERE sourceType='financing' AND
  sourceId=… COALESCE(SUM(expenseAmount),0)` clamped ≥0) — a RAW-`sql` copy vs a typed-`and/eq/inArray` copy, drift-prone money duplication (a divergent
  copy silently miscounts a balance + TCO). computeBalance(id) now delegates → `(await computeBalances([id])).get(id) ?? 0` (the `?? 0` mirrors the prior
  `return 0` for a missing record). −24 LOC. Behavior-preserving + INDEPENDENTLY ANCHORED: financing-balance.property.test.ts already has a `computeBalances
  (batch) equivalence` block (batch == per-record) + Property 5/6 drive computeBalance directly — all pass unchanged. Only deltas: an error string + log
  line (no test asserts either), query count 2→2. Rejected the FE createStateAccessor factory (rewiring $state with no test net = silent-reactivity churn,
  rules 3/5) + converging calculatePayoffDateFromStart onto addMonthsClamped (local-midnight construction = a tz-difference, rule 2). validate:local EXIT 0,
  1435 pass.*

- ~~**Extract insertVehicleJunctions — dedup the reminder→vehicle junction-insert loop across create/update (filed+done C326).**~~ — *DONE
  C326: the `for (vehicleId) tx.insert(reminderVehicles)` loop was byte-identical at createWithVehicles + updateWithVehicles (differ only in
  reminder.id vs id); mirrors the insurance repo's insertJunctionRows idiom. Extracted private insertVehicleJunctions(tx, reminderId,
  vehicleIds); one source of truth for the junction write. Behavior-preserving: all 115 reminder tests pass unchanged. validate:local EXIT 0,
  1434 pass.*

- ~~**Collapse the 4× `units` field-by-field projection in analytics into a `{ ...userUnits }` spread (filed+done C320).**~~ — *DONE C320: the
  `units: { distanceUnit: userUnits.distanceUnit, volumeUnit: ..., chargeUnit: ... }` projection was hand-repeated at 4 analytics response
  sites; UnitPreferences is exactly that 3-field shape. Replaced with `units: { ...userUnits }` ×4 — so a future 4th unit auto-propagates to
  all 4 surfaces instead of silently dropping (the clientId-drop / sheets-header class). −12 LOC, tsc-confirmed, behavior-preserving (the
  analytics-routes-http + summary/cross-vehicle/fuel-stats suites pass unchanged). validate:local EXIT 0, 1433 pass.*

- ~~**Extract fetchOrThrow — dedup the byte-identical fetch-setup + error-parsing in api-client request/requestFull (filed+done C314).**~~ —
  *DONE C314: request + requestFull shared a byte-identical 37-line block (URL resolve + JSON Content-Type + credentials fetch + the
  !response.ok error-envelope parse → throw ApiError), differing only in the success path (request unwraps .data + handles 204; requestFull
  returns raw JSON). Extracted fetchOrThrow(url, options) → Promise<Response> (setup + error-check); each wrapper does its own body handling.
  ~74 LOC → 1 core + 2 thin wrappers; one source of truth for the drift-prone error parsing. Behavior-preserving: api-client.test.ts + the
  expense/analytics/reminder service suites (75 tests) pass unchanged. fe validate:local EXIT 0, 613 pass.*

- ~~**Converge the 4 inline pagination-clamp sites onto the existing clampPagination helper (filed+done C310).**~~ — *DONE C310: the
  `limit = Math.min(query.limit ?? defaultPageSize, maxPageSize); offset = query.offset ?? 0` block was hand-repeated at 4 sites
  (odometer/routes ×2, expenses/routes ×1, expenses/repository.findPaginated ×1) while utils/pagination.ts already exported clampPagination
  with ZERO callers — and the helper is the MORE CORRECT version (floors limit at minPageSize + offset ≥0, which the inline `?? 0` didn't).
  Behavior-preserving: every site's Zod schema pre-bounds limit/offset into the exact range the helper clamps to (minPageSize=1), so no-op on
  validated input + defensive if a schema loosens. Dropped a dead CONFIG import (tsc-confirmed). 221 tests unchanged, validate:local EXIT 0.*

- ~~**Extract fetchTermsAndCoverage — dedup the 5× term+coverage query-assembly in InsurancePolicyRepository (filed+done C304).**~~ — *DONE
  C304: the "select terms by policyId (endDate desc) → select term→vehicle junction rows → dedupe vehicleIds" block was byte-identical at 5
  sites (attachTermsAndCoverage + update-policy / add-term / update-term / delete-term txns), differing only in the db handle (this.db vs tx)
  + spread target. Extracted private `fetchTermsAndCoverage(handle: AppDatabase | DrizzleTransaction, policyId) → {terms, termVehicleCoverage,
  vehicleIds}`; callers spread it + add their own policy row / newTermId. Left the CREATE path alone (builds coverage IN-MEMORY from the
  just-inserted terms, not a re-query — converting = redundant round-trip + behavior change, rule 2). ~75 LOC → 1 helper. Behavior-preserving:
  all 56 insurance tests pass unchanged. validate:local EXIT 0, 1421 pass.*

- ~~**Extract simulateAmortization — dedup the twin balance-walk loops in calculateExtraPaymentImpact (filed+done C299).**~~ — *DONE
  C299: calculateExtraPaymentImpact (financing-calculations.ts) ran the SAME guarded amortization balance-walk TWICE (original payment
  vs payment+extra), byte-identical but for the payment amount. C161 recorded a hand-copied variant of this loop once LOSING its
  negative-amortization guard → these copies are a live bug vector. Extracted pure `simulateAmortization(balance, monthlyRate,
  paymentAmount, maxMonths) → {months, totalInterest}` (the `principal ≤ 0` break = the C161 guard; rate 0 ⇒ 0%-APR path #92), called
  twice; savings = the deltas. Left calculatePayoffDate's loop alone (it RETURNS on the under-funded path, not byte-identical — rule 2).
  −28 LOC, one source of truth. Test-anchored both ways: 46 financing tests pass unchanged. fe validate:local EXIT 0, 610 pass.*

*(NEW category. Three concrete items seeded below from a quick grounding scan — verify each
against current source before acting, then knock out the top one. Once these are done (or to
go broader), run the AUDIT fan-out per rule 7 to repopulate. Obey the `arch` rules above —
behavior-preserving, test-anchored, ONE small reviewable refactor per cycle.)*

- ~~**Financing routes adopt the shared `validateVehicleOwnership` (filed+done C294).**~~ — *DONE C294: financing/routes.ts
  was the LONE route module hand-rolling the vehicle-ownership guard inline (`vehicleRepository.findByUserIdAndId` + a manual
  `throw new HTTPException(404, {message:'Vehicle not found'})`) at 2 sites (GET + POST), while every sibling
  (expenses/insurance/odometer/analytics/vehicles) uses the shared `validateVehicleOwnership`. Neither site used the returned
  vehicle → clean dedup. Behavior-preserving: validateVehicleOwnership throws `NotFoundError('Vehicle')` → global handler renders
  the same 404 + "Vehicle not found"; only the raw `code` shifts 'HTTPException'→'NotFoundError' (CONVERGING financing onto the
  code every other route emits; FE never branches on either — both absent from ERROR_CODE_MESSAGES). Side win: POST 404 now logs
  as a client warn, not "Server error". -8 LOC, dead vehicleRepository import dropped. GUARD: new
  financing-vehicle-ownership-404.test.ts pins the 404+message on both routes, GREEN before AND after. validate:local EXIT 0,
  1418 pass (+2).*

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
    me-http.test.ts. Behavior-preserving, green→green 1246 pass (+1).*
  - ~~**`toDate` — the `instanceof Date ? x : new Date(x)` normalization, 4 sites → 1 (C194 inline scout)**~~ — *DONE C194:
    analytics/repository.ts hand-repeated `value instanceof Date ? value : new Date(value as unknown as number)` at 4 sites
    (fuel-monthly :689, financing startDate :796, term start+end :1003/:1007). EXCLUDED the `? x.getTime() : 0`/`: Number(x)`
    sort-comparator variants (different fallbacks — the C182-#2 trap). Extracted exported `toDate(value: Date|number|string)` beside
    monthsOwnedInYear + wired all 4. tsc surfaced that the financing site's `Date | null` local type was masking a null→epoch path
    (the old `as unknown as number` cast hid it) → preserved exactly with `?? 0` (startDate is `.notNull()` so null is unreachable
    anyway). Anchored by the existing fuel-stats/insurance-details/financing tests (green through) + 3 new toDate cases. green→green
    1266 pass (+3).*
  - ~~**`sortByVehicleThenDate` — the (vehicleId, date) fuel-row sort comparator, 3 sites → 1 (C200 inline scout)**~~ — *DONE C200:
    the ENTIRE `[...fuelRows].sort((a,b) => { vehicleId localeCompare; then date getTime })` block was hand-duplicated byte-for-byte at
    3 analytics/repository.ts sites (:1283/:1436/:2048 — the per-vehicle MPG/cost/odometer pre-sorts; the `: Number(x)` variant C194
    had noted-but-excluded, now its own clean dedup). EXCLUDED the :923 latest-term sort (different `: 0` fallback + startDate tiebreak
    — still the C182-#2 trap). Extracted `sortByVehicleThenDate` to analytics-charts.ts beside forEachVehiclePair; date-key kept VERBATIM
    (FuelExpenseRow.date is Date|number|null, never string → number=epoch-ms + Number(null)=0 unchanged). +3 tests; existing analytics
    suites green through. green→green 1272 pass (+3).*
  - ~~**`offlineExpenseToBackend` — the OfflineExpense→toBackendExpense field mapping, 3 sites → 1 (C205 inline scout)**~~ — *DONE C205:
    a STRONG fresh lead from the C204 #66 fix — the 10-field OfflineExpense→toBackendExpense mapping was copy-pasted at 3 sync sites
    (offline-storage syncOfflineExpenses + sync-manager syncSingleExpense + resolveConflict keep_local), and that drift is EXACTLY how #66
    happened (fuelType added to the online path, missed in the duplicated copies → an offline electric charge silently dropped on sync).
    VERIFIED firsthand all 3 map the same fields, differing only in a defensive `tags || []` no-op (tags is a required string[]) + the source
    var → behaviorally identical. Extracted exported `offlineExpenseToBackend(e)` to offline-storage.ts (beside the type) + wired all 3 +
    removed the now-dead toBackendExpense + ExpenseCategory imports from sync-manager. PAYOFF: collapses the triplication that bred #66 so a
    future field can't be carried in one copy and forgotten in another (NORTH_STAR #6 + regression-prevention). +3 direct helper tests (core
    mapping; the electric-charge #66 invariant at the dedup boundary; liquid control); existing sync suites green through. Caught + fixed a
    test-mock gap (sync-manager.test.ts vi.mock stubbed only 4 fns → importActual keeps the REAL pure mapper, a net improvement). green→green
    FE 545 pass (+3), tsc 0, build OK; prettier + eslint clean.*
  - ~~**`parseClampedInt` — the insurance /expiring-soon days/limit parse-clamp, 2 sites → 1 (C211 inline scout)**~~ — *DONE C211: the
    `Number.parseInt(raw) + Number.isFinite ? clamp : fallback` idiom was hand-rolled at the 2 /expiring-soon sites (days + limit), and that
    copy-paste is EXACTLY how #70 happened (limit carried the finite-guard, days didn't). Extracted `parseClampedInt(raw, fallback, min, max)`
    to utils/calculations.ts + wired both sites. PAYOFF (the C205 "dup caused the bug → dedup it" logic): the guard can't be on one param +
    forgotten on its sibling. Anchored by the C210 expiring-soon-http.test.ts (green through) + 6 unit tests. green→green 1289 pass (+6).
    SCOUTED + REJECTED as churn (C75/C99): the FE query-builders (divergent inclusion rules — C69 trap), the ~57 logging-idiom sites (C147
    doc comment EXPLICITLY excludes them — structured-log shape, not value extraction), clampPagination (pre-parsed, no NaN-guard).*
  - ~~**`calendarYearRange` — the [Jan1, nextJan1) year-boundary Date pair, 3 sites → 1 (C216 inline scout)**~~ — *DONE C216: the
    `new Date(year, 0, 1)` / `new Date(year + 1, 0, 1)` pair was hand-repeated at 3 analytics/repository.ts sites (queryTotalSpending :654,
    year-scoped vehicle-expenses :1835, getYearEnd :1937) — sites 1+2 feed `gte(start)+lt(end)`, site 3 `Math.floor(.getTime()/1000)`s the pair
    into a DateRange. Extracted exported `calendarYearRange(year): {start, end}` beside monthsOwnedInYear/toDate (the file's own year-date-helper
    cluster) + wired all 3 via destructuring. PAYOFF: one source of truth for the year-boundary pair (a future leap/half-open-edge fix lands
    once). Behavior-identical (each site consumes the 2 Dates as before; local-time preserved); anchored by the existing analytics suites (green
    through) + 3 helper tests (boundaries; the 366-day leap half-open window; 365-day non-leap). green→green 1296 pass (+3).*
  - ~~**`parseUploadedPhoto` — the multipart upload parse+File-validate block, 2 sites → 1 (C221 inline scout)**~~ — *DONE C221: the
    `parseBody() → body.photo → instanceof File → AppError('No photo file provided', 400)` block was byte-identical at both upload routes
    (photos/routes.ts:63 + vehicles/photo-routes.ts:27). Extracted `parseUploadedPhoto(c): Promise<File>` to photos/helpers.ts + wired both
    (each → `const file = await parseUploadedPhoto(c)`) + dropped the now-unused AppError import from both. PAYOFF: one source of truth for the
    upload-input contract + the seam for the #34 follow-on (size/type/magic-byte validation lands once). +3 direct tests (File→returned;
    missing→400; non-File→400, via a minimal Hono app + FormData); existing upload suites green through. green→green 1306 pass (+3). ALSO
    verified firsthand a #74 sibling-gap is NOT real: vehicles/photo-routes.ts inherits changeTracker from its parent (use('*') before .route()).*
  - ~~**`photoThumbnailResponse` — the photo byte-serve Response, 2 sites → 1 (C227 inline scout; ALSO closed security gap #77)**~~ — *DONE C227:
    the thumbnail serve `new Response(buffer, {headers})` existed at photos/routes.ts:85 + vehicles/photo-routes.ts:59 with the SAME headers
    EXCEPT the generic route carried `X-Content-Type-Options: nosniff` (C133/#35) and the VEHICLE route did NOT (#77) — so the vehicle path (the
    PRIMARY photo surface) was MIME-sniff-exploitable (client-asserted never-sniffed mimeType). Extracted `photoThumbnailResponse(buffer,
    mimeType)` to photos/helpers.ts with nosniff baked in + wired both → vehicle GAINS nosniff (security fix), generic unchanged, future drift
    prevented. UPDATED the C133 source-scan to follow the literal to the builder + pin both routes call it; NON-VACUOUS (RED with vehicle wiring
    reverted). green→green 1310 pass (+1). **#77 (vehicle-photo serve missing nosniff) CLOSED.*** **ARCH QUEUE thin — next arch cycle prefers a rule-7 fan-out over forcing a micro-dedup.**
  - **C232 (arch): trigger-service 3× `reason:'error'` skip-push → one `pushReminderSkipError` helper.** DONE — collapsed the byte-identical
    skip-push at the time/mileage/recheck catch sites into one source of truth (the skip shape can't drift between axes; the recheck axis was
    added later, C214). Test-anchored green→green (trigger-bad-interval-unit asserts skip.message contains the real error text). Confirmed AGAIN:
    the `error instanceof Error ? .message : ...` idiom across 16 files is EXCLUDED by design (C147/C211 — logger structured-shape + fixed-fallback
    stay inline); do NOT re-file it.
  - **C238 (arch): byte-identical `unitPreferencesSchema` + partial + `{ ...existing, ...partial }` merge (vehicles + settings routes) → one shared
    `utils/unit-preferences-schema.ts`.** DONE — two sources of truth for one validation contract (a future enum/message change would drift)
    collapsed to a pure module (zod + type enums only, NOT the repo-heavy validation.ts); `mergeUnitPreferences` handles the null-existing vehicle
    edge. +7 direct tests; every existing vehicles/settings route test passed UNCHANGED. The C237 mergeBackup/StorageConfig stay single-site in
    settings (config-specific — not over-extracted, rule 5).
  - **C243 (arch): financing `{...financing, computedBalance, eligibleForPayoff}` enrichment (3 sites: vehicles list + single GET, financing GET) →
    one pure `withComputedBalance` helper** (beside isEligibleForPayoff). DONE — takes the already-computed balance so it serves both the batch-Map
    and per-record paths; the SAME trio C182 collapsed the threshold across, so this finishes the derived-field-set dedup. +3 direct tests; every
    existing vehicles/financing route test passed UNCHANGED (incl. the list-financing-contract key-shape pin). green→green 1347 pass (+3).
  - **C249 (arch): duplicated `findIdsByVehicleId` body (ExpenseRepository + OdometerRepository, byte-identical select-id-and-map) → shared
    `BaseRepository.findIdsByColumn`.** DONE — protected generic in the base; each repo's named method delegates (keeps the public typed contract
    the vehicle-delete cascade relies on). Rejected the photo-cleanup-on-delete blocks (4 files, different child entity-types/repos → C75 churn
    trap) + the claim/term/expense FK-validators (different parent-scopes) as not-clean. Test-anchored green→green (vehicle-delete-cascade exercises
    both paths, passed UNCHANGED). green→green 1357 pass (unchanged).
  - **ARCH VEIN NOW RELIABLY DRY (confirmed C254).** Rejected-as-churn this cycle: analytics-api `buildQuery` vs expense-api `buildExpenseQuery`
    (different shapes — generic/`?`-prefixed/.set-only vs bare/`tags`-array/.trim/exported-tested-contract; converging forces the tested one to
    regress, the C75 outlier rule). With C249's 3 BE rejections + these 2, no clean dedup remains. STANDING GUIDANCE: an arch cycle should EXPECT to
    pivot to the next-actionable category (don't-force-a-blocked-pick) UNLESS feature work introduces a NEW genuine duplication. The BE logging-idiom
    convergence stays EXCLUDED by design (C147/C211); do NOT re-file it.

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
  - ~~**`toDateInputValue(date)` — the date→YYYY-MM-DD input idiom, 9 FE sites → 1 (C267, FE fan-out)**~~ — *DONE C267: with the
    backend twice-cert-dry (C254/C261/C266), a fresh FE fan-out found `new Date(x).toISOString().split('T')[0]` / `.slice(0,10)`
    (identical for an ISO string) hand-repeated 9× across 6 files — ExpenseForm + expense-form-validation, ReminderForm (×2), VehicleForm
    (×2), the odometer-new route, the CSV-filename in expense-api. PAYOFF (rule 5): it's the UTC off-by-one tz class the NORTH_STAR flags +
    `dateOnlyToISO` already guards on the reverse direction → one chokepoint makes the future local-date fix ONE edit not nine. Added
    `toDateInputValue(date: Date | string)` to formatters.ts (beside dateOnlyToISO, NORTH_STAR #4); BEHAVIOR-PRESERVING — replicates the
    current UTC `.slice(0,10)` EXACTLY (the local-date fix stays a future `bug` cycle). Wired all 9 (mixed Date+string) + 4 imports; the
    C135/C166 precedent (a value-identical swap can't move a pixel → no eyes-on needed). +3 unit tests. green→green fe 595 pass (+3),
    every form/service test UNCHANGED.*
  - ~~**`vehicleIdsForTerm(termVehicleCoverage, termId)` — the insurance term junction→vehicleIds derivation, 3 sites → 1 (C273)**~~ — *DONE C273: the
    `policy.termVehicleCoverage.filter(tc => tc.termId === X).map(tc => tc.vehicleId)` block was byte-identical at 3 sites in insurance/routes.ts
    (create-policy loop, addTerm, updateTerm), each feeding createTermExpenses/updateTermExpenses. Extracted a pure `vehicleIdsForTerm` to insurance/hooks.ts
    (typed `readonly TermCoverageRow[]`, decoupled from the full policy) + wired all 3 → one-liners. Behavior-preserving (faithful 1:1 map). +3 unit tests
    (filter+project order, empty/unknown→[], no cross-term leak); anchored by the existing premium-expense-hook + C272 ownership tests green→green. 1388 pass (+3).*
  - ~~**`triggerBlobDownload(blob, filename)` — the browser save-as Blob-download idiom, 2 FE sites → 1 (C278)**~~ — *DONE C278: the 7-line object-URL →
    anchor → click → revoke → remove dance was byte-identical at expense-api (CSV export) + settings-store (backup download), differing only in blob +
    filename. Extracted a pure helper to new utils/download.ts + wired both → one-liners. Behavior-preserving (same ordering; callers guard browser/ok
    upstream). +2 unit tests (jsdom URL stubs + click spy: url created+revoked, anchor clicked, no DOM leak, filename set). green→green fe 604 pass (+2).*
  - ~~**`buildAuthProviderConfig(email, avatarUrl?)` — the auth-provider config:{email,avatarUrl} shape, 3 BE sites → 1 (C283)**~~ — *DONE C283: the
    OAuth-identity config blob was hand-assembled byte-identically at auth-provider-repository create + updateProfile + auth/routes.ts new-user insert,
    and read back via config.email/config.avatarUrl → writers must stay in lockstep (FE↔BE drift class). Extracted a pure helper + wired all 3.
    Behavior-preserving (identical literal); anchored by the existing config-shape property tests + auth-routes green→green, +2 helper tests. 1400 pass (+2).
    REJECTED this scout: new Date(x*1000) (trivial), store try/catch HOF (taste/risk), createLoadState (filed direction call C79).*
  - ~~**`assertLicensePlateAvailable(plate, userId, excludeId?)` — the per-user plate-uniqueness check, 2 vehicle-route sites → 1 (C289)**~~ — *DONE C289:
    findByLicensePlate → ConflictError was hand-rolled at vehicles/routes POST + PUT (the latter adding the self-exclusion). Extracted a route helper; the
    excludeId param folds in the PUT self-exclusion (POST omits, PUT passes current id). Behavior-preserving (verified both branches); anchored by the
    existing #80/#233 plate tests green→green, +2 new tests for the excludeId branches (no-self-409 on unchanged-plate re-save; same-user dup on a DIFFERENT
    vehicle still 409s — excludeId not over-broad). 1407 pass (+2).*

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
> **🟢 RESOLVED 2026-06-11 — "Playwright sandbox-denied" was a MISDIAGNOSIS (loop-improvement #1).**
> For 60+ cycles every eyes-on tail (maintenance T7–T9, import-trackers T4–T6, recurring-expenses
> T4–T8, all deep-review screenshots) was logged "Playwright-blocked." It is NOT a sandbox issue,
> NOT a missing browser, NOT a launch-flag problem. PROVEN this session: chromium-1223 +
> headless_shell are installed, the `shot.mjs` harness is correct, and `chromium.launch()` returns
> **OK with NO flags** — but ONLY when invoked from a SCRIPT FILE. Inline `node …`/`mise exec -- node …`
> (like inline `git commit`) is refused by the permission engine; `bash some.sh` is approved. THE FIX:
> run screenshots via **`bash .meshclaw-tools/shot.sh <route> [mobile|desktop] [out.png]`** (committed
> wrapper that cd's to frontend/ + `mise exec -- node ../.meshclaw-tools/shot.mjs "$@"`), with the dev
> server up (`regress.sh START_SERVERS=1`). Same script-file rule as VROOM git commits. → The eyes-on
> tails are NO LONGER blocked: a UI-work cycle can shoot, `Read` the PNG, critique, and close T7–T9 /
> T4–T6 / T4–T8 for real. Wrap `regress.sh` the same way (`bash` it, don't inline) if it ever trips.
> *(NOTE: `.meshclaw-tools/` is gitignored, so `shot.sh` rides with the untracked toolkit, not the PR.)*

> **STANDING CADENCE (loop-improvement #5): every ~10 cycles, run a branch-hygiene sweep** — the
> loop is now 50+ commits deep on `claude-loop-dev` headed for one big human PR. Each sweep:
> (1) `git status` for untracked `*.test.ts` OUTSIDE the by-design-untracked set (`*.meshclaw.e2e.ts`)
> — bun discovers tests by filesystem, so an untracked spec counts locally every cycle but VANISHES
> on merge, silently dropping its coverage (confirmed cyc 200); commit or delete any stray;
> (2) full `regress.sh` for a clean green baseline; (3) refresh `BRANCH_REVIEW.md` (gitignored), grouping
> commits since the last refresh by theme so the eventual PR stays reviewable. Counts as one `infra`
> increment; the most recent sweep cycle is noted in the LEDGER so the next is easy to time.

*(queue empty — repopulate as loop tooling / docs needs surface. #5 branch-hygiene sweep DONE C340 (branch 150 commits C190–C339; zero stray untracked .test.ts; BRANCH_REVIEW.md scope 139→150, +§31 the C329–C339 delta [#99/#101 fixed, #100 escalated], pending-Angelo +#100; coverage carried from the C323 re-measure be 86.53% / fe 84.39%), next due ~C350; CLAUDE.md refresh DONE C335 (suite ~1434/619 → ~1440/641); a TARGETED suite-size re-fix DONE C346 (~1440/641 → ~1444/658); #5 sweep DONE C351 (branch 161 commits, +§32 the C340–C350 arc, coverage re-measure be 86.25/86.67 · fe 84.17/83.9/76.32 — ~flat vs C323), next sweep ~C361; CLAUDE.md FULL refresh DONE C357 (coverage line C323→C351 reading + plateau framing + the post-C223 FE-ratchet narrative; suite ~1454/659; closed-bug+pending-Angelo verified current), next ~C370. NOTE C164/C165 (still standing): feature chronically starved (eyes-on-blocked + money-cents/trips both T0-gated) — escalated to Angelo for a horizon-spec steer + the T0 ratify; trips T1–T5 are loop-buildable once cleared.)*
- ~~**#5 branch-hygiene sweep + coverage re-measure + BRANCH_REVIEW.md refresh (C447)**~~ — *DONE C447 (infra OVER budget 7>6; cadence overdue, last actual sweep C435).
  (1) zero stray untracked unit/spec .test.ts; branch 257 commits, 0 behind, clean fast-forwardable. (2) green baseline + RE-MEASURE: be 86.96% line / 86.55% func (1538 pass,
  ~flat vs C435 86.94/86.60); fe 85.89% line / 87.15% func / 78.35% branch (713 pass, UP +0.63 line vs C435 — the C436/C444 guards); BE↔FE gap ~1.1pts, tightest ever.
  (3) BRANCH_REVIEW.md refresh: 245→257 commits, +§34 (the 12-commit C435–C446 delta — 6 bugs incl. the #136 NORTH_STAR-#1 silent-Sheets-backup-gap, the offline↔sync family
  fully-collapsed (C444), 4 escalations/notes filed). Doc/measurement-only. Next #5 ~C457; CLAUDE.md ~C450.*
- ~~**#5 branch-hygiene sweep + coverage re-measure + BRANCH_REVIEW.md refresh (C435)**~~ — *DONE C435 (infra most-starved 6/6; cadence overdue, last actual sweep C423).
  (1) zero stray untracked unit/spec .test.ts (all untracked = by-design *.meshclaw.e2e.ts + .meshclaw-tools/ + screenshots + configs); branch 245 commits, 0 behind, clean
  fast-forwardable. (2) green baseline + RE-MEASURE: be 86.94% line / 86.60% func (1532 pass, vs C423 86.93/86.57 flat-to-up); fe 85.26% line / 85.53% func / 77.40% branch
  (697 pass, UP +0.75 line vs C423 — the C426/C432 dead-code/dup removal raised the covered ratio); BE↔FE gap ~1.7pts, tightest ever. (3) BRANCH_REVIEW.md refresh: 161→245
  commits, +§33 (the 84-commit C351–C434 delta — ~22 bugs incl. 2 HIGH, ~19 dedups, 6 escalations filed). Doc/measurement-only. Next #5 ~C445; CLAUDE.md ~C439.*
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
