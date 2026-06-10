# Recurring Expenses — Tasks

> **Status: T0 SIGNED OFF (D1–D4 ratified C94) — T1 is the next backend build.** One task per loop cycle, not one-and-done — same
> multi-cycle shape as maintenance-schedule / import-trackers. Each task is independently verified
> (`bun run validate` / frontend `validate:local` / eyes-on + the round-trip E2E per the feature-DoD
> rule). The engine is reused unchanged throughout — see `design.md` grounding.

- [x] **T0 — Sign-off gate (APPROVED C94).** Angelo ratified D1–D4 in `requirements.md` (all recommended
      options). **Build unblocked.** (The load-bearing premise — extend the existing expense-reminder engine,
      do NOT build a new `recurring_expenses` table/scheduler — is confirmed.)

### Backend / trust-first (D4 order)

- [ ] **T1 — Grounding check + traceability response (R3, A1).** Confirm whether the expense GET
      response and the frontend `Expense` type carry `sourceType`/`sourceId`. If missing on the read
      path, surface them; **lock the new key-shape with the FE↔BE contract-drift guard** (loop-improvement
      #2 pattern). Pin a backend test that a reminder-materialized expense reports `sourceType:'reminder'`.
      *(Largely non-eyes-on — a response/type + guard.)*
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
- [ ] **T6 — Source traceability UI (R3).** "Recurring" badge on expense rows where
      `sourceType==='reminder'`, linking to the source reminder; from the reminder, a "materialized N
      expenses" view. Eyes-on screenshot. **BACKEND SEAM DONE (C122):** `GET /reminders/:id/expenses`
      → `expenseRepository.findBySource('reminder', id, user.id)` → the materialized rows (ownership-
      checked, user-scoped); +4 HTTP tests (reminder-materialized-expenses-route.test.ts). The "N
      expenses" view fetches this. **REMAINING (eyes-on):** the badge + the view UI. (The badge's read
      data — sourceType/sourceId on the expense list — was already surfaced at T1/C96.)
- [ ] **T7 — Recurring-cost visibility (R5, D4).** Dashboard "upcoming recurring costs" + monthly
      recurring run-rate (derive on read; amount × normalized-to-monthly frequency); a "Recurring
      expenses" lens over the existing expense-type reminders (no migration). Eyes-on screenshot.
      **BACKEND CORE DONE (C111):** `reminder-cost.ts` (pure, no DB) — `occurrencesPerYear` /
      `monthlyRunRate(reminder)` / `recurringCostSummary(reminders[])`→{count,monthlyTotal}, on an
      occurrences-per-year÷12 basis mirroring `computeNextDueDate`'s frequency interpretation; only
      active positive-amount expense reminders contribute. +10 unit tests (reminder-cost.test.ts).
      **ROUTE DONE (C116):** `GET /api/v1/reminders/recurring-cost` → findByUserId(type:'expense') →
      recurringCostSummary → {count, monthlyTotal}; +3 HTTP tests (recurring-cost-route.test.ts:
      monthly+yearly sum, empty→zero, user-scoped). **BACKEND T7 COMPLETE. REMAINING (eyes-on):** the
      dashboard widget/lens that fetches GET /recurring-cost + renders it.

### Done-when (feature-DoD)

- [ ] **T8 — Round-trip E2E.** Create a split recurring expense in one form → app open (or click) →
      sibling rows materialize → appear in each vehicle's TCO with a Recurring badge → delete the source →
      past rows remain + cascade dialog shown. Promote into the committed suite, or record
      "code-complete, eyes-on pending" if Playwright stays sandbox-blocked. Only then is the feature DONE.

> NOTE: T1–T3 are backend/non-eyes-on and can land while Playwright is blocked — directly addressing why
> the `feature` category starved (both in-flight features are stuck at eyes-on-blocked frontend tails).
> T4–T8 are eyes-on. The whole feature reuses the existing engine, so no existing behavior regresses.
