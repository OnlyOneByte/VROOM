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
- [~] **T2 (partial, cycle 16)** `OdometerRepository.getCurrentOdometer(vehicleId)` shipped =
      `MAX(odometer)` across a UNION of `expenses.mileage` + `odometer_entries.odometer`, by value
      (not by date), null when no reading, vehicle-scoped. Reuses the `getHistory` UNION shape.
      Pinned by `get-current-odometer.test.ts` (8 cases: null-empty, single-source max, cross-source
      max either way, NULL-mileage ignored, per-vehicle scoping, zero≠null). **DEFERRED to T3:** the
      `vehicle-stats.currentMileage` reconcile — that field is computed inside a PERIOD-FILTERED,
      fuel-only stats route, so swapping it to the all-sources/all-time MAX is a visible semantics
      change (under a 7d filter "current mileage" would jump to the all-time odometer), not a
      behavior-preserving reconcile. Do it in T3 alongside the mileage-due consumer, where the period
      semantics can be decided deliberately.
- [~] **T3 (in progress)** `trigger-service`: whichever-comes-first due logic (time OR mileage);
      null-guard the time query; mileage dedup via `dueOdometer`.
      - [x] **T3 part 1 (cycle 22) — the deferred migration.** Migration `0004_marvelous_the_fury.sql`
            relaxes `reminders.next_due_date` + `reminder_notifications.due_date` to nullable.
            **Index design CORRECTED vs the spec:** spec said widen to `(reminderId, dueDate,
            dueOdometer)` — wrong, because SQLite treats NULLs as DISTINCT in a UNIQUE index, so that
            would silently stop deduping time-only reminders (NULL dueOdometer). Instead kept
            `rn_reminder_due_idx (reminderId, dueDate)` for the time axis + added a PARTIAL unique
            `rn_reminder_odo_idx (reminderId, dueOdometer) WHERE dueOdometer IS NOT NULL` for mileage.
            **HAND-AUTHORED** (C15 exception): drizzle's generated rebuild drops `reminders` while the
            CASCADE children hold rows + `PRAGMA foreign_keys=OFF` is a no-op inside the migrator txn →
            would wipe child rows. Safe order: stash children in `_hold_` tables → empty live children
            → rebuild → refill. Proven by `migration-0004.test.ts` (5 tests, child rows survive
            row-for-row with FKs ON). trigger-service null-guards a null `next_due_date` (no time
            axis). tsc 0 · musl-biome clean · 898 pass · build OK.
      - [ ] **T3 part 2** trigger-service whichever-comes-first: OR-in mileage-due via
            `getCurrentOdometer` ≥ `nextDueOdometer`; emit a mileage notification (null dueDate,
            dueOdometer set) with app-level dedup on the partial index; FOLD IN bug #12
            (`fastForwardPastNow` ignores `endDate` — same function). Unit tests for all due/not-due
            permutations (time-only, mileage-only, both).
      - [ ] **T3 part 3** the deferred T2 reconcile — decide `vehicle-stats.currentMileage` period
            semantics and route it (or a new all-time field) through `getCurrentOdometer`.
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
