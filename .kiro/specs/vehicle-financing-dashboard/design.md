# Design Document

## Overview

The vehicle financing dashboard will transform the existing basic financing tab into a comprehensive, visually rich interface that provides users with deep insights into their vehicle loans or leases. The design leverages shadcn/ui components, particularly the chart library, to create interactive visualizations. The dashboard will be organized into logical sections with a responsive grid layout that adapts to different screen sizes.

## Architecture

### Component Structure

```
FinancingTab (TabsContent)
├── FinancingSummaryHeader (New Component)
│   ├── Progress Bar (shadcn Progress)
│   └── Key Metrics Cards (shadcn Card)
├── PaymentMetricsGrid (New Component)
│   ├── Total Paid Card
│   ├── Interest Paid Card
│   ├── Payoff Date Card
│   └── Next Payment Card
├── FinancingCharts (New Component)
│   ├── Progress Donut Chart (shadcn Chart - Pie)
│   └── Amortization Chart (shadcn Chart - Area/Bar)
├── PaymentCalculator (New Component)
│   ├── Input Fields (shadcn Input)
│   └── Results Display (shadcn Card)
├── PaymentHistory (New Component)
│   ├── Timeline Items (shadcn Card)
│   └── Scroll Area (shadcn ScrollArea)
└── EmptyState (Existing Pattern)
```

### Data Flow

1. **Page Load**: The vehicle detail page already loads vehicle data including financing information
2. **Financing Data**: The `vehicle.financing` object contains all necessary financing details
3. **Payment Data**: Will need to fetch payment history from a new API endpoint
4. **Calculations**: Client-side calculations for amortization schedule, metrics, and what-if scenarios
5. **Real-time Updates**: All calculations update reactively using Svelte 5 runes

## Components and Interfaces

### 1. FinancingSummaryHeader Component

**Purpose**: Display high-level financing status with progress visualization

**Props**:
```typescript
interface FinancingSummaryHeaderProps {
  financing: VehicleFinancing;
  progressPercentage: number;
}
```

**Layout**:
- Full-width card at the top
- Large progress bar showing percentage paid
- Grid of 4 metric cards below:
  - Original Amount
  - Current Balance
  - Amount Paid
  - Progress Percentage

**Styling**:
- Use gradient progress bar for visual appeal
- Color coding: green for >75% paid, blue for 50-75%, orange for <50%
- Large, bold numbers for amounts
- Icons from lucide-svelte for each metric

### 2. PaymentMetricsGrid Component

**Purpose**: Display calculated financial metrics in an easy-to-scan grid

**Props**:
```typescript
interface PaymentMetricsGridProps {
  financing: VehicleFinancing;
  payments: VehicleFinancingPayment[];
  totalInterestPaid: number;
  estimatedPayoffDate: Date;
  nextPaymentDate: Date;
}
```

**Layout**:
- Responsive grid: 4 columns on desktop, 2 on tablet, 1 on mobile
- Cards for:
  - Total Interest Paid (loans only)
  - Total Amount Paid
  - Estimated Payoff Date
  - Next Payment Due (highlighted if within 7 days)

**Calculations**:
- Total Interest: Sum of `interestAmount` from all payments
- Total Paid: Original amount - current balance
- Payoff Date: Based on current balance, payment amount, and frequency
- Next Payment: Calculate from last payment date + payment frequency

### 3. FinancingCharts Component

**Purpose**: Provide visual representations of financing data

**Props**:
```typescript
interface FinancingChartsProps {
  financing: VehicleFinancing;
  payments: VehicleFinancingPayment[];
  amortizationSchedule: AmortizationEntry[];
}

interface AmortizationEntry {
  paymentNumber: number;
  paymentDate: Date;
  paymentAmount: number;
  principalAmount: number;
  interestAmount: number;
  remainingBalance: number;
  isPaid: boolean;
}
```

**Charts**:

1. **Progress Donut Chart** (shadcn chart-pie-donut):
   - Inner ring: Amount paid vs. remaining
   - Outer ring: Principal paid vs. interest paid (for loans)
   - Center: Percentage complete
   - Colors: Green for paid, gray for remaining, blue for principal, orange for interest

2. **Amortization Chart** (shadcn chart-area-step or chart-bar-mixed):
   - X-axis: Payment number or date
   - Y-axis: Payment amount
   - Two series: Principal (stacked), Interest (stacked)
   - Highlight completed payments with different opacity
   - Tooltip shows detailed breakdown on hover

**Chart Configuration**:
```typescript
const chartConfig = {
  principal: {
    label: "Principal",
    color: "hsl(var(--chart-1))"
  },
  interest: {
    label: "Interest",
    color: "hsl(var(--chart-2))"
  }
}
```

### 4. PaymentCalculator Component

**Purpose**: Allow users to calculate impact of extra payments

**Props**:
```typescript
interface PaymentCalculatorProps {
  financing: VehicleFinancing;
  currentPayoffDate: Date;
}
```

**Layout**:
- Collapsible card (shadcn Collapsible)
- Input field for extra payment amount
- Real-time calculation results:
  - New payoff date
  - Months saved
  - Interest saved
  - Total savings

**Calculations**:
- Use loan amortization formula
- Calculate new schedule with extra payment applied
- Compare original vs. new schedule

**Formula**:
```typescript
// Monthly payment calculation
P = L[c(1 + c)^n]/[(1 + c)^n - 1]
// Where:
// P = monthly payment
// L = loan amount (current balance)
// c = monthly interest rate (APR / 12 / 100)
// n = number of payments remaining
```

### 5. PaymentHistory Component

**Purpose**: Display chronological list of all payments

**Props**:
```typescript
interface PaymentHistoryProps {
  payments: VehicleFinancingPayment[];
  financing: VehicleFinancing;
}
```

**Layout**:
- Scrollable area (shadcn ScrollArea) with max height
- Each payment as a card with:
  - Payment date (formatted)
  - Payment amount (large, bold)
  - Principal and interest breakdown
  - Remaining balance after payment
  - Payment type badge (standard, extra, custom)
- Timeline connector between payments
- Most recent payment at top

**Styling**:
- Extra payments highlighted with green accent
- Standard payments with neutral styling
- Payment number badge on each card
- Use shadcn Badge for payment type

### 6. NextPaymentCard Component

**Purpose**: Prominently display upcoming payment information

**Props**:
```typescript
interface NextPaymentCardProps {
  financing: VehicleFinancing;
  nextPaymentDate: Date;
  daysUntilPayment: number;
}
```

**Layout**:
- Prominent card with alert styling if due soon
- Large payment amount
- Countdown: "Due in X days"
- Payment frequency indicator
- Calendar icon

**Conditional Styling**:
- Green: >7 days away
- Yellow: 3-7 days away
- Red: <3 days or overdue

### 7. LeaseMetricsCard Component

**Purpose**: Display lease-specific information

**Props**:
```typescript
interface LeaseMetricsCardProps {
  financing: VehicleFinancing;
  currentMileage: number | null;
}
```

**Layout**:
- Card with lease-specific metrics:
  - Lease end date
  - Months remaining
  - Mileage limit (if applicable)
  - Current mileage vs. limit
  - Projected mileage at lease end
  - Potential excess mileage fees
- Progress bar for mileage usage
- Warning if projected to exceed limit

**Calculations**:
```typescript
// Projected mileage at lease end
const monthsElapsed = (now - startDate) / (1000 * 60 * 60 * 24 * 30);
const monthsRemaining = termMonths - monthsElapsed;
const milesPerMonth = (currentMileage - initialMileage) / monthsElapsed;
const projectedMileage = currentMileage + (milesPerMonth * monthsRemaining);
const excessMiles = Math.max(0, projectedMileage - mileageLimit);
const potentialFee = excessMiles * excessMileageFee;
```

## Data Models

### Client-Side Types

```typescript
interface FinancingMetrics {
  totalPaid: number;
  totalInterestPaid: number;
  totalPrincipalPaid: number;
  progressPercentage: number;
  estimatedPayoffDate: Date;
  monthsRemaining: number;
  nextPaymentDate: Date;
  daysUntilNextPayment: number;
}

interface PaymentCalculation {
  extraPaymentAmount: number;
  newPayoffDate: Date;
  monthsSaved: number;
  interestSaved: number;
  totalSavings: number;
}

interface LeaseMetrics {
  monthsRemaining: number;
  daysRemaining: number;
  mileageUsed: number;
  mileageRemaining: number;
  projectedFinalMileage: number;
  projectedExcessMiles: number;
  projectedExcessFee: number;
  isOverMileage: boolean;
}
```

### API Endpoints

**GET /api/vehicles/:vehicleId/financing/payments**
- Returns: Array of VehicleFinancingPayment
- Sorted by payment date descending
- Includes all payment history for the vehicle's financing

**Response**:
```typescript
{
  data: VehicleFinancingPayment[];
  count: number;
}
```

## Error Handling

### Missing Data Scenarios

1. **No Financing Data**: Display empty state with message
2. **No Payment History**: Show empty state in payment history section only
3. **Missing APR**: Skip amortization chart, show warning
4. **Invalid Dates**: Use fallback calculations or hide affected components
5. **Calculation Errors**: Display error message in affected section, don't crash entire tab

### Error Messages

- Use shadcn Alert component for errors
- Non-blocking: Show error in specific section, rest of dashboard works
- Provide helpful context: "Unable to calculate amortization schedule without APR"

## Testing Strategy

### Unit Tests

1. **Calculation Functions**:
   - Amortization schedule generation
   - Payment date calculations
   - Interest calculations
   - Lease mileage projections

2. **Component Logic**:
   - Conditional rendering based on financing type
   - Progress percentage calculations
   - Date formatting and display

### Integration Tests

1. **Data Loading**:
   - Fetch financing data successfully
   - Fetch payment history successfully
   - Handle API errors gracefully

2. **User Interactions**:
   - Payment calculator updates in real-time
   - Charts display correct data
   - Responsive layout changes

### Visual Tests

1. **Responsive Design**:
   - Desktop layout (1920px, 1440px, 1024px)
   - Tablet layout (768px)
   - Mobile layout (375px, 414px)

2. **Chart Rendering**:
   - Charts display correctly
   - Tooltips work on hover
   - Touch interactions on mobile

## Accessibility

### ARIA Labels

- All charts have descriptive aria-labels
- Progress bars have aria-valuenow, aria-valuemin, aria-valuemax
- Interactive elements have clear labels
- Form inputs have associated labels

### Keyboard Navigation

- All interactive elements keyboard accessible
- Tab order follows visual flow
- Calculator inputs support keyboard entry
- Collapsible sections toggle with Enter/Space

### Screen Readers

- Chart data available in table format (visually hidden)
- Important metrics announced clearly
- Status messages for calculations
- Error messages properly announced

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Load payment history only when tab is active
2. **Memoization**: Cache expensive calculations (amortization schedule)
3. **Debouncing**: Debounce calculator input to avoid excessive recalculations
4. **Virtual Scrolling**: Use for payment history if >100 payments
5. **Chart Optimization**: Limit data points for large datasets

### Bundle Size

- shadcn chart components are tree-shakeable
- Only import needed chart types
- Lazy load calculator component if not immediately visible

## Visual Design

### Color Scheme

- **Primary**: Use existing app primary color for main elements
- **Success**: Green (#10b981) for positive metrics, completed payments
- **Warning**: Yellow/Orange (#f59e0b) for upcoming payments, caution
- **Danger**: Red (#ef4444) for overdue, over-limit warnings
- **Neutral**: Gray scale for standard information

### Typography

- **Headings**: Bold, 18-24px for section titles
- **Metrics**: Bold, 24-32px for key numbers
- **Body**: Regular, 14-16px for descriptions
- **Labels**: Medium, 12-14px for chart labels

### Spacing

- **Section Gaps**: 24px between major sections
- **Card Padding**: 16-24px internal padding
- **Grid Gaps**: 16px between grid items
- **Compact Mode**: Reduce spacing on mobile

### Icons

Use lucide-svelte icons:
- `CreditCard`: Financing header
- `TrendingUp`: Progress and growth
- `Calendar`: Payment dates
- `DollarSign`: Financial amounts
- `Clock`: Time-based metrics
- `AlertCircle`: Warnings
- `CheckCircle`: Completed status
- `Calculator`: Payment calculator

## Implementation Notes

### Svelte 5 Runes

- Use `$state()` for reactive variables (calculator inputs, collapsed states)
- Use `$derived()` for computed values (metrics, calculations)
- Use `$effect()` for side effects (fetching payment data when tab becomes active)

### Chart Library

- shadcn/ui uses Recharts under the hood
- Import chart components from `$lib/components/ui/chart`
- Use provided chart configuration pattern
- Ensure responsive container for charts

### Date Handling

- Use native Date objects
- Format with existing `formatDate` utility
- Calculate date differences carefully (account for timezones)
- Use `date-fns` if complex date math needed

### Currency Formatting

- Use existing `formatCurrency` utility
- Respect user's currency settings from store
- Consistent decimal places (2 for currency)

### Responsive Breakpoints

```typescript
// Tailwind breakpoints
sm: 640px   // Mobile landscape
md: 768px   // Tablet
lg: 1024px  // Desktop
xl: 1280px  // Large desktop
```

### Component File Structure

```
frontend/src/lib/components/financing/
├── FinancingSummaryHeader.svelte
├── PaymentMetricsGrid.svelte
├── FinancingCharts.svelte
├── PaymentCalculator.svelte
├── PaymentHistory.svelte
├── NextPaymentCard.svelte
├── LeaseMetricsCard.svelte
└── __tests__/
    └── financing-components.test.ts
```

### Utility Functions

Create `frontend/src/lib/utils/financing-calculations.ts`:
```typescript
export function calculateAmortizationSchedule(...)
export function calculateNextPaymentDate(...)
export function calculatePayoffDate(...)
export function calculateExtraPaymentImpact(...)
export function calculateLeaseMetrics(...)
export function formatPaymentFrequency(...)
```
