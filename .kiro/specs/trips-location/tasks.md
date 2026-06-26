# Trips & Location — Tasks

> DRAFT (C165). **T0 is a SIGN-OFF GATE — BUILD BLOCKED until Angelo ratifies D1–D6 (requirements.md).**
> This is a NORTH_STAR horizon feature; like every prior feature it's backend-first, with the UI as an
> eyes-on (Playwright-gated) tail. T1–T5 are fully loop-buildable once T0 clears; T6 is eyes-on.

- [x] **T0 — Sign-off gate — ✅ GREENLIT by Angelo 2026-06-24.** D1–D6 ratified at the spec's recommended
  option for each (D1 yes-trips-is-a-go-horizon-feature; D2 reuse odometer linkage; D3 business-mileage rate
  model; D4 purpose enum; D5 free-text location only in v1, GPS deferred; D6 backend-first). **BUILD
  UNBLOCKED** — T1–T5 are now loop-buildable (one `feature` cycle each, verified via `validate:local`); T6 is
  the eyes-on tail. Runs alongside money-cents-migration (also greenlit same day) — the loop picks whichever
  is the most-starved over-budget feature cycle; both are independent.
- [x] **T1 — Schema + migration. ✅ DONE (C202).** Additive `trips` table + `trips_vehicle_date_idx`
  (design §1) in schema.ts (mirrors odometerEntries; `distance` NOT stored — derived R2; no float-money
  column per §7) + `Trip`/`NewTrip` inferred types. Migration `0007_previous_ikaris.sql` generated via
  drizzle-kit (a single additive `CREATE TABLE` + index, the 0003 class — NOT the 0004 rebuild footgun) +
  snapshot + journal. Guard: migration-0007.test.ts (+8) — column set, NOT-NULL/nullable shape, the
  composite index, an insert+read, vehicle-delete AND user-delete FK cascade, pre-0007 data survives
  untouched, double-apply rejected. Non-vacuous (all 8 drive the real migration SQL). validate:local green.
- [x] **T2 — Repository + ownership helper. ✅ DONE (C206).** `TripRepository` (backend/src/api/trips/
  repository.ts) extends BaseRepository (inherits create/findById/update/delete) + userId-scoped finders
  (findByIdAndUserId, findByUserId(filters?), findByVehicle, findByUserIdPaginated, findIdsByVehicleId) +
  a tenant-safe `deleteByIdAndUserId` keying on BOTH id AND userId (the #52 lesson) + an exported pure
  `tripDistance` clamp helper (R2/#46, distance derived not stored — one source of truth for T3/T5).
  `validateTripOwnership` added to the validateXOwnership family (validation.ts, the C160 pattern; NotFound
  not 403 — #80 enumeration discipline). Unit tests (+14: repository.test.ts 12 + tripDistance 2) over the
  in-memory migrated harness: CRUD, every finder userId-scoped, filter combinations, pagination, and the
  REQUIRED #52 cross-tenant delete-scope test (a foreign delete is a no-op → false). validate:local GREEN
  (1852 pass). REMAINING: T3 routes (consumes validateTripOwnership + the repo) + T5 analytics, then T6 eyes-on.
- [x] **T3 — Routes + Zod validation. ✅ DONE (C210).** `src/api/trips/{routes,validation}.ts` + registered
  at `/api/v1/trips` in app.ts. validation.ts: `createTripSchema` (R2 `endOdometer >= startOdometer`
  cross-field refine + D4 `purpose` z.enum [TRIP_PURPOSES exported] + R5 `tripDate` z.coerce.date() with a
  future-guard + D5 optional bounded locations/note) + `updateTripSchema` (partial, KEEPS the R2 refine so a
  both-odometer PUT can't invert). Endpoints: POST / (vehicleId in body → validateVehicleOwnership before
  insert), GET / (paginated, vehicleId+purpose filters), GET /:id + PUT /:id (validateTripOwnership), DELETE
  /:id (tenant-safe deleteByIdAndUserId → 404 on a foreign/absent id), GET /vehicle/:vehicleId. **DEVIATION
  from §3 (noted): the vehicle-scoped list is `/api/v1/trips/vehicle/:vehicleId` (self-contained in the trips
  router) rather than `/api/v1/vehicles/:id/trips` (which would need a cross-router add to the vehicles
  router) — same data, cleaner module boundary; revisit if the FE T6 prefers the nested path.** HTTP tests
  (+18, trips-http.test.ts via createTestApp): create happy + R2/future/bad-purpose/unowned-vehicle-404; list
  paginated + purpose-filter + tenant-scope; get own/foreign-404; vehicle-list + unowned-404; update happy +
  R2-on-PUT + foreign-404-no-write; delete happy + foreign-404-removes-nothing (#52) + anon-401. All ownership
  misses are 404 not 403 (#80). validate:local GREEN (1873 pass). REMAINING: T5 analytics, then T6 eyes-on FE.
- [x] **T4 — Backup round-trip (data-safety, R3). ✅ DONE (C202, landed WITH T1 — the data-safety guards
  COUPLE them: the backup-table-coverage source-scan fails the moment a schema table isn't backed up, so a
  persisted-but-un-backed-up `trips` is not a coherent half-state; "land together" like money-cents' core).**
  Wired `trips` into: config (TABLE_SCHEMA_MAP + TABLE_FILENAME_MAP + OPTIONAL_BACKUP_FILES), the ZIP export
  query + return (backup.ts), `validateReferentialIntegrity` (new `validateTripRefs` — trip.vehicleId ∈
  in-backup vehicles), the restore FK-ordered insert + delete + ImportSummary + the merge-conflict PROBE
  (detectConflicts — trips is userId-owned with its own id PK, the reminders/#93 precedent, so a colliding
  merge reports a clean conflict not a raw UNIQUE throw), the BackupData/ParsedBackupData types, AND the
  Google Sheets path (SHEET_HEADERS + SHEET_NAMES + export tab + readback, tolerating a missing Trips tab in
  older backups). All THREE drift guards (backup-/restore-table-coverage + sheets-header-coverage) green.
  Round-trip test: trips-roundtrip.test.ts (+4) — a fully-populated trip survives ZIP export→replace-restore
  field-for-field; NULL optionals round-trip as null; 3 purposes survive; a trip naming an absent vehicle is
  REJECTED pre-wipe (validateTripRefs fires). NORTH_STAR #1. validate:local green (1836 pass).
- [x] **T5 — Mileage-summary analytics (R4). ✅ DONE (C212).** Implemented as a PURE builder
  `buildTripSummary(trips, rate)` in `src/utils/trip-summary.ts` (DB-free — avoids the C77 analytics-repo
  singleton trap; the route fetches trips via tripRepository then calls it): tripCount, totalMiles,
  milesByPurpose (all 4 D4 keys always present), averageTripMiles (div-guarded count>0), businessMiles +
  businessMileageValue (= businessMiles × rate), rate echoed. Distance via the shared `tripDistance` clamp
  (inverted pair → 0). + `buildTripSummaryByMonth` (R5 local-month bucketing via toMonthKey). Wired
  `GET /api/v1/trips/summary?vehicleId&rate` (registered BEFORE /:id; optional vehicleId scopes + ownership-
  checks, else cross-fleet). **SCOPE NOTE / FOLLOW-ON (D3): the business-mileage rate is a QUERY PARAM
  (default 0), NOT a stored field — D3 ratified "a default rate in userPreferences + optional per-trip
  override", but C202 added NO rate column (the §7 note flagged it as a separate slice). Adding a
  `userPreferences.businessMileageRate` column is its own schema/migration + backup-coverage slice (the
  T1↔T4 coupling); deferred so T5 ships the correct math now. The FE T6 can pass a rate; persistence is the
  follow-on.** Tests: trip-summary.test.ts (+9 incl. a fast-check property: Σ milesByPurpose == totalMiles,
  businessMileageValue == businessMiles × rate, empty → zeros-not-NaN, inverted-pair-clamps-0, unknown-
  purpose→other) + 4 HTTP cases (cross-fleet/vehicle-scoped/unowned-404/empty-zeros). validate:local GREEN
  (1889 pass).
- [x] **D2 odometer linkage — ✅ DONE (C213, the ratified-but-unbuilt requirement).** A C213 deep-review of the
  trips↔odometer interaction caught that D2 ("reuse odometer linkage", ratified at T0) was NEVER implemented:
  T1–T5 wrote no odometer entry, so a created trip's endOdometer did NOT feed `getCurrentOdometer` (probe: POST
  trip end=5000 → 0 odometer_entries / getCurrentOdometer null) — breaking the maintenance-reminder + lease-overage
  axis D2 requires. FIX: `OdometerRepository.createFromTrip({vehicleId,userId,odometer,recordedAt})` writes an entry
  at endOdometer/tripDate DEDUPED by (vehicleId, local calendar-day, odometer value) → null when a same-day-same-
  reading entry already exists (the user's manual log; D2's "avoid the divergent double-count"); the trip POST calls
  it + rechecks mileage reminders (mirroring the odometer route). Tests: create-from-trip.test.ts (+6) + 2 HTTP
  (POST trip → getCurrentOdometer reflects endOdometer; a same-day-same-reading 2nd trip doesn't double-log).
  validate:local GREEN (1897 pass). **NOW the trips BACKEND is genuinely complete (T1–T5 + D2); only T6 (eyes-on FE) remains.**
- [ ] **T6 — Frontend (eyes-on tail, R6).** trips list + form + summary card + `trip-api.ts` client (the
  C149/C163 service pattern); four-states + a11y + mobile; then the FE→BE→DB e2e (feature-DoD). **Playwright-
  sandbox-blocked in the loop → lands "code-complete, eyes-on pending"** like maintenance T9 / import T4–6.
  - [x] **T6a — FE data layer DONE (C218):** `src/lib/types/trip.ts` (Trip / TripPurpose [== backend
    TRIP_PURPOSES] / TripSummary [== buildTripSummary output] / MilesByPurpose + the `tripDistance` clamp
    mirror) + barrel-exported; `src/lib/services/trip-api.ts` (the C149/C163 pattern over the C210/C212 routes:
    list [paginated + vehicleId/purpose filter-drop], getSummary [vehicleId+rate], getByVehicle, getById,
    create, update, delete). +14 unit tests (trip-api.test.ts: exact URL/payload per method, filter-drop, the
    summary rate param, + the tripDistance clamp). FE validate:local GREEN (825 pass, +12). NO eyes-on needed
    for the data layer.
  - [x] **T6b-1 — trips LIST page + mileage-summary card DONE + EYES-ON VERIFIED (C220):** replaced the
    `/trips` "Coming Soon" stub with a real read-only list page driving `tripApi.list()` + `tripApi.getSummary()`,
    full four-states (loading Skeleton / error+Retry / EmptyState / data), the R4 Mileage Summary card
    (Total/Trips/Business/Avg), and per-trip cards (purpose Badge, derived distance via tripDistance, odometer
    range, date, vehicle name, locations, note). **Eyes-on: booted servers, seeded 2 trips via the real API,
    shot /trips DESKTOP + MOBILE + Read both PNGs** — summary math correct (210/2/135/105), newest-first order,
    NO mobile horizontal overflow (NORTH_STAR #3), no console errors, no auth bounce. FE validate:local GREEN
    (svelte-check 0, build, 826 pass).
  - [x] **T6b-2 CREATE form DONE + EYES-ON VERIFIED (C227):** `TripForm.svelte` (ReminderForm-style dialog →
    tripApi.create) + a pure `trip-form-validation.ts` (vehicle/odometer presence + R2 end>=start + R5
    future-LOCAL-DAY guard mirroring the C226 backend fix; +12 unit tests). Wired into the list page: a
    "Log Trip" PageHeader action + an empty-state CTA + the dialog with onSaved=load. Per-vehicle unit label
    on the odometer fields; purpose/date default to business/today. **Eyes-on: booted servers, shot the open
    dialog DESKTOP + MOBILE + Read both PNGs** (clean, no mobile overflow, footer stacks, date defaults to
    today=Jun 25 2026 — the exact C226-fixed case) + an E2E POST of a TODAY-dated trip through the live
    FE→BE→DB stack succeeded (was the pre-C226 400). FE validate:local GREEN (838 pass).
  - [ ] **T6b-3 — EDIT + DELETE entry points (FE eyes-on tail; depends on T7 backend lifecycle below).**
    Card-level edit/delete actions + the `updateTripSchema`-backed edit mode in `TripForm`. The trips↔odometer
    lifecycle semantics they invoke are DECIDED (C214, below) + implemented in the T7 backend slice; this task
    is the FE wiring: an edit button → the form in edit mode (pre-hydrated, the C132 hydration-path care), a
    delete button → a confirm dialog that ALSO asks the keep-or-delete-linked-odometer question (C214 case 1).
    Eyes-on: boot → shot the edit dialog + the delete-confirm DESKTOP+MOBILE + Read; drive a real edit + a real
    delete through the live stack (the C230 fill+submit discipline, not a render-only shot). Lands after T7.

### C214 trips↔odometer lifecycle — RATIFIED by Angelo (2026-06-25). Build-unblocked.
> The D2 linkage (a trip writes a deduped `odometerEntries` row, createFromTrip/C213) created a lifecycle
> question the create-only path left open: what happens to that linked entry on trip EDIT/DELETE. Angelo
> ratified the hierarchy below — it is now DECIDED, not gated. D3 (business-rate persistence) ratified with it.

- [x] **T7 — Trip EDIT/DELETE odometer-lifecycle (backend, the C214 ruling). ✅ DONE (post-reset C3).**
  `OdometerRepository.deleteLinkedTripEntry` (matches the createFromTrip dedup key + the `From trip`
  provenance marker → never touches a manual reading); `DELETE /trips/:id?keepOdometer` (default KEEP,
  =false also removes the linked entry + rechecks reminders); `PUT /trips/:id` re-syncs the linked entry
  when endOdometer/tripDate change. Flipped the pending C214 characterization tests to the ratified
  behavior + added the T7 block (keep-default / opt-in-remove / manual-reading-safety / edit-re-sync-no-orphan).
  Full backend suite 1954 pass; validate:local GREEN. (Case 2 — delete the in-trip odometer entry → it is a
  normal odometerEntries row, removed via the existing odometer DELETE route; the in-trip surface is T6b-3 FE.)
  Implemented the ratified hierarchy in `TripRepository` (+ routes/validation), each leg with tests + a cross-tenant ownership guard:
  1. **Delete a trip → PROMPT keep-or-delete the linked odometer entry.** The backend supports BOTH outcomes:
     `DELETE /trips/:id?keepOdometer=true|false` (or a body flag) — `false` also deletes the linked
     `odometerEntries` row (matched by the C213 createFromTrip dedup key: vehicle + tripDate + endOdometer),
     `true` leaves it. The FE delete-confirm (T6b-3) surfaces the choice; the backend default when the param
     is absent is **keep** (the non-destructive default — never silently drop odometer history).
  2. **Delete the odometer entry that lives WITHIN a trip → delete the linked entry.** (The in-trip odometer
     view's delete affordance removes the linked `odometerEntries` row directly; this is the symmetric case to
     1 but scoped to the entry, not the trip — the trip row itself is unaffected.)
  3. **Edit the odometer entry within a trip → edit the linked entry.** A trip `update` that changes
     `endOdometer`/`tripDate` re-syncs the linked `odometerEntries` row (re-run the createFromTrip upsert on
     the new key; remove the stale one) so `getCurrentOdometer` + the mileage-reminder axis never read a
     desynced value. Pin: edit endOdometer → linked entry reflects the new reading, no orphan left behind.
  Tests: per-leg repository + HTTP (keepOdometer both ways; in-trip entry delete; edit re-sync; ownership-miss
  = 404 #80). `validate:local` green. This backend slice UNBLOCKS T6b-3 (the FE wiring above).
- [ ] **T8 — D3 business-mileage rate persistence (RATIFIED: default-in-prefs + per-trip override).** Add a
  `userPreferences.businessMileageRate` column (additive migration, the C174 themePreference pattern +
  backup-coverage guard) as the DEFAULT rate; keep the existing `getSummary?rate=` query param as the
  effective override input. (A per-TRIP override field is a thin additive follow-on; v1 wires the prefs
  default + the summary consuming it when no explicit rate is passed.) Tests: migration (default/backfill),
  settings PUT/GET round-trip (the C179 bounded-field pattern), backup round-trip; `validate:local` green.

## Build-order note
Once T0 clears, T1–T5 are a clean backend-first arc the loop can drive across several `feature` cycles
(each independently verifiable via `validate:local`), exactly like the recurring-expenses / import-trackers
backends. T7 (C214 lifecycle) + T8 (D3 rate) are now DECIDED backend slices (one per cycle); only T6 (incl.
the T6b-3 edit/delete FE wiring, which depends on T7) needs the eyes-on harness. This makes trips a GOOD
unblock candidate — most of it is loop-buildable, unlike the three in-flight features whose backends are
already done and only have eyes-on tails left.
