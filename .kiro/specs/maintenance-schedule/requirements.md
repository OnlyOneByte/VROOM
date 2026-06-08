# Maintenance-Schedule Reminders — Requirements

> **Status: DRAFT — needs Angelo's sign-off on the open product decisions (D1–D6) before
> any build.** This spec was drafted by the autonomous loop (cycle 4). It is grounded in
> the existing reminders engine (`.kiro/specs/reminders-recurring-expenses/`) and the
> odometer/unit model — see `design.md` for the file-level grounding. Nothing here is built.

## Problem

VROOM's reminders engine is **purely time-based**: a reminder fires when `next_due_date <= now`.
But the highest-value maintenance ("oil change every 5,000 mi", "tire rotation every 6,000 mi",
"brake inspection every 2 years") is driven by **mileage**, often **whichever comes first**
between a distance interval and a time interval. Today a user can only approximate this with a
date-only reminder, which fires on the wrong day for anyone who drives more or less than average.

## Goal

Let a user define a **maintenance schedule** per vehicle: a named service (oil, tires, brakes,
registration…) with a **mileage interval and/or a time interval**, and surface a **due / overdue**
status computed from the vehicle's **current odometer** and the clock — reusing the existing
reminder notification feed and dashboard "Upcoming" card rather than building a parallel system.

## Users / value

The multi-vehicle owner (NORTH_STAR's primary persona) who wants honest upkeep tracking:
"my truck is 800 mi from its next oil change" and "registration is due in 3 weeks" surfaced in
one place, correct for a metric user, never silently missed.

## Functional requirements

- **R1 — Maintenance reminder type.** A reminder MAY be triggered by mileage, by time, or by
  both. When both are set, it is due when **either** axis is reached ("whichever comes first").
- **R2 — Mileage interval.** A maintenance reminder MAY define `intervalMileage` (a positive
  integer in the vehicle's distance unit) and an anchor `lastServiceOdometer`. It is
  **mileage-due** when `currentOdometer(vehicle) >= lastServiceOdometer + intervalMileage`.
- **R3 — Time interval.** Reuses the existing `frequency` / `intervalValue` / `intervalUnit` /
  `nextDueDate` machinery unchanged. It is **time-due** when `nextDueDate <= now` (today's rule).
- **R4 — Per-vehicle.** A maintenance reminder targets exactly one vehicle (its odometer is the
  trigger input). Reuses the `reminder_vehicles` junction but is constrained to a single vehicle
  (see D4). The mileage interval is interpreted in **that vehicle's** `distanceUnit`.
- **R5 — Current-odometer source of truth.** "Current odometer" is a single canonical value per
  vehicle (see D2) computed from both manual odometer entries and expense `mileage` readings.
- **R6 — Due/overdue surfacing.** A due maintenance reminder appears in the existing notification
  feed and the dashboard "Upcoming Reminders" card, showing **why** it's due and **how close** the
  other axis is — e.g. "Oil change — due now (5,120 mi; next was 5,000 mi)" or "Registration — due
  in 12 days". Distance is rendered with the vehicle's unit label (`mi`/`km`), never hardcoded.
- **R7 — Acknowledge / reset.** When the user marks a maintenance reminder **done** (service
  performed), the schedule advances: `lastServiceOdometer := currentOdometer` (mileage axis) and
  `nextDueDate := nextDueDate + interval` (time axis), so it re-arms for the next cycle. Time-only
  maintenance reuses the existing auto-advance; mileage requires an explicit "mark done" (see D3).
- **R8 — Mileage check trigger.** Because mileage "due" only changes when a new reading is
  recorded (not with wall-clock), the mileage axis MUST be re-evaluated when a new odometer entry
  or a mileaged expense is created for the vehicle — not only on the check-on-login path (see D5).
- **R9 — Data safety.** Maintenance reminders and their anchors MUST round-trip through backup and
  restore on **every** path (CSV + Sheets) — i.e. any new columns are added to both serializers
  and pinned by the existing coverage guards (cycle-208/209 + the cycle-3 Sheets-header guard).
- **R10 — Four-states + unit/locale correctness.** The maintenance UI honors the quality bar:
  loading / empty / error / data states; mobile-first; axe-clean; all distances unit-correct; all
  money (if a service-cost estimate is shown) via `formatCurrency`.

## Non-goals (this iteration)

- Predictive "you'll hit this in ~N days based on your average mi/day" forecasting (a nice future
  layer; R6 may show a simple naive projection only if D6 says so).
- Per-service cost history / parts tracking (expenses already cover spend).
- Auto-creating an expense when marked done (the existing `type='expense'` reminder already does
  scheduled-expense creation; maintenance is a `notification`-class concept here — see D1).
- Migrating historical odometer values when a vehicle's `distanceUnit` is changed (pre-existing
  latent gap, see design Ambiguity #2 — called out, not solved here).

## Open product decisions — **NEED ANGELO'S SIGN-OFF**

> Each lists the recommended option (✅). The loop will NOT build until these are ratified.

- **D1 — New type vs extend `notification`?** A maintenance reminder is conceptually a
  notification with a mileage axis. Options: (a) add a third `type='maintenance'`; (b) keep
  `type='notification'` and add an optional `triggerMode` (`time` | `mileage` | `both`).
  ✅ **Recommend (b)** — smaller surface, reuses the notification feed/dedup as-is, additive
  nullable columns; `triggerMode` defaults to `time` so all existing reminders are unaffected.
- **D2 — Canonical "current odometer".** Scoping found two competing notions today
  (`vehicle-stats.currentMileage` = max(fuel-expense.mileage) only; vs the odometer `getHistory`
  UNION). ✅ **Recommend** a new `getCurrentOdometer(vehicleId)` = **`MAX(reading)` over BOTH
  `odometer_entries.odometer` AND `expenses.mileage`** (max-by-value, since odometer is physically
  monotonic — robust to a back-dated entry). Reconcile `vehicle-stats` to reuse it.
- **D3 — Mileage "mark done" UX.** Mileage can't auto-advance on a clock. ✅ **Recommend** an
  explicit "Mark serviced" action on the reminder that snapshots `currentOdometer` into
  `lastServiceOdometer` (and advances the time axis if present). Until then it stays "overdue".
- **D4 — Single vs multi-vehicle.** Mileage triggering needs one vehicle's odometer. ✅ **Recommend
  single-vehicle** for maintenance reminders (validation: exactly one `vehicleId` when
  `triggerMode` involves mileage). Time-only maintenance MAY keep multi-vehicle.
- **D5 — Mileage re-check trigger point.** ✅ **Recommend** evaluating the mileage axis (a) on the
  existing check-on-login trigger AND (b) right after an odometer/mileaged-expense write for that
  vehicle, so "due" surfaces promptly without a background job.
- **D6 — Show a naive projection?** Whether R6 shows "~due in ~8 days at your recent pace".
  ✅ **Recommend deferring** projection to a follow-up (keep this iteration deterministic: show the
  raw gap "820 mi to go", not a forecast).

## Acceptance (once signed off)

- A user can add "Oil change — every 5,000 mi or 6 months, whichever first" to a vehicle, and it
  shows the correct due state for a metric (km) vehicle and an imperial (mi) vehicle.
- Recording an odometer entry that crosses the threshold flips the reminder to "due now" without a
  page reload requiring a manual trigger (R8).
- "Mark serviced" re-arms both axes (R7).
- Backup → restore (CSV and Sheets) preserves every maintenance field (R9), pinned by a guard test.
- regress.sh green + an eyes-on screenshot of the maintenance UI in all four states.
