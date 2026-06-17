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
*(All three are spec-APPROVED + BACKEND-COMPLETE; only the eyes-on frontend tail remains. These were
"Playwright-blocked" for ~200 cycles — that was a MISDIAGNOSIS (see GUIDE.md): shot.sh works now, so
the FE→BE→DB round-trip can finally be built, shot, and verified. Feature-DoD: not done until that
round-trip is exercised eyes-on.)*

1. ~~**Maintenance-schedule reminders**~~ — **DONE (C1 2026-06-17).** Backend was 100%; the last tail
   (T7/T8/T9 eyes-on) is now CONFIRMED via shot.sh — the mileage form reveal/hide logic + the
   `Next: <odometer>` milestone render + the working "Serviced" re-arm button all verified by Reading the
   captured PNGs, full FE→BE→DB→render round-trip exercised. Spec ticked `[x]`. *Two follow-ons stay
   flagged to Angelo (NOT loop-fixable): lease/loan miles-used currentMileage-vs-currentOdometer (confirm
   the C157 all-time landing); "Current Mileage" card display-semantics direction call.* (NOTE: the
   `.meshclaw.e2e.ts` spec is gitignored-by-design — the committed regression net is the backend
   mileage/mark-serviced unit + HTTP-harness tests, per GUIDE "source-scan > untracked e2e".)
2. **Import from other trackers** — backend complete (T1 applyMapping, T2 presets+detectSource, T3
   `POST /import` optional mapping + `/import/detect`) + FE client methods (importExpensesCsv mapping arg +
   detectImportSource). **REMAINING: T4/T5 mapping-step dialog MARKUP** (detected-source banner, per-field
   column dropdowns, unit/date-format/target-vehicle pickers, category-remap table; reuse the preview/commit
   step) **+ T6 round-trip e2e** (incl. real-export signature validation). Spec: `.kiro/specs/import-trackers/`.
3. **Recurring expenses** — backend complete (engine already auto-materializes expense rows from
   `type:'expense'` reminders; T1 traceability, T2 split-materialization, T3 cascade-safe delete via
   clearSource, T5 gate `shouldTriggerRecurringExpenses`, T6/T7 FE client methods — all in archive).
   **REMAINING: T4–T8 frontend MARKUP** — T4 multi-vehicle split in ReminderForm (reuse split widget); T5
   the app-init/focus hook that calls the gate + POSTs `reminderApi.trigger()`; T6 "Recurring" badge + view;
   T7 dashboard run-rate widget; T8 round-trip e2e. Spec: `.kiro/specs/recurring-expenses/`.

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
> Angelo), the offline outbox→sync field-mapping (the #66/#101/#111 dropout family — is every
> OfflineExpense field carried through both save paths + the mapper?), or a fresh data-safety write path.

### guard
*(queue empty — repopulate from real bug classes. Pattern: HTTP-harness (createTestApp + s3-provider
seam) or a source-scan committed test. Pure-logic coverage is largely saturated — the live frontier is
the now-shootable eyes-on FE + any newly-touched module.)*

### bug
*(queue empty of fresh finds. The productive vein (per the archive): write-path VALIDATION ASYMMETRY —
a route checks parent ownership but writes FK/config fields verbatim; and date/tz math. One fresh-surface
scout per bug cycle, then record + pivot if dry. Don't manufacture a finding.)*

> **CLOSED C2: #147** — PUT /split/:id didn't re-validate the carried-forward financing source link
> against the NEW vehicle set (the regenerated siblings could land on a vehicle whose active financing
> isn't sourceId → understated balance). Fixed via the shared `assertSplitFinancingSourceValid` on both
> split paths + 3 guards. **The #62/#109/#125/#145/#147 within-tenant financing-source-link integrity
> class is now closed across ALL FOUR write paths: regular POST, regular PUT, split CREATE, split UPDATE.**
> Don't re-scout this class — it's saturated. Next bug scout: try a DIFFERENT vein (date/tz math, the
> offline-outbox field-dropout family #66/#101/#111, or analytics split-sibling overcount if any builder
> was missed by the #56/#108/#113/#146 sweep).

> **PENDING ANGELO — product/architecture calls, do NOT auto-fix (each changes a displayed $/HTTP
> behavior or needs a product decision). Carried from the archive; full grounding there.**
> - **#36 (HIGH)** — Google Sheets backup writes `USER_ENTERED` → formula injection + round-trip corruption (ARCC-consult before fixing).
> - **#37 (HIGH)** — Sheets backup is a non-atomic in-place rewrite that can destroy the only good copy.
> - **#127 (HIGH, data-safety)** — replace-mode restore wipe; concrete trigger mitigated C428, the GENERAL fix is a tx-semantics change (arch rule-6, escalated).
> - **#100 (arch-gated)** — userPreferences un-serialized read-modify-write lost-update race across 5+ write sites (settings/providers).
> - **#129 (MED)** — credentials/account-linking finding (see archive C-note ~line 197).
> - **#94 (MED, broadened to a 6-member CLASS)** — fleet-SUMMARY fuel-stats builders pool mixed units without conversion (getCrossVehicle is the correct contrast).
> - **#88 (MED)** — split recurring-expense reminder keeps stale vehicleId in expenseSplitConfig JSON when a vehicle is deleted (junction cascades, blob doesn't).
> - **#97 (LOW-MED)** — vehicle-delete leaves a sole-linked reminder active-but-orphaned (junction cascades, reminder row survives is_active=1).
> - **#98 (MED)** — sync-manager keep_local sends forceOverwrite, silently stripped by Zod → offline edit lost on true clientId collision.
> - **#85 (MED)** — fuel-stats "This/Last Year" is range-relative, not calendar-year (labeling decision).
> - **#69 (MED)** — a monthly-only insurance term shows in analytics but is absent from TCO (materialize vs analytics-only?).
> - **#51 (LOW)** — an active policy with no terms inflates activePoliciesCount while contributing $0.
> - **#22 (MED, hardening)** — zip-bomb guard trusts attacker-declared header.size; needs a compression-ratio cap (approach-gated).
> - **#79 (LOW)** — a malformed fuel offline entry can get stuck (data-hygiene).
> - **#112 (LOW)** — cross-vehicle analytics chart palette legibility (design-gated).
> - **efficiency-band unification (#94-adjacent, ESCALATED C419)** — per-vehicle stats (0,150) vs analytics [5,100]/[1,10] give the same car two different averages; pick one band.
>
> _(REMOVED C1 2026-06-17: **#140 LeaseMetricsCard annual-vs-total** — verified ALREADY FIXED + merged via
> "Merge Monday (#112)"; all 3 display sites route through `leaseTotalMileageAllowance`. It was stale
> post-reset doc-drift, not open work. Don't re-pick it.)_

### arch
*(queue empty — reliably DRY per the archive (last clean picks: buildQueryString C337, computeBalances C332).
Run a fresh dedup scout; if nothing clean surfaces, record "no churn warranted" + pivot. Obey the arch rules above.)*

### infra
*(queue empty — repopulate as tooling/docs/coverage needs surface. Standing cadence (loop-improvement #5):
~every 10 cycles run a branch-hygiene sweep — `git status` untracked-`*.test.ts` check (bun discovers by
filesystem; untracked specs vanish on merge), full regress, coverage re-measure (update the LEDGER cov:
baseline), refresh `BRANCH_REVIEW.md` grouped by theme so the eventual PR stays reviewable.)*
