# Recurring Expenses — Design

> **Status: DRAFT — blocked on requirements D1–D4 sign-off.** Assumes the ✅ option for each open
> decision; sections that hinge on one are marked **[depends on Dx]**. Grounded in a direct read of the
> reminder trigger engine, expense source-linking, and the reminder form (cycle 88) — file:line cited.

## Grounding — the engine we extend (reuse, don't reinvent)

**The recurring-expense engine already exists and is exercised in production code.** Verified:

- **Trigger → expense materialization:** `backend/src/api/reminders/trigger-service.ts`
  `processReminder` (:377) loops a due reminder's periods and at :407 branches on
  `reminder.type === 'expense'` → `processExpensePeriod` (:176) → `createExpenseFromReminder` (:108).
  That function INSERTS a real expense — single-vehicle (:125-143) or, when `expenseSplitConfig` is set,
  a multi-vehicle split via `expenseSplitService.createSiblings` (:148-163) — stamped
  `sourceType:'reminder'`, `sourceId:reminder.id`, inside the **same transaction** that advances
  `nextDueDate` (:182-191). Idempotent + atomic, on the reminder's frequency cadence.
- **Recurrence model (reuse wholesale):** `computeNextDueDate(currentDue, frequency, intervalValue,
  intervalUnit, anchorDay)` (:72) handles weekly/monthly/yearly/custom with anchor-day clamping. The DB
  carries `frequency`, `intervalValue`, `intervalUnit`, `startDate`, `endDate`, `nextDueDate` on
  `reminders`. No new scheduler is needed.
- **Split (reuse):** `backend/src/api/expenses/split-service.ts` `computeAllocations` + `createSiblings`
  (even / percentage / absolute), already accepts `sourceType`/`sourceId` (:86-87, :106-107).
- **Source-linking primitives already exist:** `expenses` carries `sourceType`/`sourceId`
  (schema, source index); the create route accepts `sourceType: z.enum(['financing','insurance_term',
  'reminder'])` (`expenses/routes.ts:80`); the repository has **`deleteBySource(sourceType, sourceId,
  userId)`** (:483, removes linked rows) and **`clearSource(sourceType, sourceId, userId)`** (:530,
  nulls the link but KEEPS the rows). These are exactly the R4 cascade verbs.
- **TCO is automatic:** analytics reads raw expense rows by `category` + `sourceType`
  (`analytics/repository.ts` getVehicleTCO / categorizeTCOExpenses), so a materialized recurring expense
  appears in cost analytics with **zero analytics changes**.
- **Frontend already has the type:** `frontend/src/lib/types/reminder.ts` `ReminderType =
  'expense' | 'notification'`; `ReminderForm.svelte` exposes a **"Recurring expense"** option with
  category + amount (:254-262, :313-350) and the API client sends the expense fields
  (`reminder-api.ts` create/update).

**The three real gaps** (each a task below), verified:
1. The due-trigger runs **only** via the manual `runDueReminders` button (`reminders/+page.svelte:97-114`);
   no on-open/cron path → recurring expenses silently fail to materialize on a self-hosted PWA.
2. `ReminderForm` intentionally omits `expenseSplitConfig` (:52-53) → no multi-vehicle recurring cost.
3. No UI surfaces an expense's `sourceType:'reminder'` → no badge, no link back to the source.

## Architecture

```
ReminderForm (type='expense', +split)  ──create──►  POST /reminders  (UNCHANGED engine)
                                                          │
app open / focus  ──auto-trigger (debounced, D1)──►  POST /reminders/trigger
                                                          │  processReminder → createExpenseFromReminder
                                                          ▼
                                          expense rows (sourceType='reminder', sourceId)
                                          │                                   │
                                  TCO/analytics (automatic)        Expenses table: "Recurring" badge + link
```

Everything inside the dashed engine is **already built**. The work is: a client-side auto-trigger (D1),
exposing split in the form (R2), surfacing the source link (R3), and the cascade-safe edit/delete (R4),
plus the recurring-cost lens (R5).

### Piece 1 — Reliable materialization (R1 / D1) **[depends on D1]**

**No backend change to the engine.** Add a client-side opportunistic trigger:
- A small `recurring-materializer` concern in the frontend app-init/layout that calls
  `reminderApi.trigger()` **once per session (or per calendar day)**, debounced via a stored timestamp
  (e.g. `localStorage`), only when authenticated and online. The trigger is idempotent + atomic, so a
  redundant call is a safe no-op; concurrency is bounded by the existing per-period dedup.
- Keep the manual "Run due reminders" button as a visible fallback + a "N due" nudge (D1 option c as a
  complement). Surface a non-intrusive result (the existing toast pattern), not a modal.
- **Self-host-with-cron note (docs):** the endpoint is already a plain authenticated POST; a deployment
  with a scheduler can curl it on a cron. Document, don't build a daemon.
- *Ambiguity A2:* exact debounce window (per app-open vs once/day) — start once per session on
  init+focus, revisit if it feels chatty. Not a data-safety risk (idempotent).

### Piece 2 — Multi-vehicle split in the form (R2 / D3) **[depends on D3]**

Expose `expenseSplitConfig` in `ReminderForm` when `type==='expense'` **and** more than one vehicle is
selected, **reusing the existing expense-split widget** (the same even/percentage/absolute control the
one-off split expense uses). The backend already validates it (`reminders/validation.ts`
`refineSplitConfig`: vehicleIds match + %-sum=100 / absolute-sum=amount — pinned C87) and materializes it
(`createExpenseFromReminder` :148). The API client already forwards arbitrary reminder fields, so the
only change is the form control + wiring `expenseSplitConfig` into the payload (today it's hard-null).
Four-states + a11y on the split sub-form; single-vehicle keeps today's no-split path.

### Piece 3 — Source traceability (R3)

- **Grounding check at build time (A1):** confirm whether the expense GET response + frontend `Expense`
  type already carry `sourceType`/`sourceId`. The columns and the create-route enum exist; if the
  read-path response or the frontend type omits them, surface them (and **lock the new keys with the
  FE↔BE contract-drift guard**, per the established pattern — loop-improvement #2).
- **Expenses table / row:** a "Recurring" `Badge` (compose from the kit) when
  `sourceType==='reminder'`, linking to the source reminder. From the reminder, a small "materialized N
  expenses" view (query expenses by `sourceType='reminder', sourceId=reminderId`).

### Piece 4 — Cascade-safe edit/delete (R4 / D2) **[depends on D2]**

- **Edit** the source reminder's amount/category/split → affects only FUTURE materializations (the next
  `createExpenseFromReminder` uses the current reminder fields). Past rows are untouched real history.
- **Delete / deactivate** the source → stops future materializations; **past rows STAY**. Use
  `clearSource('reminder', reminderId, userId)` (:530) to null the dangling link on already-materialized
  rows so they remain as standalone history (NOT `deleteBySource`, which would erase real cost data —
  the wrong verb here). Gate behind a `ConfirmDialog` disclosing the cascade ("N past expenses kept; no
  future ones created"). **[depends on D2 confirming keep-history]**
- *Ambiguity A3:* there's already an `onFinancingDeactivated` hook (C85) that severs source links on
  payoff — mirror that idiom for the reminder-delete path so the two source types behave consistently.

### Piece 5 — Recurring-cost visibility (R5 / D4) **[depends on D4]**

- A dashboard "Upcoming recurring costs" section + a monthly recurring run-rate, computed from the
  user's active `type:'expense'` reminders (amount × normalized-to-monthly frequency). No new persisted
  aggregate — derive on read, like the existing analytics.
- A "Recurring expenses" lens: a filter/view over the existing expense-type reminders (NO migration, NO
  new table) so the capability is discoverable by the cost mental-model. Reuse the reminders list UI.

## What does NOT change

- The trigger engine, the recurrence math, the split service, the expense write path, the analytics
  aggregation — all reused verbatim. No new table, no parallel scheduler, no schema migration for a
  recurring subsystem. (R3 may add `sourceType` to a *response*/type if missing — that's serialization,
  not a schema change.)

## Test plan

- **Unit (frontend):** the debounce/once-per-session gate of the auto-materializer (mock
  `reminderApi.trigger`, assert single call + skip-when-recent + skip-when-offline); the recurring
  run-rate calc (weekly/monthly/yearly/custom normalized to monthly); the "Recurring" badge predicate.
- **Unit/HTTP (backend):** the engine paths are already covered (C25/C31/C37/C87); ADD a characterization
  for the **split** materialization specifically if not already pinned (an expense-type reminder with an
  even/percentage/absolute `expenseSplitConfig` fires → N sibling expense rows with the right shares +
  `sourceType:'reminder'`), and for the **delete→clearSource keeps history** path.
- **Contract guard:** if `sourceType` is newly added to the expense response, lock its key-shape vs the
  frontend `Expense` contract (loop-improvement #2 pattern).
- **E2E + screenshot (feature-DoD):** create a split recurring expense in one form → open app (or click)
  → both sibling rows materialize → appear in each vehicle's TCO with a Recurring badge → delete the
  source → past rows remain, cascade dialog shown. (Playwright-blocked here → "code-complete, eyes-on
  pending.")

## Rollout

Backend/trust-first per D4: (1) reliable materialization (D1, client-side, idempotent) + traceability
(R3, mostly response/type + a badge) — these make the existing engine trustworthy with the least
eyes-on surface; (2) split exposure (R2); (3) the recurring-cost projection + lens (R5). Each task is one
loop increment, individually verified. The engine is untouched throughout, so no existing behavior
regresses. **Build starts only after D1–D4 sign-off.**
