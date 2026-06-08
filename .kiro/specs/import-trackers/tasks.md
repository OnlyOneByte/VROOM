# Import from Other Trackers — Tasks

> **BLOCKED: do not start until requirements D1–D5 are signed off.** Backend-first per CLAUDE.md.
> Each task is one loop increment; verify before ticking. The whole feature is additive — the native
> CSV-import path stays the default when no `mapping` is sent, so nothing here risks existing import.

## Phase 0 — sign-off (gates everything)
- [ ] **T0** Angelo ratifies D1–D5 (units, category map, date formats, no-vehicle-column, preset set)
      or chooses alternatives. Reconcile design `[depends on Dx]` sections before any code.

## Phase 1 — backend mapping core (pure, no I/O)
- [ ] **T1** `import-mapping.ts`: `ColumnMapping` type + `applyMapping(foreignCsv, mapping)` →
      native-shape CSV. Unit conversion (reuse `unit-conversions.ts`), decimal-comma, category map
      (+ unmapped→misc flag), **local-time** date normalization per `dateFormat`. Unit tests incl. a
      non-UTC-zone date case.
- [ ] **T2** `import-mapping-presets.ts`: static maps for Fuelly/Fuelio/Drivvo [D5] + `detectSource(headers)`.
      Pure; unit-tested against each signature + an unknown file.

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
