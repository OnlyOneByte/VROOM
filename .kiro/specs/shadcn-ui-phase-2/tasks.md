# Implementation Plan - Phase 2: Advanced shadcn/ui Components

- [x] 1. Install Phase 2 shadcn-ui components
  - Install Dialog, AlertDialog, Table, Tabs, Accordion, Progress, RadioGroup, ScrollArea, Collapsible, and Empty components
  - Verify all components are properly installed and accessible
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11_

- [x] 2. Migrate delete confirmations to AlertDialog
  - [x] 2.1 Update expenses page delete confirmation
    - Replace custom modal in `frontend/src/routes/expenses/+page.svelte` (line ~807) with AlertDialog
    - Remove custom backdrop and modal styling
    - Implement AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter
    - Add AlertDialogCancel and AlertDialogAction buttons
    - Preserve expense deletion functionality
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  
  - [x] 2.2 Update vehicle detail page delete confirmation
    - Replace custom modal in `frontend/src/routes/vehicles/[id]/+page.svelte` (line ~831) with AlertDialog
    - Apply same AlertDialog pattern as expenses page
    - Maintain consistency with expenses page implementation
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  
  - [ ]* 2.3 Test AlertDialog migrations
    - Verify AlertDialog opens on delete button click
    - Test Escape key closes dialog without deleting
    - Test outside click closes dialog without deleting
    - Test confirm button deletes item and closes dialog
    - Test keyboard navigation (Tab, Enter, Escape)
    - Verify ARIA attributes with screen reader
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 14.1, 14.2, 14.5_

- [x] 3. Migrate sync conflict resolver to Dialog
  - [x] 3.1 Update SyncConflictResolver to use Dialog
    - Replace custom modal in `frontend/src/lib/components/SyncConflictResolver.svelte` (line ~58) with Dialog
    - Remove custom backdrop and modal styling
    - Implement DialogContent, DialogHeader, DialogTitle, DialogDescription
    - Add ScrollArea for long conflict content
    - Preserve all conflict resolution functionality
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  
  - [ ]* 3.2 Test Dialog migration
    - Verify Dialog opens when sync conflict occurs
    - Test Escape key closes dialog
    - Test ScrollArea works for long content
    - Test conflict resolution buttons work correctly
    - Verify ARIA attributes with screen reader
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 14.1, 14.2, 14.5_

- [x] 4. Migrate expense list to Table component
  - [x] 4.1 Replace expense list with Table
    - Replace custom div-based list in `frontend/src/routes/expenses/+page.svelte` with Table component
    - Implement TableHeader with TableHead for column headers
    - Implement TableBody with TableRow and TableCell for expense rows
    - Add ScrollArea wrapper for long lists
    - Maintain existing expense display (date, vehicle, type, category, amount, actions)
    - _Requirements: 3.1, 3.4, 3.6, 3.7_
  
  - [x] 4.2 Implement table sorting
    - Add clickable column headers for sorting
    - Implement sort by date, amount, and type
    - Add sort direction indicators (asc/desc icons)
    - Preserve existing sorting functionality
    - _Requirements: 3.2_
  
  - [x] 4.3 Make table responsive
    - Add horizontal ScrollArea for mobile
    - Ensure table is usable on small screens
    - Test touch interactions on mobile
    - _Requirements: 3.4, 3.7_
  
  - [ ]* 4.4 Test Table migration
    - Verify all expenses display correctly
    - Test column sorting works for all columns
    - Test keyboard navigation through table rows
    - Test horizontal scrolling on mobile
    - Verify semantic HTML structure (table, thead, tbody, tr, td)
    - Test with screen reader
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 14.1, 14.2, 14.6_

- [ ]* 5. Add Tabs to analytics page
  - [ ]* 5.1 Implement Tabs for analytics views
    - Add Tabs component to `frontend/src/routes/analytics/+page.svelte`
    - Create tabs for: Overview, Trends, Efficiency, Breakdown
    - Implement TabsList with TabsTrigger for each tab
    - Implement TabsContent for each view
    - Move existing content into appropriate TabsContent sections
    - _Requirements: 4.1, 4.4, 4.6, 4.7_
  
  - [ ]* 5.2 Test analytics Tabs
    - Verify tabs switch content without page reload
    - Test keyboard navigation with arrow keys
    - Test active tab visual indication
    - Verify ARIA attributes (role="tablist", role="tab", role="tabpanel")
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 14.1, 14.2, 14.7_

- [x] 6. Add Tabs to vehicle detail page
  - [x] 6.1 Implement Tabs for vehicle sections
    - Add Tabs component to `frontend/src/routes/vehicles/[id]/+page.svelte`
    - Create tabs for: Overview, Expenses, Maintenance, Loan Info
    - Organize existing content into TabsContent sections
    - Maintain all existing functionality
    - _Requirements: 4.2, 4.4, 4.6, 4.7_
  
  - [ ]* 6.2 Test vehicle detail Tabs
    - Verify tabs switch content without page reload
    - Test keyboard navigation
    - Test that all vehicle data displays correctly in each tab
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 14.7_

- [ ] 7. Add Tabs to settings page
  - [ ] 7.1 Implement Tabs for settings categories
    - Add Tabs component to `frontend/src/routes/settings/+page.svelte`
    - Create tabs for different setting categories (General, Notifications, Preferences)
    - Organize settings into TabsContent sections
    - _Requirements: 4.3, 4.4, 4.6, 4.7_
  
  - [ ]* 7.2 Test settings Tabs
    - Verify tabs switch content without page reload
    - Test keyboard navigation
    - Test that settings save correctly from each tab
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 14.7_

- [x] 8. Add Accordion to vehicle cards
  - [x] 8.1 Implement Accordion for vehicle details
    - Add Accordion component to vehicle cards in `frontend/src/routes/+page.svelte`
    - Create AccordionItem for "More Details" section
    - Move additional vehicle info into AccordionContent
    - Keep summary info always visible
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  
  - [ ]* 8.2 Test vehicle card Accordion
    - Verify accordion expands and collapses smoothly
    - Test keyboard navigation with arrow keys
    - Test visual indication of expanded state
    - Verify ARIA attributes (aria-expanded, aria-controls)
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 14.1, 14.2_

- [-] 9. Add Accordion to expense filters
  - [x] 9.1 Implement Accordion for filter sections
    - Add Accordion component to filter section in `frontend/src/routes/expenses/+page.svelte`
    - Group related filters into AccordionItems
    - Allow multiple sections to be open simultaneously
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7_
  
  - [ ]* 9.2 Test filter Accordion
    - Verify accordion expands and collapses smoothly
    - Test multiple sections open at once
    - Test keyboard navigation
    - Verify filters work correctly when expanded
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 14.1, 14.2_

- [x] 10. Migrate loan progress to Progress component
  - [x] 10.1 Update vehicle loan progress bars
    - Replace custom progress bar in `frontend/src/routes/vehicles/+page.svelte` (line ~590) with Progress component
    - Remove custom inline styles
    - Calculate progress value using $derived
    - Display percentage text above progress bar
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_
  
  - [ ]* 10.2 Test Progress component migration
    - Verify progress bar displays correct percentage
    - Test smooth animation when value changes
    - Test with screen reader (should announce value)
    - Verify ARIA attributes (role="progressbar", aria-valuenow, aria-valuemin, aria-valuemax)
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 14.1, 14.2_

- [ ]* 11. Migrate expense type selection to RadioGroup
  - [ ]* 11.1 Update ExpenseForm to use RadioGroup
    - Replace button group in `frontend/src/lib/components/expenses/ExpenseForm.svelte` with RadioGroup
    - Implement RadioGroupItem for each expense type
    - Add icons and labels to each radio option
    - Style radio options to look like cards
    - Maintain form submission functionality
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6_
  
  - [ ]* 11.2 Test RadioGroup migration
    - Verify only one option can be selected at a time
    - Test keyboard navigation with arrow keys
    - Test visual indication of selected option
    - Verify form submission includes selected value
    - Verify ARIA attributes (role="radiogroup", role="radio")
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 14.1, 14.2_

- [x] 12. Add ScrollArea to mobile navigation
  - [x] 12.1 Update Navigation to use ScrollArea
    - Add ScrollArea to mobile navigation menu in `frontend/src/lib/components/Navigation.svelte` (line ~130)
    - Wrap navigation items in ScrollArea
    - Remove custom overflow-y-auto class
    - _Requirements: 8.1, 8.5, 8.6_
  
  - [ ]* 12.2 Test mobile navigation ScrollArea
    - Verify scrolling works on mobile
    - Test touch scrolling
    - Test custom scrollbar styling
    - _Requirements: 8.1, 8.5, 8.6_

- [x] 13. Add ScrollArea to dialogs and tables
  - [x] 13.1 Add ScrollArea to Dialog content
    - Update SyncConflictResolver Dialog to use ScrollArea for content
    - Set max height for ScrollArea
    - _Requirements: 8.2, 8.5, 8.6, 8.7_
  
  - [x] 13.2 Add ScrollArea to Table
    - Wrap expense Table in ScrollArea for vertical scrolling
    - Add horizontal ScrollArea for mobile table overflow
    - _Requirements: 8.3, 8.5, 8.6, 8.7_
  
  - [x] 13.3 Add ScrollArea to chart containers
    - Add ScrollArea to chart containers in analytics pages
    - Handle horizontal overflow for wide charts
    - _Requirements: 8.4, 8.5, 8.6, 8.7_
  
  - [ ]* 13.4 Test ScrollArea implementations
    - Verify scrolling works in all locations
    - Test touch scrolling on mobile
    - Test scrollbar updates when content changes
    - _Requirements: 8.5, 8.6, 8.7_

- [x] 14. Implement Form component patterns
  - [x] 14.1 Update form validation error display
    - Update all forms to use FormField component for error display
    - Add aria-invalid attribute to fields with errors
    - Add aria-describedby to associate errors with fields
    - Ensure errors are announced to screen readers
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.7_
  
  - [x] 14.2 Update expense form validation
    - Apply FormField pattern to ExpenseForm
    - Update error display for all fields
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7_
  
  - [x] 14.3 Update vehicle form validation
    - Apply FormField pattern to vehicle forms
    - Update error display for all fields
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7_
  
  - [ ]* 14.4 Test form validation patterns
    - Verify errors display consistently across all forms
    - Test aria-invalid attribute is set correctly
    - Test aria-describedby associates errors with fields
    - Test screen reader announces errors
    - Test focus moves to first error on form submission
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 14.1, 14.2, 14.4_

- [x] 15. Add Collapsible to filter sections
  - [x] 15.1 Implement Collapsible for expense filters
    - Add Collapsible component to filter section in `frontend/src/routes/expenses/+page.svelte`
    - Implement CollapsibleTrigger with chevron icon
    - Implement CollapsibleContent with filter controls
    - Add smooth expand/collapse animation
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  
  - [ ]* 15.2 Test Collapsible implementation
    - Verify filter section expands and collapses smoothly
    - Test keyboard navigation
    - Test visual indication of expanded/collapsed state
    - Verify ARIA attributes (aria-expanded, aria-controls)
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 14.1, 14.2_

- [x] 16. Add Empty state components
  - [x] 16.1 Add Empty state to expenses page
    - Add Empty component when no expenses exist
    - Include icon, title, description, and "Add First Expense" button
    - _Requirements: 11.1, 11.4, 11.5, 11.6, 11.7_
  
  - [x] 16.2 Add Empty state to vehicles page
    - Add Empty component when no vehicles exist
    - Include icon, title, description, and "Add First Vehicle" button
    - _Requirements: 11.2, 11.4, 11.5, 11.6, 11.7_
  
  - [x] 16.3 Add Empty state to efficiency alerts
    - Update EfficiencyAlerts component to use Empty component for "All Good" state
    - Include icon, title, and description
    - _Requirements: 11.3, 11.4, 11.5, 11.7_
  
  - [ ]* 16.4 Test Empty state components
    - Verify Empty states display when no data exists
    - Test action buttons navigate to correct forms
    - Verify Empty states are centered and visually appealing
    - _Requirements: 11.5, 11.6, 11.7_

- [-] 17. Verify Svelte 5 runes patterns
  - [ ] 17.1 Review all migrated components for runes compliance
    - Ensure all components use $state() for reactive state
    - Ensure all components use $derived() for computed values
    - Ensure all components use $effect() for side effects
    - Ensure all components use $props() for props
    - Ensure no class: directives on Svelte components
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  
  - [ ]* 17.2 Test runes patterns
    - Verify reactivity works correctly in all components
    - Test computed values update correctly
    - Test side effects trigger appropriately
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_