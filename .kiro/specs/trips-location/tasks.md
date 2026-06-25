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
  (1889 pass). **The trips BACKEND arc (T1–T5) is COMPLETE; only T6 (eyes-on FE) remains.**
- [ ] **T6 — Frontend (eyes-on tail, R6).** trips list + form + summary card + `trip-api.ts` client (the
  C149/C163 service pattern); four-states + a11y + mobile; then the FE→BE→DB e2e (feature-DoD). **Playwright-
  sandbox-blocked in the loop → lands "code-complete, eyes-on pending"** like maintenance T9 / import T4–6.

## Build-order note
Once T0 clears, T1–T5 are a clean backend-first arc the loop can drive across several `feature` cycles
(each independently verifiable via `validate:local`), exactly like the recurring-expenses / import-trackers
backends. Only T6 needs the eyes-on harness. This makes trips a GOOD unblock candidate — most of it is
loop-buildable, unlike the three in-flight features whose backends are already done and only have eyes-on
tails left.
