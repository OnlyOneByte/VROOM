# Trips & Location — Design

> DRAFT (C165). Spec-only — build-gated on T0 (Angelo ratifies D1–D6 in requirements.md). Grounded against
> the real schema (`odometerEntries` at schema.ts:344) + the established repository/route/backup/analytics
> patterns. Every section reuses an existing idiom — this is additive, not architectural.

## §1 — Schema (`trips` table)
Mirrors `odometerEntries` (schema.ts:344) — the closest existing shape:

```ts
export const trips = sqliteTable('trips', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  vehicleId: text('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startOdometer: integer('start_odometer').notNull(),
  endOdometer: integer('end_odometer').notNull(),       // R2: end >= start enforced at Zod, distance derived
  purpose: text('purpose').notNull(),                   // 'business'|'personal'|'commute'|'other' (D4)
  tripDate: integer('trip_date', { mode: 'timestamp' }).notNull(),
  startLocation: text('start_location'),                // D5: free-text label, optional (no GPS in v1)
  endLocation: text('end_location'),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => ({
  vehicleDateIdx: index('trips_vehicle_date_idx').on(table.vehicleId, table.tripDate),  // the odometer idx pattern
}));
```
- `distance` is NOT stored — it's derived `max(0, endOdometer − startOdometer)` (R2, the #46 clamp), so a
  later odometer correction can't desync a stored distance. Migration: a single additive `CREATE TABLE` +
  index (the 0003-class additive migration, NOT the 0004 rebuild footgun — the money-cents spec's risk note).

## §2 — Repository (`backend/src/api/trips/repository.ts`)
The expense/odometer repository pattern: a `TripRepository` over `getDb()` (the `testDb || db` seam so the
in-memory harness drives it). Methods: `create`, `findByIdAndUserId` (→ the `validateTripOwnership` helper,
the C160 family), `findByUserId(filters?)`, `findByVehicle(vehicleId, userId)`, `update`, `delete`. Every
query ANDs `eq(trips.userId, userId)` — the C155 tenant-scope discipline (the destructive delete keys on
BOTH id AND userId, not id alone — the #52 lesson).

## §3 — Routes (`backend/src/api/trips/routes.ts`)
`POST/GET/PUT/DELETE /api/v1/trips`, `GET /api/v1/trips/:id`, `GET /api/v1/vehicles/:id/trips`. Zod schemas
in `validation.ts`: `createTripSchema` enforces `endOdometer >= startOdometer` (R2 — a cross-field
refinement, the reminders/validation.ts pattern), `purpose` as a `z.enum`, `tripDate` coerced local-day
(R5 — the buildLocalDate/normalizeForeignDate discipline, C61/C115). Ownership via `validateVehicleOwnership`
(create, the vehicleId path) + the new `validateTripOwnership` (mutate by trip id).

## §4 — Backup round-trip (R3)
Add `trips` to: the backup export table set, the restore insert set (userId-stamped — C145 stampUserId),
`validateReferentialIntegrity` (trip.vehicleId ∈ in-backup vehicle ids — C146), and BOTH source-scan
coverage guards (`backup-table-coverage.test.ts` + `restore-table-coverage.test.ts` enumerate every table;
adding a table without wiring backup fails them by design — the guard that caught prior omissions). A trip
carries no FKs beyond vehicleId/userId, so no junction-table complexity.

## §5 — Analytics rollup (R4)
A `getTripSummary(userId, vehicleId?)` in the analytics repository, reusing the per-vehicle grouping +
div-guard idioms (`groupByVehicle`, the costPerDistance null-guard): total miles by purpose, business-mile
$ = businessMiles × rate (D3 rate from preferences), trip count, avg distance (= totalMiles / count, guarded
count>0). Split-safe by construction (trips don't split → no #18/#56 denominator class). Month bucketing via
`toMonthKey` on local `tripDate` (R5).

## §6 — Frontend (R6, eyes-on tail)
Trips list (per-vehicle tab + a cross-fleet view), a trip form (vehicle + odometer pair + purpose + date +
optional locations/note), and a mileage-summary card (the reimbursement report). Reuses the expense-form /
lines-table idioms, formatCurrency/formatDistance, the four-states + a11y kit. FE service layer:
`trip-api.ts` mirroring `expense-api.ts` (the C149/C163 method→endpoint pattern). **This is the
Playwright-eyes-on-blocked tail** — code-complete-but-not-DONE until the FE→BE→DB e2e runs (the feature-DoD
rule), like maintenance T9 / import-trackers T4–6.

## §7 — What this design deliberately does NOT do (the risk fence)
- NO GPS / location capture / map render / geocoding (D5 — v2, needs a privacy review for a self-hosted PWA).
- NO automatic trip detection (v1 is manual entry — auto-detect needs background GPS, a v2+).
- NO change to the userId-ownership model (unlike vehicle-sharing — that's a separate, much larger spec).
- NO new external dependency (unlike receipt-OCR's vision API).
- NO money-type change (trips store integer odometers; the business-rate $ is display-time, and will inherit
  the money-cents migration when it lands — so trips should NOT introduce new float-dollar columns; the rate
  lives in preferences and follows the cents decision).
