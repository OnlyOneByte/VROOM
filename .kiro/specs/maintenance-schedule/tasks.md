# Maintenance-Schedule Reminders — Tasks

> **UNBLOCKED: Angelo signed off D1–D6 (all ✅ recommended) cycle 12 — build is GO.** Ordering
> follows CLAUDE.md (backend-first). Each task is one loop increment; verify (`bun run validate` /
> `npm run type-check && build` / regress.sh + screenshot) before ticking.

## Phase 0 — sign-off (this gates everything)
- [x] **T0** Angelo ratified D1–D6 at the ✅ recommended option for each (cycle 12). Design
      `[depends on Dx]` sections already assume those options, so no reconciliation needed; build T1+.

## Phase 1 — backend foundation
- [x] **T1 (cycle 15)** Migration `0003_many_jean_grey.sql` — ADDITIVE ONLY: added `triggerMode`
      (default 'time'), `intervalMileage`, `lastServiceOdometer`, `nextDueOdometer` to `reminders`
      and `dueOdometer` to `reminderNotifications` (5× `ALTER TABLE ADD COLUMN`, no table rebuild).
      Pinned by `migration-0003.test.ts` (columns present, existing rows survive with defaults).
      **DESCOPED from the original T1:** relaxing `nextDueDate`/`dueDate` to nullable + widening the
      dedup index forces a SQLite table REBUILD that cascade-drops child notification rows; moved to
      T3 where the trigger logic actually needs a null date. Until then NOT NULL stays correct (no
      mileage-only reminder is created yet).
- [ ] **T2** `odometerRepository.getCurrentOdometer(vehicleId)` = MAX over odometer_entries +
      expenses.mileage (D2). Unit tests. Reconcile `vehicle-stats.currentMileage` to reuse it.
- [ ] **T3** `trigger-service`: whichever-comes-first due logic (time OR mileage); null-guard the
      time query; mileage dedup via `dueOdometer`. **First: the deferred migration** — relax
      `nextDueDate`/`dueDate` to nullable + widen the dedup index to (reminderId, dueDate,
      dueOdometer). Write it carefully (table rebuild; verify child rows survive — the
      migration-0003 harness lesson). Unit tests for all due/not-due permutations.
- [ ] **T4** Routes + validation: extend create/update Zod refinements (D4 single-vehicle when
      mileage); `POST /:id/mark-serviced` re-arm (D3); `recheckMileageReminders` on odometer/
      mileaged-expense write (D5). HTTP tests.

## Phase 2 — data safety
- [~] **T5 (partial, cycle 15)** Added the 5 new columns to `SHEET_HEADERS` (reminders +
      reminderNotifications) the moment T1's migration landed, because the cycle-3
      sheets-header-coverage guard fails otherwise (R9). CSV path is schema-derived → auto-covered.
      **Remaining:** a backup→restore round-trip test that asserts every maintenance field
      survives both paths (do once T3/T4 can create a mileage reminder with non-null values).

## Phase 3 — frontend
- [ ] **T6** Types + service client for the new fields + mark-serviced.
- [ ] **T7** `ReminderForm`: trigger-mode control + mileage branch (interval w/ unit label,
      current-odometer hint, lastServiceOdometer), single-vehicle constraint.
- [ ] **T8** `/reminders` page + `DueRemindersCard`: OR-in mileage due, render reason + gap with
      unit label, "Mark serviced" action. Four states + a11y.

## Phase 4 — verify
- [ ] **T9** E2E (mi + km vehicle, mileage-due flip on odometer write, mark-serviced re-arm) +
      eyes-on screenshots of all four states. regress.sh green.
