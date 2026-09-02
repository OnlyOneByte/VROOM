# Requirements Document

## Introduction

The VROOM car tracker app currently hardcodes imperial unit labels (mi, gal, MPG, etc.) throughout the frontend, despite users being able to set unit preferences in settings. This feature introduces unit-aware display by storing unit preferences per vehicle, inheriting those units for expenses, using global settings as the display preference for cross-vehicle analytics, and converting values on read when aggregating across vehicles with different unit systems.

## Glossary

- **App**: The VROOM car tracker application (frontend and backend combined)
- **UnitPreferences**: A shared JSON schema `{ distanceUnit, volumeUnit, chargeUnit, ... }` used consistently across user settings, vehicles, and expenses — extensible for future unit types
- **Settings_Store**: The Svelte 5 runes store (`settingsStore`) that holds the authenticated user's global preferences including a `unitPreferences` JSON object
- **Vehicle_Record**: A row in the `vehicles` database table representing a single tracked vehicle
- **Expense_Record**: A row in the `expenses` database table representing a cost event linked to a specific Vehicle_Record
- **Unit_Converter**: A backend utility module responsible for converting numeric values between supported distance, volume, and charge units
- **Label_Resolver**: A frontend utility module that returns the correct display label (e.g., "km", "L", "km/L") for a given unit enum value
- **Analytics_API**: The backend analytics endpoints that compute aggregated statistics across one or more vehicles
- **Global_Unit_Preference**: The user-level `unitPreferences` JSON stored in `user_settings`, used as the target unit system when displaying cross-vehicle analytics and as defaults for new vehicles/expenses
- **Vehicle_Unit_Preference**: The per-vehicle `unitPreferences` JSON column on the `vehicles` table, using the shared UnitPreferences schema, determining the unit system for that vehicle's data entry and single-vehicle display
- **Conversion_Factor**: A numeric multiplier used to convert a value from one unit to another (e.g., 1 mile = 1.609344 kilometers)

## Requirements

### Requirement 1: Per-Vehicle Unit Storage

**User Story:** As a user, I want each vehicle to have its own distance and volume/charge unit preferences, so that I can track vehicles in different unit systems.

#### Acceptance Criteria

1. THE Vehicle_Record SHALL store a single `unitPreferences` JSON column containing at minimum `distanceUnit`, `volumeUnit`, and `chargeUnit` keys
2. THE `unitPreferences` JSON object SHALL validate that `distanceUnit` is one of `miles` or `kilometers`, `volumeUnit` is one of `gallons_us`, `gallons_uk`, or `liters`, and `chargeUnit` is one of `kwh`
3. THE `unitPreferences` JSON schema SHALL be extensible — additional unit keys (e.g., `pressureUnit`, `temperatureUnit`) MAY be added in the future without requiring a database migration
4. WHEN a new Vehicle_Record is created without explicit unit values, THE App SHALL default `unitPreferences` from the user's Global_Unit_Preference
5. WHEN a Vehicle_Record is created with explicit unit values, THE App SHALL use the provided values instead of the Global_Unit_Preference defaults
6. WHEN a user edits a Vehicle_Record, THE App SHALL allow updating the `unitPreferences` fields
7. THE database migration SHALL add the `unitPreferences` column to the `vehicles` table as a TEXT (JSON) NOT NULL column with a default value of `{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}`

### Requirement 2: Expense Unit Inheritance

**User Story:** As a user, I want expenses to automatically use their parent vehicle's units, so that I do not need to pick units for every expense entry.

#### Acceptance Criteria

1. WHEN an Expense_Record is displayed, THE App SHALL resolve the unit labels from the associated Vehicle_Record's Vehicle_Unit_Preference
2. THE App SHALL NOT present a per-expense unit picker in the expense creation or editing forms
3. WHEN the ExpenseForm displays hint text referencing distance (e.g., "miles"), THE Label_Resolver SHALL substitute the correct label based on the selected vehicle's `distanceUnit`
4. WHEN the ExpenseForm displays hint text referencing volume (e.g., "gallons"), THE Label_Resolver SHALL substitute the correct label based on the selected vehicle's `volumeUnit`

### Requirement 3: Unit Conversion Functions

**User Story:** As a developer, I want a set of pure conversion functions, so that values can be accurately converted between supported unit systems.

#### Acceptance Criteria

1. THE Unit_Converter SHALL convert distance values between `miles` and `kilometers` using the factor 1 mile = 1.609344 kilometers
2. THE Unit_Converter SHALL convert volume values between `gallons_us`, `gallons_uk`, and `liters` using the factors: 1 gallon (US) = 3.785411784 liters, 1 gallon (UK) = 4.54609 liters
3. THE Unit_Converter SHALL convert fuel efficiency values (distance/volume) by applying the appropriate distance and volume conversions
4. THE Unit_Converter SHALL return the input value unchanged when the source and target units are identical
5. FOR ALL supported unit pairs, converting a value from unit A to unit B and then back to unit A SHALL produce a result within 0.0001 of the original value (round-trip property)

### Requirement 4: Frontend Label Resolution

**User Story:** As a user, I want all unit labels in the UI to reflect the correct unit system, so that I see "km" instead of "mi" when my vehicle uses kilometers.

#### Acceptance Criteria

1. WHEN displaying single-vehicle data (fuel stats, odometer, expenses), THE Label_Resolver SHALL use the Vehicle_Unit_Preference of the viewed vehicle to produce labels
2. WHEN displaying cross-vehicle analytics, THE Label_Resolver SHALL use the Global_Unit_Preference to produce labels
3. THE Label_Resolver SHALL produce correct short labels: `mi`/`km` for distance, `gal`/`gal`/`L` for volume, `kWh` for charge
4. THE Label_Resolver SHALL produce correct efficiency labels: `mi/gal` (MPG), `km/L`, `mi/kWh`, `km/kWh`, and all other valid distance/volume and distance/charge combinations
5. THE Label_Resolver SHALL produce correct "cost per distance" labels: e.g., `Cost/mi`, `Cost/km`
6. THE Label_Resolver SHALL produce correct long-form labels for card titles: e.g., `Gallons (US)`, `Liters`, `Miles`, `Kilometers`

### Requirement 5: Hardcoded Label Replacement

**User Story:** As a user, I want all currently hardcoded imperial labels replaced with dynamic labels, so that the UI respects my unit preferences everywhere.

#### Acceptance Criteria

1. WHEN FuelStatsTab displays volume totals, THE App SHALL use the Label_Resolver instead of the hardcoded string `' gal'`
2. WHEN FuelStatsTab displays distance totals, THE App SHALL use the Label_Resolver instead of the hardcoded string `' mi'`
3. WHEN FuelStatsTab displays efficiency metrics, THE App SHALL use the Label_Resolver instead of the hardcoded strings `'Average MPG'`, `'Best MPG'`, and `'Worst MPG'`
4. WHEN FuelStatsTab displays cost-per-distance, THE App SHALL use the Label_Resolver instead of the hardcoded string `'Cost/Mile'`
5. WHEN FuelEfficiencyTrendChart displays axis labels, THE App SHALL use the Label_Resolver instead of the hardcoded strings `'MPG'` and `'mi/kWh'`
6. WHEN FuelCharts displays series labels and titles, THE App SHALL use the Label_Resolver instead of the hardcoded strings `'MPG'`, `'Gallons'`, `'Price per gallon'`, and `'Cost per Mile'`
7. WHEN AdvancedCharts displays seasonal efficiency, THE App SHALL use the Label_Resolver instead of the hardcoded string `'Avg MPG'`
8. WHEN CrossVehicleTab displays cost and efficiency, THE App SHALL use the Label_Resolver instead of the hardcoded strings `'/mi'` and `'MPG'`
9. WHEN YearEndTab displays summary stats, THE App SHALL use the Label_Resolver instead of the hardcoded strings `'Avg MPG'` and `'total miles'`
10. WHEN PerVehicleTab displays distance, THE App SHALL use the Label_Resolver instead of the hardcoded string `'Total Miles'`
11. WHEN OdometerTab displays readings, THE App SHALL use the Label_Resolver instead of the hardcoded string `' mi'`
12. WHEN LeaseMetricsCard displays mileage, THE App SHALL use the Label_Resolver instead of the hardcoded string `' mi'`
13. WHEN PaymentMetricsGrid displays cost-per-distance, THE App SHALL use the Label_Resolver instead of the hardcoded strings `' mi over'` and `'/mi'`
14. WHEN ExpenseForm displays distance hints, THE App SHALL use the Label_Resolver instead of the hardcoded string `' miles'`
15. WHEN the analytics page displays quick stats, THE App SHALL use the Label_Resolver instead of the hardcoded string `'Avg MPG'`

### Requirement 6: Backend Analytics Conversion

**User Story:** As a user, I want cross-vehicle analytics to show values in my preferred units, so that comparing vehicles with different unit systems produces meaningful results.

#### Acceptance Criteria

1. WHEN the Analytics_API aggregates data across multiple vehicles, THE Analytics_API SHALL convert each vehicle's values to the user's Global_Unit_Preference before aggregation
2. WHEN the Analytics_API computes fuel efficiency for a single vehicle, THE Analytics_API SHALL return the value in that vehicle's Vehicle_Unit_Preference without conversion
3. WHEN the Analytics_API computes cost-per-distance, THE Analytics_API SHALL use the appropriate distance unit (vehicle-level for single-vehicle, global for cross-vehicle)
4. WHEN all vehicles share the same unit system as the Global_Unit_Preference, THE Analytics_API SHALL skip conversion and return raw values
5. IF a Vehicle_Record has a unit value that does not match any supported enum value, THEN THE Analytics_API SHALL reject the request with a validation error

### Requirement 7: API Response Field Naming

**User Story:** As a developer, I want API response fields to use unit-neutral names, so that the frontend does not assume a specific unit system from field names.

#### Acceptance Criteria

1. THE Analytics_API response fields SHALL use unit-neutral names: `totalDistance` instead of `totalMiles`, `avgEfficiency` instead of `avgMpg`, `volume` instead of `gallons`, `costPerDistance` instead of `costPerMile`, `pricePerVolume` instead of `pricePerGallon`
2. THE Analytics_API response SHALL include a `units` object specifying the `distanceUnit`, `volumeUnit`, and `chargeUnit` used for the returned values
3. WHEN the frontend receives an analytics response, THE App SHALL read the `units` object to determine which labels to display

### Requirement 8: Vehicle Creation Form Unit Defaults

**User Story:** As a user, I want the vehicle creation form to pre-fill unit preferences from my global settings, so that I rarely need to change them.

#### Acceptance Criteria

1. WHEN the vehicle creation form loads, THE App SHALL pre-fill `distanceUnit`, `volumeUnit`, and `chargeUnit` from the user's Global_Unit_Preference
2. WHEN the user changes a unit preference in the vehicle creation form, THE App SHALL use the user-selected value for the new Vehicle_Record
3. THE vehicle creation form SHALL display the unit preference fields in a collapsible or secondary section to keep the common case simple
4. THE vehicle edit form SHALL display the current Vehicle_Unit_Preference and allow changes

### Requirement 9: Existing Data Migration

**User Story:** As an existing user, I want my current vehicles and settings to retain the correct unit preferences after the migration, so that my data continues to display correctly.

#### Acceptance Criteria

1. WHEN the database migration runs, THE migration SHALL set each existing Vehicle_Record's `unitPreferences` JSON to contain `distanceUnit`, `volumeUnit`, and `chargeUnit` values from the owning user's `user_settings`
2. IF a Vehicle_Record's owning user has no `user_settings` row, THEN THE migration SHALL use the schema defaults (`{"distanceUnit":"miles","volumeUnit":"gallons_us","chargeUnit":"kwh"}`)
3. THE migration SHALL consolidate the existing separate `distanceUnit`, `volumeUnit`, and `chargeUnit` columns in `user_settings` into a single `unitPreferences` JSON column
4. THE migration SHALL preserve existing user unit preference values when consolidating into the JSON column
5. THE migration SHALL preserve all existing numeric values in the `expenses` and `odometer_entries` tables without modification

### Requirement 10: Unified User Settings Unit Storage

**User Story:** As a developer, I want user settings to store unit preferences in the same JSON schema as vehicles and expenses, so that the data model is consistent and extensible across all entities.

#### Acceptance Criteria

1. THE `user_settings` table SHALL store a `unitPreferences` JSON column using the same UnitPreferences schema as vehicles and expenses
2. THE database migration SHALL consolidate the existing separate `distanceUnit`, `volumeUnit`, and `chargeUnit` columns into the single `unitPreferences` JSON column
3. THE migration SHALL preserve existing user unit preference values when consolidating into the JSON column
4. THE Settings_Store SHALL expose the `unitPreferences` object for use by the frontend Label_Resolver and as defaults for new vehicles
5. THE settings API SHALL accept and return `unitPreferences` as a JSON object in the same shape as vehicles and expenses

### Requirement 11: Settings Page Unit Context

**User Story:** As a user, I want the global settings page to clarify that unit preferences apply as defaults for new vehicles and as the display preference for cross-vehicle analytics.

#### Acceptance Criteria

1. THE settings page SHALL display explanatory text indicating that the global unit preferences serve as defaults for new vehicles
2. THE settings page SHALL display explanatory text indicating that the global unit preferences determine the display units for cross-vehicle analytics
3. WHEN the user changes the Global_Unit_Preference, THE App SHALL NOT retroactively change any existing Vehicle_Record's Vehicle_Unit_Preference
