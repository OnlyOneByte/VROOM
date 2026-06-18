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
      - [x] **MANUAL UNIT pickers DONE (C41, eyes-on CONFIRMED):** the manual path now exposes Odometer-unit
            + Volume-unit pickers (shown only when those columns are mapped), defaulting to the target
            vehicle's units (= no conversion baseline). `buildMapping` sends the file's distanceUnit/volumeUnit
            only when the matching column is mapped, so applyMapping converts INTO the vehicle's units —
            closing the C37 gap where a metric log imported raw (NORTH_STAR #2). Eyes-on via
            `import-manual-units.meshclaw.e2e.ts` + shot: a km/litres log mapped + units set to Kilometers/
            Liters → committed row converted 160.9344 km→100 mi, 37.854 L→~10 US gal (verified via API).
            Field/unit Select triggers got `data-testid`s for deterministic e2e targeting.
      - [x] **CATEGORY-REMAP table DONE (C47, eyes-on CONFIRMED):** when a preview surfaces
            `unmappedCategories` (a foreign category WORD the importer didn't recognize → falls back to misc,
            D2 "never invent"), the dialog renders an "Unrecognized categories" panel — one row per word + a
            VROOM-category `Select` (reusing the canonical `categoryLabels`). Assigning a word folds it into
            the mapping's `categoryMap` (merged over any preset map; user choices win) and re-previews, so
            the word resolves + drops out of the list and its rows re-categorize. Eyes-on via
            `import-category-remap.meshclaw.e2e.ts` + 2 shots (Read): a bespoke CSV with `Type=servicing` →
            "Unrecognized categories" panel renders → map servicing→Maintenance → panel disappears, "1 ready"
            → committed row imported as `maintenance` (NOT the misc fallback, verified via API). Remap trigger
            got `data-testid="remap-category-{word}"`. FE validate:local GREEN (735).
      - [ ] **REMAINING (T4 follow-ups):** the Angelo-gated preset `defaultCategory`. **BLOCKER surfaced +
            flagged to Angelo C31:** the fuel presets map no category column and `mapCategory` leaves a blank
            category blank (D2 "never invent"), so a DETECTED fuel log previews 0-ready ("Unknown category").
            Recommended fix (a): give each fuel preset a `defaultCategory:'fuel'` (backend-preset change,
            awaiting the steer) — until then the auto-detect path detects+maps but commits nothing. (NOTE: the
            C47 remap table does NOT solve this — a detected preset maps no category COLUMN at all, so there's
            no word to remap; the gap is the missing column, which is the parked `defaultCategory` decision.)
- [ ] **T5** Four-states + a11y + mobile; compose from the kit.

## Phase 4 — verify
- [~] **T6** E2E (auto-detected preset path + manual-mapping path, mi + km vehicle) + eyes-on
      screenshots of all four states. regress.sh green. Consider extending the `no-utc-month-parse`
      guard to cover `import-mapping.ts`.
      - [x] **DATE-GUARD slice DONE (C54):** the merge-surviving no-utc guard for the import date paths is
            committed — `no-utc-import-date.test.ts` (+3) scans import-mapping.ts / local-date.ts /
            import-csv.ts for a Date built from a date-only string OR `${y}-${m}-${d}` template (the
            midnight-UTC rollback, #23/#59/#87), and pins that import-mapping still routes through
            buildLocalDate. Non-vacuous BOTH ways (both antipattern forms → RED; the 2 legit new Date(ms)/
            new Date(s) sites don't false-flag). The behavioral net (import-mapping.test.ts local-time
            discipline across iso/mdy/dmy/epoch) already existed; this is the structural tree-wide net.
      - [ ] **REMAINING:** the eyes-on round-trip E2E across BOTH paths (auto-detect preset + manual) on a
            mi AND a km vehicle + the four-state screenshots. The per-slice eyes-on already landed (C31
            detect, C37 manual-map, C41 manual-units, C47 category-remap each shot + Read); T6 is the
            consolidated multi-state pass + regress.sh-green capture (gated only by the eyes-on harness,
            not blocked).
