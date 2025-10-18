# Implementation Plan

- [ ] 1. Create data preparation functions for new charts
  - Create helper functions in `expense-helpers.ts` for preparing chart data
  - Implement `prepareMileagePerMonthData` function to calculate monthly mileage from expenses
  - Implement `prepareOdometerData` function to extract and deduplicate odometer readings
  - Implement `prepareFuelConsumptionCostData` function to aggregate fuel volume and costs by time period
  - Add helper functions: `groupExpensesByMonth` and `calculateMonthlyMileage`
  - Add data validation for mileage and fuel data
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.3_

- [ ]* 1.1 Write unit tests for data preparation functions
  - Test `prepareMileagePerMonthData` with various expense patterns and edge cases
  - Test `prepareOdometerData` with duplicate dates and gaps in data
  - Test `prepareFuelConsumptionCostData` with gas, electric, and hybrid vehicle data
  - Test period filtering for all time periods (7d, 30d, 90d, 1y, all)
  - Test edge cases: empty data, single entry, invalid values
  - _Requirements: 2.1, 2.2, 2.3, 2.7, 3.1, 3.2, 3.6, 4.1, 4.4, 4.6_

- [ ] 2. Create MileagePerMonthChart component
  - Create `frontend/src/lib/components/charts/MileagePerMonthChart.svelte`
  - Implement component with Props interface (data, period, isLoading, error)
  - Use LayerChart BarChart for visualization
  - Configure chart with 280px height, month labels on x-axis, miles on y-axis
  - Add tooltip showing month, miles driven, and odometer range
  - Implement loading state with Skeleton component
  - Implement empty state for insufficient data (< 2 mileage entries)
  - Implement error state with EmptyState component
  - Use shadcn-svelte Card components for layout
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.4, 6.5, 7.5_

- [ ] 3. Create OdometerHistoryChart component
  - Create `frontend/src/lib/components/charts/OdometerHistoryChart.svelte`
  - Implement component with Props interface (data, period, distanceUnit, isLoading, error)
  - Use LayerChart LineChart for visualization with time scale
  - Configure chart with 280px height, date on x-axis, odometer reading on y-axis
  - Add y-axis label with appropriate distance unit (miles or kilometers)
  - Add tooltip showing date and exact odometer reading
  - Implement smooth curve line style with data points
  - Implement loading state with Skeleton component
  - Implement empty state for insufficient data (< 2 mileage entries)
  - Implement error state with EmptyState component
  - Use shadcn-svelte Card components for layout
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.4, 6.5, 7.5_

- [ ] 4. Create FuelConsumptionCostChart component
  - Create `frontend/src/lib/components/charts/FuelConsumptionCostChart.svelte`
  - Implement component with Props interface (data, period, vehicleType, volumeUnit, isLoading, error)
  - Use LayerChart with dual y-axes for overlay visualization
  - Configure left y-axis for fuel volume/charge (gallons, liters, or kWh)
  - Configure right y-axis for cost in currency
  - Use green color for volume line and orange color for cost line
  - Add tooltip showing date, volume, and cost
  - Handle electric vehicles by displaying kWh instead of fuel volume
  - Handle hybrid vehicles by combining fuel and charge data
  - Implement loading state with Skeleton component
  - Implement empty state for insufficient data (< 2 fuel entries)
  - Implement error state with EmptyState component
  - Use shadcn-svelte Card components for layout
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 6.4, 6.5, 7.5_

- [ ] 5. Update vehicle overview page with new charts
  - Open `frontend/src/routes/vehicles/[id]/+page.svelte`
  - Import new chart components: MileagePerMonthChart, OdometerHistoryChart, FuelConsumptionCostChart
  - Add derived state for new chart data using data preparation functions
  - Reorder charts: move CategoryPieChart to be first in the layout
  - Add new charts section with responsive grid layout (2 columns on desktop, 1 on mobile)
  - Place MileagePerMonthChart and OdometerHistoryChart in 2-column grid
  - Place FuelConsumptionCostChart as full-width chart
  - Pass appropriate props to all chart components (data, period, isLoading, etc.)
  - Ensure charts only render when sufficient data is available
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 3.1, 3.3, 4.1, 4.4, 6.1, 6.2, 6.3, 6.4_

- [ ] 6. Implement responsive layout for all charts
  - Verify mobile layout: all charts stack vertically in single column
  - Verify tablet layout: charts display in 2-column grid where appropriate
  - Verify desktop layout: charts display in 2-column grid for optimal space usage
  - Ensure CategoryPieChart displays full-width on all screen sizes
  - Ensure FuelConsumptionCostChart displays full-width on all screen sizes
  - Test chart readability at minimum supported screen width (375px)
  - Verify all charts maintain minimum readable height (280px)
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 7. Add error handling and loading states
  - Verify loading indicators display while chart data is being calculated
  - Verify skeleton loaders show for all charts during initial load
  - Verify empty states display appropriate messages when data is insufficient
  - Verify error states display without breaking page layout
  - Test period filter changes trigger loading states and update within 500ms
  - Add error boundaries to prevent chart failures from breaking the page
  - _Requirements: 6.5, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 8. Implement accessibility features
  - Add ARIA labels to all chart card regions
  - Add aria-labelledby and aria-describedby to chart content areas
  - Verify chart titles and descriptions are announced by screen readers
  - Verify empty states provide clear feedback to screen readers
  - Verify loading states announce "Loading chart data"
  - Verify error states announce error messages
  - Test keyboard navigation through period selector
  - Verify all chart colors meet WCAG AA contrast standards (4.5:1 ratio)
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ]* 9. Write component tests for new charts
  - Create test file for MileagePerMonthChart component
  - Test rendering with valid data, loading state, empty state, and error state
  - Create test file for OdometerHistoryChart component
  - Test rendering with valid data, loading state, empty state, and error state
  - Create test file for FuelConsumptionCostChart component
  - Test rendering with valid data for gas, electric, and hybrid vehicles
  - Test period filter changes for all chart components
  - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.3, 3.4, 4.1, 4.4, 4.7, 4.8, 7.3_

- [ ]* 10. Write integration tests for vehicle page
  - Update vehicle page tests to verify chart visibility based on data availability
  - Test chart reordering: verify CategoryPieChart appears first
  - Test period selector interaction updates all charts
  - Test chart updates when expenses are added or deleted
  - Test responsive behavior at different screen sizes
  - _Requirements: 1.1, 1.2, 2.6, 3.5, 4.6, 6.1, 6.2, 6.3, 7.3_

- [ ] 11. Validate and fix any issues
  - Run `npm run validate` in frontend directory
  - Fix any linting, formatting, or type errors
  - Run `npm run all:fix` to auto-fix issues
  - Verify no console errors or warnings in browser
  - Test all charts with real data in development environment
  - _Requirements: All_
