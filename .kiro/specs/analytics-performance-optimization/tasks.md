# Implementation Plan: Analytics Performance Optimization

## Overview

Two-tier optimization of the analytics page: (1) lazy-mount tab content via `{#if}` blocks so only the active tab is in the DOM, and (2) consolidate the initial page load into a single `GET /api/v1/analytics/summary` endpoint that shares DB queries across quickStats, fuelStats, and fuelAdvanced computations. The existing individual endpoints remain unchanged for backward compatibility.

## Tasks

- [x] 1. Tier 1 — Lazy-mount tab content on the analytics page
  - [x] 1.1 Refactor `+page.svelte` to lazy-mount tabs with `{#if}` blocks
    - Replace `<Tabs.Content>` wrapping each tab component with `{#if activeTab === '...'}` conditional blocks
    - Keep `<Tabs.Root>` and `<Tabs.List>` with triggers unchanged
    - Ensure `activeTab` defaults to `'fuel-stats'` (already the case)
    - Only the active tab's component should be mounted in the DOM; inactive tabs produce no DOM nodes or API calls
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Checkpoint — Verify lazy-mount works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Tier 2 — Backend consolidated summary endpoint
  - [x] 3.1 Add `buildFuelStatsFromData()` and `buildFuelAdvancedFromData()` private methods to `AnalyticsRepository`
    - Extract the computation logic from `getFuelStats()` into `buildFuelStatsFromData()` that accepts pre-fetched `fuelRows`, `fuelRowsByVehicle`, `vehicleNameMap`, `range`, and `prevYearAgg` instead of querying the DB
    - Extract the computation logic from `getFuelAdvanced()` into `buildFuelAdvancedFromData()` that accepts pre-fetched `fuelRows`, `fuelRowsByVehicle`, `allExpenses`, `vehicleNameMap`, and `range`
    - Refactor `getFuelStats()` and `getFuelAdvanced()` to call these new methods internally so existing endpoints remain unchanged
    - _Requirements: 3.1, 3.2, 3.3, 8.1_

  - [x] 3.2 Add `getSummary()` method to `AnalyticsRepository`
    - Execute shared queries (`queryVehicleNameMap`, `queryAllExpenses`, `queryFuelExpenses`, `queryFuelAggregates`, vehicle rows) once via `Promise.all`
    - Build `quickStats` from pre-fetched data (reuse logic from `getQuickStats`)
    - Call `buildFuelStatsFromData()` and `buildFuelAdvancedFromData()` with the shared data
    - Return `{ quickStats, fuelStats, fuelAdvanced }`
    - Wrap in try/catch, log errors with userId and range context, throw `DatabaseError`
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 7.1, 7.2_

  - [x] 3.3 Write property test: Summary data equivalence (Property 2)
    - **Property 2: Summary data equivalence**
    - For any valid user and date range, `getSummary()` quickStats/fuelStats/fuelAdvanced must be identical to calling `getQuickStats()`, `getFuelStats()`, `getFuelAdvanced()` independently
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 3.4 Add `GET /summary` route to `backend/src/api/analytics/routes.ts`
    - Use `dateRangeQuerySchema` for query validation (same as existing endpoints)
    - Use `requireAuth` middleware (already applied via `routes.use('*', requireAuth)`)
    - Call `analyticsRepository.getSummary(user.id, { start: startDate, end: endDate })`
    - Return `{ success: true, data }` response
    - _Requirements: 2.2, 2.3, 6.1, 6.2, 6.3, 7.2_

  - [x] 3.5 Write unit tests for the summary route
    - Test that valid requests return combined quickStats, fuelStats, fuelAdvanced
    - Test that unauthenticated requests return 401
    - Test that invalid date range params return validation error
    - Test that DB errors return 500 with structured error response
    - **Validates: Requirements 6.1, 6.2, 7.2**

- [x] 4. Checkpoint — Verify backend summary endpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Tier 2 — Frontend integration with summary endpoint
  - [x] 5.1 Add `AnalyticsSummaryResponse` type to `frontend/src/lib/types.ts`
    - Define `AnalyticsSummaryResponse` containing `quickStats: QuickStatsResponse`, `fuelStats: FuelStatsResponse`, `fuelAdvanced: FuelAdvancedResponse`
    - _Requirements: 2.3_

  - [x] 5.2 Add `getSummary()` method to `analyticsApi` in `frontend/src/lib/services/analytics-api.ts`
    - Accept `{ startDate, endDate }` params
    - Call `GET /api/v1/analytics/summary` via `apiClient.get`
    - Implement fallback: if the call fails, fall back to calling `getQuickStats`, `getFuelStats`, `getFuelAdvanced` in parallel
    - Return `AnalyticsSummaryResponse`
    - _Requirements: 2.1, 4.1, 4.2_

  - [x] 5.3 Update `FuelStatsTab.svelte` to accept pre-loaded data as optional props
    - Add optional `fuelStats` and `fuelAdvanced` props
    - Use `$derived` to pick prop data when available, otherwise use locally-loaded data
    - Only call `loadData()` in `onMount` if props are not provided
    - Preserve existing UI rendering unchanged
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 5.4 Update `+page.svelte` to call `getSummary()` and pass data to `FuelStatsTab`
    - Replace `loadQuickStats()` with `loadSummary()` that calls `analyticsApi.getSummary()`
    - Derive `quickStats`, `fuelStats`, `fuelAdvanced` from the summary response
    - Pass `fuelStats` and `fuelAdvanced` as props to `FuelStatsTab`
    - Show error state with retry button on failure
    - _Requirements: 2.1, 2.4, 4.3, 7.3_

  - [x] 5.5 Write unit tests for `getSummary()` fallback behavior
    - Test that successful summary call returns combined data
    - Test that on 404/network error, fallback calls individual endpoints
    - Test that fallback produces the same response shape
    - **Validates: Requirements 4.1, 4.2**

- [x] 6. Final checkpoint — Validate everything
  - Ensure all tests pass, ask the user if questions arise.
  - Run `bun run all:fix && bun run validate` in backend
  - Run `npm run all:fix && npm run validate` in frontend

- [x] 7. Tier 3 — Viewport-aware chart rendering
  - [x] 7.1 Refactor `visibility-watch.svelte.ts` to be IntersectionObserver-first
    - Change initial `visible` state to `false` for all elements (remove synchronous `checkVisibility` that sets `true` for above-fold elements)
    - Make IntersectionObserver the primary visibility gate — `visible` flips to `true` only when the element enters the viewport
    - Add a sticky `hasBeenVisible` flag: once a chart has rendered, keep `visible = true` even when scrolled out of view (prevents re-mount thrashing)
    - Keep MutationObserver for hidden-tab detection (`display: none` via `hidden` attribute)
    - Ensure existing ChartCard consumers work without changes (same `createVisibilityWatch()` API)
    - _Properties: 7, 8_

  - [x] 7.2 Update `+page.svelte` to use dynamic imports for non-default tab components
    - Keep `FuelStatsTab` as a static import (default tab, needs to render immediately)
    - Replace static imports of `CrossVehicleTab`, `PerVehicleTab`, `YearEndTab` with dynamic `{#await import(...)}` blocks
    - Show a `LoaderCircle` spinner while the dynamic import resolves
    - _Property: 9_

- [x] 8. Checkpoint — Verify Tier 3 rendering performance
  - Ensure all tests pass
  - Verify below-fold charts in Fuel & Stats tab don't render until scrolled into view
  - Verify non-default tab dynamic imports load on first tab switch

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Existing individual endpoints (`/quick-stats`, `/fuel-stats`, `/fuel-advanced`, etc.) remain completely unchanged
- Tier 1 (task 1) is independent and can be shipped without Tier 2
- Property tests use fast-check (already in the project)
