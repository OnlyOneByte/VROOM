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
- [ ] **T3 — Routes + Zod validation.** The 6 endpoints (design §3); `createTripSchema` with the
  `endOdometer >= startOdometer` cross-field refinement (R2) + `purpose` enum + local-day `tripDate` (R5).
  HTTP tests via createTestApp (ownership 404s, the R2 reject, the distance-derivation echo).
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
- [ ] **T5 — Mileage-summary analytics (R4).** `getTripSummary` (per-vehicle + cross-fleet: miles-by-purpose,
  business-$ at the D3 rate, count, avg; div-guarded). Property/characterization tests (sum-by-purpose =
  total; business-$ = businessMiles × rate; empty → zeros not NaN).
- [ ] **T6 — Frontend (eyes-on tail, R6).** trips list + form + summary card + `trip-api.ts` client (the
  C149/C163 service pattern); four-states + a11y + mobile; then the FE→BE→DB e2e (feature-DoD). **Playwright-
  sandbox-blocked in the loop → lands "code-complete, eyes-on pending"** like maintenance T9 / import T4–6.

## Build-order note
Once T0 clears, T1–T5 are a clean backend-first arc the loop can drive across several `feature` cycles
(each independently verifiable via `validate:local`), exactly like the recurring-expenses / import-trackers
backends. Only T6 needs the eyes-on harness. This makes trips a GOOD unblock candidate — most of it is
loop-buildable, unlike the three in-flight features whose backends are already done and only have eyes-on
tails left.
