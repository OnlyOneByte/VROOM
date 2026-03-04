# Requirements Document

## Introduction

The VROOM car tracker application needs end-to-end EV and PHEV support. Currently, the VehicleForm omits `vehicleType` from submissions, backend stats ignore electric efficiency, the API transformer guesses field semantics based on vehicle type, and the "fuel" category label doesn't reflect charging. This design resolves these gaps by using the existing `fuelType` column as the discriminator between fuel and charging expenses (no new expense columns), adding `trackFuel` and `trackCharging` boolean flags to the vehicles table to decouple UI visibility from `vehicleType`, and extending stats calculations for electric efficiency. The `fuelAmount` column stores both gallons/liters and kWh — the `fuelType` value determines interpretation.

## Glossary

- **Vehicles_Table**: The SQLite `vehicles` table storing vehicle records including tracking preferences
- **Expense_Table**: The SQLite `expenses` table storing all vehicle expense records (unchanged schema)
- **API_Transformer**: The frontend module (`api-transformer.ts`) that maps between frontend `volume`/`charge` fields and backend `fuelAmount` using `fuelType` as the discriminator
- **VehicleForm**: The Svelte component for creating and editing vehicles
- **Validator**: The backend validation module (`validation.ts`) that enforces data integrity rules on expense submissions
- **Stats_Calculator**: The backend modules (`vehicle-stats.ts` and `calculations.ts`) that compute fuel and electric efficiency metrics
- **Backup_Pipeline**: The backend sync subsystem (`backup.ts`, `restore.ts`, `google-sheets.ts`) that exports and imports user data
- **Category_Labels**: The backend type definitions that map expense category enum values to user-facing display strings
- **Electric_Fuel_Type_Helper**: The pure function `isElectricFuelType()` that returns true for the four electric fuel types and false for everything else
- **fuelAmount**: The existing nullable column on the expenses table storing liquid fuel quantity (gallons/liters) OR electric charge quantity (kWh), discriminated by `fuelType`
- **fuelType**: The existing column on the expenses table that determines how `fuelAmount` is interpreted — electric types mean kWh, all others mean gallons/liters
- **vehicleType**: A vehicle attribute with values `gas`, `electric`, or `hybrid` — informational/display only, does not drive validation or behavior
- **trackFuel**: A NOT NULL boolean column on the vehicles table controlling whether fuel fields appear in the expense form (default true)
- **trackCharging**: A NOT NULL boolean column on the vehicles table controlling whether charge fields appear in the expense form (default false)
- **ELECTRIC_FUEL_TYPES**: The constant array `['Electric', 'Level 1 (Home)', 'Level 2 (AC)', 'DC Fast Charging']` defining all recognized electric fuel type values

## Requirements

### Requirement 1: Vehicle Energy Tracking Flags

**User Story:** As a user with an electric or hybrid vehicle, I want to independently control whether my vehicle tracks fuel costs, charging costs, or both — regardless of the vehicle type label — so that the expense form shows the right fields for my situation.

#### Acceptance Criteria

1. WHEN the database migration runs, THE Vehicles_Table SHALL contain a `trackFuel` column (NOT NULL boolean, default true) and a `trackCharging` column (NOT NULL boolean, default false)
2. WHEN the migration runs on a database with existing vehicles, THE migration SHALL set tracking flags based on existing `vehicleType`: gas vehicles get trackFuel=true/trackCharging=false, electric vehicles get trackFuel=false/trackCharging=true, hybrid vehicles get both true
3. THE `trackFuel` and `trackCharging` flags SHALL be independently settable regardless of `vehicleType` — a gas vehicle MAY have trackCharging=true and an electric vehicle MAY have trackFuel=true
4. THE Expense_Table schema SHALL remain unchanged — no new columns are added for EV support
5. THE existing `fuelAmount` column SHALL store both gallons/liters (for fuel-type expenses) and kWh (for electric-type expenses), discriminated by the `fuelType` value

### Requirement 2: fuelType-Based Deterministic API Field Mapping

**User Story:** As a developer, I want the API transformer to map frontend fields to backend fields using `fuelType` as the sole discriminator, so that the mapping is deterministic and correct for all vehicle types including hybrids.

#### Acceptance Criteria

1. WHEN transforming a frontend expense with a non-electric `fuelType` to backend format, THE API_Transformer SHALL map the `volume` field to `fuelAmount`
2. WHEN transforming a frontend expense with an electric `fuelType` to backend format, THE API_Transformer SHALL map the `charge` field to `fuelAmount`
3. WHEN transforming a backend expense to frontend format, THE API_Transformer SHALL use `isElectricFuelType(fuelType)` to determine mapping direction: electric fuelType maps `fuelAmount` to `charge`, non-electric fuelType maps `fuelAmount` to `volume`
4. THE API_Transformer SHALL NOT use `vehicleType` as a parameter or discriminator in any mapping function
5. WHEN a backend expense has an electric `fuelType` and a non-null `fuelAmount`, THE API_Transformer SHALL set `charge` to the `fuelAmount` value and leave `volume` undefined
6. WHEN a backend expense has a non-electric `fuelType` and a non-null `fuelAmount`, THE API_Transformer SHALL set `volume` to the `fuelAmount` value and leave `charge` undefined
7. FOR ALL valid expenses, transforming to backend format and back via `fromBackendExpense(toBackendExpense(expense))` SHALL preserve the energy value — if the input had volume=X the output has volume=X, if the input had charge=Y the output has charge=Y

### Requirement 3: VehicleForm Type and Tracking Submission

**User Story:** As a user, I want the vehicle creation and edit form to submit the vehicle type and my energy tracking preferences, so that my vehicle is correctly configured and I can independently control which energy costs to track.

#### Acceptance Criteria

1. WHEN a user submits the VehicleForm to create a vehicle, THE VehicleForm SHALL include the `vehicleType`, `trackFuel`, and `trackCharging` fields in the request payload
2. WHEN a user submits the VehicleForm to update a vehicle, THE VehicleForm SHALL include the `vehicleType`, `trackFuel`, and `trackCharging` fields in the request payload
3. WHEN a vehicle is created or updated with `vehicleType`, `trackFuel`, and `trackCharging` values, THE system SHALL persist those values so that subsequent reads return the same values
4. THE VehicleForm SHALL display toggle switches for "Track fuel costs" and "Track charging costs" that the user can independently enable or disable
5. WHEN the user changes `vehicleType` in the form, THE VehicleForm SHALL auto-set `trackFuel` and `trackCharging` defaults (gas → fuel only, electric → charging only, hybrid → both) but SHALL allow the user to override these values
6. THE `trackFuel` and `trackCharging` toggles SHALL be independently settable regardless of the selected `vehicleType`

### Requirement 4: Electric Efficiency Calculations

**User Story:** As a user with an electric or hybrid vehicle, I want to see electric efficiency metrics (mi/kWh) alongside or instead of fuel efficiency (MPG), so that I can track my vehicle's energy performance.

#### Acceptance Criteria

1. WHEN calculating stats for a vehicle, THE Stats_Calculator SHALL split fuel-category expenses into fuel-group and charge-group using `isElectricFuelType(expense.fuelType)`
2. WHEN calculating stats for a vehicle with `trackCharging=true`, THE Stats_Calculator SHALL compute `averageMilesPerKwh` from charge-group expenses
3. WHEN calculating stats for a vehicle with `trackCharging=false`, THE Stats_Calculator SHALL return `averageMilesPerKwh` as null
4. WHEN calculating stats for a vehicle with `trackFuel=true`, THE Stats_Calculator SHALL compute `averageMpg` from fuel-group expenses
5. WHEN calculating stats for a vehicle with `trackFuel=false`, THE Stats_Calculator SHALL return `averageMpg` as null
6. THE Stats_Calculator SHALL compute `totalChargeConsumed` as the sum of `fuelAmount` values for all fuel-category expenses where `isElectricFuelType(fuelType)` is true
7. THE Stats_Calculator SHALL compute `totalFuelConsumed` as the sum of `fuelAmount` values for all fuel-category expenses where `isElectricFuelType(fuelType)` is false
8. WHEN calculating `milesPerKwh` with a kWh value of zero or less, THE Stats_Calculator SHALL return zero instead of NaN or Infinity
9. WHEN fewer than two charge expenses with mileage data exist, THE Stats_Calculator SHALL return null for `averageMilesPerKwh`
10. THE Stats_Calculator SHALL exclude charge expenses marked as `missedFillup` from average efficiency calculations
11. THE Stats_Calculator SHALL filter out unrealistic `milesPerKwh` values exceeding 10 mi/kWh

### Requirement 5: fuelType-Based Fuel Expense Validation

**User Story:** As a user, I want the system to validate my fuel and charging expenses based on the expense's own `fuelType`, so that I receive clear error messages when required data is missing.

#### Acceptance Criteria

1. WHEN a fuel-category expense is submitted with an electric `fuelType`, THE Validator SHALL require both `fuelAmount` (kWh) and `mileage` to be present
2. WHEN a fuel-category expense is submitted with a non-electric `fuelType`, THE Validator SHALL require both `fuelAmount` (gallons/liters) and `mileage` to be present
3. WHEN a non-fuel-category expense is submitted, THE Validator SHALL accept the expense regardless of `fuelAmount`, `fuelType`, or `mileage` values
4. THE Validator SHALL NOT use `vehicleType` or `trackFuel`/`trackCharging` flags for validation — the expense's own `fuelType` is the sole discriminator
5. IF a fuel-category expense with an electric `fuelType` is missing `fuelAmount` or `mileage`, THEN THE Validator SHALL throw a validation error with message indicating charge amount (kWh) and mileage are required
6. IF a fuel-category expense with a non-electric `fuelType` is missing `fuelAmount` or `mileage`, THEN THE Validator SHALL throw a validation error with message indicating fuel amount and mileage are required

### Requirement 6: Backup and Sync Pipeline Support for Tracking Flags

**User Story:** As a user, I want my energy tracking preferences to survive backup, restore, and Google Sheets sync operations, so that I don't lose my tracking configuration when managing my backups.

#### Acceptance Criteria

1. WHEN creating a backup, THE Backup_Pipeline SHALL include the `trackFuel` and `trackCharging` columns in the exported vehicle CSV data
2. WHEN restoring from a backup that contains `trackFuel` and `trackCharging` data, THE Backup_Pipeline SHALL insert those values into the vehicles table
3. WHEN restoring from an older backup that does not contain `trackFuel` or `trackCharging` columns, THE Backup_Pipeline SHALL default `trackFuel` to true and `trackCharging` to false without error
4. WHEN syncing to Google Sheets, THE Backup_Pipeline SHALL include `trackFuel` and `trackCharging` as column headers in vehicles and export their values
5. WHEN reading vehicle data from Google Sheets, THE Backup_Pipeline SHALL parse the `trackFuel` and `trackCharging` columns and include them in the restored data

### Requirement 7: EV-Aware Category Labels

**User Story:** As a user with an electric vehicle, I want the "fuel" expense category to reflect that it also covers charging, so that the UI language matches my experience.

#### Acceptance Criteria

1. THE Category_Labels SHALL display the fuel category label as "Fuel & Charging" instead of "Fuel"
2. THE Category_Labels SHALL display the fuel category description as "Fuel, gas, and electric charging costs"

### Requirement 8: Electric Fuel Type Helper and Charging Type Constants

**User Story:** As a developer, I want a centralized helper function and constant array defining the electric fuel types, so that all components use a single source of truth for determining whether a `fuelType` indicates electric charging.

#### Acceptance Criteria

1. THE Electric_Fuel_Type_Helper SHALL define a constant array ELECTRIC_FUEL_TYPES containing exactly: 'Electric', 'Level 1 (Home)', 'Level 2 (AC)', 'DC Fast Charging'
2. THE Electric_Fuel_Type_Helper SHALL provide an `isElectricFuelType(fuelType)` function that returns true if and only if `fuelType` matches one of the four values in ELECTRIC_FUEL_TYPES
3. WHEN `isElectricFuelType` is called with null, THE Electric_Fuel_Type_Helper SHALL return false
4. WHEN `isElectricFuelType` is called with any string not in ELECTRIC_FUEL_TYPES, THE Electric_Fuel_Type_Helper SHALL return false
5. THE `isElectricFuelType` function SHALL be a pure function with no side effects — same input always produces same output
6. THE Electric_Fuel_Type_Helper SHALL be usable by both frontend and backend code

### Requirement 9: Expense Form Charging Type Options

**User Story:** As a user logging a charging session, I want to select the type of charging (Level 1, Level 2, DC Fast Charging) as the fuel type, so that my charging expenses are categorized with the correct charging level.

#### Acceptance Criteria

1. WHEN a vehicle has `trackCharging=true` and the user is creating a fuel-category expense, THE expense form SHALL display the electric charging type options: 'Level 1 (Home)', 'Level 2 (AC)', 'DC Fast Charging', and 'Electric'
2. WHEN a vehicle has `trackFuel=true` and the user is creating a fuel-category expense, THE expense form SHALL display the existing fuel type options (octane ratings, Diesel)
3. WHEN a vehicle has both `trackFuel=true` and `trackCharging=true`, THE expense form SHALL display both fuel type options and charging type options, allowing the user to select either
4. WHEN the user selects an electric charging type as `fuelType`, THE expense form SHALL show a charge input field (kWh) instead of a volume input field (gallons/liters)
5. WHEN the user selects a non-electric fuel type as `fuelType`, THE expense form SHALL show a volume input field (gallons/liters) instead of a charge input field (kWh)
