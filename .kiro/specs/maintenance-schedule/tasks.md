# Maintenance-Schedule Reminders — Tasks

> **UNBLOCKED: Angelo signed off D1–D6 (all ✅ recommended) cycle 12 — build is GO.** Ordering
> follows CLAUDE.md (backend-first). Each task is one loop increment; verify (`bun run validate` /
> `npm run type-check && build` / regress.sh + screenshot) before ticking.

## Phase 0 — sign-off (this gates everything)
- [x] **T0** Angelo ratified D1–D6 at the ✅ recommended option for each (cycle 12). Design
      `[depends on Dx]` sections already assume those options, so no reconciliation needed; build T1+.

## Phase 1 — backend foundation
- [ ] **T1** Migration: add `triggerMode` (default 'time'), `intervalMileage`, `lastServiceOdometer`,
      `nextDueOdometer` to `reminders`; relax `nextDueDate` to nullable; add `dueOdometer` to
      `reminderNotifications` + widen its unique index. (DatabaseMigrations.md; db:init path.)
- [ ] **T2** `odometerRepository.getCurrentOdometer(vehicleId)` = MAX over odometer_entries +
      expenses.mileage (D2). Unit tests. Reconcile `vehicle-stats.currentMileage` to reuse it.
- [ ] **T3** `trigger-service`: whichever-comes-first due logic (time OR mileage); null-guard the
      time query; mileage dedup via `dueOdometer`. Unit tests for all due/not-due permutations.
- [ ] **T4** Routes + validation: extend create/update Zod refinements (D4 single-vehicle when
      mileage); `POST /:id/mark-serviced` re-arm (D3); `recheckMileageReminders` on odometer/
      mileaged-expense write (D5). HTTP tests.

## Phase 2 — data safety
- [ ] **T5** Add the new `reminders` + `reminderNotifications` columns to `SHEET_HEADERS`
      (the cycle-3 guard fails until done). Confirm CSV path auto-covers (schema-derived).
      Backup→restore round-trip test preserves every maintenance field (R9).

## Phase 3 — frontend
- [ ] **T6** Types + service client for the new fields + mark-serviced.
- [ ] **T7** `ReminderForm`: trigger-mode control + mileage branch (interval w/ unit label,
      current-odometer hint, lastServiceOdometer), single-vehicle constraint.
- [ ] **T8** `/reminders` page + `DueRemindersCard`: OR-in mileage due, render reason + gap with
      unit label, "Mark serviced" action. Four states + a11y.

## Phase 4 — verify
- [ ] **T9** E2E (mi + km vehicle, mileage-due flip on odometer write, mark-serviced re-arm) +
      eyes-on screenshots of all four states. regress.sh green.
