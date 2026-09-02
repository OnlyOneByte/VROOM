# Requirements Document

## Introduction

Expense Pagination adds server-side SQL pagination to the expense list API, a lean expense summary endpoint for basic aggregations, and a new analytics domain with a fuel efficiency endpoint. The frontend stops deriving chart data from raw expense arrays — tables use paginated fetches, stats/category/trend charts use the expense summary, and fuel efficiency charts use the analytics endpoint.

## Glossary

- **Expense_API**: The backend `GET /api/v1/expenses` route handler for paginated expense listing
- **Summary_API**: The backend `GET /api/v1/expenses/summary` endpoint returning basic aggregations (totals, category breakdown, monthly trend)
- **Analytics_API**: The new backend `GET /api/v1/analytics/fuel-efficiency` endpoint returning computed fuel efficiency trend data
- **ExpenseRepository**: The data access layer in `backend/src/api/expenses/repository.ts`
- **ExpensesTable**: The frontend component `ExpensesTable.svelte` that renders the expense list
- **ExpenseService**: The frontend `expenseApi` in `frontend/src/lib/services/expense-api.ts`
- **PaginatedResponse**: A response envelope containing `data`, `totalCount`, `limit`, `offset`, and `hasMore`
- **ExpenseSummary**: Pre-aggregated data: totals, category breakdown, monthly trend

## Requirements

### Requirement 1: SQL-Level Pagination in Repository

**User Story:** As a developer, I want expense queries to use SQL LIMIT/OFFSET so that the database only returns the requested page of results.

#### Acceptance Criteria

1. WHEN the repository receives `limit` and `offset` parameters, IT SHALL apply `LIMIT` and `OFFSET` clauses to the SQL query instead of fetching all rows and slicing in JS
2. WHEN `limit` is not provided, IT SHALL default to `CONFIG.pagination.defaultPageSize` (20)
3. WHEN `limit` exceeds `CONFIG.pagination.maxPageSize` (100), IT SHALL clamp it to 100
4. THE repository SHALL also return a `totalCount` of matching rows (before pagination)

### Requirement 2: Paginated API Response Format

**User Story:** As a frontend developer, I want the expense list endpoint to return pagination metadata so I can build pagination controls.

#### Acceptance Criteria

1. WHEN a paginated expense list is requested, THE Expense_API SHALL return `{ success: true, data: Expense[], totalCount: number, limit: number, offset: number, hasMore: boolean }`
2. THE `hasMore` field SHALL be `true` when `offset + data.length < totalCount`
3. THE `totalCount` SHALL reflect the total number of expenses matching the current filters
4. WHEN no expenses match, THE Expense_API SHALL return `{ data: [], totalCount: 0, limit: 20, offset: 0, hasMore: false }`

### Requirement 3: Tag Filtering at SQL Level

**User Story:** As a developer, I want tag filtering to happen in SQL so that totalCount is accurate and pagination is correct.

#### Acceptance Criteria

1. WHEN `tags` query parameter is provided, THE repository SHALL filter by tags in SQL using JSON array containment
2. THE `totalCount` SHALL accurately reflect the number of expenses matching the tag filter

### Requirement 4: Expense Summary Endpoint

**User Story:** As a frontend developer, I want a single endpoint for basic expense aggregations so the frontend doesn't compute stats client-side from raw expense arrays.

#### Acceptance Criteria

1. THE Summary_API SHALL be available at `GET /api/v1/expenses/summary` with optional `vehicleId` and `period` query params
2. THE response SHALL include `totalAmount`, `expenseCount`, `monthlyAverage`, and `recentAmount` (last 30 days)
3. THE response SHALL include `categoryBreakdown`: an array of `{ category, amount, count }` for each category with data
4. THE response SHALL include `monthlyTrend`: an array of `{ period: "YYYY-MM", amount, count }` sorted chronologically
5. WHEN `vehicleId` is provided, ALL aggregations SHALL be scoped to that vehicle
6. WHEN `period` is provided (7d, 30d, 90d, 1y, all), THE aggregations SHALL be filtered to that period

### Requirement 5: Analytics Fuel Efficiency Endpoint

**User Story:** As a user, I want to see my fuel efficiency trend over time, computed server-side from my fuel expense history.

#### Acceptance Criteria

1. THE Analytics_API SHALL be available at `GET /api/v1/analytics/fuel-efficiency` with optional `vehicleId` query param
2. THE response SHALL include `fuelEfficiencyTrend`: an array of `{ date, efficiency, mileage }` computed from sequential fuel expenses
3. THE computation SHALL skip missed fillups and filter unrealistic values (MPG < 5 or > 100, mi/kWh < 1 or > 10)
4. THE endpoint SHALL always return all-time data (no period filtering) since efficiency trends are most useful over the full vehicle lifetime
5. WHEN `vehicleId` is provided, THE data SHALL be scoped to that vehicle

### Requirement 6: Frontend Service Updates

**User Story:** As a user, I want the expenses table to load one page at a time so the page loads faster.

#### Acceptance Criteria

1. THE ExpenseService methods `getExpensesByVehicle` and `getAllExpenses` SHALL be updated to accept pagination params and return the paginated response envelope
2. ALL consumers SHALL be updated to handle the new response format
3. A new `getExpenseSummary(params)` method SHALL be added for summary data
4. A new `analyticsApi` service SHALL be created with `getFuelEfficiency(params)` method

### Requirement 7: Pagination Controls in ExpensesTable

**User Story:** As a user, I want to see pagination controls at the bottom of the expenses table.

#### Acceptance Criteria

1. WHEN pagination props are provided, THE ExpensesTable SHALL display pagination controls with page indicator and previous/next buttons
2. Previous SHALL be disabled on first page; Next SHALL be disabled on last page
3. THE ExpensesTable SHALL show a loading state during page transitions

### Requirement 8: Expenses Page Integration

**User Story:** As a user, I want the main expenses page to use server-side pagination and server-computed stats.

#### Acceptance Criteria

1. WHEN the expenses page loads, IT SHALL fetch the first page of expenses AND the expense summary in parallel
2. WHEN the user changes filters, THE page SHALL reset to page 1 and re-fetch both
3. THE summary stats cards SHALL use data from the summary endpoint

### Requirement 9: Vehicle Detail Page Integration

**User Story:** As a user, I want the vehicle detail page to use pagination for the Expenses tab and server endpoints for charts.

#### Acceptance Criteria

1. THE Expenses tab SHALL use paginated fetching for the ExpensesTable
2. THE overview tab's expense trend chart and category pie chart SHALL use data from the expense summary endpoint
3. THE overview tab's fuel efficiency chart SHALL use data from the analytics fuel efficiency endpoint
4. THE overview tab's stats cards SHALL use data from the expense summary endpoint
5. WHEN an expense is deleted, THE page SHALL re-fetch the current page, summary, and fuel efficiency data

### Requirement 10: Dashboard Integration

**User Story:** As a user, I want the dashboard to use server endpoints for its stats and charts.

#### Acceptance Criteria

1. THE dashboard stats cards SHALL use data from the expense summary endpoint (no vehicleId)
2. THE dashboard monthly trend chart SHALL use `monthlyTrend` from the summary endpoint
3. THE dashboard category pie chart SHALL use `categoryBreakdown` from the summary endpoint
4. THE dashboard recent activity list SHALL use a paginated expense fetch with `limit=5`
