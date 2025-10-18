# Implementation Plan

## Overview

This implementation plan converts the vehicle overview UI enhancement design into actionable coding tasks. Each task builds incrementally on previous work, following test-driven development principles where appropriate.

---

- [x] 1. Setup Layerchart and dependencies
  - Install Layerchart package (`npm install layerchart`)
  - Configure Layerchart with Tailwind CSS if needed
  - Verify Layerchart works with a simple test component
  - _Requirements: 8.4_

- [x] 2. Replace primary stats cards with shadcn Card components
  - [x] 2.1 Update Total Expenses card
    - Replace `.card-compact` with shadcn Card, CardContent
    - Use shadcn typography tokens (text-muted-foreground, etc.)
    - Add hover:shadow-lg transition
    - _Requirements: 1.2, 2.1_
  
  - [x] 2.2 Update Last 30 Days card
    - Replace with shadcn Card component
    - Match styling from Total Expenses card
    - _Requirements: 1.2, 2.1_
  
  - [x] 2.3 Update Monthly Average card
    - Replace with shadcn Card component
    - Ensure consistent spacing and typography
    - _Requirements: 1.2, 2.1_
  
  - [x] 2.4 Update Avg MPG/Last Expense card
    - Replace with shadcn Card component
    - Handle conditional display logic
    - _Requirements: 1.2, 2.1_

- [x] 3. Replace period selector with shadcn Select
  - Replace native HTML select with shadcn Select component
  - Import SelectTrigger, SelectValue, SelectContent, SelectItem
  - Bind to selectedStatsPeriod state
  - Test period changes trigger data updates
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 4. Update Mileage & Fuel Statistics section
  - [x] 4.1 Replace container with shadcn Card
    - Use Card with CardHeader and CardContent
    - Add Gauge icon to CardTitle
    - _Requirements: 1.3, 4.1_
  
  - [x] 4.2 Update stat items styling
    - Replace colored bg classes with shadcn border and bg-card
    - Use text-muted-foreground for labels
    - Ensure responsive grid layout
    - _Requirements: 1.3, 2.3_

- [x] 5. Create ExpenseTrendChart component
  - [x] 5.1 Create component file
    - Create `frontend/src/lib/components/charts/ExpenseTrendChart.svelte`
    - Import Layerchart components (Chart, Svg, Area, Axis, Tooltip, LinearGradient)
    - Define Props interface with data and period
    - _Requirements: 8.1_
  
  - [x] 5.2 Implement chart rendering
    - Use Chart component with x="date" y="amount"
    - Add Area with gradient fill
    - Add X and Y axes with proper formatting
    - Add interactive Tooltip
    - _Requirements: 8.1, 8.5_
  
  - [x] 5.3 Add empty state
    - Show message when data.length === 0
    - Use shadcn styling for empty state
    - _Requirements: 8.7_
  
  - [x] 5.4 Wrap in shadcn Card
    - Add Card with CardHeader (title, description)
    - Place chart in CardContent
    - _Requirements: 8.1_

- [x] 6. Create data preparation function for expense trends
  - Create `prepareExpenseTrendData` function
  - Filter expenses by selected period
  - Group by week or month based on period
  - Return array of {date, amount, count}
  - _Requirements: 8.1, 8.8_

- [x] 7. Integrate ExpenseTrendChart into overview tab
  - Add chart below period selector
  - Pass prepared expense trend data
  - Pass selectedStatsPeriod as period prop
  - Test chart updates when period changes
  - _Requirements: 8.1, 8.8_

- [x] 8. Create FuelEfficiencyTrendChart component
  - [x] 8.1 Create component file
    - Create `frontend/src/lib/components/charts/FuelEfficiencyTrendChart.svelte`
    - Import Layerchart components (Chart, Svg, Line, Axis, Tooltip, Highlight)
    - Define Props with data and fuelType
    - _Requirements: 8.3_
  
  - [x] 8.2 Implement chart rendering
    - Use Chart with x="date" y="efficiency"
    - Add Line with green stroke color
    - Add axes with efficiency label (MPG or mi/kWh)
    - Add Highlight for hover effects
    - Add Tooltip with efficiency and mileage
    - _Requirements: 8.3, 8.5_
  
  - [x] 8.3 Add conditional rendering
    - Only show chart if data.length >= 2
    - Show empty state for insufficient data
    - Use $derived for efficiency label based on fuelType
    - _Requirements: 8.7_
  
  - [x] 8.4 Wrap in shadcn Card
    - Add Card with CardHeader
    - Dynamic description based on fuelType
    - _Requirements: 8.3_

- [x] 9. Create data preparation function for fuel efficiency
  - Create `prepareFuelEfficiencyData` function
  - Filter fuel expenses with mileage
  - Calculate efficiency between consecutive entries
  - Handle both volume (MPG) and charge (mi/kWh)
  - Filter out invalid efficiency values
  - Return array of {date, efficiency, mileage}
  - _Requirements: 8.3_

- [x] 10. Integrate FuelEfficiencyTrendChart into overview tab
  - Add chart after mileage statistics section
  - Only render if fuel efficiency data exists
  - Pass vehicle fuel type
  - Test with both gas and electric vehicles
  - _Requirements: 8.3_

- [x] 11. Create CategoryPieChart component
  - [x] 11.1 Create component file
    - Create `frontend/src/lib/components/charts/CategoryPieChart.svelte`
    - Import Layerchart components (Chart, Svg, Pie, Tooltip)
    - Define Props with category data array
    - _Requirements: 8.2_
  
  - [x] 11.2 Implement pie chart
    - Use Chart with r="amount"
    - Configure Pie with innerRadius (donut style)
    - Add padAngle and cornerRadius for styling
    - Add Tooltip with category details
    - _Requirements: 8.2, 8.5_
  
  - [x] 11.3 Add legend/summary section
    - Create side-by-side layout (chart + legend)
    - Map through data to show color indicators
    - Display category name, amount, and percentage
    - Add hover:bg-accent for interactive feel
    - _Requirements: 8.2_
  
  - [x] 11.4 Wrap in shadcn Card
    - Add Card with CardHeader
    - Use flex layout for chart and legend
    - Make responsive (stack on mobile)
    - _Requirements: 8.2, 9.2_

- [x] 12. Create data preparation function for category chart
  - Create `prepareCategoryChartData` function
  - Calculate total expenses
  - Map categories to include name, amount, percentage, color
  - Use consistent category colors
  - Return array for chart consumption
  - _Requirements: 8.2_

- [x] 13. Update Expenses by Category section
  - [x] 13.1 Add CategoryPieChart above grid
    - Integrate pie chart component
    - Pass prepared category data
    - _Requirements: 3.1, 8.2_
  
  - [x] 13.2 Update category grid cards
    - Replace custom divs with shadcn Card components
    - Use CardContent for layout
    - Add Badge component for category labels
    - Add hover:shadow-md transition
    - _Requirements: 3.2, 3.3_

- [x] 14. Update Vehicle Information section
  - Replace `.card` with shadcn Card
  - Use CardHeader with CardTitle
  - Add Car icon to title
  - Use CardContent for grid layout
  - Update typography (text-muted-foreground for labels)
  - Ensure responsive grid (1 col mobile, 2 cols desktop)
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 15. Add loading states with Skeleton components
  - [x] 15.1 Create stats grid skeleton
    - Show 4 Card skeletons during loading
    - Use Skeleton for text placeholders
    - _Requirements: 6.1_
  
  - [x] 15.2 Create chart skeleton
    - Add Card with Skeleton for chart area
    - Use appropriate height (300px)
    - _Requirements: 6.1_
  
  - [x] 15.3 Implement loading state logic
    - Show skeletons when isLoading is true
    - Replace with actual content when loaded
    - _Requirements: 6.1_

- [x] 16. Improve empty states
  - [x] 16.1 Update no expenses empty state
    - Use shadcn Card with centered content
    - Add FileText icon
    - Add descriptive text
    - Add Button to add expense
    - _Requirements: 6.2_
  
  - [x] 16.2 Update no financing empty state
    - Use shadcn Card with centered content
    - Add CreditCard icon
    - _Requirements: 6.3_
  
  - [x] 16.3 Add chart empty states
    - Ensure all charts show appropriate messages
    - Use consistent styling
    - _Requirements: 6.4, 8.7_
<!-- 
- [ ] 17. Test responsive design
  - Test on mobile viewport (< 768px)
  - Test on tablet viewport (768px - 1024px)
  - Test on desktop viewport (> 1024px)
  - Verify all grids stack/expand correctly
  - Verify charts remain readable on mobile
  - Test period selector on mobile
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 18. Verify existing functionality
  - Test vehicle data loading
  - Test expense data loading
  - Test stats calculations
  - Test tab navigation
  - Test expense filtering
  - Test period selector updates
  - Verify all links and buttons work
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 19. Run validation and fix issues
  - Run `npm run all:fix` in frontend directory
  - Run `npm run validate` in frontend directory
  - Fix any TypeScript errors
  - Fix any linting warnings
  - Fix any formatting issues
  - _Requirements: All_

- [ ] 20. Final testing and polish
  - Visual QA across all breakpoints
  - Test with real vehicle data
  - Test with vehicles that have no expenses
  - Test with vehicles that have no fuel data
  - Verify all charts render correctly
  - Check accessibility (keyboard navigation, focus states)
  - Verify color contrast meets WCAG AA
  - _Requirements: All_ -->
