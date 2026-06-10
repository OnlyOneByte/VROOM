# Recurring Expenses — Requirements

> **Status: DRAFT — awaiting Angelo sign-off on D1–D4.** Drafted by the autonomous loop (cycle 88).
> **Key grounding (verified against source, not assumed):** the recurring-expense *engine already
> exists* — an `type: 'expense'` reminder auto-creates real expense rows on its frequency. This spec
> therefore **closes the gaps on the existing engine** (exposure, reliable materialization,
> traceability) — it does **NOT** add a new `recurring_expenses` table or a parallel scheduler
> (that would reinvent the reminder engine; NORTH_STAR #4 "compose, don't reinvent"). Grounding in
> `design.md`.

## Problem

"Recurring expenses" reads like a missing feature, but it is mostly **already built and under-exposed**.
Verified in `backend/src/api/reminders/trigger-service.ts`: when an `type:'expense'` reminder's time
axis fires, the backend inserts a real expense row — single (`createExpenseFromReminder` :125-143) or a
multi-vehicle split via the hardened `expenseSplitService` (:148-163) — stamped `sourceType:'reminder'`,
on the reminder's `frequency` cadence, inside the same transaction that advances `nextDueDate`. Those
rows flow into TCO/$-per-month/$-per-mile automatically (analytics reads raw rows by `category` +
`sourceType`). The frontend `ReminderForm` already offers a **"Recurring expense"** type with category
+ amount.

So the gaps aren't the engine — they're three concrete holes that make recurring costs **untrustworthy
and invisible** for the real use cases (insurance premium, loan payment, parking pass):

1. **Materialization is manual-only.** The due-trigger runs **only** when the user clicks "Run due
   reminders" on `/reminders` (`+page.svelte:97-114`). There is no on-login/app-open trigger and a
   self-hosted PWA has no always-on cron. A user who sets a "$150/month insurance premium" and never
   clicks sees **zero** of those expenses in their TCO — a silent under-count of true cost of ownership
   (brushes NORTH_STAR #1, "no silent loss," on the cost-completeness axis).
2. **Multi-vehicle split is not exposed.** `ReminderForm` intentionally omits `expenseSplitConfig`
   (:52-53). A household "$150 insurance covering 2 cars" can't be one recurring expense — the user must
   hand-make two $75 reminders, which drift apart on edit.
3. **No traceability.** An auto-created expense doesn't show it came from a recurring source — no badge,
   no link back to the reminder that made it. A user sees "3 expense(s) created" in a toast, then can't
   tell which rows are recurring or jump to edit the source.

## Goal

Make recurring costs **first-class and reliable** on top of the *existing* expense-reminder engine —
reusing `computeNextDueDate`, the frequency model, `expenseSplitService`, and `sourceType/sourceId` —
by adding only the three missing pieces: **reliable materialization without a cron**, **multi-vehicle
split exposure**, and **source traceability** — plus a light "recurring costs" lens so users find the
capability by the cost mental-model, not just the reminder one. No new write path, no schema for a
parallel scheduler.

## Functional requirements

- **R1 — Reliable materialization without an always-on cron.** Due recurring expenses must actually
  appear in the user's data without depending on them remembering a button. The trigger is already
  idempotent (dedup) + atomic, so it is safe to run opportunistically. Mechanism is **D1** (recommended:
  auto-run the due-trigger on app open/focus, debounced once per session/day, keeping the manual button).
  A deployment that *does* have a scheduler can also call the existing endpoint on a cron — documented,
  not required.
- **R2 — Multi-vehicle split in the create/edit form.** Expose `expenseSplitConfig` in `ReminderForm`
  for expense-type reminders, **reusing the existing expense-split UI** (even / percentage / absolute),
  so one recurring expense can cover N owned vehicles. The backend already validates + materializes
  splits (`refineSplitConfig`, `expenseSplitService`) — this is exposure, not new logic. **[D3]**
- **R3 — Source traceability.** An expense materialized from a recurring source must be identifiable:
  a "Recurring" badge on the row + a link back to the source reminder, and from the recurring expense a
  view of what it has generated. Requires surfacing `sourceType`/`sourceId` in the expense response if
  not already present (a grounding check, see design A1).
- **R4 — Edit/delete semantics that never lose history.** Editing a recurring expense affects only
  **future** materializations; **already-materialized past expense rows are real history and are never
  silently deleted** (NORTH_STAR #1). Deleting/deactivating the source stops future materializations and
  must **disclose the cascade** (what stays, what stops) before confirming. Exact behavior is **D2**.
- **R5 — Recurring-cost visibility.** Surface an "upcoming recurring costs" view + a monthly recurring
  run-rate (e.g. "$150/mo insurance + $40/mo parking = $190/mo recurring"), composed from the existing
  reminder + analytics data — the dashboard has no such projection today. A light "Recurring expenses"
  lens/filter (over the existing expense-type reminders; **no migration**) so the capability is
  discoverable by cost, not buried under "Reminders." **[D4 scopes how much of this ships in v1.]**
- **R6 — Inherit all existing engine safety.** Materialization stays on the **unchanged** trigger path:
  idempotent re-trigger (no double-charge), atomic per-period transaction, multi-vehicle split through
  the hardened `expenseSplitService`. No new ingestion/write path is introduced.
- **R7 — Quality bar.** Four-states + a11y + mobile on every touched surface; compose from the kit
  (reuse the expense-split widget, badge, ConfirmDialog for the R4 cascade). Backend `bun run validate`;
  frontend `validate:local`; an eyes-on screenshot; and per the feature-DoD rule, one E2E exercising the
  real **create recurring → trigger → expense materializes → shows in TCO with a Recurring badge**
  round-trip (harness-blocked here → "code-complete, eyes-on pending," not done).

## Non-goals (this iteration)

- **A separate `recurring_expenses` table or a parallel scheduler service.** Explicitly rejected — the
  expense-type reminder engine already does this; we reuse it. (If a future need outgrows reminders,
  that's its own spec + sign-off.)
- **A backend cron daemon.** A self-hosted PWA can't assume one exists; R1/D1 solves materialization
  client-opportunistically. A cron is an optional deployment add-on, documented only.
- **Variable-amount recurring** (e.g. "log the actual utility bill each month"). Recurring expenses here
  are a **fixed** amount per period; a prompt-for-actual-amount flow is a follow-up.
- **Receipt OCR / auto-detection of recurring patterns from history.** Out of scope.
- **Mileage-axis auto-expense.** The mileage trigger only notifies today (`processMileageReminder` emits
  a notification, never an expense) — keeping that as-is; recurring *expenses* are the time axis.

## Open product decisions — **NEED ANGELO'S SIGN-OFF**

> Recommended option (✅) each. Build is blocked until ratified.

- **D1 — Materialization cadence without a cron (the central call).** How do due recurring expenses get
  created if the user doesn't click the button? Options: (a) **auto-run the due-trigger on app
  open/focus**, debounced (once per session or per calendar day), keeping the manual button as a
  fallback; (b) **lazy-on-read** — any GET that depends on current expenses (dashboard/analytics) first
  runs the user's due-trigger; (c) keep **manual-only** but add a prominent "N recurring expenses due"
  nudge. ✅ **(a)** — the trigger is already idempotent + atomic, so running it on app init is safe and
  invisible; it materializes the moment the user opens the app. **(b) rejected**: a GET that performs
  writes is surprising and risks latency/duplication on concurrent reads. Document (c)'s nudge as a
  complement to (a). *Self-host-with-cron deployments can additionally hit the endpoint on a schedule.*
- **D2 — Edit/delete of a recurring source vs. already-materialized rows.** When a user edits the amount
  or deletes a recurring expense, what happens to past expenses it already created? ✅ **Past
  materialized rows are immutable history and STAY** (never silently delete real cost data — NORTH_STAR
  #1); **editing affects only future** materializations; **deleting/deactivating the source stops future
  ones** and shows a ConfirmDialog disclosing the cascade ("N past expenses will be kept; no future ones
  will be created"). No bulk-delete of history is performed automatically. Confirm this is the desired
  contract.
- **D3 — Split exposure UX.** Reuse the existing expense-split widget inside `ReminderForm`, or build a
  reminder-specific split control? ✅ **Reuse** the existing split component/config (compose, don't
  reinvent) — the data shape (`ReminderSplitConfig`) already mirrors the expense split methods.
- **D4 — v1 scope / ordering.** Which gaps ship first. ✅ **Backend-first, trust-first ordering:**
  (1) reliable materialization (D1) + traceability (R3) — these make the *existing* engine trustworthy
  and are largely backend/non-eyes-on; (2) split exposure (R2); (3) the recurring-cost
  projection/lens (R5). Confirm this order, or re-prioritize.

## Acceptance (once signed off)

- A "$150/month insurance, split 50/50 across two cars" recurring expense is creatable in **one** form;
  on the next app open the current period's two $75 expense rows materialize automatically (no button
  click) and appear in each vehicle's TCO.
- Re-opening the app / re-running the trigger does **not** duplicate that month's rows (inherits the
  existing dedup).
- An auto-created expense row shows a "Recurring" badge and links back to its source; deleting the
  source keeps the past rows and discloses the cascade before confirming.
- The dashboard shows the upcoming recurring costs + monthly recurring run-rate.
- `bun run validate` + frontend `validate:local` green; eyes-on screenshots of the split form + the
  recurring lens + the cascade dialog in all four states; the create→trigger→materialize→TCO E2E
  (or "eyes-on pending" if the harness is blocked).
