# Design Document

## Overview

This design document outlines the implementation approach for enhancing the vehicle overview page with additional analytics charts. The solution leverages the existing LayerChart library (used by shadcn-svelte charts) and follows established patterns from existing chart components. The enhancement includes reordering existing charts and adding three new chart types: mileage per month bar chart, total odometer line chart, and fuel consumption/cost overlay chart.

## Architecture

### Component Structure

The solution follows the existing chart component architecture:

```
frontend/src/lib/components/charts/
├── CategoryPieChart.svelte (existing - will be reordered)
├── ExpenseTrendChart.svelte (existing)
├── FuelEfficiencyTrendChart.svelte (existing)
├── MileagePerMonthChart.svelte (new)
├── OdometerHistoryChart.svelte (new)
└── FuelConsumptionCostChart.svelte (new)
```

### Data Flow

```
Vehicle Page ([id]/+page.svelte)
    ↓
Expense Data (from API)
    ↓
Data Preparation Functions (expense-helpers.ts)
    ↓
Chart Components (Svelte components)
    ↓
LayerChart Library (BarChart, LineChart, AreaChart)
```

### Technology Stack

- **Chart Library**: LayerChart (via shadcn-svelte chart components)
- **Scaling**: d3-scale (scaleTime, scaleLinear, scaleBand)
- **UI Components**: shadcn-svelte (Card, Skeleton, EmptyState)
- **State Management**: Svelte 5 runes ($state, $derived)

## Components and Interfaces

### 1. MileagePerMonthChart Component

**Purpose**: Display monthly mileage driven as a bar chart

**Props Interface**:
```typescript
interface Props {
  data: MileagePerMonthData[];
  period: TimePeriod;
  isLoading?: boolean;
  error?: string | null;
}

interface MileagePerMonthData {
  month: Date;        // First day of the month
  miles: number;      // Miles driven in that month
  startMileage: number;  // Starting odometer reading
  endMileage: number;    // Ending odometer reading
}
```

**Chart Configuration**:
- Chart Type: BarChart from LayerChart
- Height: 280px (consistent with other charts)
- X-axis: Month labels (e.g., "Jan 2024")
- Y-axis: Miles driven
- Color: Primary theme color
- Tooltip: Shows month, miles driven, and odometer range

**Empty State Conditions**:
- Fewer than 2 mileage entries
- No mileage data in selected period

### 2. OdometerHistoryChart Component

**Purpose**: Display cumulative odometer readings over time as a line chart

**Props Interface**:
```typescript
interface Props {
  data: OdometerData[];
  period: TimePeriod;
  distanceUnit: DistanceUnit;
  isLoading?: boolean;
  error?: string | null;
}

interface OdometerData {
  date: Date;
  mileage: number;
}
```

**Chart Configuration**:
- Chart Type: LineChart from LayerChart
- Height: 280px
- X-axis: Date (time scale)
- Y-axis: Odometer reading with unit label
- Color: Blue theme color
- Line Style: Smooth curve with data points
- Tooltip: Shows date and exact odometer reading

**Empty State Conditions**:
- Fewer than 2 mileage entries
- No mileage data in selected period

### 3. FuelConsumptionCostChart Component

**Purpose**: Display fuel consumption and cost as an overlay chart with dual y-axes

**Props Interface**:
```typescript
interface Props {
  data: FuelConsumptionCostData[];
  period: TimePeriod;
  vehicleType: VehicleType;
  volumeUnit: VolumeUnit;
  isLoading?: boolean;
  error?: string | null;
}

interface FuelConsumptionCostData {
  date: Date;
  volume: number;      // Fuel volume (gallons/liters) or charge (kWh)
  cost: number;        // Total cost
  count: number;       // Number of fuel entries
}
```

**Chart Configuration**:
- Chart Type: Dual-axis chart using LayerChart
- Height: 280px
- X-axis: Date (time scale)
- Left Y-axis: Fuel volume/charge
- Right Y-axis: Cost
- Colors: Green for volume, Orange for cost
- Tooltip: Shows date, volume, and cost

**Special Handling**:
- Electric vehicles: Display kWh instead of gallons/liters
- Hybrid vehicles: Combine both fuel and charge data
- Grouping: Aggregate by week or month based on period

**Empty State Conditions**:
- Fewer than 2 fuel entries
- No fuel data in selected period

## Data Models

### Data Preparation Functions

New functions to be added to `frontend/src/lib/utils/expense-helpers.ts`:

```typescript
/**
 * Prepare mileage per month data for bar chart
 * Groups expenses by month and calculates miles driven
 */
export function prepareMileagePerMonthData(
  expenses: Expense[],
  period: TimePeriod
): MileagePerMonthData[];

/**
 * Prepare odometer history data for line chart
 * Extracts mileage readings and deduplicates by date
 */
export function prepareOdometerData(
  expenses: Expense[],
  period: TimePeriod
): OdometerData[];

/**
 * Prepare fuel consumption and cost data for overlay chart
 * Groups fuel expenses by time period and aggregates volume and cost
 */
export function prepareFuelConsumptionCostData(
  expenses: Expense[],
  period: TimePeriod
): FuelConsumptionCostData[];

/**
 * Group expenses by month
 * Helper function for monthly aggregation
 */
function groupExpensesByMonth(expenses: Expense[]): Map<string, Expense[]>;

/**
 * Calculate mileage driven in a month
 * Uses min and max mileage values within the month
 */
function calculateMonthlyMileage(expenses: Expense[]): number;
```

### Data Validation

**Mileage Data Validation**:
- Mileage values must be positive
- Mileage must increase over time (or stay the same)
- Maximum reasonable monthly mileage: 5,000 miles
- Minimum reasonable monthly mileage: 0 miles

**Fuel Data Validation**:
- Volume/charge must be positive
- Cost must be positive
- Use existing validation constants from expense-helpers.ts

## Error Handling

### Component-Level Error Handling

Each chart component will handle errors gracefully:

1. **Loading State**: Display skeleton loader while data is being prepared
2. **Empty State**: Show informative message when insufficient data
3. **Error State**: Display error message if data preparation fails
4. **Fallback**: Never break page layout, always render card container

### Error Messages

```typescript
const ERROR_MESSAGES = {
  INSUFFICIENT_MILEAGE_DATA: 'Add at least 2 expenses with mileage to see this chart',
  INSUFFICIENT_FUEL_DATA: 'Add at least 2 fuel expenses to see this chart',
  NO_DATA_IN_PERIOD: 'No data available for the selected period',
  CALCULATION_ERROR: 'Unable to calculate chart data',
  RENDER_ERROR: 'Failed to render chart'
};
```

### Data Preparation Error Handling

```typescript
try {
  const chartData = prepareChartData(expenses, period);
  if (chartData.length < MIN_DATA_POINTS) {
    return { data: [], error: ERROR_MESSAGES.INSUFFICIENT_DATA };
  }
  return { data: chartData, error: null };
} catch (error) {
  console.error('Chart data preparation failed:', error);
  return { data: [], error: ERROR_MESSAGES.CALCULATION_ERROR };
}
```

## Testing Strategy

### Unit Tests

**Data Preparation Functions** (`expense-helpers.test.ts`):
- Test `prepareMileagePerMonthData` with various expense patterns
- Test `prepareOdometerData` with duplicate dates and gaps
- Test `prepareFuelConsumptionCostData` with mixed fuel types
- Test edge cases: empty data, single entry, invalid values
- Test period filtering: 7d, 30d, 90d, 1y, all

**Test Cases**:
```typescript
describe('prepareMileagePerMonthData', () => {
  it('should calculate monthly mileage correctly', () => {});
  it('should handle single month data', () => {});
  it('should handle gaps in data', () => {});
  it('should filter by period', () => {});
  it('should return empty array for insufficient data', () => {});
  it('should handle invalid mileage values', () => {});
});

describe('prepareOdometerData', () => {
  it('should extract odometer readings', () => {});
  it('should deduplicate same-day entries', () => {});
  it('should sort by date', () => {});
  it('should filter by period', () => {});
});

describe('prepareFuelConsumptionCostData', () => {
  it('should aggregate fuel volume and cost', () => {});
  it('should handle electric vehicle data', () => {});
  it('should handle hybrid vehicle data', () => {});
  it('should group by appropriate time period', () => {});
});
```

### Component Tests

**Chart Component Tests** (`__tests__/ChartComponents.test.ts`):
- Test rendering with valid data
- Test loading state
- Test empty state
- Test error state
- Test period filter changes
- Test responsive behavior

### Integration Tests

**Vehicle Page Tests** (`vehicles/[id]/+page.test.ts`):
- Test chart visibility based on data availability
- Test chart reordering (pie chart first)
- Test period selector interaction
- Test chart updates when expenses change

### Manual Testing Checklist

- [ ] Charts render correctly on desktop (1920x1080)
- [ ] Charts render correctly on tablet (768x1024)
- [ ] Charts render correctly on mobile (375x667)
- [ ] Charts update when period filter changes
- [ ] Tooltips display correct information
- [ ] Empty states show appropriate messages
- [ ] Loading states display skeleton loaders
- [ ] Charts maintain layout when errors occur
- [ ] Accessibility: keyboard navigation works
- [ ] Accessibility: screen readers announce chart data

## Layout and Responsive Design

### Chart Grid Layout

**Desktop (lg and above)**:
```
┌─────────────────────────────────────┐
│     Category Pie Chart (full)      │
├──────────────────┬──────────────────┤
│  Expense Trend   │ Fuel Efficiency  │
├──────────────────┼──────────────────┤
│ Mileage/Month    │ Odometer History │
├──────────────────┴──────────────────┤
│   Fuel Consumption & Cost (full)   │
└─────────────────────────────────────┘
```

**Tablet (md)**:
```
┌─────────────────────────────────────┐
│     Category Pie Chart (full)      │
├──────────────────┬──────────────────┤
│  Expense Trend   │ Fuel Efficiency  │
├──────────────────┴──────────────────┤
│      Mileage Per Month (full)      │
├─────────────────────────────────────┤
│      Odometer History (full)       │
├─────────────────────────────────────┤
│   Fuel Consumption & Cost (full)   │
└─────────────────────────────────────┘
```

**Mobile (sm and below)**:
```
┌─────────────────────────────────────┐
│     Category Pie Chart (full)      │
├─────────────────────────────────────┤
│      Expense Trend (full)          │
├─────────────────────────────────────┤
│     Fuel Efficiency (full)         │
├─────────────────────────────────────┤
│    Mileage Per Month (full)        │
├─────────────────────────────────────┤
│     Odometer History (full)        │
├─────────────────────────────────────┤
│  Fuel Consumption & Cost (full)    │
└─────────────────────────────────────┘
```

### Implementation

```svelte
<!-- Category Pie Chart - First -->
{#if categoryChartData.length > 0}
  <CategoryPieChart data={categoryChartData} isLoading={isLoadingStats} />
{/if}

<!-- Existing Charts - Side by Side on Desktop -->
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <ExpenseTrendChart ... />
  {#if fuelEfficiencyData.length >= 2}
    <FuelEfficiencyTrendChart ... />
  {/if}
</div>

<!-- New Charts - Mileage and Odometer -->
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  {#if mileagePerMonthData.length > 0}
    <MileagePerMonthChart ... />
  {/if}
  {#if odometerData.length >= 2}
    <OdometerHistoryChart ... />
  {/if}
</div>

<!-- Fuel Consumption & Cost - Full Width -->
{#if fuelConsumptionCostData.length >= 2}
  <FuelConsumptionCostChart ... />
{/if}
```

## Performance Considerations

### Data Preparation Optimization

1. **Memoization**: Use Svelte's `$derived` for chart data preparation
2. **Filtering**: Filter expenses by period before processing
3. **Aggregation**: Limit data points to reasonable numbers (max 100 per chart)
4. **Lazy Loading**: Only prepare data for visible charts

### Chart Rendering Optimization

1. **Skeleton Loaders**: Show immediately while data loads
2. **Debouncing**: Debounce period filter changes (300ms)
3. **Virtual Scrolling**: Not needed for current chart count
4. **Code Splitting**: Charts are already in separate components

### Performance Targets

- Initial page load: < 2 seconds
- Period filter change: < 500ms
- Chart render time: < 200ms per chart
- Memory usage: < 50MB for chart data

## Accessibility

### ARIA Labels

```svelte
<Card.Root role="region" aria-label="Mileage per month chart">
  <Card.Header>
    <Card.Title id="mileage-chart-title">Mileage Per Month</Card.Title>
    <Card.Description id="mileage-chart-desc">
      Monthly driving distance
    </Card.Description>
  </Card.Header>
  <Card.Content aria-labelledby="mileage-chart-title" aria-describedby="mileage-chart-desc">
    <!-- Chart content -->
  </Card.Content>
</Card.Root>
```

### Keyboard Navigation

- Charts are not interactive beyond tooltips
- Period selector is keyboard accessible (existing)
- Focus management follows existing patterns

### Screen Reader Support

- Chart titles and descriptions are announced
- Empty states provide clear feedback
- Loading states announce "Loading chart data"
- Error states announce error messages

### Color Contrast

- All chart colors meet WCAG AA standards (4.5:1 ratio)
- Use existing theme colors from shadcn-svelte
- Provide text labels in addition to colors

## Additional Chart Recommendations

Based on the available data, here are additional charts that could be valuable:

### 1. Cost Per Mile Trend Chart
**Data Available**: Yes (mileage and expenses)
**Value**: Shows efficiency of vehicle operation over time
**Implementation Complexity**: Medium
**Priority**: High

### 2. Maintenance Cost Trend Chart
**Data Available**: Yes (maintenance category expenses)
**Value**: Helps predict maintenance needs and budget
**Implementation Complexity**: Low
**Priority**: Medium

### 3. Expense Category Trend (Stacked Area)
**Data Available**: Yes (all expenses with categories)
**Value**: Shows how expense composition changes over time
**Implementation Complexity**: High
**Priority**: Low

### 4. Fuel Price Per Unit Trend
**Data Available**: Yes (fuel cost and volume)
**Value**: Tracks fuel price changes over time
**Implementation Complexity**: Medium
**Priority**: Medium

### 5. Monthly Budget vs Actual
**Data Available**: Partial (would need budget feature)
**Value**: Helps with expense planning
**Implementation Complexity**: High (requires new feature)
**Priority**: Low (future enhancement)

### Recommendation Priority

For this implementation phase:
1. **Include**: Mileage per month, Odometer history, Fuel consumption/cost
2. **Future Phase 1**: Cost per mile trend, Maintenance cost trend
3. **Future Phase 2**: Expense category trend, Fuel price trend
4. **Future Phase 3**: Budget comparison (requires new feature)

## Design Decisions and Rationales

### Decision 1: Use LayerChart Instead of D3 Directly

**Rationale**:
- Consistency with existing charts
- Better integration with shadcn-svelte
- Simpler component code
- Built-in responsive behavior
- Maintained by shadcn-svelte team

### Decision 2: Reorder Charts (Pie Chart First)

**Rationale**:
- Pie chart provides immediate overview of expense distribution
- Users want to see "where their money goes" first
- Trend charts are more detailed and come second
- Follows F-pattern reading behavior

### Decision 3: Separate Components for Each Chart

**Rationale**:
- Easier to maintain and test
- Can be reused in other contexts
- Clear separation of concerns
- Follows existing architecture
- Easier to add/remove charts

### Decision 4: Use Derived State for Chart Data

**Rationale**:
- Automatic reactivity with Svelte 5 runes
- No manual subscription management
- Efficient recalculation only when dependencies change
- Clean and readable code

### Decision 5: Aggregate Data by Time Period

**Rationale**:
- Prevents chart overcrowding with too many data points
- Improves performance for users with many expenses
- Makes trends more visible
- Follows industry best practices

### Decision 6: Show Empty States Instead of Hiding Charts

**Rationale**:
- Users know the feature exists
- Provides guidance on what data is needed
- Maintains consistent layout
- Encourages data entry

## Migration and Rollout

### Phase 1: Core Implementation
1. Create data preparation functions
2. Build chart components
3. Update vehicle page layout
4. Add unit tests

### Phase 2: Polish and Testing
1. Add loading states
2. Add error handling
3. Test responsive behavior
4. Accessibility audit

### Phase 3: Documentation and Deployment
1. Update component documentation
2. Add user guide for new charts
3. Deploy to staging
4. User acceptance testing
5. Deploy to production

### Rollback Plan

If issues are discovered:
1. Feature flag to disable new charts
2. Revert to previous layout
3. Keep data preparation functions (no data loss)
4. Fix issues and redeploy

## Future Enhancements

1. **Export Charts**: Allow users to download charts as images
2. **Chart Customization**: Let users choose which charts to display
3. **Comparison Mode**: Compare multiple time periods
4. **Annotations**: Add notes to specific data points
5. **Predictive Analytics**: Show projected trends
6. **Multi-Vehicle Comparison**: Compare metrics across vehicles
