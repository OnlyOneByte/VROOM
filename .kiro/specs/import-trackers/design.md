# Import from Other Trackers — Design

> **Status: DRAFT — blocked on requirements D1–D5 sign-off.** Assumes the ✅ option for each open
> decision; sections that hinge on one are marked **[depends on Dx]**. Grounded in a read of the
> current import internals (cycle 9).

## Grounding — the pipeline we wrap (reuse, don't reinvent)

- **Native import route:** `backend/src/api/expenses/routes.ts` `POST /import` (~`routes.ts:406`).
  Carries CSV *text* on the JSON path; `dryRun` previews, `dryRun:false` commits.
- **The plan builder:** `backend/src/api/expenses/import-csv.ts` `buildImportPlan(csv, vehicles)`
  → parses with `csv-parse/sync` (`columns:true`), resolves each row via `parseRow`, returns
  `{rows, readyCount, errorCount}`. `parseRow` reads VROOM's native headers through a denormalizing
  `get('date'|'vehicle'|'category'|'amount'|'mileage'|'volume'|'fuelType'|'description'|'tags')`
  and delegates each field to a small `parse*` helper (cycle-190/191).
- **The native column shape** (export + import contract): `EXPORT_COLUMNS` (`routes.ts:316`) =
  `date,vehicle,category,amount,currency,mileage,volume,fuelType,description,tags,missedFillup,createdAt`.
- **The commit:** `expenseRepository.importExpenses(rows, userId)` (cycle-8) — one db.transaction,
  deterministic per-row clientId → idempotent re-import, returns `{imported, duplicates}`.
- **Safety already present (all inherited free):** formula-injection neutralize/denormalize
  (`csv-safety.ts`, cycle-192), cross-tenant-safe vehicle-by-name resolution within `findByUserId`
  (cycle-145), 5 MB / 5000-row caps, full per-row error reporting.

**Key architectural insight:** foreign import is a **header+value translation pre-pass** that emits a
CSV in VROOM's *native* shape, then calls the existing `buildImportPlan` unchanged. Everything
downstream — validation, preview, neutralization, idempotency, atomic commit — is reused verbatim.

## Architecture

```
foreign CSV text + ColumnMapping  ──►  applyMapping()  ──►  native-shape CSV  ──►  buildImportPlan ──► importExpenses
   (client sends both)                 (NEW, server)        (EXPORT_COLUMNS)        (UNCHANGED)         (UNCHANGED)
```

### New: `ColumnMapping` + `applyMapping` (server, `backend/src/api/expenses/import-mapping.ts`)

```ts
interface ColumnMapping {
  source?: string;              // preset id ('fuelly'|'fuelio'|'drivvo') or undefined for manual
  columns: Partial<Record<NativeField, string>>;  // VROOM field -> foreign header name
  targetVehicle?: string;       // chosen vehicle name when no vehicle column (D4)
  dateFormat: 'iso' | 'mdy' | 'dmy' | 'epoch';     // D3
  distanceUnit?: 'miles' | 'kilometers';           // file's unit (D1)
  volumeUnit?: 'gallons_us' | 'gallons_uk' | 'liters';
  categoryMap?: Record<string, ExpenseCategory>;   // foreign word -> enum (D2)
}
```
`applyMapping(foreignCsv, mapping)` parses the foreign rows, and for each emits a native-shape record:
- rename columns per `mapping.columns`; inject `vehicle = targetVehicle` when no vehicle column (D4);
- transform values: decimal-comma → dot; **unit-convert** distance/volume to the target vehicle's
  unit via `backend/src/utils/unit-conversions.ts` (D1); map category words via `categoryMap`, else
  `misc` + flag (D2); normalize the date to ISO **in local time** using `dateFormat` (D3) — reusing
  the same local-time discipline as `parseMonthToDate`/the cycle-11 fix (NEVER `new Date('YYYY-MM-DD')`).
It returns native CSV text. The existing `buildImportPlan` then does all validation/erroring — so a
bad mapped value still surfaces as a normal per-row error, not a crash.

### Presets (`import-mapping-presets.ts`)

A static table: `{ id, label, headerSignature: string[], columns, dateFormat, units, categoryMap }`
for Fuelly/Fuelio/Drivvo [depends on D5]. `detectSource(headers)` returns the preset whose signature
is a subset of the file's headers, or null → manual mapping. Pure + unit-tested; no I/O.

### Route

Extend `POST /import` with an optional `mapping` field (when absent, today's native path runs
unchanged — fully backward compatible). When present: `csv = applyMapping(rawCsv, mapping)` then the
existing `buildImportPlan`/dryRun/`importExpenses` flow. Add `GET /import/detect` (or fold detection
into a dryRun response) so the client can auto-select a preset from the uploaded headers. **[depends
on D5 for the preset set]**

### Frontend

Extend the existing import dialog (`/expenses` import UI, cycle-191) with a **mapping step** between
file-select and preview: show detected source (or "manual"), per-field column dropdowns (populated
from the file's headers), unit + date-format + target-vehicle pickers, and a category-remap table for
unrecognized values. Reuse the existing preview/commit step as-is. Compose from the kit; four-states.

## Inheriting the timezone discipline (explicit)

`applyMapping`'s date normalization is the one new place that parses dates, so it MUST follow the
repo's local-time rule (cycle-6/11) — build dates from parts in local time, never hand a date-only
string to `new Date()`. The `no-utc-month-parse` guard class should be considered for extension to
cover this file.

## Ambiguities flagged

- **A1 — lossy unit conversion** (D1): converting L→gal etc. introduces rounding; store the
  converted value (matches how the app stores as-entered in the vehicle's unit). Document it.
- **A2 — category collisions** (D2): two foreign words may map to the same enum; that's fine
  (many→one). The risk is silent *mis*-bucketing — mitigated by the "unmapped → misc + visible note"
  rule, never a silent guess.
- **A3 — vehicle name matching** across trackers: foreign files name vehicles differently than the
  user's VROOM nicknames; D4's "pick one target vehicle" sidesteps it for single-car files, but
  multi-vehicle foreign files still need the user to map names — surface unmatched names as per-row
  errors (the native resolver already does this).

## Test plan

- Unit: `detectSource` (each preset signature + unknown), `applyMapping` (rename, unit convert,
  decimal comma, category map + unmapped→misc, each date format in a non-UTC zone, no-vehicle-column
  → targetVehicle).
- HTTP: a Fuelly-shaped and a Fuelio-shaped fixture → preview (counts/errors) → commit; re-import
  no-op (inherits cycle-8); malformed row reported; metric file into imperial vehicle converts.
- E2E + screenshot: mapping UI four states; auto-detected preset path; manual-mapping path.

## Rollout

Backend-first per CLAUDE.md: mapping types + `applyMapping` + presets + `detectSource` (+ tests) →
route extension (backward-compatible) → frontend mapping step → e2e. The native import path is
untouched and stays the default when no `mapping` is sent. **Build starts only after D1–D5 sign-off.**
