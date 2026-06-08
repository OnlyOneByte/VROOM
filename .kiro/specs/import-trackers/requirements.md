# Import from Other Trackers — Requirements

> **Status: DRAFT — needs Angelo's sign-off on the open product decisions (D1–D5) before build.**
> Drafted by the autonomous loop (cycle 9). It builds directly on the **already-hardened** VROOM
> CSV-import path (cycles 190–192 + the cycle-8 idempotency/atomicity hardening). Nothing here is
> built. Grounding (file:line) is in `design.md`.

## Problem

A new VROOM user almost always has history in another tracker — **Fuelly, Fuelio, Drivvo,
aCar, Gasbuddy…** — exportable as CSV. Today VROOM only imports its **own** export shape
(`date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,
createdAt`). A foreign CSV's columns/units/category words don't match, so the user must hand-edit
the file or re-enter years of fill-ups. That's the single biggest adoption wall for a self-hostable
tracker whose whole pitch is "you own your data."

## Goal

Let a user import a foreign tracker's CSV by **mapping its columns onto VROOM's fields once**, then
reuse the existing import pipeline verbatim (validation, per-row error reporting, formula-injection
neutralization, cross-tenant-safe vehicle resolution, idempotency, atomic commit). The feature is a
**translation layer in front of `buildImportPlan`**, not a new ingestion path — so every safety
property the native import already has is inherited, not re-implemented.

## Functional requirements

- **R1 — Column mapping.** The user maps each VROOM field (`date`, `vehicle`, `category`, `amount`,
  `mileage`, `volume`, `fuelType`, `description`, `tags`, `missedFillup`) to a column in their file
  (or "none"). `date`, `amount`, and a vehicle source (column OR a single chosen target vehicle, see
  R4) are required; the rest are optional, exactly as the native importer already treats them.
- **R2 — Known-source presets.** Ship a small set of built-in column maps for the common trackers
  (Fuelly, Fuelio, Drivvo to start) keyed off their header signatures, so a recognized file
  auto-fills the mapping (user can still adjust). Unknown files fall back to manual mapping.
- **R3 — Value transforms during mapping.** Beyond renaming columns, the mapper must transform:
  (a) **units** — a file in L/100km or km or imperial gallons mapped onto a vehicle whose unit is
  different (see D1); (b) **category vocabulary** — foreign category words ("Gas", "Service",
  "Insurance") → VROOM's enum (`fuel|maintenance|financial|regulatory|enhancement|misc`) via a
  per-source (and user-editable) lookup (D2); (c) **date formats** — DD/MM/YYYY vs MM/DD/YYYY vs
  epoch, parsed in **local time** (never midnight-UTC — the cycle-6/11 class) (D3);
  (d) **decimal comma** — `1,5` → `1.5` for European exports.
- **R4 — Vehicle resolution.** Same cross-tenant-safe rule as native import: resolve to a vehicle
  the user **owns**, by name, never a file-provided id. If the foreign file has no usable vehicle
  column, the user picks one target vehicle for the whole import (D4).
- **R5 — Preview before commit.** Reuse the existing dryRun preview: after mapping, show the per-row
  plan (ready/error counts, first-N rows, every error message) before the user commits — identical
  to the native CSV-import UX.
- **R6 — Inherit all native-import safety.** The mapped rows flow through the **unchanged**
  `buildImportPlan` → `importExpenses`, so: per-row validation + full error report; formula-injection
  neutralization; idempotent re-import (deterministic clientId); atomic all-or-nothing commit;
  row/size caps. No new write path, no duplicated validation.
- **R7 — Mapping is presented client-side, applied server-side.** The transform must run on the
  server (same trust boundary as the rest of import); the client sends the file + the chosen mapping,
  the server applies it and runs the existing plan. (Mirrors how import already rides the JSON path.)
- **R8 — Quality bar.** Four-states on the mapping UI (no file / mapping / preview / committing +
  error); mobile-first; axe-clean; unit/locale-correct; compose from the kit (reuse the existing
  import dialog scaffolding). Backend `bun run validate`; UI screenshot.

## Non-goals (this iteration)

- Direct API/OAuth sync with other trackers (CSV file only).
- Importing non-expense entities from foreign files (their reminders, photos, etc.).
- A fully general "any spreadsheet" wizard with saved reusable templates — start with per-import
  mapping + a few built-in presets; saved custom templates are a follow-up.
- Auto-detecting units from the data (the user confirms units per the mapping; no guessing).

## Open product decisions — **NEED ANGELO'S SIGN-OFF**

> Recommended option (✅) each. Build is blocked until ratified.

- **D1 — Unit handling on import.** Foreign files carry their own units (km, L, L/100km, imperial
  gal). Options: (a) require the user to declare the file's units in the mapper, convert to the
  target vehicle's unit on import; (b) assume the file already matches the vehicle's unit (today's
  native-import assumption) and just document it. ✅ **(a)** — a metric Fuelio export into an
  imperial vehicle is the common case; converting (reusing `unit-conversions.ts`) is the honest
  behavior. Volume/distance unit pickers live in the mapper.
- **D2 — Category mapping.** Foreign category words rarely match VROOM's 6-value enum. ✅ Ship a
  per-source default lookup (e.g. Fuelly "Gas"→fuel) + let the user remap any unrecognized value in
  the preview step; an unmapped category defaults to `misc` with a visible per-row note (never a
  silent wrong bucket).
- **D3 — Ambiguous date formats.** DD/MM vs MM/DD can't always be inferred. ✅ The mapper has an
  explicit date-format selector (with a sensible per-preset default); parse in **local time**.
- **D4 — No-vehicle-column files.** Many single-car exports omit a vehicle column. ✅ Let the user
  pick one target vehicle for the whole file when no vehicle column is mapped (still owner-scoped).
- **D5 — Scope of v1 presets.** Which trackers ship as built-in presets first. ✅ **Fuelly + Fuelio +
  Drivvo** (most common; all fuel-centric) — others fall back to manual mapping. Confirm the set.

## Acceptance (once signed off)

- A real Fuelly/Fuelio CSV imports via auto-detected preset → preview → commit, with correct
  units, categories, and dates for a metric and an imperial vehicle.
- Re-importing the same foreign file is a no-op (inherits cycle-8 idempotency).
- A malformed row reports a clear error and doesn't block the good rows; a mid-batch DB failure
  rolls back (inherits the atomic commit).
- regress.sh green + an eyes-on screenshot of the mapping UI in all four states.
