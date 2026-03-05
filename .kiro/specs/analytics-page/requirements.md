# Requirements Document

## Introduction

The analytics page provides vehicle owners with a comprehensive dashboard for insights into fleet spending, fuel efficiency, financing, insurance, and vehicle health. It replaces the current placeholder page with a data-driven experience powered by backend API endpoints that aggregate data from existing database tables. The page is organized into four tabs (Fuel & Stats, Cross-Vehicle, Per-Vehicle, Year-End Summary) plus always-visible quick stats.

## Glossary

- **Analytics_Page**: The SvelteKit page at `/analytics` that renders the analytics dashboard
- **Quick_Stats**: The always-visible summary cards at the top of the analytics page showing vehicle count, YTD spending, average MPG, and fleet health score
- **Backend**: The Hono server exposing analytics API endpoints under `/api/v1/analytics/`
- **Repository**: The data access layer (`analytics/repository.ts`) that performs SQL aggregation queries
- **Analytics_API_Service**: The frontend service (`analytics-api.ts`) that calls backend analytics endpoints
- **Fuel_Stats_Tab**: The tab displaying fuel consumption metrics, gas price history, and advanced fuel charts
- **Cross_Vehicle_Tab**: The tab displaying fleet-wide expense trends, category breakdowns, financing, and insurance overviews
- **Per_Vehicle_Tab**: The tab displaying per-vehicle health score, TCO dashboard, and expense charts
- **Year_End_Tab**: The tab displaying annual summary with category breakdown, biggest expense, and year-over-year comparison
- **Health_Score**: A 0-100 composite score computed as `maintenanceRegularity × 0.4 + mileageIntervalAdherence × 0.35 + insuranceCoverage × 0.25`
- **TCO**: Total Cost of Ownership, the sum of purchase price, financing interest, insurance, fuel, maintenance, and other costs for a vehicle
- **MPG**: Miles per gallon, computed from consecutive fuel expense mileage readings divided by fuel amount

## Requirements

### Requirement 1: Quick Stats Display

**User Story:** As a vehicle owner, I want to see a summary of my fleet's key metrics at the top of the analytics page, so that I can get an instant overview without navigating into tabs.

#### Acceptance Criteria

1. WHEN the analytics page loads, THE Analytics_Page SHALL fetch and display Quick_Stats cards showing vehicle count, YTD spending, average MPG, and fleet health score
2. WHEN the user has no vehicles, THE Quick_Stats SHALL display zero for vehicle count, zero for YTD spending, null for average MPG, and zero for fleet health score
3. WHEN the Quick_Stats data fails to load, THE Analytics_Page SHALL display an error message with a retry option

### Requirement 2: Quick Stats Backend Endpoint

**User Story:** As a frontend developer, I want a backend endpoint that returns aggregated quick stats, so that the analytics page can display summary metrics without client-side computation.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/quick-stats`, THE Backend SHALL return vehicle count, YTD spending, average MPG, and fleet health score for the authenticated user
2. WHEN an optional `year` query parameter is provided, THE Backend SHALL scope spending and MPG calculations to that year
3. WHEN no `year` parameter is provided, THE Backend SHALL default to the current year
4. THE Repository SHALL compute `ytdSpending` as the sum of all expense amounts for the user's vehicles in the given year
5. THE Repository SHALL compute `vehicleCount` as the count of vehicles owned by the authenticated user
6. THE Repository SHALL compute `fleetHealthScore` as the weighted average of all vehicle Health_Scores, bounded between 0 and 100


### Requirement 3: Fuel Stats Tab

**User Story:** As a vehicle owner, I want to see detailed fuel consumption metrics and charts, so that I can understand my fuel spending patterns and efficiency trends.

#### Acceptance Criteria

1. WHEN the user activates the Fuel_Stats_Tab, THE Analytics_Page SHALL fetch fuel stats data from the Backend and display stat cards and charts
2. WHEN fuel stats data is returned, THE Fuel_Stats_Tab SHALL display comparison cards for fillup counts and gallons with current vs previous year and current vs previous month values
3. WHEN fuel stats data is returned, THE Fuel_Stats_Tab SHALL display fuel consumption metrics including average, best, and worst MPG
4. WHEN fuel stats data is returned, THE Fuel_Stats_Tab SHALL display fillup detail metrics including average, minimum, and maximum volume
5. WHEN fuel stats data is returned, THE Fuel_Stats_Tab SHALL display average cost metrics including per-fillup cost, best and worst cost per mile, and average cost per day
6. WHEN fuel stats data is returned, THE Fuel_Stats_Tab SHALL display distance metrics including total miles, average per day, and average per month
7. WHEN fuel stats data is returned, THE Fuel_Stats_Tab SHALL render charts for monthly consumption, gas price history, fillup cost by vehicle, odometer progression, and cost per mile
8. WHEN the user has no fuel expenses, THE Fuel_Stats_Tab SHALL display an empty state with zero counts, null averages, and empty charts

### Requirement 4: Fuel Stats Backend Endpoint

**User Story:** As a frontend developer, I want a backend endpoint that returns aggregated fuel statistics, so that the Fuel & Stats tab can display comprehensive fuel metrics.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/fuel-stats`, THE Backend SHALL return fillup counts, gallon totals, fuel consumption metrics, fillup details, average costs, distance metrics, and chart data arrays for the authenticated user
2. WHEN an optional `vehicleId` parameter is provided, THE Backend SHALL filter all fuel stats to that single vehicle
3. IF the provided `vehicleId` does not belong to the authenticated user, THEN THE Backend SHALL return a 404 error
4. THE Repository SHALL ensure `fillupDetails.minVolume <= fillupDetails.avgVolume <= fillupDetails.maxVolume` when all values are non-null
5. THE Repository SHALL compute MPG from consecutive fuel expenses as `(currentMileage - previousMileage) / fuelAmount`
6. THE Repository SHALL return at most 12 entries in `monthlyConsumption`, one per month
7. THE Repository SHALL ensure all `gasPriceHistory` entries have a positive `pricePerGallon` value

### Requirement 5: Advanced Fuel Charts Backend Endpoint

**User Story:** As a vehicle owner, I want to see advanced fuel analytics like seasonal efficiency, day-of-week patterns, and maintenance timelines, so that I can identify deeper patterns in my vehicle usage.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/fuel-advanced`, THE Backend SHALL return maintenance timeline, seasonal efficiency, vehicle radar scores, day-of-week patterns, monthly cost heatmap, and fillup interval data
2. THE Repository SHALL compute maintenance timeline by grouping maintenance expenses by service type, calculating average intervals, and projecting next due dates
3. THE Repository SHALL assign maintenance timeline status as `overdue` when days remaining is negative, `warning` when days remaining is less than 30, and `good` otherwise
4. THE Repository SHALL compute vehicle radar scores normalized to 0-100 for fuel efficiency, maintenance cost, reliability, annual cost, and mileage
5. THE Repository SHALL compute fillup intervals by bucketing consecutive fuel expense date gaps into labeled ranges and returning only non-empty buckets
6. THE Repository SHALL compute the monthly cost heatmap with expense amounts broken down by the six category values: fuel, maintenance, financial, regulatory, enhancement, and misc

### Requirement 6: Cross-Vehicle Analytics

**User Story:** As a multi-vehicle owner, I want to compare expenses and efficiency across all my vehicles, so that I can identify which vehicles cost the most and optimize my fleet spending.

#### Acceptance Criteria

1. WHEN the user activates the Cross_Vehicle_Tab, THE Analytics_Page SHALL fetch cross-vehicle data and display expense trend charts, category breakdowns, and vehicle cost comparisons
2. WHEN a GET request is made to `/api/v1/analytics/cross-vehicle`, THE Backend SHALL return monthly expense trends, expense by category with percentages, vehicle cost comparison with cost per mile, and fuel efficiency comparison across vehicles
3. THE Repository SHALL compute category percentages that sum to approximately 100 within floating-point tolerance when total spending is greater than zero
4. THE Repository SHALL compute `costPerMile` as `totalCost / totalMiles` when total miles is greater than zero, and null otherwise

### Requirement 7: Financing Overview

**User Story:** As a vehicle owner with financed vehicles, I want to see a summary of my financing obligations, so that I can track monthly payments, remaining balances, and interest paid.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/financing`, THE Backend SHALL return a financing summary with total monthly payments, remaining balance, interest paid YTD, and counts of active loans and leases
2. WHEN financing data is returned, THE Cross_Vehicle_Tab SHALL display per-vehicle financing details including type, monthly payment, remaining balance, APR, interest paid, and months remaining
3. THE Backend SHALL return a monthly payment timeline, financing type distribution, and loan principal vs interest breakdown
4. WHEN a vehicle has no financing record, THE Backend SHALL classify the vehicle financing type as `own`

### Requirement 8: Insurance Overview

**User Story:** As a vehicle owner, I want to see a summary of my insurance policies and costs, so that I can track premiums and compare coverage across vehicles.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/insurance`, THE Backend SHALL return an insurance summary with total monthly premiums, total annual premiums, and active policy count
2. WHEN insurance data is returned, THE Cross_Vehicle_Tab SHALL display per-vehicle insurance details including carrier, monthly premium, annual premium, deductible, and coverage type
3. THE Backend SHALL return monthly premium trend data and cost-by-carrier breakdown

### Requirement 9: Per-Vehicle Health Score

**User Story:** As a vehicle owner, I want to see a health score for each vehicle, so that I can understand which vehicles need attention based on maintenance regularity, mileage adherence, and insurance coverage.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/vehicle-health` with a `vehicleId`, THE Backend SHALL return an overall health score and three sub-scores for the specified vehicle
2. THE Repository SHALL compute the overall Health_Score as `round(maintenanceRegularity × 0.4 + mileageIntervalAdherence × 0.35 + insuranceCoverage × 0.25)`
3. THE Repository SHALL bound each sub-score and the overall score between 0 and 100 inclusive
4. THE Repository SHALL set `insuranceCoverage` to 100 when the vehicle has an active insurance policy, and 0 otherwise
5. THE Repository SHALL compute `maintenanceRegularity` based on time gaps between maintenance expenses, penalizing gaps exceeding 90 days
6. THE Repository SHALL compute `mileageIntervalAdherence` based on mileage gaps between maintenance expenses, scoring intervals within 3000-7000 miles as good
7. IF the `vehicleId` does not belong to the authenticated user, THEN THE Backend SHALL return a 404 error

### Requirement 10: Vehicle TCO Dashboard

**User Story:** As a vehicle owner, I want to see the total cost of ownership for each vehicle, so that I can understand the true cost of owning and operating each vehicle.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/vehicle-tco` with a `vehicleId`, THE Backend SHALL return TCO data including purchase price, financing interest, insurance cost, fuel cost, maintenance cost, other costs, total cost, ownership months, total miles, cost per mile, cost per month, and a monthly trend breakdown
2. THE Repository SHALL compute `totalCost` as the sum of purchase price, financing interest, insurance cost, fuel cost, maintenance cost, and other costs
3. THE Repository SHALL compute `costPerMile` as `totalCost / totalMiles` when total miles is greater than zero, and null otherwise
4. THE Repository SHALL compute `costPerMonth` as `totalCost / ownershipMonths` when ownership months is greater than zero
5. IF the `vehicleId` does not belong to the authenticated user, THEN THE Backend SHALL return a 404 error

### Requirement 11: Per-Vehicle Expense Charts

**User Story:** As a vehicle owner, I want to see expense breakdowns and efficiency trends for a specific vehicle, so that I can track that vehicle's spending over time.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/vehicle-expenses` with a `vehicleId`, THE Backend SHALL return monthly maintenance costs, monthly fuel efficiency and cost data, and an expense category breakdown
2. WHEN an optional `year` parameter is provided, THE Backend SHALL scope expense data to that year
3. IF the `vehicleId` does not belong to the authenticated user, THEN THE Backend SHALL return a 404 error

### Requirement 12: Year-End Summary

**User Story:** As a vehicle owner, I want to see an annual summary of my fleet expenses, so that I can review the year's spending, compare to the previous year, and identify my biggest expense.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/v1/analytics/year-end` with a `year` parameter, THE Backend SHALL return total spent, category breakdown with percentages, MPG trend, biggest expense, previous year comparison, vehicle count, total miles, average MPG, and cost per mile
2. THE Repository SHALL compute `totalSpent` as the sum of all expense amounts for the user's vehicles in the given year
3. THE Repository SHALL compute category breakdown percentages that sum to approximately 100 within floating-point tolerance when total spending is greater than zero
4. THE Repository SHALL return `biggestExpense` as the expense with the highest amount in the given year, or null when no expenses exist
5. WHEN previous year data exists, THE Repository SHALL compute `percentageChange` as `((currentYearTotal - previousYearTotal) / previousYearTotal) × 100`
6. WHEN no previous year data exists, THE Repository SHALL return null for `previousYearComparison`
7. THE Repository SHALL return at most 12 entries in `mpgTrend`, one per month

### Requirement 13: Authentication and Data Isolation

**User Story:** As a vehicle owner, I want my analytics data to be private, so that no other user can see my vehicle or expense information.

#### Acceptance Criteria

1. THE Backend SHALL require authentication via `requireAuth` middleware on all analytics endpoints
2. THE Repository SHALL filter all queries by the authenticated user's ID to prevent cross-user data access
3. WHEN a per-vehicle endpoint receives a `vehicleId` that does not belong to the authenticated user, THE Backend SHALL return a 404 error without revealing the vehicle exists

### Requirement 14: Input Validation

**User Story:** As a backend developer, I want all query parameters validated before processing, so that invalid inputs are rejected early with clear error messages.

#### Acceptance Criteria

1. THE Backend SHALL validate all query parameters using Zod schemas via `zValidator` middleware
2. WHEN an invalid `year` parameter is provided, THE Backend SHALL return a 400 error before the route handler executes
3. WHEN an invalid `vehicleId` parameter is provided, THE Backend SHALL return a 400 error before the route handler executes

### Requirement 15: Tab Navigation and Lazy Loading

**User Story:** As a vehicle owner, I want the analytics page to load quickly by only fetching data for the active tab, so that I do not wait for all analytics data at once.

#### Acceptance Criteria

1. WHEN the analytics page loads, THE Analytics_Page SHALL fetch only Quick_Stats data initially
2. WHEN the user switches to a tab, THE Analytics_Page SHALL fetch data for that tab on activation
3. WHILE a tab's data is loading, THE Analytics_Page SHALL display a loading indicator within that tab
4. WHEN a tab's data fails to load, THE Analytics_Page SHALL display an error message with a retry option within that tab

### Requirement 16: Per-Vehicle Tab Vehicle Selection

**User Story:** As a multi-vehicle owner, I want to select a specific vehicle in the Per-Vehicle tab, so that I can view health, TCO, and expense data for that vehicle.

#### Acceptance Criteria

1. WHEN the Per_Vehicle_Tab is activated, THE Per_Vehicle_Tab SHALL display a vehicle selector dropdown populated with the user's vehicles
2. WHEN the user selects a vehicle, THE Per_Vehicle_Tab SHALL fetch and display health score, TCO data, and expense charts for the selected vehicle
3. WHEN the user has only one vehicle, THE Per_Vehicle_Tab SHALL auto-select that vehicle

### Requirement 17: Empty State Handling

**User Story:** As a new user with no data, I want to see helpful guidance instead of blank charts, so that I understand what the analytics page will show once I add vehicles and expenses.

#### Acceptance Criteria

1. WHEN the user has no vehicles, THE Analytics_Page SHALL display an empty state guiding the user to add vehicles
2. WHEN a tab has no data to display, THE Analytics_Page SHALL show an empty state message within that tab instead of empty charts
3. WHEN a per-vehicle endpoint returns no expense data, THE Per_Vehicle_Tab SHALL display an empty state for the affected charts

### Requirement 18: Chart Rendering

**User Story:** As a vehicle owner, I want to see my analytics data visualized in charts, so that I can quickly understand trends and patterns.

#### Acceptance Criteria

1. THE Analytics_Page SHALL render all charts using layerchart components
2. THE Analytics_Page SHALL use semantic color tokens from the design system for all chart colors
3. WHEN chart data contains multiple vehicles, THE Analytics_Page SHALL distinguish each vehicle with a unique color from the chart-1 through chart-5 token palette
