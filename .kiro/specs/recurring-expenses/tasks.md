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
- [ ] **T2 — Split materialization characterization (R6).** If not already pinned, add the
      characterization that an expense-type reminder with an even / percentage / absolute
      `expenseSplitConfig` fires → N sibling expense rows with correct shares + `sourceType:'reminder'`
      (the path at `trigger-service.ts:148-163`). Anchors T4 before any form change. *(Backend test only.)*
- [ ] **T3 — Cascade-safe delete (R4, D2).** On reminder delete/deactivate, sever the link on
      already-materialized rows via `clearSource('reminder', id, userId)` (keep history; do NOT
      `deleteBySource`). Mirror the C85 `onFinancingDeactivated` idiom for consistency. HTTP test:
      delete a source → past expense rows remain, link nulled, no future materialization. *(Backend.)*

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
      expenses" view. Eyes-on screenshot.
- [ ] **T7 — Recurring-cost visibility (R5, D4).** Dashboard "upcoming recurring costs" + monthly
      recurring run-rate (derive on read; amount × normalized-to-monthly frequency); a "Recurring
      expenses" lens over the existing expense-type reminders (no migration). Eyes-on screenshot.

### Done-when (feature-DoD)

- [ ] **T8 — Round-trip E2E.** Create a split recurring expense in one form → app open (or click) →
      sibling rows materialize → appear in each vehicle's TCO with a Recurring badge → delete the source →
      past rows remain + cascade dialog shown. Promote into the committed suite, or record
      "code-complete, eyes-on pending" if Playwright stays sandbox-blocked. Only then is the feature DONE.

> NOTE: T1–T3 are backend/non-eyes-on and can land while Playwright is blocked — directly addressing why
> the `feature` category starved (both in-flight features are stuck at eyes-on-blocked frontend tails).
> T4–T8 are eyes-on. The whole feature reuses the existing engine, so no existing behavior regresses.
