# Implementation Plan: Unit-Aware Display

## Overview

Migrate VROOM from hardcoded imperial labels to a fully unit-aware system. Backend gains a `UnitConverter` module, per-vehicle `unitPreferences` JSON columns, and unit-neutral API responses. Frontend replaces all hardcoded labels with dynamic resolution from vehicle or global unit context. This is a breaking API change — backend and frontend are updated simultaneously.

## Tasks

- [x] 1. Define shared types and conversion utilities
  - [x] 1.1 Add `UnitPreferences` type and unit enums to backend types
    - Add `DistanceUnit`, `VolumeUnit`, `ChargeUnit` enums and `UnitPreferences` interface to `backend/src/types.ts`
    - Include index signature for extensibility
    - Add a `parseUnitPreferences` validation function that checks enum membership
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Implement `UnitConverter` functions in `backend/src/utils/unit-conversions.ts`
    - Add `convertDistance(value, from, to)`, `convertVolume(value, from, to)`, `convertEfficiency(value, fromDist, fromVol, toDist, toVol)` as pure functions
    - Use exact conversion factors: 1 mile = 1.609344 km, 1 gal (US) = 3.785411784 L, 1 gal (UK) = 4.54609 L
    - Return input unchanged when source and target units are identical
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 1.3 Write property tests for unit conversion (Properties 5, 6, 7)
    - Create `backend/src/utils/__tests__/unit-conversions.property.test.ts` using `fast-check`
    - **Property 5: Unit conversion correctness** — generate random values and unit pairs, verify conversion applies correct factor
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - **Property 6: Unit conversion identity** — generate random values and same unit, verify exact identity
    - **Validates: Requirements 3.4**
    - **Property 7: Unit conversion round-trip** — generate random values and unit pairs, verify round-trip within 0.0001
    - **Validates: Requirements 3.5**

  - [x] 1.4 Add `UnitPreferences` type and unit enums to frontend types
    - Add `UnitPreferences` interface to `frontend/src/lib/types/index.ts` (or appropriate types file)
    - Extend `Vehicle` interface with `unitPreferences: UnitPreferences`
    - Update `UserSettings` interface: replace separate `distanceUnit`/`volumeUnit`/`chargeUnit` with `unitPreferences: UnitPreferences`
    - Add `UnitsMetadata` type for analytics responses
    - _Requirements: 1.1, 7.2, 10.1_

- [x] 2. Database migration and schema updates
  - [x] 2.1 Update Drizzle schema for `vehicles` and `user_settings` tables
    - Add `unitPreferences` JSON column to `vehicles` table in `backend/src/db/schema.ts`
    - Replace separate `distanceUnit`, `volumeUnit`, `chargeUnit` columns in `user_settings` with single `unitPreferences` JSON column
    - Set NOT NULL with default `{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}`
    - _Requirements: 1.7, 10.1, 10.2_

  - [x] 2.2 Create migration 0006 for unit preferences consolidation
    - Add `unit_preferences` column to `vehicles` table
    - Backfill each vehicle's `unitPreferences` from owning user's `user_settings` separate columns
    - Add `unit_preferences` column to `user_settings` table
    - Backfill `user_settings.unit_preferences` from existing separate columns
    - Drop old separate `distance_unit`, `volume_unit`, `charge_unit` columns from `user_settings`
    - Vehicles without a matching `user_settings` row get schema defaults
    - Preserve all existing numeric values in `expenses` and `odometer_entries` unchanged
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.2, 10.3_

  - [x] 2.3 Write migration tests (Properties 14, 15, 16)
    - Create `backend/src/db/__tests__/migration-0006.test.ts`
    - **Property 14: User settings migration consolidates columns** — seed users with separate unit columns, run migration, verify JSON matches
    - **Validates: Requirements 10.2, 10.3, 10.4**
    - **Property 15: Migration backfills from user settings** — seed users with settings and vehicles, verify vehicle backfill
    - **Validates: Requirements 9.1**
    - **Property 16: Migration preserves existing data** — seed expenses and odometer entries, verify numeric values unchanged
    - **Validates: Requirements 9.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Backend API updates for vehicles and settings
  - [x] 4.1 Update vehicle routes to handle `unitPreferences`
    - Update create endpoint: accept optional `unitPreferences` in body, default from user's `user_settings.unitPreferences` if absent
    - Update update endpoint: accept partial `unitPreferences` updates
    - Add Zod validation for `unitPreferences` enum values on create/update
    - Return `unitPreferences` in vehicle response objects
    - _Requirements: 1.4, 1.5, 1.6, 8.1, 8.2_

  - [x] 4.2 Update vehicle repository for `unitPreferences` persistence
    - Update `create` to merge defaults from user settings when `unitPreferences` is omitted
    - Update `update` to handle partial `unitPreferences` merges
    - Update `getById` and list queries to include `unitPreferences` in returned data
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 4.3 Write property tests for vehicle unit CRUD (Properties 1, 2, 3, 4)
    - Create `backend/src/api/vehicles/__tests__/vehicle-units.property.test.ts` using `fast-check`
    - **Property 1: Unit preferences contain required keys** — generate random unit preference objects, verify validation
    - **Validates: Requirements 1.1, 1.2**
    - **Property 2: Default unit inheritance on vehicle creation** — generate user settings, create vehicles without units, verify defaults
    - **Validates: Requirements 1.4**
    - **Property 3: Explicit unit preferences override defaults** — generate valid prefs, create vehicles with explicit units, verify stored values
    - **Validates: Requirements 1.5**
    - **Property 4: Unit preferences are updatable** — update vehicle units, verify new values stored
    - **Validates: Requirements 1.6**

  - [x] 4.4 Update settings API and repository for `unitPreferences` JSON
    - Update settings routes to accept/return `unitPreferences` as a JSON object
    - Update settings repository to read/write the `unitPreferences` JSON column
    - Remove handling of old separate `distanceUnit`/`volumeUnit`/`chargeUnit` fields
    - _Requirements: 10.1, 10.4, 10.5_

  - [x] 4.5 Update settings store on frontend
    - Update `frontend/src/lib/stores/settings.ts` to expose `unitPreferences` object
    - Update any references to separate `distanceUnit`/`volumeUnit`/`chargeUnit` to use `unitPreferences.*`
    - _Requirements: 10.4_

- [x] 5. Backend analytics conversion and unit-neutral responses
  - [x] 5.1 Add unit conversion helpers to analytics repository
    - Add `getUserUnits(userId)` helper to read user's `unitPreferences` from `user_settings`
    - Add `getVehicleUnits(vehicleId)` helper to read vehicle's `unitPreferences`
    - _Requirements: 6.1, 6.2_

  - [x] 5.2 Update cross-vehicle analytics to convert values before aggregation
    - Update `getCrossVehicle`, `getQuickStats`, `getYearEnd` methods to convert per-vehicle values to user's global units via `UnitConverter` before aggregation
    - Skip conversion when all vehicles share the same units as the global preference
    - Add validation error for invalid unit enum values in stored data
    - _Requirements: 6.1, 6.3, 6.4, 6.5_

  - [x] 5.3 Rename API response fields to unit-neutral names
    - Rename `totalMiles` → `totalDistance`, `avgMpg` → `avgEfficiency`, `bestMpg` → `bestEfficiency`, `worstMpg` → `worstEfficiency`, `gallons` → `volume`, `costPerMile` → `costPerDistance`, `pricePerGallon` → `pricePerVolume`, `mpg` → `efficiency`, `avgGallons` → `avgVolume`, `mpgTrend` → `efficiencyTrend`
    - Add `units: { distanceUnit, volumeUnit, chargeUnit }` metadata to all analytics responses
    - _Requirements: 7.1, 7.2_

  - [x] 5.4 Write property test for cross-vehicle analytics conversion (Property 11)
    - Create `backend/src/api/analytics/__tests__/analytics-units.property.test.ts` using `fast-check`
    - **Property 11: Cross-vehicle analytics conversion** — generate vehicles with mixed units and expense data, verify aggregation converts to target units
    - **Validates: Requirements 6.1**

  - [x] 5.5 Write property test for global settings change isolation (Property 17)
    - Add to `backend/src/api/vehicles/__tests__/vehicle-units.property.test.ts`
    - **Property 17: Global settings change does not affect vehicles** — update user settings, verify existing vehicles unchanged
    - **Validates: Requirements 11.3**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend label resolution and analytics response handling
  - [x] 7.1 Verify and extend label functions in `frontend/src/lib/utils/units.ts`
    - Ensure `getDistanceUnitLabel`, `getVolumeUnitLabel`, `getFuelEfficiencyLabel`, `getCostPerDistanceLabel`, `getLongFormLabel` cover all enum values
    - Add any missing label functions (e.g., long-form labels like `Gallons (US)`, `Liters`, `Miles`, `Kilometers`)
    - _Requirements: 4.3, 4.4, 4.5, 4.6_

  - [x] 7.2 Write property test for label function output (Property 10)
    - Create `frontend/src/lib/utils/__tests__/units.property.test.ts` using `fast-check`
    - **Property 10: Label function output correctness** — generate all valid unit enum combinations, verify label functions produce correct output
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6**

  - [x] 7.3 Update frontend analytics response types and API service
    - Update analytics API service to use unit-neutral field names (`totalDistance`, `avgEfficiency`, etc.)
    - Update response type interfaces to include `units: UnitsMetadata`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Replace hardcoded labels in frontend components
  - [x] 8.1 Update FuelStatsTab with dynamic labels
    - Replace hardcoded `' gal'`, `' mi'`, `'Average MPG'`, `'Best MPG'`, `'Worst MPG'`, `'Cost/Mile'` with Label_Resolver calls using vehicle's `unitPreferences`
    - Use `$derived` for reactive label computation
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 8.2 Update FuelEfficiencyTrendChart and FuelCharts with dynamic labels
    - Replace hardcoded `'MPG'`, `'mi/kWh'`, `'Gallons'`, `'Price per gallon'`, `'Cost per Mile'` with Label_Resolver calls
    - _Requirements: 5.5, 5.6_

  - [x] 8.3 Update AdvancedCharts and CrossVehicleTab with dynamic labels
    - Replace hardcoded `'Avg MPG'`, `'/mi'`, `'MPG'` with Label_Resolver calls
    - CrossVehicleTab uses global unit preferences for labels
    - _Requirements: 5.7, 5.8_

  - [x] 8.4 Update YearEndTab and PerVehicleTab with dynamic labels
    - Replace hardcoded `'Avg MPG'`, `'total miles'`, `'Total Miles'` with Label_Resolver calls
    - _Requirements: 5.9, 5.10_

  - [x] 8.5 Update OdometerTab and LeaseMetricsCard with dynamic labels
    - Replace hardcoded `' mi'` with Label_Resolver calls using vehicle's `unitPreferences`
    - _Requirements: 5.11, 5.12_

  - [x] 8.6 Update PaymentMetricsGrid and ExpenseForm with dynamic labels
    - Replace hardcoded `' mi over'`, `'/mi'`, `' miles'` with Label_Resolver calls
    - _Requirements: 5.13, 5.14_

  - [x] 8.7 Update analytics page quick stats with dynamic labels
    - Replace hardcoded `'Avg MPG'` with Label_Resolver call using global unit preferences
    - _Requirements: 5.15_

- [x] 9. Vehicle form and settings page updates
  - [x] 9.1 Add unit preferences section to vehicle create/edit forms
    - Add collapsible "Unit Preferences" section with shadcn-svelte `Select` components for `distanceUnit`, `volumeUnit`, `chargeUnit`
    - Pre-fill defaults from `settingsStore.settings.unitPreferences` on create
    - Show current vehicle values on edit
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 9.2 Add explanatory text to settings page
    - Add text clarifying global units serve as defaults for new vehicles
    - Add text clarifying global units determine display units for cross-vehicle analytics
    - _Requirements: 11.1, 11.2_

- [x] 10. Backup/sync compatibility updates
  - [x] 10.1 Update backup, restore, and Google Sheets sync for new schema
    - Update `backup.ts` to verify JSON round-trip for `unit_preferences` column in `coerceRow`
    - Update `restore.ts` to handle `unit_preferences` as JSON string; older backups without the column use schema defaults; older backups with separate columns migrate to JSON format
    - Update `google-sheets.ts` to add `unit_preferences` to vehicles and user_settings headers, remove old separate unit columns from user_settings headers
    - _Requirements: 9.5, 10.1_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- This is a breaking API change — backend and frontend field name changes happen simultaneously
- No per-expense unit storage; expenses inherit from parent vehicle at display time
