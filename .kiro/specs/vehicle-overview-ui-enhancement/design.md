D# Design Document

## Overview

This design document outlines the enhancement and standardization of the vehicle overview page to use shadcn/ui components throughout, while adding data visualizations to improve user understanding of vehicle expenses and statistics. The redesign will maintain all existing functionality while improving visual consistency, user experience, and information architecture.

### Goals

1. Replace all custom CSS card classes with shadcn/ui Card components
2. Standardize UI components across the entire page
3. Add meaningful data visualizations using existing D3.js charts
4. Improve information hierarchy and visual organization
5. Maintain responsive design across all device sizes
6. Preserve all existing functionality and data fetching logic

### Non-Goals

1. Changing the underlying data fetching or calculation logic
2. Modifying the tab structure or navigation
3. Altering the expense filtering functionality
4. Changing the backend API endpoints

## Architecture

### Component Structure

The vehicle overview page will maintain its current structure with enhanced UI components:

```
VehiclePage (+page.svelte)
├── Header Section (shadcn Card)
├── Tabs Component (existing shadcn Tabs)
│   ├── Overview Tab
│   │   ├── Period Selector (shadcn Select)
│   │   ├── Primary Stats Grid (shadcn Cards)
│   │   ├── Expense Trend Chart (new - D3.js in shadcn Card)
│   │   ├── Mileage & Fuel Statistics (shadcn Card with grid)
│   │   ├── Fuel Efficiency Chart (new - D3.js in shadcn Card)
│   │   ├── Category Breakdown Section
│   │   │   ├── Category Pie Chart (new - D3.js in shadcn Card)
│   │   │   └── Category Grid (shadcn Cards with Badges)
│   │   └── Vehicle Information (shadcn Card)
│   ├── Expenses Tab (existing)
│   ├── Reminders Tab (existing)
│   └── Finance Tab (existing)
└── Floating Action Button (existing)
```

### Technology Stack

- **UI Components**: shadcn/ui (Svelte 5 compatible)
- **Charts**: Layerchart (Svelte-native charting library built on D3)
- **State Management**: Svelte 5 runes ($state, $derived, $effect)
- **Styling**: Tailwind CSS with shadcn/ui design tokens

### Chart Library Decision

After evaluating options, we recommend **Layerchart** over the existing D3.js implementation:

**Why Layerchart?**
- Built specifically for Svelte (not a React port)
- Excellent Svelte 5 runes support
- Declarative, component-based API (more maintainable)
- Built on D3 under the hood (keeps the power, improves DX)
- Responsive by default
- Integrates well with shadcn/ui styling
- Will solve existing analytics page issues

**Alternatives Considered:**
- **Keep D3.js**: Powerful but requires manual DOM manipulation, harder to maintain, current analytics issues
- **shadcn/ui Charts**: React/Recharts-based, not Svelte-compatible
- **Chart.js + svelte-chartjs**: Good option but less flexible, wrapper adds complexity
- **Layerchart**: Best fit for Svelte 5 + modern development

This decision will also benefit the analytics page refactor mentioned by the user.

## Components and Interfaces

### 1. Primary Stats Cards

**Current Implementation**: Custom `.card-compact` class with manual styling

**New Implementation**: shadcn/ui Card components

```svelte
<Card class="hover:shadow-lg transition-shadow">
  <CardContent class="flex items-center justify-between p-6">
    <div class="space-y-1">
      <p class="text-sm font-medium text-muted-foreground">Total Expenses</p>
      <p class="text-2xl font-bold">{formatCurrency(vehicleStats.totalExpenses)}</p>
    </div>
    <DollarSign class="h-8 w-8 text-primary" />
  </CardContent>
</Card>
```

**Features**:
- Consistent padding and spacing using shadcn design tokens
- Hover effects for visual feedback
- Icon and text alignment using flexbox
- Responsive grid layout (1 col mobile, 2 cols tablet, 4 cols desktop)

### 2. Period Selector

**Current Implementation**: Native HTML `<select>` element

**New Implementation**: shadcn/ui Select component

```svelte
<Select bind:value={selectedStatsPeriod}>
  <SelectTrigger class="w-[180px]">
    <SelectValue placeholder="Select period" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="7d">Last 7 Days</SelectItem>
    <SelectItem value="30d">Last 30 Days</SelectItem>
    <SelectItem value="90d">Last 90 Days</SelectItem>
    <SelectItem value="1y">Last Year</SelectItem>
    <SelectItem value="all">All Time</SelectItem>
  </SelectContent>
</Select>
```

**Features**:
- Consistent styling with other form elements
- Better mobile experience
- Keyboard navigation support
- Clear visual feedback for selected state

### 3. Expense Trend Chart (New)

**Component**: New chart component using Layerchart

**Location**: `frontend/src/lib/components/charts/ExpenseTrendChart.svelte`

**Purpose**: Display expense trends over time based on selected period

```svelte
<script lang="ts">
  import { Chart, Svg, Area, Axis, Tooltip, LinearGradient } from 'layerchart';
  import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';
  
  interface Props {
    data: ExpenseTrendData[];
    period: string;
  }
  
  let { data, period }: Props = $props();
</script>

<Card>
  <CardHeader>
    <CardTitle>Expense Trends</CardTitle>
    <CardDescription>
      {period === 'all' ? 'All time' : `Last ${period}`}
    </CardDescription>
  </CardHeader>
  <CardContent>
    {#if data.length > 0}
      <Chart {data} x="date" y="amount" padding={{ left: 16, bottom: 24 }}>
        <Svg>
          <LinearGradient class="from-primary/50 to-primary/0" vertical let:url>
            <Area line={{ class: 'stroke-primary stroke-2' }} fill={url} />
          </LinearGradient>
          <Axis placement="bottom" format="short" />
          <Axis placement="left" format="currency" />
        </Svg>
        <Tooltip header={(data) => formatDate(data.date)} let:data>
          <div class="text-sm">
            <div class="font-semibold">{formatCurrency(data.amount)}</div>
            <div class="text-muted-foreground">{data.count} expenses</div>
          </div>
        </Tooltip>
      </Chart>
    {:else}
      <div class="flex items-center justify-center h-[300px] text-muted-foreground">
        <div class="text-center">
          <p>No expense data available</p>
          <p class="text-sm">Add expenses to see trends</p>
        </div>
      </div>
    {/if}
  </CardContent>
</Card>
```

**Data Structure**:
```typescript
interface ExpenseTrendData {
  date: Date;
  amount: number;
  count: number;
}
```

**Chart Type**: Area chart with line showing monthly/weekly expense totals

**Features**:
- Responsive width (Layerchart handles automatically)
- Interactive tooltips showing date, amount, and expense count
- Smooth gradient fill
- Automatic axis scaling
- Empty state when insufficient data
- Currency formatting on Y-axis

### 4. Mileage & Fuel Statistics Section

**Current Implementation**: Custom card with colored background boxes

**New Implementation**: shadcn Card with consistent stat items

```svelte
<Card>
  <CardHeader>
    <CardTitle class="flex items-center gap-2">
      <Gauge class="h-5 w-5" />
      Mileage & Fuel Statistics
    </CardTitle>
  </CardHeader>
  <CardContent>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {#each statItems as stat}
        <div class="flex flex-col space-y-1 p-4 rounded-lg border bg-card">
          <span class="text-sm font-medium text-muted-foreground">{stat.label}</span>
          <span class="text-2xl font-bold">{stat.value}</span>
          <span class="text-xs text-muted-foreground">{stat.unit}</span>
        </div>
      {/each}
    </div>
  </CardContent>
</Card>
```

**Features**:
- Consistent border and background using shadcn design tokens
- Responsive grid layout
- Clear visual hierarchy with typography
- Conditional rendering based on fuel type (gas vs electric)

### 5. Fuel Efficiency Chart (New)

**Component**: New chart component using Layerchart

**Location**: `frontend/src/lib/components/charts/FuelEfficiencyTrendChart.svelte`

**Purpose**: Display fuel efficiency (MPG or mi/kWh) trends over time

```svelte
<script lang="ts">
  import { Chart, Svg, Line, Axis, Tooltip, Highlight } from 'layerchart';
  import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';
  
  interface Props {
    data: FuelEfficiencyData[];
    fuelType: 'gas' | 'diesel' | 'electric' | 'hybrid';
  }
  
  let { data, fuelType }: Props = $props();
  
  let efficiencyLabel = $derived(
    fuelType === 'electric' ? 'mi/kWh' : 'MPG'
  );
</script>

<Card>
  <CardHeader>
    <CardTitle>Fuel Efficiency Trends</CardTitle>
    <CardDescription>
      {fuelType === 'electric' ? 'Miles per kWh' : 'Miles per gallon'}
    </CardDescription>
  </CardHeader>
  <CardContent>
    {#if data.length >= 2}
      <Chart {data} x="date" y="efficiency" padding={{ left: 16, bottom: 24 }}>
        <Svg>
          <Line class="stroke-green-600 stroke-2" />
          <Axis placement="bottom" format="short" />
          <Axis placement="left" label={efficiencyLabel} />
          <Highlight points lines />
        </Svg>
        <Tooltip header={(data) => formatDate(data.date)} let:data>
          <div class="text-sm">
            <div class="font-semibold">{data.efficiency.toFixed(1)} {efficiencyLabel}</div>
            <div class="text-muted-foreground">{data.mileage.toLocaleString()} miles</div>
          </div>
        </Tooltip>
      </Chart>
    {:else}
      <div class="flex items-center justify-center h-[300px] text-muted-foreground">
        <div class="text-center">
          <p>Insufficient fuel data</p>
          <p class="text-sm">Add at least 2 fuel entries with mileage</p>
        </div>
      </div>
    {/if}
  </CardContent>
</Card>
```

**Data Structure**:
```typescript
interface FuelEfficiencyData {
  date: Date;
  efficiency: number; // MPG or mi/kWh
  mileage: number;
}
```

**Chart Type**: Line chart showing efficiency over time

**Features**:
- Different labels based on fuel type
- Interactive tooltips showing date, efficiency, and mileage
- Highlight on hover for better UX
- Empty state when insufficient fuel data (< 2 entries)
- Automatic axis scaling
- Green color to indicate "efficiency"

### 6. Category Breakdown Section

**Current Implementation**: Grid of colored boxes with icons

**New Implementation**: Pie chart + enhanced grid with shadcn components

#### Category Pie Chart (New)

```svelte
<script lang="ts">
  import { Chart, Svg, Pie, Tooltip } from 'layerchart';
  import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '$lib/components/ui/card';
  
  interface Props {
    data: CategoryChartData[];
  }
  
  let { data }: Props = $props();
</script>

<Card>
  <CardHeader>
    <CardTitle>Expense Distribution</CardTitle>
    <CardDescription>Breakdown by category</CardDescription>
  </CardHeader>
  <CardContent class="flex flex-col lg:flex-row gap-6">
    <!-- Pie Chart -->
    <div class="flex-1">
      {#if data.length > 0}
        <Chart {data} r="amount" class="h-[300px]">
          <Svg>
            <Pie 
              innerRadius={60} 
              padAngle={2}
              cornerRadius={4}
            />
          </Svg>
          <Tooltip let:data>
            <div class="text-sm">
              <div class="font-semibold">{data.name}</div>
              <div>{formatCurrency(data.amount)}</div>
              <div class="text-muted-foreground">{data.percentage.toFixed(1)}%</div>
            </div>
          </Tooltip>
        </Chart>
      {/if}
    </div>
    
    <!-- Legend/Summary -->
    <div class="flex-1 space-y-2">
      {#each data as category}
        <div class="flex items-center justify-between p-2 rounded-lg hover:bg-accent transition-colors">
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full" style="background-color: {category.color}"></div>
            <span class="text-sm font-medium">{category.name}</span>
          </div>
          <div class="text-right">
            <div class="text-sm font-bold">{formatCurrency(category.amount)}</div>
            <div class="text-xs text-muted-foreground">{category.percentage.toFixed(1)}%</div>
          </div>
        </div>
      {/each}
    </div>
  </CardContent>
</Card>
```

#### Category Grid

```svelte
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
  {#each Object.entries(vehicleStats.expensesByCategory) as [category, amount]}
    <Card class="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent class="flex flex-col items-center p-4 space-y-2">
        <div class="p-2 rounded-lg {getCategoryColor(category)}">
          <svelte:component this={getCategoryIcon(category)} class="h-4 w-4" />
        </div>
        <Badge variant="secondary" class="text-xs">
          {formatCategoryName(category)}
        </Badge>
        <span class="text-sm font-bold">{formatCurrency(amount)}</span>
      </CardContent>
    </Card>
  {/each}
</div>
```

**Features**:
- Interactive pie chart with hover effects
- Side-by-side layout on desktop, stacked on mobile
- Category legend with color indicators
- Grid view for quick scanning
- Badge components for category labels
- Hover effects on cards

### 7. Vehicle Information Section

**Current Implementation**: Custom card with grid layout

**New Implementation**: shadcn Card with improved typography

```svelte
<Card>
  <CardHeader>
    <CardTitle class="flex items-center gap-2">
      <Car class="h-5 w-5" />
      Vehicle Information
    </CardTitle>
  </CardHeader>
  <CardContent>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
      {#each vehicleInfoItems as item}
        <div class="space-y-1">
          <p class="text-sm font-medium text-muted-foreground">{item.label}</p>
          <p class="text-base font-semibold">{item.value}</p>
        </div>
      {/each}
    </div>
  </CardContent>
</Card>
```

**Features**:
- Consistent spacing and typography
- Clear label/value hierarchy
- Responsive grid layout
- Conditional rendering of optional fields

### 8. Loading States

**Implementation**: shadcn Skeleton components

```svelte
{#if isLoading}
  <div class="space-y-6">
    <!-- Stats Grid Skeleton -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {#each Array(4) as _}
        <Card>
          <CardContent class="p-6">
            <Skeleton class="h-4 w-24 mb-2" />
            <Skeleton class="h-8 w-32" />
          </CardContent>
        </Card>
      {/each}
    </div>
    
    <!-- Chart Skeleton -->
    <Card>
      <CardHeader>
        <Skeleton class="h-6 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton class="h-[300px] w-full" />
      </CardContent>
    </Card>
  </div>
{:else}
  <!-- Actual content -->
{/if}
```

### 9. Empty States

**Implementation**: shadcn Empty component or Alert

```svelte
{#if expenses.length === 0}
  <Card>
    <CardContent class="flex flex-col items-center justify-center py-12">
      <FileText class="h-12 w-12 text-muted-foreground mb-4" />
      <h3 class="text-lg font-semibold mb-2">No expenses yet</h3>
      <p class="text-muted-foreground text-center mb-4">
        Start tracking expenses for this vehicle
      </p>
      <Button href="/expenses/new?vehicleId={vehicleId}">
        <Plus class="h-4 w-4 mr-2" />
        Add Expense
      </Button>
    </CardContent>
  </Card>
{/if}
```

## Data Models

### Chart Data Preparation

#### Expense Trend Data

```typescript
function prepareExpenseTrendData(
  expenses: Expense[], 
  period: '7d' | '30d' | '90d' | '1y' | 'all'
): ExpenseTrendData[] {
  // Filter expenses based on period
  const filteredExpenses = filterByPeriod(expenses, period);
  
  // Group by month or week depending on period
  const grouping = period === '7d' || period === '30d' ? 'week' : 'month';
  
  // Aggregate expenses
  const grouped = groupExpensesByPeriod(filteredExpenses, grouping);
  
  return grouped.map(group => ({
    period: group.period,
    amount: group.total,
    count: group.count
  }));
}
```

#### Fuel Efficiency Data

```typescript
function prepareFuelEfficiencyData(expenses: Expense[]): FuelEfficiencyData[] {
  const fuelExpenses = expenses
    .filter(e => e.category === 'fuel' && e.mileage)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  const efficiencyData: FuelEfficiencyData[] = [];
  
  for (let i = 1; i < fuelExpenses.length; i++) {
    const current = fuelExpenses[i];
    const previous = fuelExpenses[i - 1];
    
    if (current.mileage && previous.mileage) {
      const miles = current.mileage - previous.mileage;
      const efficiency = current.volume 
        ? miles / current.volume  // MPG
        : miles / (current.charge || 1);  // mi/kWh
      
      if (efficiency > 0 && efficiency < 100) {
        efficiencyData.push({
          date: new Date(current.date),
          efficiency,
          mileage: current.mileage
        });
      }
    }
  }
  
  return efficiencyData;
}
```

#### Category Chart Data

```typescript
function prepareCategoryChartData(
  expensesByCategory: Record<string, number>
): CategoryChartData[] {
  const total = Object.values(expensesByCategory).reduce((sum, amt) => sum + amt, 0);
  const colors = getCategoryColors();
  
  return Object.entries(expensesByCategory).map(([category, amount]) => ({
    category,
    name: formatCategoryName(category),
    amount,
    percentage: (amount / total) * 100,
    color: colors[category]
  }));
}
```

## Error Handling

### Chart Rendering Errors

```typescript
$effect(() => {
  try {
    if (chartContainer && chartData.length > 0) {
      renderChart();
    }
  } catch (error) {
    console.error('Chart rendering error:', error);
    appStore.addNotification({
      type: 'error',
      message: 'Failed to render chart'
    });
  }
});
```

### Data Loading Errors

```typescript
async function loadVehicleStats() {
  try {
    const response = await fetch(`/api/vehicles/${vehicleId}/stats?period=${selectedStatsPeriod}`);
    
    if (!response.ok) {
      throw new Error('Failed to load stats');
    }
    
    const result = await response.json();
    vehicleStatsData = result.data;
  } catch (error) {
    console.error('Error loading vehicle stats:', error);
    // Show error state in UI
    statsError = true;
  }
}
```

### Empty Data Handling

- Charts with insufficient data (< 2 data points) show empty state message
- Empty states use shadcn Alert or Card with centered content
- Clear messaging about why data is not available
- Action buttons to add data when appropriate

## Testing Strategy

### Component Testing

1. **Visual Regression Testing**
   - Capture screenshots of each card component
   - Test responsive breakpoints (mobile, tablet, desktop)
   - Verify shadcn component styling consistency

2. **Interaction Testing**
   - Period selector changes update charts
   - Hover states on cards and charts
   - Chart tooltips display correct data
   - Empty states render correctly

3. **Data Testing**
   - Chart data preparation functions
   - Edge cases (no data, single data point, large datasets)
   - Date range filtering
   - Category aggregation

### Integration Testing

1. **Data Flow**
   - Verify expense data loads correctly
   - Stats calculations remain accurate
   - Period selector updates all dependent components
   - Charts update when data changes

2. **Responsive Design**
   - Test all breakpoints
   - Verify grid layouts adapt correctly
   - Charts remain readable on mobile
   - Touch interactions work on mobile devices

### Accessibility Testing

1. **Keyboard Navigation**
   - All interactive elements accessible via keyboard
   - Focus indicators visible
   - Tab order logical

2. **Screen Readers**
   - Chart data accessible via ARIA labels
   - Card content properly structured
   - Empty states have descriptive text

3. **Color Contrast**
   - All text meets WCAG AA standards
   - Chart colors distinguishable
   - Icons have sufficient contrast

## Implementation Notes

### Svelte 5 Runes Usage

- Use `$state()` for reactive variables
- Use `$derived()` for computed values
- Use `$effect()` for side effects (chart rendering, data fetching)
- Avoid legacy `$:` reactive statements

### shadcn/ui Component Imports

```typescript
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '$lib/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '$lib/components/ui/select';
import { Badge } from '$lib/components/ui/badge';
import { Skeleton } from '$lib/components/ui/skeleton';
import { Button } from '$lib/components/ui/button';
```

### Chart Component Pattern with Layerchart

```svelte
<script lang="ts">
  import { Chart, Svg, Line, Area, Axis, Tooltip } from 'layerchart';
  
  interface Props {
    data: ChartData[];
    type?: 'line' | 'area';
  }
  
  let { data, type = 'line' }: Props = $props();
</script>

{#if data.length > 0}
  <Chart {data} x="date" y="value" padding={{ left: 16, bottom: 24 }}>
    <Svg>
      {#if type === 'area'}
        <Area line={{ class: 'stroke-primary stroke-2' }} class="fill-primary/20" />
      {:else}
        <Line class="stroke-primary stroke-2" />
      {/if}
      <Axis placement="bottom" format="short" />
      <Axis placement="left" />
    </Svg>
    <Tooltip let:data>
      <div class="text-sm">
        <div class="font-semibold">{data.label}</div>
        <div>{data.value}</div>
      </div>
    </Tooltip>
  </Chart>
{:else}
  <div class="flex items-center justify-center h-[300px] text-muted-foreground">
    <p>No data available</p>
  </div>
{/if}
```

**Benefits of Layerchart Pattern:**
- No manual DOM manipulation
- Declarative component-based API
- Automatic reactivity with Svelte 5 runes
- No need for onMount/onDestroy lifecycle hooks
- Built-in responsive behavior
- Cleaner, more maintainable code

### Responsive Grid Classes

```html
<!-- Stats Grid: 1 col mobile, 2 cols tablet, 4 cols desktop -->
<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">

<!-- Category Grid: 2 cols mobile, 3 cols tablet, 6 cols desktop -->
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

<!-- Mileage Stats: 1 col mobile, 2 cols tablet, 4 cols desktop -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
```

### Color Scheme

Use shadcn design tokens for consistency:

```typescript
const categoryColors = {
  fuel: 'text-blue-600 bg-blue-50 border-blue-200',
  maintenance: 'text-orange-600 bg-orange-50 border-orange-200',
  financial: 'text-green-600 bg-green-50 border-green-200',
  regulatory: 'text-purple-600 bg-purple-50 border-purple-200',
  enhancement: 'text-pink-600 bg-pink-50 border-pink-200',
  misc: 'text-gray-600 bg-gray-50 border-gray-200'
};
```

## Migration Strategy

### Phase 1: Component Replacement
1. Replace primary stats cards with shadcn Card
2. Replace period selector with shadcn Select
3. Update mileage & fuel statistics section
4. Update category grid with shadcn Cards and Badges
5. Update vehicle information section

### Phase 2: Add Visualizations
1. Create ExpenseTrendChart component
2. Create FuelEfficiencyTrendChart component
3. Create CategoryPieChart component
4. Integrate charts into overview tab

### Phase 3: Polish
1. Add loading skeletons
2. Improve empty states
3. Add error handling
4. Test responsive design
5. Accessibility audit

### Phase 4: Validation
1. Run frontend validation (`npm run validate`)
2. Fix any linting or type errors
3. Test all functionality
4. Visual QA across devices

## Design Decisions

### Why shadcn/ui?

- Already used throughout the application
- Provides consistent design language
- Built on Radix UI primitives (accessible)
- Customizable with Tailwind CSS
- Svelte 5 compatible

### Why Keep D3.js?

- Already integrated in the project
- Powerful and flexible for custom charts
- Good performance with large datasets
- Existing chart utilities can be reused
- Team familiarity

### Why Not Use shadcn Charts?

- shadcn charts are React/Recharts based (TypeScript/TSX examples)
- Would require significant adaptation for Svelte
- D3.js provides more control and customization
- Existing D3 implementation is working well

### Layout Decisions

- **Stats Grid**: 4 columns on desktop for quick scanning
- **Charts**: Full-width for better data visibility
- **Category Grid**: 6 columns on desktop to show all categories at once
- **Mobile**: Single column for readability, charts remain full-width

## Future Enhancements

1. **Interactive Charts**: Click on chart elements to filter expenses
2. **Chart Export**: Download charts as images
3. **Comparison Mode**: Compare multiple time periods side-by-side
4. **Predictive Analytics**: Show projected expenses based on trends
5. **Custom Date Ranges**: Allow users to select custom date ranges
6. **Chart Preferences**: Remember user's preferred chart types


## Design Decisions

### Why shadcn/ui?

- Already used throughout the application
- Provides consistent design language
- Built on Radix UI primitives (accessible)
- Customizable with Tailwind CSS
- Svelte 5 compatible

### Why Layerchart Over D3.js?

**Current D3.js Issues:**
- Requires manual DOM manipulation
- More complex to maintain
- Lifecycle management needed (onMount/onDestroy)
- Not declarative (doesn't fit Svelte's paradigm)
- Current analytics page has rendering issues
- Harder to debug and test

**Layerchart Benefits:**
- Built specifically for Svelte (declarative, component-based)
- Still uses D3 under the hood (keeps the power)
- Automatic reactivity with Svelte 5 runes
- No lifecycle management needed
- Better developer experience
- Easier to maintain and debug
- Will solve analytics page issues
- Active development and good documentation

**This decision will also benefit the future analytics page refactor.**

### Why Not shadcn Charts or Recharts?

- shadcn charts are React/Recharts based (TypeScript/TSX examples)
- Recharts is React-specific, not compatible with Svelte
- Would require significant adaptation or wrappers
- Not officially supported for Svelte
- Layerchart provides better Svelte integration

### Layout Decisions

- **Stats Grid**: 4 columns on desktop for quick scanning
- **Charts**: Full-width for better data visibility
- **Category Grid**: 6 columns on desktop to show all categories at once
- **Mobile**: Single column for readability, charts remain full-width
- **Chart Height**: 300px default for consistency

## Future Enhancements

1. **Interactive Charts**: Click on chart elements to filter expenses
2. **Chart Export**: Download charts as images
3. **Comparison Mode**: Compare multiple time periods side-by-side
4. **Predictive Analytics**: Show projected expenses based on trends
5. **Custom Date Ranges**: Allow users to select custom date ranges
6. **Chart Preferences**: Remember user's preferred chart types
7. **Analytics Page Refactor**: Apply same Layerchart approach to analytics page
