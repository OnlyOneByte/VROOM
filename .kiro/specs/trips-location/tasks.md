# Trips & Location — Tasks

> DRAFT (C165). **T0 is a SIGN-OFF GATE — BUILD BLOCKED until Angelo ratifies D1–D6 (requirements.md).**
> This is a NORTH_STAR horizon feature; like every prior feature it's backend-first, with the UI as an
> eyes-on (Playwright-gated) tail. T1–T5 are fully loop-buildable once T0 clears; T6 is eyes-on.

- [ ] **T0 — Sign-off gate — BUILD BLOCKED, awaiting Angelo.** Ratify D1 (is trips the right next horizon
  feature?), D2 (odometer linkage: reuse vs parallel), D3 (business-mileage rate model), D4 (purpose enum vs
  tags), D5 (free-text location only in v1, GPS deferred), D6 (backend-first order). Until then, NO build —
  this spec is the go/no-go artifact. If Angelo prefers a different horizon item (theming-engine / money-cents
  / vehicle-sharing are also drafted + awaiting sign-off), this spec is shelved, not discarded. *(NOTE: a
  C166-prior errored cycle flipped this to "greenlit 2026-06-24" with NO record of Angelo's approval; reverted
  C166 — there is NO such greenlight.)*
- [ ] **T1 — Schema + migration.** Additive `trips` table + `trips_vehicle_date_idx` (design §1); one
  `CREATE TABLE` migration (the 0003 additive class). +schema types. No data backfill (new table).
- [ ] **T2 — Repository + ownership helper.** `TripRepository` (CRUD, all userId-scoped, the C155 tenant
  discipline) + `validateTripOwnership` into the `validateXOwnership` family (the C160 pattern). Unit tests
  over the in-memory harness, incl. a cross-tenant delete-scope test (the #52 regression class).
- [ ] **T3 — Routes + Zod validation.** The 6 endpoints (design §3); `createTripSchema` with the
  `endOdometer >= startOdometer` cross-field refinement (R2) + `purpose` enum + local-day `tripDate` (R5).
  HTTP tests via createTestApp (ownership 404s, the R2 reject, the distance-derivation echo).
- [ ] **T4 — Backup round-trip (data-safety, R3).** Wire `trips` into export + restore (userId-stamped) +
  `validateReferentialIntegrity` + BOTH table-coverage source-scan guards. Round-trip test (seed trips →
  export → wipe → restore → identical). NORTH_STAR #1.
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
