# Implementation Plan

- [ ] 1. Set up financing utilities and calculations
  - Create `frontend/src/lib/utils/financing-calculations.ts` with core calculation functions
  - Implement amortization schedule generation function
  - Implement payment date calculation functions (next payment, payoff date)
  - Implement extra payment impact calculator
  - Implement lease metrics calculator (mileage projections, excess fees)
  - Add helper functions for payment frequency formatting
  - _Requirements: 1.1, 2.1, 3.1, 4.2, 4.3, 5.3, 6.5_

- [ ]* 1.1 Write unit tests for financing calculations
  - Test amortization schedule generation with various loan scenarios
  - Test payment date calculations with different frequencies
  - Test extra payment impact calculations
  - Test lease mileage projection calculations
  - _Requirements: 1.1, 3.1, 4.2, 5.3_

- [ ] 2. Add shadcn chart components
  - Run shadcn CLI to add chart component: `npx shadcn@latest add chart`
  - Verify chart component is properly installed in `frontend/src/lib/components/ui/chart`
  - Test basic chart rendering with sample data
  - _Requirements: 1.3, 3.1, 8.1_

- [ ] 3. Create backend API endpoint for payment history
  - Add GET route `/api/vehicles/:vehicleId/financing/payments` in backend
  - Implement controller to fetch payments using `VehicleFinancingPaymentRepository`
  - Add authorization check to ensure user owns the vehicle
  - Return payments sorted by date descending
  - Handle case where no payments exist (return empty array)
  - _Requirements: 2.1, 2.2_

- [ ]* 3.1 Write integration tests for payment history endpoint
  - Test successful payment retrieval
  - Test authorization (user can only access their own vehicle's payments)
  - Test empty payment history
  - Test invalid vehicle ID
  - _Requirements: 2.1_

- [ ] 4. Create FinancingSummaryHeader component
  - Create `frontend/src/lib/components/financing/FinancingSummaryHeader.svelte`
  - Accept financing and progressPercentage props using `$props()`
  - Implement large progress bar using shadcn Progress component
  - Create grid of 4 metric cards (Original Amount, Current Balance, Amount Paid, Progress %)
  - Add conditional color coding (green >75%, blue 50-75%, orange <50%)
  - Use lucide-svelte icons for each metric
  - Ensure responsive layout (4 cols desktop, 2 cols tablet, 1 col mobile)
  - _Requirements: 1.1, 1.2, 1.5, 9.1, 9.2, 9.3_

- [ ] 5. Create PaymentMetricsGrid component
  - Create `frontend/src/lib/components/financing/PaymentMetricsGrid.svelte`
  - Accept financing, payments, and calculated metrics as props
  - Implement responsive grid with 4 metric cards
  - Create Total Interest Paid card (loans only)
  - Create Total Amount Paid card
  - Create Estimated Payoff Date card
  - Create Next Payment Due card with conditional highlighting
  - Use `$derived()` for metric calculations
  - _Requirements: 4.1, 4.2, 4.3, 6.1, 6.2, 6.3, 9.1, 9.2, 9.3_

- [ ] 6. Create FinancingCharts component with donut chart
  - Create `frontend/src/lib/components/financing/FinancingCharts.svelte`
  - Implement progress donut chart using shadcn chart-pie-donut pattern
  - Configure chart with two rings: paid vs. remaining (inner), principal vs. interest (outer)
  - Display percentage complete in center
  - Add interactive tooltips with detailed breakdowns
  - Use chart color configuration from design
  - Ensure responsive sizing
  - _Requirements: 1.3, 1.4, 8.1, 8.2, 8.3, 9.4_

- [ ] 7. Add amortization chart to FinancingCharts component
  - Implement amortization chart using shadcn chart-area-step or chart-bar-mixed
  - Generate amortization schedule data using utility function
  - Configure stacked chart with principal and interest series
  - Highlight completed payments with different opacity
  - Add detailed tooltips showing payment breakdown
  - Conditionally render only for loans with APR > 0
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.2_

- [ ] 8. Create PaymentCalculator component
  - Create `frontend/src/lib/components/financing/PaymentCalculator.svelte`
  - Implement collapsible card using shadcn Collapsible
  - Add input field for extra payment amount using shadcn Input
  - Use `$state()` for input value
  - Use `$derived()` to calculate impact in real-time
  - Display results: new payoff date, months saved, interest saved
  - Format results in easy-to-read cards
  - Only render for loans (not leases)
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 9. Create PaymentHistory component
  - Create `frontend/src/lib/components/financing/PaymentHistory.svelte`
  - Implement scrollable area using shadcn ScrollArea with max height
  - Create payment card layout for each payment
  - Display payment date, amount, principal/interest breakdown, remaining balance
  - Add payment type badge using shadcn Badge (standard, extra, custom)
  - Highlight extra payments with green accent
  - Add timeline connector visual between payments
  - Sort payments with most recent first
  - Implement empty state for no payments
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 10. Create NextPaymentCard component
  - Create `frontend/src/lib/components/financing/NextPaymentCard.svelte`
  - Calculate next payment date from financing data
  - Calculate days until payment
  - Implement prominent card with payment amount and due date
  - Add conditional styling: green (>7 days), yellow (3-7 days), red (<3 days or overdue)
  - Display payment frequency indicator
  - Use Calendar icon from lucide-svelte
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 11. Create LeaseMetricsCard component
  - Create `frontend/src/lib/components/financing/LeaseMetricsCard.svelte`
  - Accept financing and currentMileage props
  - Calculate lease-specific metrics using utility function
  - Display lease end date and months remaining
  - Show mileage limit, current mileage, and projected final mileage
  - Add progress bar for mileage usage
  - Calculate and display potential excess mileage fees
  - Add warning styling if projected to exceed limit
  - Only render for lease financing type
  - _Requirements: 1.4, 4.4, 4.5_

- [ ] 12. Integrate all components into vehicle detail page
  - Update `frontend/src/routes/vehicles/[id]/+page.svelte`
  - Import all new financing components
  - Add API call to fetch payment history using `$effect()` when financing tab is active
  - Use `$state()` for payment data
  - Use `$derived()` for all calculated metrics
  - Replace existing financing tab content with new component structure
  - Maintain existing empty state for no financing
  - Add error handling for API failures
  - Ensure proper loading states
  - _Requirements: 1.1, 2.1, 4.1, 7.1, 7.2, 7.3, 10.1, 10.2, 10.3_

- [ ] 13. Add responsive layout and styling
  - Implement responsive grid system in financing tab
  - Configure Tailwind breakpoints: 4 cols (lg), 2 cols (md), 1 col (sm)
  - Ensure charts are responsive and maintain aspect ratio
  - Test layout on desktop (1920px, 1440px, 1024px)
  - Test layout on tablet (768px)
  - Test layout on mobile (375px, 414px)
  - Adjust spacing and padding for mobile
  - Ensure touch-friendly interactions on mobile
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 14. Implement accessibility features
  - Add ARIA labels to all charts
  - Add aria-valuenow, aria-valuemin, aria-valuemax to progress bars
  - Ensure all interactive elements have clear labels
  - Add keyboard navigation support to calculator
  - Test tab order follows visual flow
  - Add screen reader announcements for calculations
  - Ensure error messages are properly announced
  - Create visually hidden table version of chart data for screen readers
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 15. Add error handling and edge cases
  - Handle missing financing data gracefully
  - Handle missing payment history (show empty state)
  - Handle missing APR (skip amortization chart, show info message)
  - Handle invalid dates with fallback calculations
  - Add error boundaries for calculation errors
  - Use shadcn Alert component for error messages
  - Ensure errors in one section don't crash entire tab
  - Add loading states for async operations
  - _Requirements: 2.5, 3.5, 7.4, 7.5, 10.4_

- [ ] 16. Optimize performance
  - Memoize expensive calculations (amortization schedule)
  - Debounce payment calculator input (300ms)
  - Lazy load payment history only when tab is active
  - Implement virtual scrolling if payment history >100 items
  - Optimize chart data points for large datasets
  - Test performance with large payment histories
  - _Requirements: 2.1, 3.1, 5.3, 8.1_

- [ ]* 17. Write component tests
  - Test FinancingSummaryHeader with various financing states
  - Test PaymentMetricsGrid calculations
  - Test FinancingCharts rendering with sample data
  - Test PaymentCalculator calculations and interactions
  - Test PaymentHistory with various payment types
  - Test NextPaymentCard conditional styling
  - Test LeaseMetricsCard calculations
  - Test responsive behavior
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 8.1, 9.1_

- [ ] 18. Final validation and polish
  - Run `npm run validate` in frontend to check for errors
  - Fix any linting or type errors
  - Test all financing scenarios: loan, lease, no financing
  - Test with various data states: no payments, few payments, many payments
  - Verify all charts display correctly
  - Verify all calculations are accurate
  - Test on multiple browsers (Chrome, Firefox, Safari)
  - Verify mobile experience
  - Check accessibility with screen reader
  - _Requirements: All_
