# Implementation Plan: Chart & Stat Card Consolidation

## Overview

Incremental 8-phase migration that creates a reusable chart/stat card component library under `$lib/components/charts/`, then migrates all pages to use it. Each phase is independently validatable.

## Tasks

- [x] 1. Phase 1 — Create chart-colors utility and foundation components
  - [x] 1.1 Create `$lib/utils/chart-colors.ts` with CATEGORY_COLORS, CATEGORY_LABELS, CHART_COLORS, assignSeriesColors, buildChartConfig, and buildCategoryPieData
    - Export `CATEGORY_COLORS` mapping each category enum value to a semantic color token
    - Export `CATEGORY_LABELS` mapping each category enum value to a display label
    - Export `CHART_COLORS` array with the five `var(--chart-N)` tokens
    - Implement `assignSeriesColors(keys)` with modular cycling
    - Implement `buildChartConfig(series)` returning a record keyed by series key
    - Implement `buildCategoryPieData(breakdown, total?)` excluding zero amounts, computing percentages
    - Add fallback to `var(--primary)` for unknown category colors and raw key for unknown labels
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 13.1, 13.2, 14.1, 14.2, 14.3, 14.4, 14.5, 15.1, 15.2_

  - [x] 1.2 Write property tests for chart-colors utilities
    - **Property 8: Category maps completeness** — verify CATEGORY_COLORS and CATEGORY_LABELS cover the full enum and use CSS custom property syntax
    - **Validates: Requirements 11.1, 11.2, 11.4**
    - **Property 9: assignSeriesColors length and order preservation** — ∀ string array of length N, output has length N, preserves order, all colors from CHART_COLORS
    - **Validates: Requirements 12.1, 12.3**
    - **Property 10: buildChartConfig structure preservation** — ∀ series array, output has exactly one entry per input item with correct label and color
    - **Validates: Requirements 13.1, 13.2**
    - **Property 11: buildCategoryPieData correctness** — ∀ valid breakdown, excludes zeros, percentages sum ≈ 100, colors from CATEGORY_COLORS
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5**
    - **Property 12: Category key fallback safety** — ∀ unknown key, color falls back to `var(--primary)`, label falls back to raw key
    - **Validates: Requirements 15.1, 15.2**

  - [x] 1.3 Create `$lib/components/charts/ChartCard.svelte`
    - Render Card.Root > Card.Header (title, description, icon snippet) > Card.Content
    - Show Skeleton when `isLoading` is true
    - Show EmptyState with error message when `error` is non-null
    - Show EmptyState with emptyTitle/emptyDescription when `isEmpty` is true
    - Render children snippet when data is available
    - Apply `use:animateOnView` with `animationClass` prop
    - Accept `class` prop for Card.Root and `height` prop for content container
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 17.3_

  - [x] 1.4 Create `$lib/components/charts/ChartLegend.svelte`
    - Render flex-wrap list of colored dot + label pairs from `items` array
    - Use `role="list"` on container and `role="listitem"` on each entry
    - Set `aria-label` when provided
    - Render nothing when items array is empty
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 17.1_

  - [x] 1.5 Create `$lib/components/charts/StatCard.svelte`
    - Render Card with label and value
    - Render colored icon badge with `bg-{iconColor}/10` and `text-{iconColor}` when icon provided
    - Render dual-metric layout with divider when secondaryLabel and secondaryValue provided
    - Render simple layout when only label/value provided
    - Display unit adjacent to value when provided
    - Display subtitle below value when provided
    - Show skeleton placeholders when `isLoading` is true
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 17.2_

  - [x] 1.6 Create `$lib/components/charts/StatCardGrid.svelte`
    - Render one StatCard per item in the items array
    - Use responsive grid: `grid-cols-2 lg:grid-cols-{columns}`
    - Pass `isLoading` to each StatCard
    - Default columns to 4 or item count if fewer than 4
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 1.7 Create `$lib/components/charts/index.ts` barrel export
    - Export all chart components and chart-colors utilities from a single entry point
    - _Requirements: 16.1_

- [x] 2. Phase 1 continued — Create typed chart wrappers
  - [x] 2.1 Move animation CSS files to `$lib/components/charts/` if not already co-located
    - Ensure `chart-line-animated`, `chart-bar-animated`, `chart-pie-animated` CSS classes are importable from the charts directory
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 2.2 Create `$lib/components/charts/AppLineChart.svelte`
    - Compose ChartCard + Chart.Container + layerchart LineChart + ChartLegend + Chart.Tooltip
    - Apply `chart-line-animated` animation class via ChartCard
    - Use default axis formatting from chart-formatters when overrides not provided
    - Delegate isLoading/error/empty state handling to ChartCard
    - _Requirements: 9.1, 9.5, 10.1, 10.5_

  - [x] 2.3 Create `$lib/components/charts/AppBarChart.svelte`
    - Compose ChartCard + Chart.Container + layerchart BarChart + ChartLegend + Chart.Tooltip
    - Apply `chart-bar-animated` animation class via ChartCard
    - Support orientation and seriesLayout props
    - Delegate isLoading/error/empty state handling to ChartCard
    - _Requirements: 9.2, 9.5, 10.2, 10.5_

  - [x] 2.4 Create `$lib/components/charts/AppPieChart.svelte`
    - Compose ChartCard + Chart.Container + layerchart PieChart + ChartLegend + Chart.Tooltip
    - Apply `chart-pie-animated` animation class via ChartCard
    - Accept pre-built pie data array with key, label, value, color, percentage
    - Delegate isLoading/error/empty state handling to ChartCard
    - _Requirements: 9.3, 9.5, 10.3_

  - [x] 2.5 Create `$lib/components/charts/AppAreaChart.svelte`
    - Compose ChartCard + Chart.Container + layerchart AreaChart + ChartLegend + Chart.Tooltip
    - Apply `chart-line-animated` animation class via ChartCard
    - Support seriesLayout prop (default/stack)
    - Delegate isLoading/error/empty state handling to ChartCard
    - _Requirements: 9.4, 9.5, 10.4, 10.5_

  - [x] 2.6 Update `$lib/components/charts/index.ts` to export all typed chart wrappers
    - _Requirements: 16.1_

- [x] 3. Checkpoint — Verify Phase 1 components
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run all:fix && npm run validate` in frontend/
  - Verify existing pages still function without modification
  - _Requirements: 16.1_

- [x] 4. Phase 2 — Migrate existing chart components to use ChartCard internally
  - [x] 4.1 Migrate `CategoryPieChart` to use ChartCard and chart-colors internally
    - Replace manual Card/Skeleton/EmptyState boilerplate with ChartCard
    - Replace local category color/label maps with imports from chart-colors.ts
    - Keep external component API unchanged
    - _Requirements: 16.2_

  - [x] 4.2 Migrate `ExpenseTrendChart` to use ChartCard internally
    - Replace manual Card/Skeleton/EmptyState boilerplate with ChartCard
    - Keep external component API unchanged
    - _Requirements: 16.2_

  - [x] 4.3 Migrate `FuelEfficiencyTrendChart` to use ChartCard internally
    - Replace manual Card/Skeleton/EmptyState boilerplate with ChartCard
    - Keep external component API unchanged
    - _Requirements: 16.2_

- [x] 5. Phase 3 — Migrate Dashboard and Analytics stat cards
  - [x] 5.1 Migrate `DashboardStatsCards` to use StatCardGrid
    - Replace manual grid + loop with StatCardGrid component
    - Map existing stat items to StatCardItem format
    - Preserve visual output
    - _Requirements: 8.1, 8.2, 16.3_

  - [x] 5.2 Migrate `QuickStats` (analytics) to use StatCardGrid
    - Replace manual stat card rendering with StatCardGrid
    - Preserve visual output
    - _Requirements: 8.1, 8.2, 16.3_

  - [x] 5.3 Migrate Expenses page inline stat cards to use StatCardGrid
    - Replace inline statCards array + manual grid with StatCardGrid
    - Preserve visual output
    - _Requirements: 8.1, 8.2, 16.3_

- [x] 6. Phase 4 — Migrate Financing and Insurance stat cards
  - [x] 6.1 Migrate `FinancingSummaryHeader` to use StatCard/StatCardGrid
    - Replace manual metric card rendering with StatCard components
    - Preserve visual output
    - _Requirements: 6.1, 6.2, 16.3_

  - [x] 6.2 Migrate `PaymentMetricsGrid` to use StatCardGrid
    - Replace manual metric grid with StatCardGrid
    - Preserve visual output
    - _Requirements: 8.1, 8.2, 16.3_

- [x] 7. Checkpoint — Verify stat card migrations
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run all:fix && npm run validate` in frontend/
  - _Requirements: 16.3_

- [x] 8. Phase 5 — Migrate analytics tab chart components
  - [x] 8.1 Migrate `CrossVehicleTab` charts to use AppLineChart, AppBarChart, AppPieChart
    - Replace inline chart card boilerplate with typed chart wrappers
    - Replace local category color maps with chart-colors imports
    - Migrate inline stat cards (financing summary, insurance analysis) to StatCard
    - _Requirements: 9.1, 9.2, 9.3, 11.1, 16.3_

  - [x] 8.2 Migrate `PerVehicleTab` charts to use AppLineChart, AppBarChart, AppPieChart, AppAreaChart
    - Replace inline chart card boilerplate with typed chart wrappers
    - Migrate TCO summary cards to StatCard
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 16.3_

  - [x] 8.3 Migrate `YearEndTab` charts to use AppLineChart, AppPieChart
    - Replace inline chart card boilerplate with typed chart wrappers
    - Migrate year-end metric cards to StatCard/StatCardGrid
    - _Requirements: 9.1, 9.3, 16.3_

- [x] 9. Phase 6 — Migrate FuelCharts and AdvancedCharts
  - [x] 9.1 Migrate `FuelCharts` to use AppLineChart and AppAreaChart
    - Replace inline chart card boilerplate for all 5+ fuel charts with typed wrappers
    - _Requirements: 9.1, 9.4, 16.3_

  - [x] 9.2 Migrate `AdvancedCharts` to use AppBarChart
    - Replace inline chart card boilerplate for seasonal, day-of-week, heatmap, intervals charts
    - _Requirements: 9.2, 16.3_

- [x] 10. Phase 7 — Remove duplicated category color/label maps
  - [x] 10.1 Remove local `categoryColors` and `categoryLabels` maps from all migrated files
    - Search for remaining duplicated maps across the codebase
    - Replace all references with imports from `$lib/utils/chart-colors.ts`
    - _Requirements: 11.1, 11.2_

- [x] 11. Checkpoint — Verify all migrations
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run all:fix && npm run validate` in frontend/
  - _Requirements: 16.3_

- [x] 12. Phase 8 — Final cleanup
  - [x] 12.1 Remove `stat-card.svelte` and `stat-card-dual.svelte`
    - Verify no remaining imports reference these files
    - Delete the old components
    - _Requirements: 16.4_

  - [x] 12.2 Remove any remaining unused imports and dead code from migrated files
    - Clean up unused imports left over from migration
    - _Requirements: 16.4_

- [x] 13. Final checkpoint — Full validation
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npm run all:fix && npm run validate` in frontend/

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each phase is independently validatable — existing pages continue to work throughout
- Property tests use fast-check and validate the chart-colors utility functions
- Checkpoints at phases 1, 4, 7, and 8 ensure incremental correctness
- External component APIs are preserved until Phase 8 cleanup
