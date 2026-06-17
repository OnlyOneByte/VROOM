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

- [ ] **T4 — Multi-vehicle split in `ReminderForm` (R2, D3).** Expose `expenseSplitConfig` when
      `type==='expense'` and >1 vehicle is selected, **reusing the existing expense-split widget**; wire
      it into the create/update payload (today hard-null at ReminderForm:52-53). Four-states + a11y;
      single-vehicle keeps the no-split path. Eyes-on screenshot of the split sub-form.
- [ ] **T5 — Reliable materialization (R1, D1).** Client-side opportunistic `reminderApi.trigger()` on
      app init/focus, debounced once per session/day (localStorage timestamp), authed + online only;
      keep the manual button + a "N due" nudge. Unit-test the gate (single call / skip-when-recent /
      skip-when-offline). Document the optional cron-hits-the-endpoint path for self-host deployments.
      **GATE DONE (C128):** `shouldTriggerRecurringExpenses({isAuthed,isOnline,lastRunMs,now?})` in
      reminder-helpers.ts — the pure decision (authed+online+(never-run OR prior-local-day)); +5 unit
      tests. The backend (`POST /reminders/trigger`) + client (`reminderApi.trigger()`) already existed.
      **REMAINING (eyes-on):** the app-init/focus hook that reads navigator.onLine/auth/localStorage,
      calls the gate, and POSTs trigger() on true (+ the "N due" nudge + manual button wiring).
- [ ] **T6 — Source traceability UI (R3).** "Recurring" badge on expense rows where
      `sourceType==='reminder'`, linking to the source reminder; from the reminder, a "materialized N
      expenses" view. Eyes-on screenshot. **BACKEND SEAM DONE (C122):** `GET /reminders/:id/expenses`
      → `expenseRepository.findBySource('reminder', id, user.id)` → the materialized rows (ownership-
      checked, user-scoped); +4 HTTP tests (reminder-materialized-expenses-route.test.ts). The "N
      expenses" view fetches this. **FE CLIENT METHOD DONE (C134):** `reminderApi.getMaterializedExpenses(id)
      : Promise<Expense[]>` (+ reminder-api.test.ts). **REMAINING (eyes-on):** the badge + the view MARKUP.
      (The badge's read data — sourceType/sourceId on the expense list — was already surfaced at T1/C96.)
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

- [ ] **T8 — Round-trip E2E.** Create a split recurring expense in one form → app open (or click) →
      sibling rows materialize → appear in each vehicle's TCO with a Recurring badge → delete the source →
      past rows remain + cascade dialog shown. Promote into the committed suite, or record
      "code-complete, eyes-on pending" if Playwright stays sandbox-blocked. Only then is the feature DONE.

> NOTE: T1–T3 are backend/non-eyes-on and can land while Playwright is blocked — directly addressing why
> the `feature` category starved (both in-flight features are stuck at eyes-on-blocked frontend tails).
> T4–T8 are eyes-on. The whole feature reuses the existing engine, so no existing behavior regresses.
