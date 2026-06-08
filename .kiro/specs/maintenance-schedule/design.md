# Maintenance-Schedule Reminders — Design

> **Status: DRAFT — blocked on requirements D1–D6 sign-off.** This design assumes the ✅
> recommended option for each open decision; if Angelo picks differently, the affected section is
> marked **[depends on Dx]**. Grounded in a read-only scoping pass (cycle 4) of the reminders
> engine and odometer/unit model — file:line references below are from that pass.

## Grounding — what already exists (reuse, don't reinvent)

**Reminders engine (time-only today):**
- Schema `reminders` table: `backend/src/db/schema.ts:421-458` — `type` ('expense'|'notification'),
  `actionMode`, `frequency`, `intervalValue`, `intervalUnit` ('day'|'week'|'month'|'year'),
  `startDate`, `endDate`, `nextDueDate` (NOT NULL — the engine's sole "when" driver), expense
  template fields, `isActive`, `lastTriggeredAt`. Index `(userId, isActive, nextDueDate)`.
- `reminder_vehicles` junction: `schema.ts:461-475` — composite PK `(reminderId, vehicleId)`,
  both FKs cascade; a reminder can link multiple vehicles.
- `reminderNotifications`: `schema.ts:478-500` — `reminderId`, `userId`, `dueDate`, `isRead`;
  **unique index `(reminderId, dueDate)`** dedups one notification per period.
- Backend: `backend/src/api/reminders/{trigger-service,repository,routes,validation}.ts`.
  Due computation `processOverdueReminders` → `findOverdue(userId, now)` (SQL `next_due_date <= now`);
  advance `computeNextDueDate` (calendar math only). **No odometer input anywhere.**
- Frontend: `ReminderForm.svelte`, `/routes/reminders/+page.svelte` (client "due" =
  `nextDueDate <= Date.now()`), dashboard `DueRemindersCard.svelte` (description already says
  "Recurring expenses and **maintenance** due soon" — naming anticipated this).

**Odometer / units:**
- `odometer_entries`: `schema.ts:343-365` — `odometer` (bare integer, **no unit field**),
  `recordedAt`. Readings also live in `expenses.mileage` (`schema.ts:214`).
- **No "current odometer" helper exists.** Unified history is a UNION ALL of expense mileage +
  odometer entries: `backend/src/api/odometer/repository.ts:73-124` (ordered by date). The only
  "current mileage" today is `backend/src/utils/vehicle-stats.ts:135` = `max(fuel-expense.mileage)`
  — **ignores manual entries and non-fuel mileage** (inconsistent; D2 reconciles this).
- Distance is stored **as-entered in the vehicle's `distanceUnit`** (`vehicles.unitPreferences`
  JSON, `schema.ts:49-52`; `distanceUnit ∈ 'miles'|'kilometers'`). **Convert-on-read, never on
  write** (`.kiro/specs/unit-aware-display/design.md:55`). Backend converter
  `backend/src/utils/unit-conversions.ts`; frontend label `getDistanceUnitLabel` (`units.ts:33`).

## Architecture — additive, reuses the engine

### Schema changes (all nullable/defaulted — additive, safe for restore of old backups)

On `reminders` (option D1(b) — extend, no new table):
- `triggerMode TEXT NOT NULL DEFAULT 'time'` — `'time' | 'mileage' | 'both'`. Existing rows → `'time'`.
- `intervalMileage INTEGER` — distance interval in the vehicle's `distanceUnit` (null unless
  mileage/both).
- `lastServiceOdometer INTEGER` — the anchor; the mileage axis is due when
  `currentOdometer >= lastServiceOdometer + intervalMileage`.
- `nextDueOdometer INTEGER` — **derived cache** = `lastServiceOdometer + intervalMileage`, stored
  so the "due" query and the notification dedup key are cheap/stable. Recomputed on write + on
  "mark serviced".

`nextDueDate` is currently NOT NULL. A mileage-**only** reminder has no date. **[depends on D1]**
Options: keep NOT NULL and store a sentinel far-future date (ugly), or relax to nullable. ✅ Plan:
relax `nextDueDate` to nullable and make the time-due query `next_due_date IS NOT NULL AND
next_due_date <= now`. This is a migration touching the existing index — write it carefully
(`.kiro/steering/DatabaseMigrations.md`; drizzle-kit push fails under bun → use db:init path).

### Current-odometer helper (D2)

New `odometerRepository.getCurrentOdometer(vehicleId): Promise<number | null>` =
`MAX(odometer)` across a UNION of `odometer_entries.odometer` and `expenses.mileage` for the
vehicle (max-by-value; null when no reading). Reuse the existing UNION shape from `getHistory`
(`repository.ts:73-124`), swapping `ORDER BY recorded_at DESC LIMIT 1` for `MAX(...)`. Reconcile
`vehicle-stats.currentMileage` to call this (kills the fuel-only inconsistency).

### Due computation (whichever-comes-first)

In `trigger-service.ts`, extend the overdue pass:
- `findOverdue` stays for the time axis (now null-guarded).
- New: for each active reminder with `triggerMode` in (`mileage`,`both`) and a linked vehicle,
  fetch `getCurrentOdometer(vehicleId)` and flag mileage-due when `current >= nextDueOdometer`.
- A reminder is **due** = time-due OR mileage-due. Emit one notification; **dedup key** must not be
  `dueDate` for mileage events (no meaningful date) — extend the unique key to
  `(reminderId, dueDate, nextDueOdometer)` or use a nullable `dueOdometer` column on
  `reminderNotifications`. **[depends on D1]** ✅ add nullable `dueOdometer` to the notification
  row + widen the unique index.

### Mark-serviced / re-arm (D3, R7)

New route `POST /api/v1/reminders/:id/mark-serviced` (rate-limited like `/trigger`):
- mileage/both: `lastServiceOdometer := getCurrentOdometer(vehicle)`, recompute `nextDueOdometer`.
- time/both: `nextDueDate := computeNextDueDate(nextDueDate, freq)` (reuse), set `lastTriggeredAt`.
- All in one optimistic-locked transaction (reuse the repository's advance pattern).

### Mileage re-check on write (D5, R8)

After a successful odometer-entry create (and mileaged-expense create) for a vehicle, call a light
`recheckMileageReminders(userId, vehicleId)` that evaluates only that vehicle's mileage/both
reminders and writes any newly-due notifications. Cheap, synchronous, no cron. Keep it idempotent
via the dedup key so the login-trigger path can't double-fire.

### Validation (validation.ts, Zod refinements)

- `triggerMode='mileage'|'both'` ⇒ `intervalMileage` required positive int, exactly one `vehicleId`
  (D4), `lastServiceOdometer` required (default to current odometer at create time if omitted).
- `triggerMode='time'|'both'` ⇒ existing frequency refinements apply.
- `triggerMode='mileage'` (pure) ⇒ `nextDueDate` may be null; frequency fields optional.

### Frontend

- **ReminderForm**: add a trigger-mode segmented control (Time | Mileage | Both). Mileage branch
  shows `intervalMileage` (input suffixed with the vehicle's `getDistanceUnitLabel`) and a
  read-only "current odometer" hint + an editable `lastServiceOdometer` (defaults to current).
  Vehicle select constrained to single when mileage involved (D4).
- **/reminders page + DueRemindersCard**: extend the client "due" derivation to OR-in the mileage
  axis (server already returns the computed due flag + the gap; client just renders). Show the
  reason + gap with the vehicle's unit label. Add a "Mark serviced" button calling the new route.
- All distances via `getDistanceUnitLabel`; reuse `ConfirmDialog` if "mark serviced" needs confirm.

### Data safety (R9)

New columns on `reminders` + `reminderNotifications` must be added to **both** backup serializers:
- CSV: schema-derived automatically (`getColumnNames` → `getTableColumns`) — free.
- **Sheets: `SHEET_HEADERS.reminders` + `SHEET_HEADERS.reminderNotifications` MUST be updated**
  (the cycle-3 `sheets-header-coverage.test.ts` guard will FAIL until they are — by design).
- Verify the cycle-208/209 table-coverage guards still pass.

## Ambiguities flagged (resolve during build, surfaced now)

- **Ambiguity #1 — current-odometer definition** (D2): max-by-value across both sources, not the
  fuel-only `vehicle-stats` value and not latest-by-date (a back-dated typo shouldn't regress it).
- **Ambiguity #2 — unit switch** (non-goal but real): odometer + interval are unitless integers in
  the vehicle's `distanceUnit`; there is **no historical migration** when a user flips the unit, so
  a stored `intervalMileage` of 5000 mi would be wrongly compared to km-era readings. This iteration
  stores interval in the vehicle's current unit and does NOT migrate on switch — documented as a
  known limitation (matches the app-wide convert-on-read posture).

## Test plan

- Unit: `getCurrentOdometer` (both sources, max-by-value, null-empty); whichever-comes-first due
  logic (time-only, mileage-only, both — each of due/not-due); re-arm math.
- HTTP: create maintenance reminder (validation refinements), mark-serviced re-arm, mileage
  re-check-on-write flips due.
- Guard: extend the Sheets header guard expectation; backup→restore round-trip preserves new fields.
- E2E + screenshot: ReminderForm mileage branch (mi + km vehicle), DueRemindersCard "due now"
  by mileage, four states.

## Rollout

Backend-first per CLAUDE.md (schema migration → repository → trigger-service → routes → validation →
tests), then frontend (types → service → form/page/card → e2e). One reminder type, additive
migration; safe to ship behind the existing reminders surface. **Build starts only after D1–D6
sign-off.**
