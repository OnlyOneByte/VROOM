# Import from Other Trackers — Tasks

> **UNBLOCKED: Angelo signed off D1–D5 (all ✅ recommended) cycle 12 — build is GO.** Backend-first
> per CLAUDE.md. Each task is one loop increment; verify before ticking. The whole feature is additive
> — the native CSV-import path stays the default when no `mapping` is sent, so nothing here risks it.

## Phase 0 — sign-off (gates everything)
- [x] **T0** Angelo ratified D1–D5 at the ✅ recommended option for each (cycle 12). Design
      `[depends on Dx]` sections already assume those options; build T1+.

## Phase 1 — backend mapping core (pure, no I/O)
- [x] **T1 (cycle 58)** `import-mapping.ts`: `ColumnMapping` type + `applyMapping(foreignCsv, mapping, target)`
      → native-shape CSV. Unit conversion INTO the target vehicle's units (reuses `unit-conversions.ts`),
      decimal-comma, category map (+ `unmappedCategories` visible flag), **local-time** date normalization
      across iso/mdy/dmy/epoch (cycle-6/11 discipline). Pure (no DB/Hono); fully additive — the native import
      path is unchanged and stays default when no mapping is sent. 14 unit tests incl. the timezone-independent
      local-day invariant AND a load-bearing `applyMapping`→`buildImportPlan` round-trip proving the emitted
      native CSV is consumable end-to-end. backend validate:local EXIT 0 (987 pass, +14).
- [x] **T2 (cycle 64)** `import-mapping-presets.ts`: static `MappingPreset` table for Fuelly/Fuelio/Drivvo
      [D5] + `detectSource(headers)` + `presetToMapping(preset, targetVehicle)`. Detection is normalized
      (lower-case + strip non-alphanumerics) + SUBSTRING-based on a DISTINCTIVE signature subset (Fuelly
      `odometer`+`fillamount`, Fuelio `odo`+`litres`, Drivvo `totalprice`+`typeoffuel`) so real-world header
      decoration doesn't defeat it and the presets don't cross-detect; unknown files → null (safe → manual
      mapping). Pure; 10 unit tests (each signature, unknown/empty, drift tolerance, no-cross-detect,
      every-preset-detects-its-own-columns self-consistency, presetToMapping→applyMapping round-trip).
      backend validate:local EXIT 0 (1006 pass, +10). NOTE: column strings are best-effort from documented
      exports — validating against a REAL Fuelly/Fuelio/Drivvo file is deferred to T6 (a mis-detect is the
      safe failure: null → manual mapping, never a wrong auto-map).

## Phase 2 — route (backward-compatible)
- [x] **T3 (cycle 70)** Extended `POST /import` with an optional `mapping` (Zod `columnMappingSchema`):
      when present, resolve the target vehicle's units → `applyMapping` → the EXISTING
      `buildImportPlan`/dryRun/`importExpenses` flow (no new write path). `unmappedCategories` added to the
      response. Added `POST /import/detect` (header names → preset or null) for the client. BACKWARD-COMPAT:
      no `mapping` → the native path runs unchanged. C60 wiring risk handled: units convert toward the
      resolved targetVehicle's unitPreferences (skipped when no match, never a guess). 9 HTTP tests
      (Fuelio preview/commit, metric→imperial conversion, idempotent re-import, unmapped-category surface,
      malformed-row per-row, unparseable→400, detect preset/null, native backward-compat). CAUGHT a real
      schema bug pre-merge: `z.record(z.enum(NativeField))` is EXHAUSTIVE in Zod v4 (rejected a partial
      `columns`) → rewrote as explicit per-field optionals. backend validate:local EXIT 0 (1038 pass, +9).

## Phase 3 — frontend
- [~] **T4** Import-dialog mapping step: detected-source banner, per-field column dropdowns from the
      file headers, unit/date-format/target-vehicle pickers, category-remap table. Reuse the existing
      preview/commit step. Types + service wiring.
      - [x] **Types + service wiring DONE (C140, non-eyes-on):** `src/lib/types/import-mapping.ts`
            (ImportColumnMapping/ImportMappingPreset/NativeImportField mirroring the backend) +
            `expenseApi.importExpensesCsv(csv, dryRun, mapping?)` (backward-compat) +
            `detectImportSource(headers)`; +5 tests.
      - [x] **AUTO-DETECT + target-vehicle slice DONE (C31, eyes-on CONFIRMED):** ImportExpensesDialog
            now (1) auto-detects a Fuelly/Fuelio/Drivvo fuel log from its headers (`detectImportSource`),
            (2) shows a "Detected a <Tracker> fuel log" banner + a target-vehicle picker (these presets
            carry no `vehicle` column → D4 requires picking one; auto-selects the only vehicle), (3) builds
            the `ImportColumnMapping` from the preset + chosen vehicle and reuses the existing preview/commit
            step verbatim. A native VROOM export (has its own vehicle column) detects null → unchanged path.
            Eyes-on via `import-mapping-detect.meshclaw.e2e.ts` + shot (`/tmp/c31-import-mapped-preview.png`):
            banner + picker render, "Daily Driver" auto-selected. FE validate:local GREEN (726).
      - [x] **MANUAL column-mapping path DONE (C37, eyes-on CONFIRMED):** for an UNRECOGNIZED foreign CSV
            (no preset match, not a native VROOM export), the dialog now renders a "Map your columns" editor
            — a per-field dropdown for each VROOM field (date*/amount*/category/vehicle/mileage/volume/
            fuelType/description/tags) populated from the file's own headers + a date-format picker + the
            target-vehicle picker (shown only when no vehicle column is mapped, D4). Initial guesses
            auto-map by header-name substring (date/amount[+spent/paid/total]/category[+kind]/…); the user
            adjusts. buildMapping emits the ImportColumnMapping (drops unmapped fields) → the existing
            preview/commit runs verbatim. Eyes-on via `import-manual-mapping.meshclaw.e2e.ts` + 2 shots
            (Read): a bespoke CSV (Transaction Date/Spent/Kind/Notes) → editor with guessed mappings →
            "1 ready · 1 row needs attention" after picking the vehicle (the maintenance row imports; the
            fuel row correctly errors "fuel rows require fuel amount and mileage"). FE validate:local GREEN.
      - [ ] **REMAINING (T4 follow-ups):** unit (distance/volume) override pickers for the manual path +
            a category-remap table for unrecognized category WORDS. **BLOCKER surfaced + flagged to Angelo
            C31:** the fuel presets map no category column and `mapCategory` leaves a blank category blank
            (D2 "never invent"), so a detected fuel log previews 0-ready ("Unknown category"). Recommended
            fix (a): give each fuel preset a `defaultCategory:'fuel'`
            (backend-preset change, awaiting the steer) — until then the auto-detect path detects+maps but
            commits nothing.
- [ ] **T5** Four-states + a11y + mobile; compose from the kit.

## Phase 4 — verify
- [ ] **T6** E2E (auto-detected preset path + manual-mapping path, mi + km vehicle) + eyes-on
      screenshots of all four states. regress.sh green. Consider extending the `no-utc-month-parse`
      guard to cover `import-mapping.ts`.
