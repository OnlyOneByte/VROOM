# Implementation Plan: Expense Pagination, Summary & Analytics

## Overview

Three backend changes: (1) replace `find()` with `findPaginated` using SQL LIMIT/OFFSET and tag filtering, (2) add `getSummary` for basic SQL aggregations at `/expenses/summary`, (3) create a new analytics domain with `/analytics/fuel-efficiency` for computed fuel efficiency trends. Frontend updates all consumers: tables use paginated fetches, stats/charts use the summary, fuel efficiency chart uses the analytics endpoint.

## Tasks

- [x] 1. Backend: Add `findPaginated` to ExpenseRepository
  - [x] 1.1 Add `PaginatedExpenseFilters` and `PaginatedResult` interfaces
    - `PaginatedExpenseFilters` extends `ExpenseFilters` with `limit?: number`, `offset?: number`, `tags?: string[]`
    - `PaginatedResult<T>` has `data: T[]` and `totalCount: number`
    - _Requirements: 1.1, 1.4_

  - [x] 1.2 Replace `find()` with `findPaginated()` on `ExpenseRepository`
    - Build WHERE conditions from filters (vehicleId, userId, category, startDate, endDate)
    - SQL-level tag filtering using `EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)`
    - COUNT(*) query for `totalCount`
    - Data query with `ORDER BY date DESC`, `LIMIT`, `OFFSET`
    - Clamp `limit` to `CONFIG.pagination.maxPageSize`, default to `CONFIG.pagination.defaultPageSize`
    - Always join with vehicles for userId ownership
    - Throw `DatabaseError` on failure
    - Remove old `find()` method
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2_

  - [x] 1.3 Update all backend callers of old `find()`
    - Remove `fetchVehicleExpenses` helper from routes.ts
    - Update any other internal callers
    - _Requirements: 1.1_

  - [x] 1.4 Write property tests for `findPaginated`
    - totalCount equals full result count regardless of limit/offset
    - Iterating all pages yields exactly totalCount unique expenses
    - Limit is clamped to maxPageSize
    - Tag filtering in SQL matches JS-level filtering
    - _Validates: Properties 1, 2, 4, 5_

- [x] 2. Backend: Add expense summary endpoint
  - [x] 2.1 Add `getSummary` method to `ExpenseRepository`
    - Accept `{ userId, vehicleId?, period? }`
    - Run parallel SQL queries: totals (SUM + COUNT), category breakdown (GROUP BY category), monthly trend (GROUP BY strftime month), recent amount (last 30 days)
    - Compute `monthlyAverage` from monthly trend count
    - All queries join with vehicles for userId ownership
    - Throw `DatabaseError` on failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.2 Add `GET /expenses/summary` route
    - Validate query params: `vehicleId` (optional), `period` (optional enum, default all)
    - If `vehicleId` provided, verify user owns the vehicle
    - Call `getSummary` with userId from auth context
    - Return `{ success: true, data: ExpenseSummary }`
    - Place route BEFORE `/:id` to avoid path conflict
    - _Requirements: 4.1, 4.5, 4.6_

  - [x] 2.3 Write property tests for `getSummary`
    - `totalAmount` equals sum of `categoryBreakdown[].amount`
    - `expenseCount` equals sum of `categoryBreakdown[].count`
    - Monthly trend periods are sorted chronologically
    - _Validates: Property 6_

- [x] 3. Backend: Create analytics domain with fuel efficiency endpoint
  - [x] 3.1 Create `backend/src/api/analytics/repository.ts`
    - `AnalyticsRepository` class
    - `getFuelEfficiencyTrend(userId, vehicleId?)` method
    - Query fuel expenses with mileage (category='fuel', mileage IS NOT NULL), join vehicles for ownership
    - Order by date ASC for sequential processing
    - Compute efficiency from consecutive pairs: skip missed fillups, filter unrealistic values (MPG 5-100, mi/kWh 1-10)
    - Return `FuelEfficiencyPoint[]` with `{ date, efficiency, mileage }`
    - Export singleton instance
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 3.2 Create `backend/src/api/analytics/routes.ts`
    - `GET /fuel-efficiency` with optional `vehicleId` query param
    - Apply `requireAuth` middleware
    - If `vehicleId` provided, verify user owns the vehicle
    - Call `analyticsRepository.getFuelEfficiencyTrend`
    - Return `{ success: true, data: { fuelEfficiencyTrend } }`
    - _Requirements: 5.1, 5.5_

  - [x] 3.3 Mount analytics routes in `backend/src/index.ts`
    - Mount at `/api/v1/analytics`
    - _Requirements: 5.1_

  - [x] 3.4 Write property tests for fuel efficiency
    - Output matches frontend `prepareFuelEfficiencyData` for same input data
    - Missed fillups are skipped
    - Unrealistic values are filtered
    - _Validates: Property 7_

- [x] 4. Backend: Update GET /api/v1/expenses route handler
  - [x] 4.1 Refactor GET `/` to use `findPaginated`
    - Single `findPaginated` call with `userId` from auth + query filters
    - Compute `hasMore` as `offset + data.length < totalCount`
    - Return `{ success: true, data, totalCount, limit, offset, hasMore }`
    - Remove `fetchVehicleExpenses` helper and in-memory sort/slice logic
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Checkpoint: Backend tests pass
  - Run `bun run all:fix && bun run validate` in backend
  - Fix any failures before proceeding

- [x] 6. Frontend: Update types and services
  - [x] 6.1 Add types to `frontend/src/lib/types/index.ts`
    - `PaginatedResponse<T>` with `data`, `totalCount`, `limit`, `offset`, `hasMore`
    - `ExpenseSummary` with `totalAmount`, `expenseCount`, `monthlyAverage`, `recentAmount`, `categoryBreakdown`, `monthlyTrend`
    - `FuelEfficiencyPoint` with `date`, `efficiency`, `mileage`
    - _Requirements: 6.1, 6.3, 6.4_

  - [x] 6.2 Update `expense-api.ts`
    - `getExpensesByVehicle(vehicleId, params?)` → returns `PaginatedExpenseResponse`
    - `getAllExpenses(params?)` → returns `PaginatedExpenseResponse`
    - New `getExpenseSummary(params?)` → returns `ExpenseSummary`
    - Build query strings from params including limit/offset
    - Transform expenses via `fromBackendExpense` for paginated methods
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 6.3 Create `frontend/src/lib/services/analytics-api.ts`
    - `analyticsApi.getFuelEfficiency(params?)` → returns `{ fuelEfficiencyTrend: FuelEfficiencyPoint[] }`
    - _Requirements: 6.4_

- [x] 7. Frontend: Add pagination controls to ExpensesTable
  - [x] 7.1 Add optional pagination props
    - `totalCount`, `currentOffset`, `pageSize`, `isLoadingPage`, `onPageChange`
    - When `totalCount` and `onPageChange` provided, render pagination controls
    - _Requirements: 7.1_

  - [x] 7.2 Implement pagination controls UI
    - Footer below table: "Page X of Y", Previous/Next buttons
    - Disable Previous on first page, Next on last page
    - `LoaderCircle` spinner when `isLoadingPage`
    - shadcn `Button` variant="outline" size="sm", `ChevronLeft`/`ChevronRight` icons
    - Semantic color tokens only
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Frontend: Update all page consumers
  - [x] 8.1 Update `/expenses` page
    - Fetch first page + summary in parallel on mount
    - Track `currentOffset`, `pageSize`, `totalCount`, `isLoadingPage`
    - Stats cards use summary data
    - On filter change, reset offset to 0, re-fetch page + summary
    - Pass pagination props to `ExpensesTable`
    - Remove client-side `summaryStats` derived computation
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 8.2 Update `/vehicles/[id]` page
    - Overview tab: replace `expenses`-derived chart data with server endpoints
      - Expense trend chart + category pie → use `summary.monthlyTrend` and `summary.categoryBreakdown`
      - Fuel efficiency chart → use `analyticsApi.getFuelEfficiency({ vehicleId })`
      - Stats cards → use `summary.totalAmount`, `summary.recentAmount`, `summary.monthlyAverage`
    - Expenses tab: use paginated fetch, pass pagination props to `ExpensesTable`
    - Remove full `loadExpenses` from `onMount` (no longer needed for overview)
    - On expense deletion, re-fetch current page + summary + fuel efficiency
    - On period change, re-fetch summary with new period
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.3 Update `/dashboard` page
    - Replace `allExpenses` with summary fetch (no vehicleId)
    - Stats cards use `summary.totalAmount`, `summary.monthlyAverage`
    - Monthly trend chart uses `summary.monthlyTrend`
    - Category pie chart uses `summary.categoryBreakdown`
    - Recent activity: paginated fetch with `limit=5`
    - Remove client-side derived computations (`filteredExpenses`, `stats`, `trendChartData`, `categoryChartData`)
    - On period change, re-fetch summary with new period
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 8.4 Update `ExpenseForm.svelte` and other consumers
    - `ExpenseForm` uses `getExpensesByVehicle` for last fuel expense and mileage validation — update to handle paginated response (extract `.data`), pass high limit
    - Offline sync manager — update if it calls expense APIs
    - _Requirements: 6.2_

- [x] 9. Frontend: Clean up unused utilities
  - [x] 9.1 Remove or deprecate frontend chart computation utilities
    - `prepareExpenseTrendData` — replaced by `summary.monthlyTrend`
    - `prepareFuelEfficiencyData` — replaced by `analyticsApi.getFuelEfficiency`
    - `prepareCategoryChartData` — replaced by `summary.categoryBreakdown`
    - `filterExpensesByPeriod` — replaced by server-side period filtering
    - `groupExpensesByCategory` — replaced by server-side grouping
    - Keep if still used elsewhere; remove if fully replaced
    - Update chart components to accept new server-provided data shapes

- [x] 10. Final checkpoint: All tests pass
  - Run `bun run all:fix && bun run validate` in backend
  - Run `npm run all:fix && npm run validate` in frontend
  - Fix any failures

## Notes

- `CONFIG.pagination` already exists with `defaultPageSize: 20`, `maxPageSize: 100`
- The existing `expenseQuerySchema` already validates `limit` and `offset` query params
- SQLite `json_each()` is used for tag filtering
- The repository already has `getTotalByCategory` and `getMonthlyTotals` methods that can be leveraged by `getSummary`
- `findFinancingByVehicleId` is a separate method and is not affected
- The analytics domain (`backend/src/api/analytics/`) is new — starts with fuel efficiency, extensible to health scores, TCO, year-end summaries
- Chart components (`ExpenseTrendChart`, `FuelEfficiencyTrendChart`, `CategoryPieChart`) will need props updated to accept server-provided data shapes
- The expense summary intentionally does NOT include fuel efficiency — that's an analytics concern
