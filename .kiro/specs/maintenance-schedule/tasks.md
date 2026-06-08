# Maintenance-Schedule Reminders — Tasks

> **BLOCKED: do not start until requirements D1–D6 are signed off by Angelo.** Ordering follows
> CLAUDE.md (backend-first). Each task is one loop increment; verify (`bun run validate` /
> `npm run type-check && build` / regress.sh + screenshot) before ticking.

## Phase 0 — sign-off (this gates everything)
- [ ] **T0** Angelo ratifies D1–D6 in `requirements.md` (or chooses alternatives). Update design
      sections marked `[depends on Dx]` to match before any code.

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
