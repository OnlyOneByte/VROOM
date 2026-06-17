# Recurring Expenses — Tasks

> **Status: T0 SIGNED OFF (D1–D4 ratified C94) — T1 is the next backend build.** One task per loop cycle, not one-and-done — same
> multi-cycle shape as maintenance-schedule / import-trackers. Each task is independently verified
> (`bun run validate` / frontend `validate:local` / eyes-on + the round-trip E2E per the feature-DoD
> rule). The engine is reused unchanged throughout — see `design.md` grounding.

- [x] **T0 — Sign-off gate (APPROVED C94).** Angelo ratified D1–D4 in `requirements.md` (all recommended
      options). **Build unblocked.** (The load-bearing premise — extend the existing expense-reminder engine,
      do NOT build a new `recurring_expenses` table/scheduler — is confirmed.)

### Backend / trust-first (D4 order)

- [x] **T1 — Grounding check + traceability response (R3, A1) — DONE C96.** Grounding found the read path
      was ALREADY a no-op: all expense reads use bare `.select()` (every column incl. sourceType/sourceId)
      and `buildPaginatedResponse` passes rows verbatim — no mapper to fix; the frontend `Expense` type
      already declares `sourceType?`/`sourceId?` (expense.ts:57-58). Per C80, a contract-drift guard is NOT
      warranted on a clean repository pass-through (it's not a hand-assembled response). The genuine
      deliverable shipped: `expense-source-traceability.test.ts` pins the OBSERVABLE HTTP contract through
      the real stack (route→trigger→split/insert→DB→GET serialize) — a materialized expense echoes
      `sourceType:'reminder'`/`sourceId` in the response (the C91 positive-contract class; the existing
      trigger-expense.test.ts only checked the DB row, which a dropped mapper would pass while breaking the
      T6 badge), and a manual expense reports null. validate:local EXIT 0 (1103 pass, +3). *(C170: ticked —
      the checkbox was stale; T1 shipped C96. With this, ALL recurring-expenses BACKEND tasks [T1–T3 + T5
      gate + T6/T7 seams] are complete — only the eyes-on UI tail [T4/T5-hook/T6/T7 markup + T8 e2e] remains.)*
- [x] **T2 — Split materialization characterization (R6) — DONE C102.** Extended
      `trigger-expense.test.ts` (+2): an even-split ($100 across 2 vehicles → 2× $50) and a
      percentage-split (75/25 of $200 → $150/$50) expense reminder fires → N sibling rows with correct
      shares summing to the template amount, shared groupId, `split_method`, and every sibling stamped
      `sourceType:'reminder'`/`sourceId` (the path at `trigger-service.ts:147-163`). Grouped by groupId so
      the overdue catch-up months assert independently. Anchors T4 before any form change. validate:local
      EXIT 0 (1112 pass).
- [x] **T3 — Cascade-safe delete (R4, D2) — DONE C104.** Wired `expenseRepository.clearSource('reminder',
      id, user.id)` into `DELETE /reminders/:id` (routes.ts) between the ownership check and the reminder
      delete — best-effort (try/catch so a clearSource hiccup can't block the delete). Keeps history, NULLs
      the link; mirrors the C85 `onFinancingDeactivated` idiom. HTTP test (delete-reminder-cascade.test.ts,
      +2): expense reminder → trigger → DELETE → rows REMAIN ($125.50, same count) with sourceType/sourceId
      nulled + nothing still linked; notification reminder delete is a clean no-op. validate:local EXIT 0
      (1114 pass). **Backend T1–T3 COMPLETE.**

### Frontend (eyes-on; Playwright-blocked here → "code-complete, eyes-on pending")

- [x] **T4 — Multi-vehicle split in `ReminderForm` (R2, D3) — DONE C22 2026-06-17 (eyes-on CONFIRMED).**
      Exposed `expenseSplitConfig` when `kind==='expense'` and ≥2 vehicles are selected with a positive
      amount, **reusing the shared `SplitConfigEditor`** (the same widget the expense + insurance-term
      forms use — InsuranceTermForm was the copy template). Wired into the create/update payload (replaced
      the hard-null): `buildSplitConfig()` returns `null` for notification/single-vehicle/unsplit (so the
      trigger keeps materializing one row on `vehicleIds[0]`, unchanged) and a `ReminderSplitConfig` union
      otherwise; `resetSplitAllocations` (the C415 shared seed) re-seeds on method + vehicle-toggle so the
      100/N percentage can't drift; edit-open reads the stored config back. Client-side split validation
      mirrors the backend `refineSplitConfig` (percentages→100, fixed-$→amount) so submit blocks before a
      400. ✅ EYES-ON CONFIRMED via `reminder-expense-split.meshclaw.e2e.ts` + two PNGs (Read): with 2
      vehicles + $200, the "Split across vehicles" editor reveals — **even** shows Daily Driver $100.00 /
      Weekend Car $100.00 · Total $200.00; switching to **%** reveals per-vehicle inputs seeded 50/50. The
      created reminder persists `expenseSplitConfig:{method:'even', vehicleIds:[2]}` (read back via GET).
      Four-states + a11y (per-vehicle `aria-label`s from the editor); single-vehicle keeps the no-split path
      (reminder-expense-type spec still green). frontend validate:local GREEN (type-check 0, build, 721).
- [x] **T5 — Reliable materialization (R1, D1) — DONE C12 2026-06-17 (eyes-on CONFIRMED).** Client-side
      opportunistic `reminderApi.trigger()` on app init, debounced once per local calendar day
      (localStorage timestamp), authed + online only. **GATE DONE (C128):**
      `shouldTriggerRecurringExpenses({isAuthed,isOnline,lastRunMs,now?})` (pure decision). **HOOK DONE
      (C12):** `maybeTriggerRecurringExpenses({isAuthed,isOnline,isBrowser,trigger,now?})` in
      reminder-helpers.ts — reads/writes the `RECURRING_TRIGGER_TS_KEY` localStorage debounce around the
      pure gate, POSTs the injected trigger, stamps the timestamp ONLY on success (a failed POST retries
      next open), fail-soft + corrupt-timestamp→never-run. Wired into +layout.svelte's authenticated-init
      `$effect` (once per session via `recurringTriggered`), injecting `reminderApi.trigger` +
      `onlineStatus.current`. +5 unit tests (trigger+stamp / skip-when-today / skip-offline-or-unauthed /
      no-stamp-on-failure / no-op-off-browser / corrupt-timestamp). ✅ EYES-ON CONFIRMED via shot.sh
      (`/tmp/t5-dash.png`): seeded an OVERDUE expense reminder, did NOT trigger manually, loaded
      /dashboard → the backend log shows exactly ONE app-fired `POST /reminders/trigger → 200` (the script
      never calls it) → 12 catch-up expenses materialized (0→12) → the dashboard "Recurring Costs" widget
      renders $99/mo · 1 reminder + "Upcoming Reminders" shows the due reminder. The manual "Run due
      reminders" button (on /reminders) is unchanged. (The "N due" nudge + window-focus re-trigger are
      optional polish, not blockers — the once-per-day init trigger satisfies R1/D1.)
- [x] **T6 — Source traceability UI (R3) — DONE (badge C9 + view C16, both eyes-on CONFIRMED).**
      **BACKEND SEAM (C122):** `GET /reminders/:id/expenses` → `expenseRepository.findBySource('reminder',
      id, user.id)` (ownership-checked, user-scoped); +4 HTTP tests. **FE CLIENT METHOD (C134):**
      `reminderApi.getMaterializedExpenses(id)`. **BADGE (C9, eyes-on):** `RecurringExpenseBadge.svelte` on
      expense rows where `sourceType==='reminder'` (desktop ExpensesTable + mobile card); confirmed via
      shot. **VIEW (C16, eyes-on):** `MaterializedExpensesDialog.svelte` (Dialog + four-states:
      loading/data/empty/error-retry, composed from the kit), opened from a Receipt "View materialized
      expenses" button on every expense-type reminder card on /reminders; fetches getMaterializedExpenses,
      lists each row (category · date · vehicle · amount) + an "N expenses · $total" summary. ✅ EYES-ON
      CONFIRMED via the materialized-expenses-dialog.meshclaw.e2e spec (`/tmp`/screenshot Read): an overdue
      monthly $75 reminder triggered → 12 catch-up rows → the dialog renders "12 expenses · $900.00 total"
      with each Financial · {date} · Daily Driver · $75.00 row. Backend log confirms the dialog-open fired
      GET /reminders/:id/expenses. Full FE→BE→DB→render round-trip.
- [x] **T7 — Recurring-cost visibility (R5, D4) — DONE C5 2026-06-17 (eyes-on CONFIRMED).** Dashboard
      monthly recurring run-rate over the existing expense-type reminders (no migration).
      **BACKEND CORE DONE (C111):** `reminder-cost.ts` (pure, no DB) — `occurrencesPerYear` /
      `monthlyRunRate(reminder)` / `recurringCostSummary(reminders[])`→{count,monthlyTotal}, on an
      occurrences-per-year÷12 basis mirroring `computeNextDueDate`'s frequency interpretation; only
      active positive-amount expense reminders contribute. +10 unit tests (reminder-cost.test.ts).
      **ROUTE DONE (C116):** `GET /api/v1/reminders/recurring-cost` → findByUserId(type:'expense') →
      recurringCostSummary → {count, monthlyTotal}; +3 HTTP tests. **FE CLIENT METHOD DONE (C134):**
      `reminderApi.getRecurringCost()` → `RecurringCostSummary`. **MARKUP DONE (C5):** new
      `RecurringCostCard.svelte` (composed from the kit — Card/Button/Skeleton/EmptyState; four-states:
      loading skeleton / data figure / zero→EmptyState; renders `formatCurrency(monthlyTotal)/month` +
      "across N recurring expenses" + a "View Recurring Expenses" link to /reminders), wired into the
      dashboard page (parallel `getRecurringCost()` fetch that degrades to {0,0} on failure so a
      reminders-service hiccup never blanks the dashboard). ✅ EYES-ON CONFIRMED via shot.sh
      (`/tmp/dash-recurring.png`): with two seeded monthly expense reminders ($120 insurance + $400 loan)
      the card renders **$520.00 / month · across 2 recurring expenses** — matching the live endpoint
      `{count:2, monthlyTotal:520}`. Full FE→BE→DB→render round-trip exercised.

### Done-when (feature-DoD)

- [x] **T8 — Round-trip E2E — DONE C27 2026-06-17 (eyes-on CONFIRMED).** Full feature-DoD chain proven
      via `recurring-expense-roundtrip.meshclaw.e2e.ts` (gitignored harness): create a SPLIT recurring
      expense (2 vehicles, even split, $100, overdue Oct–Dec 2024) → `POST /reminders/trigger` materializes
      one sibling per vehicle per overdue month, each `sourceType:'reminder'` + `expenseAmount:50` (even
      split of $100 / 2) + carrying the template tag → delete the source reminder → the materialized rows
      SURVIVE (T3 clearSource: history kept, `sourceType`/`sourceId` nulled, none still linked). EYES-ON
      (`/tmp/c27-roundtrip-badged-expenses.png`, Read): /expenses renders the **⟳ Recurring** badge (C9/T6)
      on a reminder-sourced row + the **⑂ Split** badge on the collapsed 2-vehicle split group ($200 group
      total, per-sibling $50 on expand). Harness lessons recorded: hono/csrf 403s a bodyless
      `page.request` POST/DELETE (trigger/delete) → send `content-type: application/json`; split siblings
      render COLLAPSED at the group total (assert the per-sibling share via API, not a UI `$50` substring);
      2024-dated rows paginate off page 1 of 150 (assert materialization via the API, tag-filtered).
      **Recurring-expenses is now COMPLETE (T1–T8 all done).**

> NOTE: T1–T3 are backend/non-eyes-on and can land while Playwright is blocked — directly addressing why
> the `feature` category starved (both in-flight features are stuck at eyes-on-blocked frontend tails).
> T4–T8 are eyes-on. The whole feature reuses the existing engine, so no existing behavior regresses.
