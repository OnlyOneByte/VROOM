# Implementation Plan

- [x] 1. Install shadcn-ui components
  - Install Badge, Alert, Avatar, Dropdown Menu, Select, Textarea, Switch, Sheet, and Sidebar components
  - Verify all components are properly installed and accessible
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [ ] 2. Migrate to Badge component
  - [ ] 2.1 Update OfflineIndicator to use Badge component
    - Replace custom status badge styling with shadcn-ui Badge
    - Map status types to Badge variants (destructive, secondary, default, outline)
    - Preserve all existing status display logic
    - _Requirements: 2.1, 2.2, 7.6_
  
  - [ ] 2.2 Update SyncStatusInline to use Badge component
    - Replace custom status display with Badge component
    - Maintain pending count badge display
    - Preserve expanded/collapsed states
    - _Requirements: 2.3, 7.2_
  
  - [ ] 2.3 Update Navigation mobile status icon to use Badge
    - Replace custom pending count badge with shadcn-ui Badge
    - Maintain positioning and styling
    - _Requirements: 2.1, 7.1_
  
  - [ ]* 2.4 Test Badge component migrations
    - Verify visual appearance matches original
    - Test all status variants (offline, syncing, success, error, pending)
    - Test responsive behavior on mobile and desktop
    - _Requirements: 7.1, 7.2, 7.6, 9.1, 9.2, 9.3_

- [ ] 3. Migrate to Alert component
  - [ ] 3.1 Update EfficiencyAlerts to use Alert component
    - Replace custom alert cards with shadcn-ui Alert
    - Implement custom color variants for yellow (medium) and green (positive) severities
    - Map alert types to Alert variants
    - Preserve dismiss functionality
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.5_
  
  - [ ] 3.2 Add custom Alert variants for medium and positive severities
    - Extend Alert component with yellow variant for medium severity
    - Extend Alert component with green variant for positive severity
    - Maintain consistent styling with existing alerts
    - _Requirements: 5.1, 5.2_
  
  - [ ]* 3.3 Test Alert component migration
    - Verify all alert types display correctly (high, medium, low, positive)
    - Test dismiss functionality
    - Test icon positioning and sizing
    - Verify "All Good" state displays correctly
    - _Requirements: 7.5, 9.1, 9.2, 9.3_

- [ ] 4. Migrate to Avatar component
  - [ ] 4.1 Update UserProfile to use Avatar component
    - Replace custom user icon with shadcn-ui Avatar
    - Implement AvatarFallback with user initials
    - Support AvatarImage for user photos (if available)
    - Maintain compact and full versions
    - _Requirements: 3.5, 7.3_
  
  - [ ]* 4.2 Test Avatar component migration
    - Verify avatar displays correctly in compact mode
    - Verify avatar displays correctly in full mode
    - Test fallback initials generation
    - Test with and without user photo
    - _Requirements: 7.3, 9.1, 9.2_

- [ ] 5. Migrate to Dropdown Menu component
  - [ ] 5.1 Update UserProfile to use Dropdown Menu
    - Replace custom dropdown with shadcn-ui Dropdown Menu
    - Remove manual dropdown state management
    - Remove custom click-outside handling
    - Implement DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 7.3_
  
  - [ ] 5.2 Integrate Avatar with Dropdown Menu trigger
    - Use Avatar component in DropdownMenuTrigger
    - Maintain compact and full button styles
    - _Requirements: 3.5, 7.3_
  
  - [ ]* 5.3 Test Dropdown Menu migration
    - Verify dropdown opens on click
    - Verify dropdown closes on outside click
    - Verify dropdown closes on item selection
    - Test keyboard navigation (tab, enter, escape)
    - Test logout functionality
    - Test navigation to settings and profile
    - _Requirements: 7.3, 9.1, 9.2, 9.5_

- [ ] 6. Migrate to Select component
  - [ ] 6.1 Update vehicle form to use Select for term months
    - Replace native select with shadcn-ui Select
    - Maintain all term options (36, 48, 60, 72, 84 months)
    - Preserve form validation
    - _Requirements: 4.1, 7.4_
  
  - [ ] 6.2 Update vehicle form to use Select for day of month
    - Replace native select with shadcn-ui Select
    - Maintain all day options (1-28)
    - Preserve form validation
    - _Requirements: 4.1, 7.4_
  
  - [ ] 6.3 Update vehicle edit form to use Select components
    - Apply same Select migrations to edit form
    - Maintain consistency with new vehicle form
    - _Requirements: 4.1, 7.4_
  
  - [ ]* 6.4 Test Select component migrations
    - Verify all options display correctly
    - Test keyboard navigation (arrow keys, enter, escape)
    - Test form submission with selected values
    - Test validation error display
    - Test mobile touch interaction
    - _Requirements: 7.4, 9.1, 9.2, 9.4, 9.5_

- [ ] 7. Migrate to Textarea component
  - [ ] 7.1 Update expense edit form to use Textarea
    - Replace custom textarea with shadcn-ui Textarea
    - Maintain maxlength attribute
    - Preserve character count display
    - Maintain icon positioning
    - _Requirements: 4.2, 7.4_
  
  - [ ] 7.2 Update other forms with textarea fields
    - Apply Textarea component to any other forms with textarea elements
    - Maintain consistent styling
    - _Requirements: 4.2, 7.4_
  
  - [ ]* 7.3 Test Textarea component migrations
    - Verify textarea displays correctly
    - Test character count functionality
    - Test maxlength enforcement
    - Test form submission with textarea value
    - Test mobile keyboard interaction
    - _Requirements: 7.4, 9.1, 9.2_

- [ ] 8. Migrate to Switch component
  - [ ] 8.1 Update vehicle form loan toggle to use Switch
    - Replace Checkbox with shadcn-ui Switch for "This vehicle has a loan" toggle
    - Maintain toggle functionality
    - Preserve form state management
    - _Requirements: 4.5, 7.4_
  
  - [ ] 8.2 Update vehicle edit form loan toggle
    - Apply same Switch migration to edit form
    - Maintain consistency with new vehicle form
    - _Requirements: 4.5, 7.4_
  
  - [ ]* 8.3 Test Switch component migrations
    - Verify switch toggles correctly
    - Test keyboard interaction (space, enter)
    - Test form state updates when toggled
    - Test loan form visibility based on switch state
    - _Requirements: 7.4, 9.1, 9.2, 9.5_

- [ ] 9. Migrate to Sheet component for mobile navigation
  - [ ] 9.1 Update Navigation to use Sheet for mobile menu
    - Replace custom mobile overlay and sidebar with shadcn-ui Sheet
    - Remove custom transform animations
    - Remove manual click-outside handling
    - Implement SheetTrigger, SheetContent, SheetHeader
    - _Requirements: 1.1, 1.2, 7.1_
  
  - [ ] 9.2 Migrate mobile navigation items to Sheet
    - Move all navigation items into SheetContent
    - Maintain active state styling
    - Preserve navigation item icons and labels
    - _Requirements: 1.4, 7.1_
  
  - [ ] 9.3 Migrate mobile user menu to Sheet
    - Move user navigation items into Sheet
    - Integrate UserProfile component (with Dropdown Menu)
    - Maintain logout functionality
    - _Requirements: 1.5, 7.1_
  
  - [ ] 9.4 Migrate mobile sync status to Sheet
    - Move SyncStatusInline component into Sheet
    - Maintain sync status display and functionality
    - _Requirements: 7.1, 7.2_
  
  - [ ]* 9.5 Test Sheet component migration
    - Verify mobile menu opens on button click
    - Verify mobile menu closes on outside click
    - Verify mobile menu closes on navigation
    - Test keyboard navigation (tab, escape)
    - Test all navigation links work
    - Test logout functionality
    - Test sync status display
    - Test on iOS Safari and Android Chrome
    - _Requirements: 7.1, 9.1, 9.2, 9.5_

- [ ] 10. Update desktop sidebar styling (optional)
  - [ ] 10.1 Apply shadcn-ui styling utilities to desktop sidebar
    - Update desktop sidebar to use consistent shadcn-ui styling patterns
    - Maintain hover-to-expand functionality
    - Preserve all existing navigation behavior
    - _Requirements: 1.3, 1.4, 7.1_
  
  - [ ]* 10.2 Test desktop sidebar updates
    - Verify hover-to-expand works correctly
    - Test navigation item active states
    - Test user menu integration
    - Test sync status display
    - Verify keyboard navigation
    - _Requirements: 7.1, 9.1, 9.2, 9.5_

- [ ] 11. Migrate SyncStatusIndicator to use Popover
  - [ ] 11.1 Update SyncStatusIndicator to use Popover component
    - Replace custom dropdown with shadcn-ui Popover
    - Remove manual click-outside handling
    - Implement PopoverTrigger and PopoverContent
    - Maintain all status information display
    - _Requirements: 2.2, 7.2_
  
  - [ ]* 11.2 Test Popover migration
    - Verify popover opens on button click
    - Verify popover closes on outside click
    - Test popover positioning (align end)
    - Test manual sync button functionality
    - Test keyboard interaction (escape to close)
    - _Requirements: 7.2, 9.1, 9.2, 9.5_

- [ ] 12. Update form validation error display
  - [ ] 12.1 Implement shadcn-ui form field error patterns
    - Update form validation error display to use consistent shadcn-ui patterns
    - Ensure errors are properly associated with form fields
    - Maintain aria-invalid attributes
    - _Requirements: 4.3, 9.4_
  
  - [ ]* 12.2 Test form validation error display
    - Verify errors display correctly for all form fields
    - Test screen reader announcements of errors
    - Test error clearing on valid input
    - _Requirements: 9.2, 9.4_

- [ ] 13. Verify Svelte 5 runes patterns
  - [ ] 13.1 Review all migrated components for runes compliance
    - Ensure all components use $state() for reactive state
    - Ensure all components use $derived() for computed values
    - Ensure all components use $effect() for side effects
    - Ensure all components use $props() for props
    - Ensure no class: directives on Svelte components
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [ ]* 13.2 Test runes patterns
    - Verify reactivity works correctly in all components
    - Test computed values update correctly
    - Test side effects trigger appropriately
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 14. Comprehensive testing and bug fixes
  - [ ] 14.1 Perform visual regression testing
    - Take screenshots of all migrated components
    - Compare with original screenshots
    - Document any intentional visual changes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  
  - [ ] 14.2 Perform accessibility testing
    - Test keyboard navigation for all components
    - Test screen reader announcements
    - Verify focus indicators are visible
    - Check color contrast
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [ ] 14.3 Perform cross-browser testing
    - Test on Chrome, Firefox, Safari (desktop)
    - Test on iOS Safari and Android Chrome (mobile)
    - Document any browser-specific issues
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
  
  - [ ] 14.4 Fix any bugs discovered during testing
    - Address visual regressions
    - Fix accessibility issues
    - Resolve browser compatibility problems
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [ ]* 14.5 Perform final integration testing
    - Test complete user workflows (add vehicle, add expense, view analytics)
    - Verify all features work end-to-end
    - Test offline functionality
    - Test sync functionality
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
