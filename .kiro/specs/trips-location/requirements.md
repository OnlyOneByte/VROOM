# Trips & Location — Requirements

> **STATUS: DRAFT (C165). Spec-only — BUILD BLOCKED until Angelo ratifies the open decisions D1–D6 below.**
> One of the NORTH_STAR horizon items ("trips & location"). Drafted during a forced-but-blocked `feature`
> cycle per the "draft, flag Angelo, move on" rule. NOT a commitment — a concrete go/no-go artifact.

## Why
A car owner who drives for work (business mileage), or who wants a per-trip cost/efficiency view, needs a
**trip log**: discrete drives with a start/end odometer, a purpose (business/personal/commute), and an
optional route note. The killer use case is **tax / reimbursement** — the IRS-style "business miles ×
rate" report is a top reason people use a car tracker. VROOM already records odometer readings and
per-fillup mileage; a trip is the natural next aggregation: the distance *between* two odometer points,
attributed to a purpose.

This is deliberately the **lowest-architectural-risk** horizon item: it's an additive `trips` table that
mirrors the existing `odometerEntries` shape (vehicle + userId FKs, cascade delete), reuses the
userId-ownership model unchanged (NOT vehicle-sharing, which rewrites ownership), and needs **no external
dependency** (NOT receipt-OCR, which needs a vision API conflicting with privacy-first self-hosting). The
"location" half is **optional free-text** (start/end place labels) in v1 — NO GPS, NO map provider, NO
geocoding (those are a v2 direction call, flagged below).

## Scope (v1)
A trip is a manual entry (the v1 contract — no automatic GPS detection):
- belongs to ONE vehicle (+ the owning user), cascade-deletes with the vehicle (the odometerEntries model);
- has a `startOdometer` and `endOdometer` (integers, same unit as the vehicle), `distance = end − start`
  (a derived, non-negative value — the #46 negative-mileage-clamp lesson applies);
- has a `purpose` enum (`business` | `personal` | `commute` | `other`) for the reimbursement split;
- has a `tripDate` (timestamp, local-calendar-day semantics — the C61/C103/#39 timezone discipline);
- has optional free-text `startLocation` / `endLocation` labels + a `note`;
- optionally links to the odometer axis: creating a trip MAY also create an `odometerEntries` row at
  `endOdometer`/`tripDate` so the trip's end reading feeds the existing all-time `currentOdometer`
  (D4 decision — reuse vs. duplicate the odometer signal).

## Requirements
- **R1 — Trip CRUD, userId-scoped.** `trips` table + repository + routes (`POST/GET/PUT/DELETE
  /api/v1/trips`, `GET /api/v1/vehicles/:id/trips`), every query userId-scoped via the established
  `validateVehicleOwnership` / `validateXOwnership` family (C160 pattern). Cascade-delete with the vehicle.
- **R2 — Distance is derived + non-negative.** `distance = max(0, endOdometer − startOdometer)` (the #46
  clamp); reject `endOdometer < startOdometer` at the Zod layer with a clear error (a backwards trip is a
  data-entry error, not a 0-distance trip). Same-unit as the vehicle (no cross-unit math).
- **R3 — Backup round-trip.** `trips` joins the backup/restore round-trip (every table round-trips —
  NORTH_STAR #1): export + import + the table-coverage source-scan guard (`backup-table-coverage.test.ts`
  / `restore-table-coverage.test.ts` must include `trips`), userId-stamped on restore (the C145 stampUserId
  pattern), referential-integrity-checked (trip.vehicleId must resolve in-backup, the C146 guard).
- **R4 — Mileage-summary analytics.** A per-vehicle + cross-fleet trip rollup: total business/personal/
  commute miles, business-mileage $ at a configurable rate (the reimbursement report), trip count, avg
  trip distance. Reuses the analytics-repository + per-vehicle grouping pattern; div-guarded; split-safe
  (trips don't split, so no #18/#56 class here).
- **R5 — Timezone-correct dates.** `tripDate` is a local-calendar-day value (the C61/C103/#39 discipline:
  date-only input anchored to local, not UTC-midnight); the rollup buckets by local month.
- **R6 — Four-states + a11y + mobile (eyes-on).** The trips list/form/summary surfaces handle loading/
  empty/error/data, pass axe, no mobile overflow (NORTH_STAR #3) — the eyes-on tail, Playwright-gated.

## Open decisions (D1–D6) — NEED ANGELO before any build
- **D1 — Is trips & location the right next horizon feature at all?** (vs. money-cents which is already
  specced + T0-gated, or vehicle-sharing, or deferring all three). This spec exists so the go/no-go is concrete.
- **D2 — Odometer linkage (R1/D4):** does creating a trip ALSO write an `odometerEntries` row (so the trip
  feeds `currentOdometer` + the mileage-reminder axis), or are trips a parallel log that never touches the
  odometer signal? Reuse avoids a divergent second mileage source; parallel avoids double-counting if the
  user also logs odometer manually. **Recommend: reuse — write an odometer entry, deduped by (vehicle, date,
  reading).**
- **D3 — Business-mileage rate:** a single user-configurable rate (a new `userPreferences` field) or a
  per-trip override, or both? **Recommend: a default rate in preferences + an optional per-trip override.**
- **D4 — `purpose` taxonomy:** the 4-enum above, or user-defined tags (reusing the expense `tags` idiom)?
  **Recommend: the fixed 4-enum for v1 (the reimbursement report needs a stable business/personal split);
  tags are a v2 enhancement.**
- **D5 — Location scope:** confirm v1 is **free-text labels only** (no GPS capture, no map render, no
  geocoding). GPS/auto-detection/maps are a v2 with real new dependencies + a privacy review (a self-hosted
  PWA storing GPS traces is a data-sensitivity call). **Recommend: free-text v1, defer GPS to a v2 spec.**
- **D6 — Build order:** backend-first (schema → repository → routes → backup → analytics → tests), THEN the
  eyes-on UI tail — matching every prior feature (maintenance/import/recurring). **Recommend: yes,
  backend-first** (so the loop can build R1–R5 and only the R6 UI is eyes-on-blocked).
