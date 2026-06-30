# Store Location with Expenses — Requirements

> SPEC (C548). The unshipped half of TODO #13 "Location integration": **"Store location with expenses."**
> (The other half — "Road trip! Trips tracking" — already SHIPPED as the `trips-location` spec, DONE
> pre-C11; this spec does NOT touch trips.) Greenlit-to-spec under Angelo decision-23: the SPEC step is
> pre-authorized; the real product/UX forks below (D1–D4) gate the dependent build slices on a T0 sign-off.

## Problem
An expense records WHAT was spent and on which vehicle, but not WHERE. A user filling up at a specific
station, paying for parking downtown, or logging a repair at a particular shop has no place to capture the
location — so "where do I usually fuel up?" / "which shop did that repair?" is lost. The `trips` table
already stores free-text `startLocation`/`endLocation`; expenses have no equivalent.

## Goal
Add an OPTIONAL location to an expense, captured + displayed + round-tripped through every expense surface,
reusing the established optional-free-text-field pattern (`description`) end to end. Additive and
low-risk: one nullable column, no new table, no migration rebuild.

## In scope (v1)
- An optional `expenses.location` free-text label (e.g. "Shell, Main St", "Downtown garage").
- Captured in the expense form (create + edit), pre-fillable, clearable on edit (the description pattern).
- Returned on every expense read; shown on the expense detail / row where description is shown.
- Round-tripped through CSV export/import + the backup/restore + Sheets-sync paths.
- Carried by the VLM receipt-parse draft IF the model already returns a vendor/location (reuse, no new
  model surface) — OPEN as D3 (the parse draft has `vendor`, not `location`; mapping is a product call).

## Out of scope (v1) — explicit cuts
- **GPS / lat-long / a map picker.** v1 is a free-text label ONLY, mirroring the trips D5 ruling
  ("free-text label, optional — no GPS in v1"). A geocoded location + map is a separate later spec.
- **Per-location analytics** ("spend by location", "most-visited stations"). The column is captured +
  displayed in v1; aggregations are a follow-on once data exists.
- **Auto-fill from device location / browser geolocation.** No new permission surface in v1.
- **A location field on split-expense legs.** Location is single-expense-only (the split schema is
  unchanged); a split's siblings share no per-leg location.

## Product / UX decisions (T0 gates these — each has a RECOMMENDED option; ACK takes it)
- **D1 — Free-text vs structured.** RECOMMEND **free-text string** (max-length capped like description),
  mirroring trips `startLocation`. No GPS, no place-id, no validation beyond length. (Alt: defer until a
  geocoded design — but that blocks a cheap, useful field on a heavy dependency.)
- **D2 — Input placement + control.** RECOMMEND a single-line `Input` labeled "Location (Optional)" placed
  next to / under Description in the expense form (Description stays a Textarea; location is a short label).
  (Alt: fold into description — rejected, loses the structured field for future analytics.)
- **D3 — VLM receipt-draft mapping.** The shipped receipt draft returns `vendor` (the merchant), not a
  `location`. RECOMMEND **leave them separate in v1** — `vendor → description` stays as-is (the shipped T7
  round-trip), and `location` is user-entered only; do NOT repurpose vendor as location (a merchant name is
  not a location). (Alt: also pre-fill location from vendor — rejected, conflates two fields + changes the
  shipped VLM contract.) NO change to the VLM feature.
- **D4 — Display surface.** RECOMMEND show location on the expense **detail/expanded row** (where
  description shows) + include it in CSV export; do NOT add a column to the dense expenses table (row width
  is already tight). (Alt: a table column — rejected for mobile width.)

## Functional requirements
- **R1** — `expenses.location` is a nullable TEXT column; additive `ALTER TABLE ADD COLUMN` migration (the
  0011-class additive pattern, NOT a rebuild). Existing rows backfill NULL; the field is fully optional.
- **R2** — The create + update Zod schemas accept an optional, length-capped `location`; an emptied value on
  edit clears it (sent as `null` — the description clear-on-edit contract). Absent on create = NULL.
- **R3** — Every expense read returns `location` (Drizzle generic select auto-flows it; the FE transformer
  maps it both ways). The expense form pre-fills it on edit + sends it on create/edit.
- **R4** — CSV export adds a `location` column (after `description`); CSV import accepts it (native VROOM
  round-trip). The backup/restore + Sheets-sync paths round-trip it (schema-derived column enumeration —
  auto-covered; pinned by the existing round-trip coverage guard so a missing column fails CI).
- **R5** — No behavior change to any other field: money, fuel, split, source-links, idempotency all
  unchanged. A pure additive column.

## Non-functional / safety
- Length-capped (reuse a CONFIG validation bound like description's) — no unbounded free-text.
- No PII beyond what the user voluntarily types; no geolocation permission, no third-party geocoding call.
- The column is in the backup payload (it is the user's own data) — the round-trip guard must include it
  so a future schema-derived backup never silently drops it.
