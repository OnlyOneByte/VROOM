# Implementation Plan

- [x] 1. Migrate frontend to match backend rewrite
  - Implement all necessary changes to align frontend with the comprehensive backend rewrite
  - Fix API field name mismatches between frontend and backend
  - Implement missing analytics endpoints in backend
  - Update all frontend components to use correct field names and endpoints
  - Ensure offline sync uses correct field transformations
  - Validate all changes with tests
  - _Requirements: All_

- [x] 1.1 Create backend analytics module
  - Create `backend/src/api/analytics/` directory with routes.ts, service.ts, repository.ts
  - Implement GET /api/v1/analytics/dashboard endpoint with aggregation logic
  - Implement GET /api/v1/analytics/vehicle/:vehicleId endpoint
  - Implement GET /api/v1/analytics/trends endpoint
  - Mount analytics routes in backend/src/index.ts
  - Add authentication and rate limiting middleware
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 8.2, 8.3_

- [ ]* 1.2 Write property test for analytics date filtering
  - **Property 4: Analytics date range filtering**
  - **Validates: Requirements 2.5**

- [ ]* 1.3 Write property test for analytics grouping
  - **Property 5: Analytics grouping correctness**
  - **Validates: Requirements 2.3**

- [ ]* 1.4 Write property test for MPG calculation
  - **Property 19: MPG calculation from consecutive readings**
  - **Validates: Requirements 8.3**

- [x] 1.5 Create frontend API transformation layer
  - Create `frontend/src/lib/services/api-transformer.ts` with transformation functions
  - Implement toBackendExpense: amount→expenseAmount, volume→fuelAmount, charge→fuelAmount
  - Implement fromBackendExpense: expenseAmount→amount, fuelAmount→volume/charge
  - Add vehicle type detection for charge vs volume mapping
  - Handle null/undefined values and legacy expenses without tags
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3_

- [ ]* 1.6 Write property test for expense transformation consistency
  - **Property 1: Expense field name transformation consistency**
  - **Validates: Requirements 1.1, 1.2, 12.3**

- [ ]* 1.7 Write property test for reverse transformation consistency
  - **Property 2: Expense field name reverse transformation consistency**
  - **Validates: Requirements 1.3, 1.4**

- [ ]* 1.8 Write property test for electric vehicle charge mapping
  - **Property 3: Electric vehicle charge mapping**
  - **Validates: Requirements 1.5**

- [ ]* 1.9 Write property test for legacy expense compatibility
  - **Property 7: Legacy expense compatibility**
  - **Validates: Requirements 3.3**

- [x] 1.10 Update frontend expense service with transformations
  - Update `frontend/src/lib/services/expense-api.ts` to import and use ApiTransformer
  - Apply toBackendExpense in create and update methods
  - Apply fromBackendExpense in get methods
  - Update TypeScript types for Expense interface
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 1.11 Update expense form component
  - Update `frontend/src/lib/components/expenses/ExpenseForm.svelte` to use transformed service methods
  - Ensure form validation aligns with backend CONFIG.validation.expense
  - Update field labels if needed
  - _Requirements: 1.1, 1.2, 16.2, 16.4_

- [x] 1.12 Update offline sync manager with transformations
  - Update `frontend/src/lib/utils/sync-manager.ts` to use ApiTransformer
  - Transform offline expenses before syncing to backend
  - Create migration function for existing offline storage
  - Run migration on app initialization
  - Add version flag to offline storage format
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ]* 1.13 Write property test for offline expense transformation
  - **Property 25: Offline expense field transformation**
  - **Validates: Requirements 12.3**

- [ ]* 1.14 Write property test for offline validation consistency
  - **Property 26: Offline expense validation consistency**
  - **Validates: Requirements 12.4**

- [x] 1.15 Update frontend type definitions
  - Update `frontend/src/lib/types/index.ts` with backend-aligned types
  - Add BackendExpenseRequest and BackendExpenseResponse interfaces
  - Update Expense interface with JSDoc comments explaining field mappings
  - Add type guards for field name checking
  - _Requirements: 17.1, 17.2_

- [x] 1.16 Update frontend analytics pages
  - Update `frontend/src/routes/dashboard/+page.svelte` to call new analytics endpoint
  - Update `frontend/src/routes/analytics/+page.svelte` to call new analytics endpoints
  - Update `frontend/src/lib/utils/analytics-api.ts` with correct endpoint paths
  - Handle loading and error states for analytics requests
  - Update data structure handling for new response format
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 1.17 Create validation rules constants file
  - Create `frontend/src/lib/utils/validation-rules.ts` with backend-aligned rules
  - Export validation limits matching backend CONFIG.validation
  - Update vehicle form validation to use these constants
  - Update expense form validation to use these constants
  - Update financing form validation to use these constants
  - _Requirements: 16.1, 16.2, 16.3, 16.4_

- [ ]* 1.18 Write property test for validation consistency
  - **Property 34: Validation rule consistency**
  - **Validates: Requirements 16.1, 16.2, 16.3**

- [ ]* 1.19 Write property test for fuel expense required fields
  - **Property 35: Fuel expense required fields**
  - **Validates: Requirements 16.4**

- [x] 1.20 Update error handling throughout frontend
  - Update `frontend/src/lib/utils/error-handling.ts` to parse new error format
  - Create parseBackendError function for `{ success: false, error: { code, message, details } }` format
  - Update handleApiError to use new parser
  - Add error code to user-friendly message mapping
  - Update form error display logic to use error.details
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ]* 1.21 Write property test for error format consistency
  - **Property 13: Error response format consistency**
  - **Validates: Requirements 6.1**

- [ ]* 1.22 Write property test for error message extraction
  - **Property 14: Error message extraction**
  - **Validates: Requirements 6.2**

- [ ]* 1.23 Write property test for validation error field mapping
  - **Property 15: Validation error field mapping**
  - **Validates: Requirements 6.5**

- [x] 1.24 Update tags system throughout frontend
  - Update expense display components to use tags array
  - Update expense creation to populate tags array
  - Update expense filtering to match tags correctly
  - Remove any remaining references to deprecated type field
  - _Requirements: 3.1, 3.2, 3.5_

- [ ]* 1.25 Write property test for tags array handling
  - **Property 6: Tags array handling**
  - **Validates: Requirements 3.2, 3.4**

- [ ]* 1.26 Write property test for tag filtering
  - **Property 8: Tag filtering correctness**
  - **Validates: Requirements 3.5**

- [x] 1.27 Audit and update API versioning
  - Search all fetch calls in frontend for unversioned endpoints
  - Update any remaining unversioned endpoints to use `/api/v1/` prefix
  - Update test mocks to use versioned endpoints
  - _Requirements: 5.1_

- [ ]* 1.28 Write property test for API versioning compliance
  - **Property 11: API versioning compliance**
  - **Validates: Requirements 5.1**

- [ ]* 1.29 Write property test for backend redirect correctness
  - **Property 12: Backend redirect correctness**
  - **Validates: Requirements 5.3**

- [x] 1.30 Update query parameter handling
  - Update expense API service to build query strings with correct parameter names
  - Ensure dates are converted to ISO format for query parameters
  - Ensure tags are comma-separated in query string
  - Update vehicle filtering to use vehicleId parameter
  - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

- [ ]* 1.31 Write property test for query parameter date format
  - **Property 30: Query parameter date format**
  - **Validates: Requirements 18.4**

- [ ]* 1.32 Write property test for expense query filter application
  - **Property 31: Expense query filter application**
  - **Validates: Requirements 18.5**

- [x] 1.33 Verify and update financing components
  - Confirm generateAmortizationSchedule is used (not API calls)
  - Confirm validateLoanTerms is used for validation
  - Confirm calculatePaymentBreakdown is used for breakdowns
  - Remove any references to removed `/api/financing/:financingId/schedule` endpoint
  - Update financing form to use `/api/v1/financing/vehicles/:vehicleId/financing` endpoint
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 13.1, 13.2, 13.3_

- [ ]* 1.34 Write property test for loan terms validation
  - **Property 9: Loan terms validation**
  - **Validates: Requirements 4.2**

- [ ]* 1.35 Write property test for payment breakdown accuracy
  - **Property 10: Payment breakdown calculation accuracy**
  - **Validates: Requirements 4.3**

- [ ]* 1.36 Write property test for financing upsert behavior
  - **Property 27: Financing upsert behavior**
  - **Validates: Requirements 13.3**

- [ ]* 1.37 Write property test for initial financing balance
  - **Property 28: Initial financing balance**
  - **Validates: Requirements 13.5**

- [ ]* 1.38 Write property test for conditional loan validation
  - **Property 29: Conditional loan validation**
  - **Validates: Requirements 13.2**

- [x] 1.39 Update settings and sync components
  - Update settings store to use `/api/v1/sync/configure` for sync settings
  - Update sync status display to show separate timestamps for sheets and backup
  - Update backup/restore flows to handle field name transformations
  - Verify Google Drive integration compatibility
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 11.4_

- [ ]* 1.40 Write property test for sync timestamp updates
  - **Property 17: Sync timestamp updates**
  - **Validates: Requirements 7.5**

- [ ]* 1.41 Write property test for backup validation
  - **Property 16: Backup validation rejection**
  - **Validates: Requirements 7.2**

- [ ]* 1.42 Write property test for settings partial update
  - **Property 23: Settings partial update**
  - **Validates: Requirements 11.1**

- [ ]* 1.43 Write property test for settings validation bounds
  - **Property 24: Settings validation bounds**
  - **Validates: Requirements 11.5**

- [x] 1.44 Update vehicle statistics integration
  - Verify vehicleApi.getVehicleStats uses correct endpoint and period parameter
  - Update VehicleStats type to match backend response
  - Add null checks in stats display components for vehicles without data
  - Ensure period parameter is sent correctly
  - _Requirements: 8.1, 8.2, 8.4, 8.5_

- [ ]* 1.45 Write property test for statistics period filtering
  - **Property 18: Vehicle statistics period filtering**
  - **Validates: Requirements 8.2**

- [x] 1.46 Update insurance policy components
  - Verify insurance policy endpoints are correct
  - Update policy display components to show expirationAlert data
  - Add severity-based styling (high = red, medium = yellow)
  - Show days until expiration prominently
  - _Requirements: 9.1, 9.2, 9.3, 9.5_

- [ ]* 1.47 Write property test for expiration alert generation
  - **Property 20: Insurance expiration alert generation**
  - **Validates: Requirements 9.2, 9.3**

- [x] 1.48 Update payment history integration
  - Verify vehicleApi.getFinancingPayments uses correct endpoint
  - Update PaymentHistory component to handle response structure
  - Add empty state for vehicles without financing
  - Ensure payment data display includes all required fields
  - _Requirements: 10.1, 10.2, 10.3, 10.5, 19.1, 19.4_

- [ ]* 1.49 Write property test for payment history sorting
  - **Property 21: Payment history sorting**
  - **Validates: Requirements 10.1, 19.4**

- [ ]* 1.50 Write property test for payment ownership verification
  - **Property 22: Payment ownership verification**
  - **Validates: Requirements 10.2**

- [x] 1.51 Update financing payment recording
  - Verify endpoint `/api/v1/financing/:financingId/payment` is used
  - Remove any client-side balance calculations (backend handles this)
  - Update payment form validation
  - Ensure payment number auto-increment is handled by backend
  - _Requirements: 19.1, 19.2, 19.3, 19.5_

- [ ]* 1.52 Write property test for payment calculation correctness
  - **Property 32: Payment calculation correctness**
  - **Validates: Requirements 19.2**

- [ ]* 1.53 Write property test for payment number increment
  - **Property 33: Payment number increment**
  - **Validates: Requirements 19.5**

- [x] 1.54 Update expense category handling
  - Verify category endpoint `/api/v1/expenses/categories` is called
  - Update category selectors to use backend labels and descriptions
  - Cache category data to minimize API calls
  - Add dynamic category support
  - _Requirements: 14.1, 14.2, 14.5_

- [x] 1.55 Run frontend validation
  - Run `npm run all:fix` in frontend directory
  - Run `npm run validate` in frontend directory
  - Fix any linting, formatting, or type errors
  - Ensure all tests pass

- [x] 1.56 Run backend validation
  - Run `bun run all:fix` in backend directory
  - Run `bun run validate` in backend directory
  - Fix any linting, formatting, or type errors
  - Ensure all tests pass

- [x] 1.57 Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
