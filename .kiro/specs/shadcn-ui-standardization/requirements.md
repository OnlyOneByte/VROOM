# Requirements Document

## Introduction

This feature aims to standardize the frontend UI components by migrating custom-built components to shadcn-ui equivalents. Currently, the VROOM Car Tracker application uses a mix of shadcn-ui components (Button, Input, Label, Card, Checkbox, Calendar, Popover, Sonner) and custom-built components. This creates inconsistency in styling, behavior, and maintainability. By standardizing on shadcn-ui, we'll achieve better consistency, accessibility, reduced maintenance burden, and leverage a well-tested component library.

## Requirements

### Requirement 1: Migrate Navigation to shadcn-ui Components

**User Story:** As a developer, I want the Navigation component to use shadcn-ui primitives, so that it has consistent styling and behavior with the rest of the application.

#### Acceptance Criteria

1. WHEN reviewing the Navigation component THEN it SHALL use shadcn-ui Sheet component for mobile menu instead of custom overlay/sidebar
2. WHEN the mobile menu is opened THEN it SHALL use Sheet component with proper accessibility attributes
3. WHEN the desktop sidebar is rendered THEN it SHALL use shadcn-ui Sidebar component or maintain current implementation with shadcn-ui styling utilities
4. WHEN navigation items are displayed THEN they SHALL use consistent hover and active states from shadcn-ui
5. WHEN the user profile section is rendered THEN it SHALL integrate with the UserProfile component updates

### Requirement 2: Migrate Status Indicators to shadcn-ui Components

**User Story:** As a developer, I want status indicators (offline, sync, etc.) to use shadcn-ui components, so that they have consistent visual design and behavior.

#### Acceptance Criteria

1. WHEN the OfflineIndicator component is rendered THEN it SHALL use shadcn-ui Badge component for status display
2. WHEN the SyncStatusIndicator component is rendered THEN it SHALL use shadcn-ui Popover component for the details dropdown
3. WHEN the SyncStatusInline component is rendered THEN it SHALL use shadcn-ui Badge component for status display
4. WHEN status changes occur THEN the components SHALL use shadcn-ui's Sonner toast notifications (already available)
5. WHEN displaying sync conflicts THEN it SHALL use shadcn-ui Alert component

### Requirement 3: Migrate UserProfile to shadcn-ui Components

**User Story:** As a developer, I want the UserProfile component to use shadcn-ui dropdown menu, so that it has consistent behavior with other dropdown interactions.

#### Acceptance Criteria

1. WHEN the UserProfile component is rendered THEN it SHALL use shadcn-ui Dropdown Menu component instead of custom dropdown
2. WHEN the user clicks the profile button THEN it SHALL open a shadcn-ui Dropdown Menu
3. WHEN the dropdown is open THEN it SHALL display user information using shadcn-ui menu items
4. WHEN clicking outside the dropdown THEN it SHALL close automatically using shadcn-ui's built-in behavior
5. WHEN the compact version is rendered THEN it SHALL use shadcn-ui Avatar component

### Requirement 4: Migrate Form Elements to shadcn-ui Components

**User Story:** As a developer, I want all form pages to use shadcn-ui form components, so that forms have consistent validation, styling, and accessibility.

#### Acceptance Criteria

1. WHEN rendering select dropdowns THEN they SHALL use shadcn-ui Select component instead of native HTML select
2. WHEN rendering textarea elements THEN they SHALL use shadcn-ui Textarea component
3. WHEN displaying form validation errors THEN they SHALL use shadcn-ui form field error patterns
4. WHEN grouping form fields THEN they SHALL use shadcn-ui Field or Form components
5. WHEN rendering the loan form toggle THEN it SHALL use shadcn-ui Switch component instead of Checkbox

### Requirement 5: Migrate Alert and Notification Components

**User Story:** As a developer, I want alert and notification displays to use shadcn-ui components, so that they have consistent styling and behavior.

#### Acceptance Criteria

1. WHEN the EfficiencyAlerts component displays alerts THEN it SHALL use shadcn-ui Alert component
2. WHEN displaying different alert severities THEN they SHALL use shadcn-ui Alert variants (default, destructive)
3. WHEN showing alert icons THEN they SHALL use consistent icon sizing and positioning from shadcn-ui
4. WHEN dismissing alerts THEN they SHALL use shadcn-ui's built-in dismiss functionality
5. WHEN displaying the "All Good" state THEN it SHALL use shadcn-ui Empty state pattern if available

### Requirement 6: Add Missing shadcn-ui Components

**User Story:** As a developer, I want to install missing shadcn-ui components needed for standardization, so that they are available for use throughout the application.

#### Acceptance Criteria

1. WHEN the project is set up THEN it SHALL include shadcn-ui Sheet component
2. WHEN the project is set up THEN it SHALL include shadcn-ui Dropdown Menu component
3. WHEN the project is set up THEN it SHALL include shadcn-ui Select component
4. WHEN the project is set up THEN it SHALL include shadcn-ui Textarea component
5. WHEN the project is set up THEN it SHALL include shadcn-ui Switch component
6. WHEN the project is set up THEN it SHALL include shadcn-ui Alert component
7. WHEN the project is set up THEN it SHALL include shadcn-ui Avatar component
8. WHEN the project is set up THEN it SHALL include shadcn-ui Badge component
9. WHEN the project is set up THEN it SHALL include shadcn-ui Sidebar component (if available)

### Requirement 7: Maintain Existing Functionality

**User Story:** As a user, I want all existing functionality to work exactly as before, so that the migration doesn't break any features.

#### Acceptance Criteria

1. WHEN using the mobile navigation THEN it SHALL open, close, and navigate exactly as before
2. WHEN viewing sync status THEN it SHALL display all information and allow manual sync as before
3. WHEN interacting with the user profile dropdown THEN it SHALL show user info and allow logout as before
4. WHEN submitting forms THEN they SHALL validate and submit exactly as before
5. WHEN viewing efficiency alerts THEN they SHALL display all alert types and allow dismissal as before
6. WHEN the application is offline THEN all offline indicators SHALL work as before

### Requirement 8: Preserve Svelte 5 Runes Patterns

**User Story:** As a developer, I want all migrated components to use Svelte 5 runes correctly, so that they follow the project's coding standards.

#### Acceptance Criteria

1. WHEN using reactive state THEN components SHALL use `$state()` instead of legacy reactive statements
2. WHEN using computed values THEN components SHALL use `$derived()` instead of `$:` statements
3. WHEN using side effects THEN components SHALL use `$effect()` instead of `$:` statements
4. WHEN passing props THEN components SHALL use `let { prop } = $props()` syntax
5. WHEN applying conditional classes THEN components SHALL NOT use `class:` directives on Svelte components

### Requirement 9: Maintain Accessibility Standards

**User Story:** As a user with accessibility needs, I want all migrated components to maintain or improve accessibility, so that the application remains usable for everyone.

#### Acceptance Criteria

1. WHEN using keyboard navigation THEN all interactive elements SHALL be keyboard accessible
2. WHEN using screen readers THEN all components SHALL have proper ARIA labels and roles
3. WHEN focusing elements THEN they SHALL have visible focus indicators
4. WHEN displaying errors THEN they SHALL be announced to screen readers
5. WHEN opening modals or dropdowns THEN focus SHALL be managed appropriately
