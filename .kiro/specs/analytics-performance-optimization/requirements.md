# Requirements Document

## Introduction

The analytics page (`/analytics`) currently makes 8 simultaneous API calls on page load due to eager tab mounting and redundant backend queries. This feature optimizes performance in two tiers: (1) lazy-mounting tab content so only the active tab triggers API calls, and (2) consolidating the initial page load into a single `/api/v1/analytics/summary` endpoint that shares common DB queries across computations.

## Glossary

- **Analytics_Page**: The SvelteKit page at `/analytics` that displays vehicle analytics across multiple tabs
- **Tab_Component**: A Svelte component rendered inside a tab panel (FuelStatsTab, CrossVehicleTab, PerVehicleTab, YearEndTab)
- **Active_Tab**: The currently selected tab whose content is visible and mounted in the DOM
- **Summary_Endpoint**: The new `GET /api/v1/analytics/summary` backend route that returns combined quickStats, fuelStats, and fuelAdvanced data
- **Analytics_Repository**: The backend data access layer (`analyticsRepository`) responsible for querying the SQLite database
- **Analytics_API_Service**: The frontend service (`analyticsApi`) that provides typed methods for calling analytics backend endpoints
- **Date_Range**: A pair of unix timestamps (seconds) representing a start and end date for filtering analytics data
- **Shared_Query**: A database query (vehicleNameMap, allExpenses, fuelExpenses) that is reused across multiple analytics computations

## Requirements

### Requirement 1: Lazy-Mount Tab Content

**User Story:** As a user, I want the analytics page to only load data for the tab I'm viewing, so that the page loads faster and uses fewer resources.

#### Acceptance Criteria

1. WHEN the Analytics_Page loads, THE Analytics_Page SHALL mount only the Active_Tab's Tab_Component in the DOM
2. WHEN a user switches to a different tab, THE Analytics_Page SHALL unmount the previous Tab_Component and mount the newly selected Tab_Component
3. WHEN a Tab_Component is not the Active_Tab, THE Analytics_Page SHALL prevent that Tab_Component from making API calls or creating DOM nodes
4. WHEN the Analytics_Page loads with no prior tab selection, THE Analytics_Page SHALL default the Active_Tab to "fuel-stats"

### Requirement 2: Consolidated Summary Endpoint

**User Story:** As a user, I want the analytics page initial load to use a single API call, so that the page renders faster with less network overhead.

#### Acceptance Criteria

1. WHEN the Analytics_Page loads, THE Analytics_API_Service SHALL call the Summary_Endpoint with the current Date_Range
2. WHEN the Summary_Endpoint receives a valid request, THE Analytics_Repository SHALL execute Shared_Queries (vehicleNameMap, allExpenses, fuelExpenses) exactly once via parallel execution
3. WHEN the Summary_Endpoint completes, THE Summary_Endpoint SHALL return a combined response containing quickStats, fuelStats, and fuelAdvanced data
4. WHEN the Summary_Endpoint returns data, THE Analytics_Page SHALL pass the pre-loaded fuelStats and fuelAdvanced data to the FuelStatsTab as props

### Requirement 3: Data Equivalence

**User Story:** As a developer, I want the consolidated endpoint to return identical data to the individual endpoints, so that the optimization introduces no data regressions.

#### Acceptance Criteria

1. FOR ALL valid user and Date_Range combinations, THE Summary_Endpoint quickStats output SHALL be identical to the independent quick-stats endpoint output
2. FOR ALL valid user and Date_Range combinations, THE Summary_Endpoint fuelStats output SHALL be identical to the independent fuel-stats endpoint output
3. FOR ALL valid user and Date_Range combinations, THE Summary_Endpoint fuelAdvanced output SHALL be identical to the independent fuel-advanced endpoint output

### Requirement 4: Graceful Degradation

**User Story:** As a user, I want the analytics page to still work if the new summary endpoint is unavailable, so that rolling deployments do not break the page.

#### Acceptance Criteria

1. IF the Summary_Endpoint returns a 404 or network error, THEN THE Analytics_API_Service SHALL fall back to calling the individual quick-stats, fuel-stats, and fuel-advanced endpoints in parallel
2. IF the fallback calls succeed, THEN THE Analytics_Page SHALL render with the same data and behavior as the Summary_Endpoint path
3. IF the Summary_Endpoint returns a server error (HTTP 500), THEN THE Analytics_Page SHALL display an error state with a retry option

### Requirement 5: FuelStatsTab Dual-Mode Data Loading

**User Story:** As a developer, I want FuelStatsTab to accept pre-loaded data as props or load its own data, so that it works both with the summary endpoint and independently.

#### Acceptance Criteria

1. WHEN FuelStatsTab receives fuelStats and fuelAdvanced props, THE FuelStatsTab SHALL use the prop data and skip its own API calls
2. WHEN FuelStatsTab receives no props (or null props), THE FuelStatsTab SHALL load data from the individual fuel-stats and fuel-advanced endpoints
3. WHEN FuelStatsTab uses prop data, THE FuelStatsTab SHALL display the same UI as when loading data independently

### Requirement 6: Authentication and Validation

**User Story:** As a system administrator, I want the summary endpoint to enforce the same security as existing endpoints, so that no new attack surface is introduced.

#### Acceptance Criteria

1. WHEN an unauthenticated request is made to the Summary_Endpoint, THE Summary_Endpoint SHALL reject the request with HTTP 401
2. WHEN a request with an invalid Date_Range is made to the Summary_Endpoint, THE Summary_Endpoint SHALL reject the request with a validation error
3. THE Summary_Endpoint SHALL enforce the same authentication middleware (requireAuth) as the existing analytics endpoints

### Requirement 7: Error Handling in Summary Computation

**User Story:** As a developer, I want database failures in the summary computation to be handled gracefully, so that errors are logged and surfaced properly.

#### Acceptance Criteria

1. IF any Shared_Query fails during summary computation, THEN THE Analytics_Repository SHALL log the error with userId and Date_Range context
2. IF a database error occurs during summary computation, THEN THE Summary_Endpoint SHALL return HTTP 500 with a structured error response
3. WHEN the Summary_Endpoint returns an error, THE Analytics_Page SHALL display the error and offer a retry action

### Requirement 8: Existing Endpoint Backward Compatibility

**User Story:** As a developer, I want existing individual analytics endpoints to remain unchanged, so that other consumers are not affected by this optimization.

#### Acceptance Criteria

1. THE existing quick-stats, fuel-stats, fuel-advanced, cross-vehicle, financing, insurance, vehicle-health, vehicle-tco, vehicle-expenses, year-end, and fuel-efficiency endpoints SHALL continue to function with their current request and response contracts
2. WHEN a tab other than fuel-stats is activated, THE Tab_Component SHALL load data from the existing individual endpoints
