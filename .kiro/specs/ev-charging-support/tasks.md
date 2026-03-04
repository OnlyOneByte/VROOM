# Implementation Plan: EV Charging Support

## Overview

Bottom-up implementation of EV charging support using `fuelType` as the discriminator between fuel and charging expenses. Adds `trackFuel`/`trackCharging` boolean flags to vehicles, extends backend stats and validation, updates the API transformer, and wires the frontend forms. No expense schema changes.

## Tasks

- [x] 1. Database migration and shared helper
  - [x] 1.1 Add `trackFuel` and `trackCharging` columns to vehicles schema and generate migration
    - Add `trackFuel` (integer boolean, NOT NULL, default true) and `trackCharging` (integer boolean, NOT NULL, default false) to the `vehicles` table in `backend/src/db/schema.ts`
    - Run `bun run db:generate` to generate the Drizzle migration
    - Add data migration SQL to set flags based on existing `vehicleType`: electric → trackFuel=false/trackCharging=true, hybrid → trackCharging=true, gas keeps defaults
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Create `isElectricFuelType` helper and `ELECTRIC_FUEL_TYPES` constant
    - Add `ELECTRIC_FUEL_TYPES` constant array (`['Electric', 'Level 1 (Home)', 'Level 2 (AC)', 'DC Fast Charging']`) and `isElectricFuelType(fuelType: string | null): boolean` function to `backend/src/db/types.ts`
    - Export both for use across backend modules
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 1.3 Write property test for `isElectricFuelType`
    - **Property 3: isElectricFuelType consistency**
    - Use fast-check to verify: all strings in ELECTRIC_FUEL_TYPES return true, all other strings (including null, empty, arbitrary) return false
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x] 1.4 Update category labels for EV awareness
    - Change `EXPENSE_CATEGORY_LABELS.fuel` to `'Fuel & Charging'` and `EXPENSE_CATEGORY_DESCRIPTIONS.fuel` to `'Fuel, gas, and electric charging costs'` in `backend/src/db/types.ts`
    - _Requirements: 7.1, 7.2_

- [x] 2. Backend calculations and vehicle stats
  - [x] 2.1 Add `calculateMilesPerKwh` and `calculateAverageMilesPerKwh` to `backend/src/utils/calculations.ts`
    - `calculateMilesPerKwh(miles, kwh)`: return `miles / kwh` with zero-guard (return 0 if kwh <= 0)
    - `calculateAverageMilesPerKwh(chargeExpenses)`: sequential analysis mirroring `calculateAverageMPG`, return null if < 2 expenses with mileage, exclude `missedFillup`, filter unrealistic values > 10 mi/kWh
    - _Requirements: 4.8, 4.9, 4.10, 4.11_

  - [x] 2.2 Update `calculateVehicleStats` in `backend/src/utils/vehicle-stats.ts`
    - Accept `trackFuel` and `trackCharging` boolean parameters
    - Split fuel-category expenses into fuel-group and charge-group using `isElectricFuelType(expense.fuelType)`
    - Compute `totalFuelConsumed` (sum of fuelAmount for non-electric) and `totalChargeConsumed` (sum of fuelAmount for electric)
    - Compute `averageMpg` only when `trackFuel=true`, `averageMilesPerKwh` only when `trackCharging=true`; return null for disabled metrics
    - Update `VehicleStats` interface to include `totalChargeConsumed` and `averageMilesPerKwh`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 2.3 Write property test for stats totals partition
    - **Property 4: Stats totals partition by fuelType**
    - Use fast-check to generate arbitrary expense lists, verify `totalFuelConsumed + totalChargeConsumed` equals sum of all `fuelAmount` values, split correctly by `isElectricFuelType`
    - **Validates: Requirements 4.1, 4.6, 4.7**

  - [x] 2.4 Write property test for stats tracking flag gating
    - **Property 5: Stats tracking flag gating**
    - Use fast-check to verify: `averageMpg` is non-null only when `trackFuel=true`, `averageMilesPerKwh` is non-null only when `trackCharging=true`
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**

- [x] 3. Backend validation update
  - [x] 3.1 Update `validateFuelExpenseData` in `backend/src/utils/validation.ts`
    - Change signature to accept `fuelType` parameter instead of (or in addition to) any vehicleType-based logic
    - For `category === 'fuel'`: require `fuelAmount` and `mileage` regardless of fuelType
    - Use `isElectricFuelType(fuelType)` to differentiate error messages: "charge amount (kWh)" vs "fuel amount"
    - For non-fuel categories: pass without energy data validation
    - Remove any `vehicleType`-based validation logic
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.2 Write property test for fuelType-based validation
    - **Property 8: fuelType-based validation**
    - Use fast-check to verify: fuel-category expenses always require fuelAmount + mileage regardless of fuelType, non-fuel categories always pass
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5, 5.6**

- [x] 4. Backend API routes and checkpoint
  - [x] 4.1 Update vehicle routes in `backend/src/api/vehicles/routes.ts`
    - Pass `trackFuel` and `trackCharging` from the vehicle record to `calculateVehicleStats`
    - Ensure vehicle create/update endpoints accept and persist `trackFuel` and `trackCharging`
    - _Requirements: 1.1, 3.3, 4.1_

  - [x] 4.2 Update expense routes in `backend/src/api/expenses/routes.ts`
    - Update calls to `validateFuelExpenseData` to pass `fuelType` from the request body
    - _Requirements: 5.1, 5.2_

  - [x] 4.3 Checkpoint — Backend validation
    - Ensure all backend tests pass, run `bun run all:fix && bun run validate` in the backend directory, ask the user if questions arise.

- [x] 5. Frontend API transformer update
  - [x] 5.1 Update `api-transformer.ts` to use `fuelType` as discriminator
    - In `toBackendExpense`: map `volume` → `fuelAmount` for non-electric fuelTypes, map `charge` → `fuelAmount` for electric fuelTypes (preserve existing behavior for volume, add charge path)
    - In `fromBackendExpense`: use `isElectricFuelType(backendExpense.fuelType)` to decide mapping — electric → `charge`, non-electric → `volume`. Remove `vehicleType` parameter and `vehicleTypeMap` from batch function
    - Add `isElectricFuelType` and `ELECTRIC_FUEL_TYPES` to frontend (either import shared or duplicate in `frontend/src/lib/utils/units.ts`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 5.2 Write property test for transformer round-trip
    - **Property 1: Transformer round-trip preservation**
    - Use fast-check to generate expenses with arbitrary volume/charge and matching fuelType, verify `fromBackendExpense(toBackendExpense(expense))` preserves the energy value
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.7**

  - [x] 5.3 Write property test for fuelType-based mutual exclusivity
    - **Property 2: fuelType-based mutual exclusivity**
    - Use fast-check to verify: for any expense from `fromBackendExpense`, exactly one of `volume` or `charge` is defined, determined solely by `isElectricFuelType(fuelType)`
    - **Validates: Requirements 2.5, 2.6**

- [x] 6. Frontend vehicle form and type updates
  - [x] 6.1 Add `trackFuel` and `trackCharging` to frontend Vehicle type
    - Update `frontend/src/lib/types/index.ts` (or wherever the Vehicle type is defined) to include `trackFuel: boolean` and `trackCharging: boolean`
    - _Requirements: 1.1, 1.3_

  - [x] 6.2 Fix VehicleForm to submit `vehicleType`, `trackFuel`, and `trackCharging`
    - In `frontend/src/lib/components/vehicles/VehicleForm.svelte`:
    - Include `vehicleType`, `trackFuel`, and `trackCharging` in the `handleSubmit` payload for both create and update
    - Add toggle switches for "Track fuel costs" and "Track charging costs"
    - When `vehicleType` changes, auto-set defaults (gas → fuel only, electric → charging only, hybrid → both) but allow user override
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_

- [x] 7. Frontend expense form updates
  - [x] 7.1 Add energy mode toggle to `FuelFieldsSection.svelte`
    - Replace the `vehicleType` prop with `trackFuel` and `trackCharging` boolean props
    - Add internal `energyMode` state (`'fuel' | 'charging'`) — derived from `fuelType` on edit (using `isElectricFuelType`), defaults to `'fuel'` on create
    - When both `trackFuel` and `trackCharging` are true: render a segmented toggle (⛽ Fuel / ⚡ Charging) at the top of the fuel details section using shadcn Tabs or a two-button control
    - When only one flag is true: no toggle shown, lock to that mode
    - Toggle visibility: fuel-only → no toggle (fuel mode), charging-only → no toggle (charging mode), both → toggle shown
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 7.2 Wire energy mode to fields, dropdown, and labels in `FuelFieldsSection.svelte`
    - Fuel mode: show volume input (`getVolumeUnitLabel`), fuel type dropdown (87 Regular, 89 Mid-Grade, 91 Premium, 93 Super Premium, Diesel, Ethanol-Free, Other), price-per-gallon, MPG efficiency display, ⛽ "Fuel Details" header
    - Charging mode: show charge input (`getChargeUnitLabel`), charging type dropdown (Level 1 Home, Level 2 AC, DC Fast Charging, Electric), price-per-kWh, mi/kWh efficiency display, ⚡ "Charging Details" header
    - When switching fuel → charging: clear `volume` and `fuelType`, set `fuelType` to `'Electric'` default
    - When switching charging → fuel: clear `charge` and `fuelType`, reset to fuel dropdown
    - _Requirements: 9.4, 9.5_

  - [x] 7.3 Update `ExpenseForm.svelte` to pass tracking flags to `FuelFieldsSection`
    - Pass `vehicle.trackFuel` and `vehicle.trackCharging` instead of `vehicle.vehicleType` to `FuelFieldsSection`
    - Update `showVolumeField`/`showChargeField` derived values to use `energyMode` from the section (or derive from `fuelType` using `isElectricFuelType`)
    - Ensure `handleMileageChange` works for both fuel and charging efficiency calculations based on `fuelType`
    - Update form validation to use `isElectricFuelType(formData.fuelType)` for field requirements
    - _Requirements: 9.1, 9.4, 9.5_

  - [x] 7.4 Update frontend `expense-helpers.ts` category label
    - Change `categoryLabels.fuel` from `'Fuel'` to `'Fuel & Charging'` to match backend label update
    - _Requirements: 7.1_

  - [x] 7.5 Checkpoint — Frontend validation
    - Ensure all frontend tests pass, run `npm run all:fix && npm run validate` in the frontend directory, ask the user if questions arise.

- [x] 8. Backup and sync pipeline
  - [x] 8.1 Update backup pipeline to include tracking flags
    - In `backend/src/api/sync/backup.ts`: include `trackFuel` and `trackCharging` in exported vehicle CSV data
    - In `backend/src/api/sync/restore.ts`: handle `trackFuel` and `trackCharging` during restore; for older backups missing these columns, rely on schema defaults (trackFuel=true, trackCharging=false)
    - In `backend/src/api/sync/google-sheets.ts`: include `trackFuel` and `trackCharging` as column headers and export/import their values
    - Update `TABLE_SCHEMA_MAP` in `backend/src/config.ts` or `BackupData` type if needed
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 8.2 Write property test for backup round-trip of tracking flags
    - **Property 9: Backup round-trip for tracking flags**
    - Verify that vehicles with arbitrary `trackFuel`/`trackCharging` values survive a backup-then-restore cycle with values preserved
    - **Validates: Requirements 6.1, 6.2**

- [x] 9. Final checkpoint
  - Run `bun run all:fix && bun run validate` in backend and `npm run all:fix && npm run validate` in frontend
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check and validate correctness properties from the design document
- No expense schema changes — `fuelType` is the sole discriminator for fuel vs charging
- `trackFuel`/`trackCharging` control UI visibility only, not validation
