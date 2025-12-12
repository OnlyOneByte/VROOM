# Implementation Plan

This plan consolidates the backend refactoring into a single comprehensive task with subtasks. The refactoring focuses on merging duplicate code and simplifying the codebase structure.

- [ ] 1. Backend Refactoring - Consolidate and Simplify Codebase
  - _Requirements: All requirements (1.1-9.5)_

    - [x] 1.1 Create merged error handling file
    - Merge `lib/core/errors/classes.ts`, `lib/core/errors/handlers.ts`, and `lib/core/errors/responses.ts` into single `lib/core/errors.ts` file
    - Export all error classes, handlers, and response formatters from one place
    - Keep all existing functionality intact
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

    - [x] 1.2 Create shared calculation utilities
    - Create `lib/utils/calculations.ts` with all calculation functions
    - Extract `calculateMPG`, `calculateAverageMPG`, `calculateCostPerMile` from `lib/services/analytics/expense-calculator.ts`
    - Extract `groupByPeriod`, `roundCurrency` functions from analytics services
    - Implement as pure functions, not classes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

    - [ ]* 1.3 Write property test for fuel efficiency calculations
    - **Property 4: Fuel Efficiency Calculation Consistency**
    - **Validates: Requirements 4.1**

    - [ ]* 1.4 Write property test for cost per mile calculations
    - **Property 5: Cost Per Mile Calculation Consistency**
    - **Validates: Requirements 4.2**

    - [ ]* 1.5 Write property test for date grouping
    - **Property 6: Date Grouping Consistency**
    - **Validates: Requirements 4.3**

    - [x] 1.6 Create shared validation schemas
    - Create `lib/utils/validation.ts` with common validation schemas
    - Add `commonSchemas.idParam`, `commonSchemas.vehicleIdParam`
    - Add `commonSchemas.pagination`, `commonSchemas.dateRange`
    - Review existing route files to identify duplicate param schemas
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

    - [x] 1.7 Create merged constants file
    - Create `lib/constants.ts` merging all constant files
    - Merge `lib/constants/app-config.ts`, `lib/constants/rate-limits.ts`, `lib/constants/sync.ts`, `lib/constants/validation.ts`
    - Export `APP_CONFIG`, `RATE_LIMITS`, `VALIDATION_LIMITS`, `BACKUP_CONFIG`, `SYNC_CONFIG`
    - Keep `lib/constants/index.ts` as barrel export
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

    - [x] 1.8 Create merged sync service
    - Create `lib/services/sync.ts` merging backup, google, and orchestrator services
    - Merge `lib/services/sync/backup-service.ts`, `lib/services/sync/google-sync.ts`, `lib/services/sync/sync-orchestrator.ts`
    - Keep all methods, just consolidate into one or two classes (BackupService + SyncService)
    - Export service instances
    - Keep `lib/services/sync/restore/` and `lib/services/sync/tracking/` subdirectories as-is
    - _Requirements: 4.5, 6.1, 6.2_

    - [x] 1.9 Create merged analytics service
    - Create `lib/services/analytics.ts` merging analytics, expense calculator, and loan calculator
    - Merge `lib/services/analytics/analytics-service.ts`, `lib/services/analytics/expense-calculator.ts`, `lib/services/analytics/loan-calculator.ts`
    - Update calculation methods to use shared `lib/utils/calculations.ts` functions
    - Keep all methods in one class
    - Keep `lib/services/analytics/types.ts` for type definitions
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

    - [ ]* 1.10 Write unit tests for merged analytics service
    - Test dashboard analytics calculation
    - Test vehicle analytics calculation
    - Test loan amortization schedule generation
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

    - [x] 1.11 Create merged financing repository
    - Create `lib/repositories/financing.ts` merging financing and payment repositories
    - Merge `lib/repositories/vehicleFinancing.ts` and `lib/repositories/vehicleFinancingPayment.ts`
    - Add payment methods to financing repository class
    - _Requirements: 1.1, 1.2, 1.5, 6.1_

    - [x] 1.12 Update all imports to use new merged files
    - Update all repositories to import from `lib/core/errors.ts`
    - Update repositories to import from `lib/constants.ts`
    - Update sync routes to import from `lib/services/sync.ts`
    - Update analytics routes to import from `lib/services/analytics.ts`
    - Update services and routes to use merged financing repository
    - Remove all old imports
    - _Requirements: 1.3, 2.3, 3.1, 5.1_

    - [x] 1.13 Update routes to use shared validation schemas
    - Update `routes/expenses.ts` to use `commonSchemas.idParam` and `commonSchemas.vehicleIdParam`
    - Update `routes/vehicles.ts` to use `commonSchemas.idParam`
    - Update `routes/financing.ts` to use `commonSchemas.idParam` and `commonSchemas.vehicleIdParam`
    - Update `routes/insurance.ts` to use `commonSchemas.idParam` and `commonSchemas.vehicleIdParam`
    - Remove duplicate param schema definitions
    - _Requirements: 2.1, 2.4, 2.5, 7.1, 7.2, 7.3, 7.4, 7.5_

    - [x] 1.14 Update routes to use shared response formatters
    - Update all routes to use `createSuccessResponse` and `createErrorResponse` from `lib/core/errors.ts`
    - Ensure consistent response format across all endpoints
    - _Requirements: 2.2, 3.1, 3.3_

    - [ ]* 1.15 Write property test for response format consistency
    - **Property 1: Response Format Consistency**
    - **Validates: Requirements 2.2**

    - [ ]* 1.16 Write property test for error transformation consistency
    - **Property 2: Error Transformation Consistency**
    - **Validates: Requirements 3.1, 3.3**

    - [ ]* 1.17 Write property test for SQLite error mapping
    - **Property 3: SQLite Error Mapping Consistency**
    - **Validates: Requirements 3.2**

    - [x] 1.18 Delete old files
    - Delete `lib/core/errors/classes.ts`, `lib/core/errors/handlers.ts`, `lib/core/errors/responses.ts`
    - Delete `lib/core/errors/index.ts` (replaced by `lib/core/errors.ts`)
    - Delete `lib/services/sync/backup-service.ts`, `lib/services/sync/google-sync.ts`, `lib/services/sync/sync-orchestrator.ts`
    - Delete `lib/services/analytics/analytics-service.ts`, `lib/services/analytics/expense-calculator.ts`, `lib/services/analytics/loan-calculator.ts`
    - Delete `lib/repositories/vehicleFinancing.ts`, `lib/repositories/vehicleFinancingPayment.ts`
    - Delete `lib/constants/app-config.ts`, `lib/constants/rate-limits.ts`, `lib/constants/sync.ts`, `lib/constants/validation.ts`
    - Delete empty `lib/services/analytics/` and `lib/services/sync/` directories if no other files remain
    - _Requirements: 1.5, 2.5, 3.4, 4.5, 6.1_

    - [x] 1.19 Update barrel exports
    - Update `lib/repositories/index.ts` to export merged financing repository
    - Update `lib/constants/index.ts` to export from merged constants file
    - Ensure all new files are properly exported
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

    - [x] 1.20 Run validation and ensure all tests pass
    - Run `bun run all:fix` in backend directory to auto-fix lint/format issues
    - Run `bun run validate` in backend directory
    - Ensure all tests pass, ask the user if questions arise
    - _Requirements: All requirements_

    - [ ]* 1.21 Write integration tests for API behavior preservation
    - **Property 8: API Behavior Preservation**
    - Test that all API endpoints return same responses after refactoring
    - Test expense endpoints
    - Test vehicle endpoints
    - Test financing endpoints
    - Test sync endpoints
    - **Validates: All requirements**
