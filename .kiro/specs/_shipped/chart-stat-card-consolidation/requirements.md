# Requirements Document

## Introduction

The VROOM app has charts and stat cards duplicated across 15+ files with inconsistent styling, repeated boilerplate for loading/error/empty states, and fragmented category color/label maps. This feature consolidates all chart and stat card patterns into a reusable component library under `$lib/components/charts/`, providing composable, consistently-styled components that every page can adopt incrementally.

## Glossary

- **ChartCard**: A universal wrapper component that provides card shell, title, description, loading skeleton, error state, empty state, and animation for any chart content.
- **ChartLegend**: A reusable legend component rendering colored dot + label pairs with proper ARIA roles.
- **StatCard**: A single flexible component replacing all stat card variants, supporting icon badges, dual metrics, subtitles, and loading states.
- **StatCardGrid**: A responsive grid component that renders an array of StatCard items with configurable columns.
- **AppLineChart**: A typed wrapper composing ChartCard + layerchart LineChart + ChartLegend + tooltip with sensible defaults.
- **AppBarChart**: A typed wrapper composing ChartCard + layerchart BarChart + ChartLegend + tooltip with sensible defaults.
- **AppPieChart**: A typed wrapper composing ChartCard + layerchart PieChart + ChartLegend + tooltip with sensible defaults.
- **AppAreaChart**: A typed wrapper composing ChartCard + layerchart AreaChart + ChartLegend + tooltip with sensible defaults.
- **chart-colors**: A utility module consolidating category color/label maps and series color assignment functions.
- **Category_Enum**: The set of expense categories: fuel, maintenance, financial, regulatory, enhancement, misc.
- **Semantic_Color_Token**: A CSS custom property reference (e.g., `var(--chart-1)`) used for theming instead of hardcoded hex values.
- **animateOnView**: An existing Svelte action that triggers CSS animation classes when an element enters the viewport.
- **EmptyState**: An existing shared component that displays contextual messages when no data is available or an error occurs.
- **ChartConfig**: A record mapping series keys to label and color pairs, used by shadcn chart primitives.
- **layerchart**: The existing charting library used by the app for rendering SVG charts.

## Requirements

### Requirement 1: ChartCard Loading State

**User Story:** As a user, I want to see a loading skeleton while chart data is being fetched, so that I know the chart is loading and the page does not appear broken.

#### Acceptance Criteria

1. WHEN the `isLoading` prop is true, THE ChartCard SHALL render a Skeleton placeholder with the specified height
2. WHILE the `isLoading` prop is true, THE ChartCard SHALL NOT render the chart content, legend, or tooltip
3. WHEN the `isLoading` prop transitions from true to false, THE ChartCard SHALL replace the Skeleton with the chart content

### Requirement 2: ChartCard Error State

**User Story:** As a user, I want to see a clear error message when chart data fails to load, so that I understand what went wrong.

#### Acceptance Criteria

1. WHEN the `error` prop contains a non-null string, THE ChartCard SHALL render an EmptyState with the error message
2. WHILE the `error` prop is non-null, THE ChartCard SHALL NOT render the chart content or legend
3. WHEN the `error` prop is null and `isLoading` is false and data is available, THE ChartCard SHALL render the chart content

### Requirement 3: ChartCard Empty State

**User Story:** As a user, I want to see a contextual empty message when there is no data for a chart, so that I understand why the chart area is blank.

#### Acceptance Criteria

1. WHEN the `isEmpty` prop is true and `isLoading` is false and `error` is null, THE ChartCard SHALL render an EmptyState with the `emptyTitle` and `emptyDescription`
2. WHEN the `isEmpty` prop is false and `isLoading` is false and `error` is null, THE ChartCard SHALL render the children snippet containing the chart

### Requirement 4: ChartCard Structure and Animation

**User Story:** As a developer, I want a consistent card structure with built-in animation support for all charts, so that I do not have to duplicate card shell and animation boilerplate.

#### Acceptance Criteria

1. THE ChartCard SHALL render a Card.Root containing a Card.Header with title and optional description and optional icon, followed by Card.Content
2. WHEN an `animationClass` prop is provided, THE ChartCard SHALL apply the `animateOnView` action with the specified CSS animation class to the chart content area
3. WHEN a `class` prop is provided, THE ChartCard SHALL apply the additional CSS classes to the Card.Root element
4. WHEN a `height` prop is provided, THE ChartCard SHALL set the chart content container to the specified height in pixels

### Requirement 5: ChartLegend Rendering

**User Story:** As a user, I want to see a clear legend identifying each series or category in a chart, so that I can understand what the chart data represents.

#### Acceptance Criteria

1. THE ChartLegend SHALL render one colored dot and label pair for each item in the `items` array
2. THE ChartLegend SHALL render the legend as an accessible list with `role="list"` and each item with `role="listitem"`
3. WHEN an `ariaLabel` prop is provided, THE ChartLegend SHALL set the `aria-label` attribute on the list element
4. WHEN the `items` array is empty, THE ChartLegend SHALL render nothing

### Requirement 6: StatCard Rendering

**User Story:** As a user, I want informational stat cards that consistently display metrics with optional icons and secondary values, so that I can quickly scan key numbers across all pages.

#### Acceptance Criteria

1. THE StatCard SHALL render a Card containing the `label` and `value` props
2. WHEN an `icon` prop is provided, THE StatCard SHALL render a colored icon badge using `bg-{iconColor}/10` and `text-{iconColor}` semantic tokens
3. WHEN `secondaryLabel` and `secondaryValue` props are both provided, THE StatCard SHALL render a dual-metric layout with a visual divider between primary and secondary metrics
4. WHEN only `label` and `value` are provided without `icon` or secondary props, THE StatCard SHALL render a simple layout with label and value
5. WHEN a `unit` prop is provided, THE StatCard SHALL display the unit text adjacent to the value
6. WHEN a `subtitle` prop is provided, THE StatCard SHALL display the subtitle below the value

### Requirement 7: StatCard Loading State

**User Story:** As a user, I want stat cards to show loading placeholders while data is being fetched, so that the layout does not shift when data arrives.

#### Acceptance Criteria

1. WHEN the `isLoading` prop is true, THE StatCard SHALL render skeleton placeholders in place of the label, value, and icon
2. WHILE the `isLoading` prop is true, THE StatCard SHALL NOT render the actual metric data

### Requirement 8: StatCardGrid Layout

**User Story:** As a developer, I want a grid component that renders stat cards from a data array with responsive columns, so that I do not have to duplicate grid layout code on every page.

#### Acceptance Criteria

1. THE StatCardGrid SHALL render one StatCard for each item in the `items` array
2. THE StatCardGrid SHALL use a responsive grid layout with 2 columns on small screens and the `columns` prop value on large screens
3. WHEN the `isLoading` prop is true, THE StatCardGrid SHALL pass `isLoading` to each StatCard, rendering skeleton placeholders
4. WHEN the `columns` prop is not provided, THE StatCardGrid SHALL default to 4 columns on large screens or the number of items if fewer than 4

### Requirement 9: Typed Chart Wrapper Composition

**User Story:** As a developer, I want typed chart wrapper components that compose ChartCard, layerchart, ChartLegend, and tooltip into a single call, so that I can render a complete chart with one component instead of assembling five.

#### Acceptance Criteria

1. THE AppLineChart SHALL compose ChartCard, Chart.Container, layerchart LineChart, ChartLegend, and Chart.Tooltip into a single component
2. THE AppBarChart SHALL compose ChartCard, Chart.Container, layerchart BarChart, ChartLegend, and Chart.Tooltip into a single component
3. THE AppPieChart SHALL compose ChartCard, Chart.Container, layerchart PieChart, ChartLegend, and Chart.Tooltip into a single component
4. THE AppAreaChart SHALL compose ChartCard, Chart.Container, layerchart AreaChart, ChartLegend, and Chart.Tooltip into a single component
5. WHEN `isLoading`, `error`, or empty data is passed to a typed chart wrapper, THE wrapper SHALL delegate state handling to ChartCard

### Requirement 10: Typed Chart Wrapper Defaults

**User Story:** As a developer, I want chart wrappers to apply sensible defaults from existing chart-formatters utilities, so that I do not have to configure axis formatting and padding for every chart.

#### Acceptance Criteria

1. THE AppLineChart SHALL apply the `chart-line-animated` animation class via ChartCard
2. THE AppBarChart SHALL apply the `chart-bar-animated` animation class via ChartCard
3. THE AppPieChart SHALL apply the `chart-pie-animated` animation class via ChartCard
4. THE AppAreaChart SHALL apply the `chart-line-animated` animation class via ChartCard
5. WHEN `xAxisProps` or `yAxisFormat` overrides are not provided, THE typed chart wrappers SHALL use default axis formatting from chart-formatters utilities

### Requirement 11: Category Color and Label Consolidation

**User Story:** As a developer, I want a single source of truth for category colors and labels, so that I do not have to maintain duplicated maps across multiple files.

#### Acceptance Criteria

1. THE chart-colors module SHALL export a `CATEGORY_COLORS` record mapping each Category_Enum value to a Semantic_Color_Token
2. THE chart-colors module SHALL export a `CATEGORY_LABELS` record mapping each Category_Enum value to a display label string
3. THE chart-colors module SHALL export a `CHART_COLORS` array containing the five semantic chart color tokens in order
4. THE key set of `CATEGORY_COLORS` SHALL equal the complete Category_Enum set: fuel, maintenance, financial, regulatory, enhancement, misc

### Requirement 12: Series Color Assignment

**User Story:** As a developer, I want a utility function that assigns chart colors to dynamic series keys, so that I do not have to manually pick colors for each chart.

#### Acceptance Criteria

1. WHEN `assignSeriesColors` is called with an array of keys, THE function SHALL return an array of the same length with each item containing the key and a color from CHART_COLORS
2. WHEN the number of keys exceeds the length of CHART_COLORS, THE function SHALL cycle through CHART_COLORS using modular indexing
3. THE `assignSeriesColors` function SHALL preserve the order of the input keys in the output array

### Requirement 13: Chart Config Builder

**User Story:** As a developer, I want a utility function that builds ChartConfig objects from series arrays, so that I do not have to manually construct config records.

#### Acceptance Criteria

1. WHEN `buildChartConfig` is called with a series array, THE function SHALL return a record where each series key maps to an object containing the label and color
2. THE `buildChartConfig` output SHALL contain exactly one entry per series item in the input array

### Requirement 14: Category Pie Data Builder

**User Story:** As a developer, I want a utility function that transforms category breakdown data into pie chart format with colors, labels, and percentages, so that pie charts across the app use consistent data preparation.

#### Acceptance Criteria

1. WHEN `buildCategoryPieData` is called with a breakdown array, THE function SHALL return items with color from CATEGORY_COLORS and label from CATEGORY_LABELS for each category
2. WHEN a breakdown item has an amount of zero, THE function SHALL exclude that item from the output
3. WHEN a `total` parameter is provided, THE function SHALL calculate percentages using that total
4. WHEN a `total` parameter is not provided, THE function SHALL compute the total as the sum of all amounts in the breakdown
5. THE sum of all percentage values in the output SHALL approximate 100 within floating-point tolerance

### Requirement 15: Category Color Fallback

**User Story:** As a developer, I want category color and label lookups to handle unknown keys gracefully, so that charts do not crash when unexpected data arrives.

#### Acceptance Criteria

1. IF a category key is not found in CATEGORY_COLORS, THEN THE chart-colors module SHALL fall back to `var(--primary)` for the color
2. IF a category key is not found in CATEGORY_LABELS, THEN THE chart-colors module SHALL fall back to the raw key string for the label

### Requirement 16: Incremental Migration Compatibility

**User Story:** As a developer, I want to migrate pages to the new components incrementally without breaking existing functionality, so that each migration phase can be validated independently.

#### Acceptance Criteria

1. WHEN new components are created in Phase 1, THE existing page components SHALL continue to function without modification
2. WHEN existing chart components (CategoryPieChart, ExpenseTrendChart, FuelEfficiencyTrendChart) are migrated in Phase 2, THE external API of those components SHALL remain unchanged
3. WHEN stat card consumers are migrated in Phases 3-4, THE visual output SHALL match the current rendering for each page
4. WHEN old stat-card.svelte and stat-card-dual.svelte are removed in Phase 8, THE removal SHALL only occur after all consumers have been migrated to the new StatCard

### Requirement 17: Accessibility

**User Story:** As a user relying on assistive technology, I want chart and stat card components to use proper semantic markup and ARIA attributes, so that I can understand the content.

#### Acceptance Criteria

1. THE ChartLegend SHALL use `role="list"` on the container and `role="listitem"` on each legend entry
2. THE StatCard SHALL use semantic heading or label elements for the metric label text
3. THE ChartCard SHALL include the chart title in an accessible heading element within Card.Header
