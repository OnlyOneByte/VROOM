# Implementation Plan: Analytics Page

## Overview

Build a comprehensive analytics dashboard at `/analytics` with four tabs (Fuel & Stats, Cross-Vehicle, Per-Vehicle, Year-End Summary) plus always-visible quick stats. The backend exposes 10 analytics-specific GET endpoints that perform server-side aggregation. The frontend uses SvelteKit + Svelte 5 runes, shadcn-svelte, and layerchart for all visualizations. The existing `analytics/routes.ts`, `analytics/repository.ts`, and `analytics-api.ts` are extended with new endpoints and methods.

## Tasks

- [x] 1. Define shared types and Zod validation schemas
  - [x] 1.1 Create TypeScript interfaces for all 10 analytics endpoint responses in `frontend/src/lib/types/`
    - Add `QuickStatsResponse`, `FuelStatsResponse`, `FuelAdvancedResponse`, `CrossVehicleResponse`, `FinancingResponse`, `InsuranceResponse`, `VehicleHealthResponse`, `VehicleTCOResponse`, `VehicleExpensesResponse`, `YearEndResponse`
    - _Requirements: 2.1, 4.1, 5.1, 6.2, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1_

  - [x] 1.2 Add Zod query parameter schemas to `backend/src/api/analytics/routes.ts`
    - `yearQuerySchema` with optional `year` (positive integer, defaults to current year)
    - `vehicleIdQuerySchema` with required `vehicleId` (string)
    - `yearVehicleQuerySchema` combining both
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 2. Implement Quick Stats backend endpoint
  - [x] 2.1 Add `getQuickStats(userId, year)` to `AnalyticsRepository`
    - Compute vehicle count, YTD spending sum, average MPG, fleet health score
    - Return zero/null defaults when no data exists
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 17.1_

  - [x] 2.2 Add `GET /analytics/quick-stats` route handler
    - Use `zValidator('query', yearQuerySchema)`, default year to current year
    - Verify ownership scoping via `requireAuth`
    - _Requirements: 2.1, 2.2, 2.3, 13.1, 14.1_

  - [x] 2.3 Write property test: Expense sum computation (Property 1)
    - **Property 1: Expense sum computation**
    - **Validates: Requirements 2.4, 12.2**

  - [x] 2.4 Write property test: Vehicle count computation (Property 2)
    - **Property 2: Vehicle count computation**
    - **Validates: Requirement 2.5**

  - [x] 2.5 Write property test: Fleet health score bounded weighted average (Property 3)
    - **Property 3: Fleet health score is bounded weighted average**
    - **Validates: Requirement 2.6**

- [x] 3. Implement Fuel Stats backend endpoint
  - [x] 3.1 Add `getFuelStats(userId, year, vehicleId?)` to `AnalyticsRepository`
    - Compute fillup counts (current/previous year and month), gallon totals, fuel consumption metrics (avg/best/worst MPG), fillup details (avg/min/max volume), average costs, distance metrics
    - Build chart data arrays: monthlyConsumption, gasPriceHistory, fillupCostByVehicle, odometerProgression, costPerMile
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7_

  - [x] 3.2 Add `GET /analytics/fuel-stats` route handler
    - Accept optional `year` and `vehicleId` query params
    - Verify vehicle ownership if `vehicleId` provided, return 404 if not owned
    - _Requirements: 4.1, 4.2, 4.3, 13.1, 13.3, 14.1_

  - [x] 3.3 Write property test: Fuel volume ordering invariant (Property 16)
    - **Property 16: Fuel volume ordering invariant**
    - **Validates: Requirement 4.4**

  - [x] 3.4 Write property test: MPG computation from consecutive expenses (Property 17)
    - **Property 17: MPG computation from consecutive expenses**
    - **Validates: Requirement 4.5**

  - [x] 3.5 Write property test: Monthly arrays bounded to 12 entries (Property 8)
    - **Property 8: Monthly arrays bounded to 12 entries**
    - **Validates: Requirements 4.6, 12.7**

  - [x] 3.6 Write property test: Gas price always positive (Property 18)
    - **Property 18: Gas price always positive**
    - **Validates: Requirement 4.7**

- [x] 4. Implement Advanced Fuel Charts backend endpoint
  - [x] 4.1 Add `getFuelAdvanced(userId, year, vehicleId?)` to `AnalyticsRepository`
    - Compute maintenance timeline (group by service type, estimate intervals, project next due dates)
    - Compute seasonal efficiency, vehicle radar scores (normalized 0-100), day-of-week patterns
    - Compute monthly cost heatmap (6 categories), fillup interval distribution (bucketed)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 4.2 Add `GET /analytics/fuel-advanced` route handler
    - Accept optional `year` and `vehicleId` query params
    - _Requirements: 5.1, 13.1, 14.1_

  - [x] 4.3 Write property test: Maintenance timeline status assignment (Property 20)
    - **Property 20: Maintenance timeline status assignment**
    - **Validates: Requirement 5.3**

  - [x] 4.4 Write property test: All computed scores bounded [0, 100] (Property 9)
    - **Property 9: All computed scores bounded [0, 100]**
    - **Validates: Requirements 9.3, 5.4**

  - [x] 4.5 Write property test: Fillup interval bucketing completeness (Property 21)
    - **Property 21: Fillup interval bucketing completeness**
    - **Validates: Requirement 5.5**

  - [x] 4.6 Write property test: Heatmap uses valid expense categories (Property 22)
    - **Property 22: Heatmap uses valid expense categories**
    - **Validates: Requirement 5.6**

- [x] 5. Checkpoint - Ensure all backend fuel/stats tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Cross-Vehicle, Financing, and Insurance backend endpoints
  - [x] 6.1 Add `getCrossVehicle(userId, year)` to `AnalyticsRepository`
    - Compute monthly expense trends, expense by category with percentages, vehicle cost comparison with cost per mile, fuel efficiency comparison
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 6.2 Add `GET /analytics/cross-vehicle` route handler
    - Accept optional `year` query param
    - _Requirements: 6.1, 6.2, 13.1, 14.1_

  - [x] 6.3 Add `getFinancing(userId)` to `AnalyticsRepository`
    - Compute financing summary (total monthly payments, remaining balance, interest paid YTD, loan/lease counts)
    - Build per-vehicle details, monthly timeline, type distribution, loan breakdown
    - Classify unfinanced vehicles as `own`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 6.4 Add `GET /analytics/financing` route handler
    - _Requirements: 7.1, 13.1_

  - [x] 6.5 Add `getInsurance(userId)` to `AnalyticsRepository`
    - Compute insurance summary (total monthly/annual premiums, active policy count)
    - Build per-vehicle details, monthly premium trend, cost by carrier
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 6.6 Add `GET /analytics/insurance` route handler
    - _Requirements: 8.1, 13.1_

  - [x] 6.7 Write property test: Category percentages sum to 100 (Property 4)
    - **Property 4: Category percentages sum to 100**
    - **Validates: Requirements 6.3, 12.3**

  - [x] 6.8 Write property test: Cost per mile formula (Property 5)
    - **Property 5: Cost per mile formula**
    - **Validates: Requirements 6.4, 10.3**

  - [x] 6.9 Write property test: Unfinanced vehicles classified as own (Property 23)
    - **Property 23: Unfinanced vehicles classified as own**
    - **Validates: Requirement 7.4**

- [x] 7. Implement Per-Vehicle backend endpoints (Health, TCO, Expenses)
  - [x] 7.1 Add `getVehicleHealth(userId, vehicleId)` to `AnalyticsRepository`
    - Compute maintenance regularity (penalize gaps > 90 days), mileage interval adherence (3000-7000 mile range), insurance coverage (binary)
    - Compute overall score using weighted formula: `round(regularity * 0.4 + mileage * 0.35 + insurance * 0.25)`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 7.2 Add `GET /analytics/vehicle-health` route handler
    - Require `vehicleId`, verify ownership, return 404 if not owned
    - _Requirements: 9.1, 9.7, 13.1, 13.3_

  - [x] 7.3 Add `getVehicleTCO(userId, vehicleId, year?)` to `AnalyticsRepository`
    - Compute TCO: purchase price + financing interest + insurance + fuel + maintenance + other costs
    - Compute cost per mile (null if no miles), cost per month, monthly trend breakdown
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 7.4 Add `GET /analytics/vehicle-tco` route handler
    - Require `vehicleId`, verify ownership, return 404 if not owned
    - _Requirements: 10.1, 10.5, 13.1, 13.3_

  - [x] 7.5 Add `getVehicleExpenses(userId, vehicleId, year?)` to `AnalyticsRepository`
    - Compute monthly maintenance costs, fuel efficiency + cost, expense category breakdown
    - _Requirements: 11.1, 11.2_

  - [x] 7.6 Add `GET /analytics/vehicle-expenses` route handler
    - Require `vehicleId`, accept optional `year`, verify ownership
    - _Requirements: 11.1, 11.2, 11.3, 13.1, 13.3_

  - [x] 7.7 Write property test: Health score formula (Property 10)
    - **Property 10: Health score formula**
    - **Validates: Requirement 9.2**

  - [x] 7.8 Write property test: Insurance coverage is binary (Property 11)
    - **Property 11: Insurance coverage is binary**
    - **Validates: Requirement 9.4**

  - [x] 7.9 Write property test: Maintenance regularity penalizes large gaps (Property 12)
    - **Property 12: Maintenance regularity penalizes large gaps**
    - **Validates: Requirement 9.5**

  - [x] 7.10 Write property test: Mileage adherence scores good intervals (Property 13)
    - **Property 13: Mileage adherence scores good intervals**
    - **Validates: Requirement 9.6**

  - [x] 7.11 Write property test: TCO total equals sum of components (Property 14)
    - **Property 14: TCO total equals sum of components**
    - **Validates: Requirement 10.2**

  - [x] 7.12 Write property test: Cost per month formula (Property 15)
    - **Property 15: Cost per month formula**
    - **Validates: Requirement 10.4**

- [x] 8. Implement Year-End Summary backend endpoint
  - [x] 8.1 Add `getYearEnd(userId, year)` to `AnalyticsRepository`
    - Compute total spent, category breakdown with percentages, MPG trend (max 12 entries)
    - Find biggest expense, compute previous year comparison with percentage change
    - Return vehicle count, total miles, avg MPG, cost per mile
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 8.2 Add `GET /analytics/year-end` route handler
    - Require `year` query param
    - _Requirements: 12.1, 13.1, 14.1_

  - [x] 8.3 Write property test: Biggest expense is the maximum (Property 24)
    - **Property 24: Biggest expense is the maximum**
    - **Validates: Requirement 12.4**

  - [x] 8.4 Write property test: Year-over-year percentage change formula (Property 25)
    - **Property 25: Year-over-year percentage change formula**
    - **Validates: Requirement 12.5**

- [x] 9. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement cross-cutting backend properties
  - [x] 10.1 Write property test: Vehicle ownership validation (Property 6)
    - **Property 6: Vehicle ownership validation**
    - **Validates: Requirements 4.3, 9.7, 10.5, 11.3, 13.3**

  - [x] 10.2 Write property test: Year scoping filters correctly (Property 7)
    - **Property 7: Year scoping filters correctly**
    - **Validates: Requirements 2.2, 11.2**

  - [x] 10.3 Write property test: Authentication required on all endpoints (Property 26)
    - **Property 26: Authentication required on all endpoints**
    - **Validates: Requirement 13.1**

  - [x] 10.4 Write property test: User data isolation (Property 27)
    - **Property 27: User data isolation**
    - **Validates: Requirement 13.2**

  - [x] 10.5 Write property test: Invalid parameters rejected with 400 (Property 28)
    - **Property 28: Invalid parameters rejected with 400**
    - **Validates: Requirements 14.2, 14.3**

  - [x] 10.6 Write property test: Vehicle ID filtering returns only that vehicle's data (Property 19)
    - **Property 19: Vehicle ID filtering returns only that vehicle's data**
    - **Validates: Requirement 4.2**

- [x] 11. Extend frontend analytics API service
  - [x] 11.1 Add all analytics endpoint methods to `frontend/src/lib/services/analytics-api.ts`
    - `getQuickStats`, `getFuelStats`, `getFuelAdvanced`, `getCrossVehicle`, `getFinancing`, `getInsurance`, `getVehicleHealth`, `getVehicleTCO`, `getVehicleExpenses`, `getYearEnd`
    - Each method builds query params and calls `apiClient.get<T>()`
    - _Requirements: 1.1, 3.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1, 15.2_

- [x] 12. Build analytics page shell with Quick Stats and tab navigation
  - [x] 12.1 Rewrite `frontend/src/routes/analytics/+page.svelte`
    - Fetch quick stats on mount via `analyticsApi.getQuickStats()`
    - Render `QuickStats.svelte` at top, shadcn-svelte `Tabs` below with 4 tabs
    - Implement lazy loading: fetch tab data only on tab activation
    - Handle loading and error states with retry
    - _Requirements: 1.1, 1.2, 1.3, 15.1, 15.2, 15.3, 15.4, 17.1_

  - [x] 12.2 Create `frontend/src/lib/components/analytics/QuickStats.svelte`
    - Display 4 summary cards: vehicle count, YTD spending, avg MPG, fleet health score
    - Use shadcn-svelte `Card`, semantic color tokens, `chart-1` through `chart-4` accents
    - Handle empty state (no vehicles)
    - _Requirements: 1.1, 1.2, 17.1_

- [x] 13. Build Fuel & Stats tab components
  - [x] 13.1 Create `frontend/src/lib/components/analytics/FuelStatsTab.svelte`
    - Fetch fuel stats and fuel advanced data on activation
    - Render comparison cards (fillups, gallons), metric cards (MPG, fillup details, costs, distance)
    - Handle loading, error, and empty states
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8, 15.3, 15.4, 17.2_

  - [x] 13.2 Create chart components for Fuel & Stats tab
    - `FuelioCharts.svelte`: monthly consumption, gas price history, fillup cost by vehicle, odometer progression, cost per mile using layerchart
    - `AdvancedCharts.svelte`: maintenance timeline, seasonal efficiency, vehicle radar, day-of-week patterns, cost heatmap, fillup intervals using layerchart
    - Use semantic color tokens and `chart-1` through `chart-5` palette for multi-vehicle series
    - _Requirements: 3.7, 18.1, 18.2, 18.3_

- [x] 14. Build Cross-Vehicle tab components
  - [x] 14.1 Create `frontend/src/lib/components/analytics/CrossVehicleTab.svelte`
    - Fetch cross-vehicle, financing, and insurance data on activation
    - Orchestrate sub-components, handle loading/error/empty states
    - _Requirements: 6.1, 15.3, 15.4, 17.2_

  - [x] 14.2 Create `ExpenseTrendChart.svelte` and `CategoryPieChart.svelte`
    - Monthly expense trend line chart, category breakdown pie/donut chart using layerchart
    - _Requirements: 6.1, 18.1, 18.2_

  - [x] 14.3 Create `VehicleCostComparison.svelte`
    - Bar chart comparing total cost and cost per mile across vehicles
    - _Requirements: 6.2, 18.1, 18.3_

  - [x] 14.4 Create `FinancingOverview.svelte`
    - Summary cards, per-vehicle details table, monthly timeline chart, type distribution, loan breakdown
    - Use `chart-1` through `chart-5` tokens for accent colors
    - _Requirements: 7.1, 7.2, 7.3, 18.1, 18.2_

  - [x] 14.5 Create `InsuranceOverview.svelte`
    - Summary cards, per-vehicle details, monthly premium trend, cost by carrier chart
    - _Requirements: 8.1, 8.2, 8.3, 18.1, 18.2_

- [x] 15. Build Per-Vehicle tab components
  - [x] 15.1 Create `frontend/src/lib/components/analytics/PerVehicleTab.svelte`
    - Vehicle selector dropdown populated from user's vehicles
    - Auto-select if only one vehicle
    - Fetch health, TCO, and expense data on vehicle selection
    - Handle loading/error/empty states
    - _Requirements: 16.1, 16.2, 16.3, 15.3, 15.4, 17.2, 17.3_

  - [x] 15.2 Create `VehicleHealthScore.svelte`
    - Display overall score and 3 sub-scores (maintenance regularity, mileage adherence, insurance coverage)
    - Use Progress or radial indicator, semantic color tokens
    - _Requirements: 9.1, 18.2_

  - [x] 15.3 Create `TCODashboard.svelte`
    - Display cost breakdown (purchase, financing, insurance, fuel, maintenance, other), total cost, cost per mile, cost per month
    - Monthly trend stacked area chart using layerchart
    - _Requirements: 10.1, 18.1, 18.2_

  - [x] 15.4 Create `VehicleCharts.svelte`
    - Monthly maintenance costs bar chart, fuel efficiency + cost dual-axis chart, expense category breakdown pie chart
    - _Requirements: 11.1, 18.1, 18.2, 18.3_

- [x] 16. Build Year-End Summary tab
  - [x] 16.1 Create `frontend/src/lib/components/analytics/YearEndTab.svelte`
    - Year selector, fetch year-end data on activation or year change
    - Display annual report card (total spent, vehicle count, total miles, avg MPG, cost per mile)
    - Category breakdown chart, MPG trend chart, biggest expense highlight
    - Year-over-year comparison with percentage change
    - Handle empty state and missing previous year data
    - _Requirements: 12.1, 15.2, 15.3, 15.4, 17.2, 18.1, 18.2_

- [x] 17. Checkpoint - Ensure frontend builds and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Wire everything together and final validation
  - [x] 18.1 Register new analytics routes in the backend router
    - Ensure all 10 endpoints are mounted under `/api/v1/analytics/`
    - Verify `requireAuth` middleware is applied to all routes
    - _Requirements: 13.1, 13.2_

  - [x] 18.2 Verify end-to-end data flow
    - Confirm analytics page loads quick stats, tab switching fetches correct data, per-vehicle selector works
    - Confirm empty states render correctly when no data exists
    - _Requirements: 1.1, 15.1, 15.2, 17.1, 17.2_

  - [x] 18.3 Write Playwright integration tests for analytics page
    - Test page load, tab navigation, vehicle selection, chart rendering without console errors
    - _Requirements: 1.1, 3.1, 6.1, 15.1, 15.2, 16.1, 16.2_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `analytics/routes.ts` and `analytics/repository.ts` are extended, not replaced
- All charts use layerchart (not recharts) per project conventions
- All colors use semantic tokens (`chart-1` through `chart-5`, `text-foreground`, etc.)
