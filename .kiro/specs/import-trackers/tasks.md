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
- [ ] **T3** Extend `POST /import` with optional `mapping`: when present, `applyMapping` then the
      EXISTING `buildImportPlan`/dryRun/`importExpenses` flow (no new write path). Add source detection
      for the client. HTTP tests: Fuelly + Fuelio fixtures → preview → commit; re-import no-op;
      metric→imperial conversion; malformed row reported.

## Phase 3 — frontend
- [ ] **T4** Import-dialog mapping step: detected-source banner, per-field column dropdowns from the
      file headers, unit/date-format/target-vehicle pickers, category-remap table. Reuse the existing
      preview/commit step. Types + service wiring.
- [ ] **T5** Four-states + a11y + mobile; compose from the kit.

## Phase 4 — verify
- [ ] **T6** E2E (auto-detected preset path + manual-mapping path, mi + km vehicle) + eyes-on
      screenshots of all four states. regress.sh green. Consider extending the `no-utc-month-parse`
      guard to cover `import-mapping.ts`.
