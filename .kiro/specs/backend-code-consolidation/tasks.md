# Implementation Plan

- [x] 1. Consolidate error handling system
  - Create new `lib/core/errors/` directory structure with classes, handlers, and responses modules
  - Update all imports across the codebase to use new error locations
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 1.1 Create error classes module
  - Create `lib/core/errors/classes.ts` with all error classes from `lib/core/errors.ts`
  - Integrate SyncError and SyncErrorCode from `lib/services/sync/sync-errors.ts`
  - Add type guards (isAppError, isOperationalError)
  - _Requirements: 1.1, 1.5_

- [x] 1.2 Create error handlers module
  - Create `lib/core/errors/handlers.ts` with database and sync error handlers
  - Move handleDatabaseError from current `lib/core/errors.ts`
  - Move handleSyncError from `lib/utils/error-handler.ts`
  - Add HTTP status mapping for all error types
  - _Requirements: 1.3, 1.5_

- [x] 1.3 Create error responses module
  - Create `lib/core/errors/responses.ts` with response formatting functions
  - Move ErrorResponse, SuccessResponse interfaces from `lib/utils/error-response.ts`
  - Move formatErrorResponse, createErrorResponse, createSuccessResponse functions
  - _Requirements: 1.2_

- [x] 1.4 Create error module index
  - Create `lib/core/errors/index.ts` that re-exports all error functionality
  - Ensure clean public API for error module
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 1.5 Update error imports across codebase
  - Update all files importing from `lib/core/errors.ts` to use `lib/core/errors/`
  - Update all files importing from `lib/utils/error-handler.ts`
  - Update all files importing from `lib/utils/error-response.ts`
  - Update all files importing from `lib/services/sync/sync-errors.ts`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 1.6 Remove old error files
  - Delete `lib/utils/error-handler.ts`
  - Delete `lib/utils/error-response.ts`
  - Delete `lib/services/sync/sync-errors.ts`
  - Delete old `lib/core/errors.ts`
  - _Requirements: 1.1_

- [x] 2. Simplify repository pattern
  - Move QueryBuilder, remove factory and interfaces, simplify base repository, update exports
  - Update all repository consumers to use new direct exports
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 2.1 Move QueryBuilder to repositories
  - Move `lib/utils/query-builder.ts` to `lib/repositories/query-builder.ts`
  - Update all imports of QueryBuilder
  - _Requirements: 3.1, 3.4_

- [x] 2.2 Remove repository factory and interfaces
  - Delete `lib/repositories/factory.ts`
  - Delete `lib/repositories/interfaces.ts`
  - _Requirements: 3.5_

- [x] 2.3 Simplify BaseRepository
  - Remove test database hooks from `lib/repositories/base.ts`
  - Simplify to focus on core CRUD operations
  - Ensure consistent use of QueryBuilder
  - _Requirements: 3.1, 3.2_

- [x] 2.4 Update repository exports
  - Modify `lib/repositories/index.ts` to export repository instances directly
  - Export repository classes for testing purposes
  - Remove factory-related exports
  - _Requirements: 3.5_

- [x] 2.5 Update repository consumers
  - Update all services to import repositories from new direct exports
  - Update routes to use new repository imports
  - Update any middleware using repositories
  - _Requirements: 3.1, 3.5_

- [x] 3. Reorganize and consolidate service layer
  - Move services to proper domain folders, merge related services, relocate utilities
  - Update all service imports across the codebase
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 3.1 Merge backup service files
  - Create `lib/services/sync/backup-service.ts` merging creator, parser, and validator
  - Move all backup creation logic from `backup-creator.ts`
  - Move all parsing logic from `backup-parser.ts`
  - Move all validation logic from `backup-validator.ts`
  - Update imports in sync-orchestrator and restore services
  - _Requirements: 4.1, 4.4_

- [x] 3.2 Remove old backup service files
  - Delete `lib/services/sync/backup-creator.ts`
  - Delete `lib/services/sync/backup-parser.ts`
  - Delete `lib/services/sync/backup-validator.ts`
  - _Requirements: 4.1_

- [x] 3.3 Merge Google sync services
  - Create `lib/services/sync/google-sync.ts` merging drive and sheets sync
  - Move drive operations from `drive-sync.ts`
  - Move sheets operations from `sheets-sync.ts`
  - Consolidate duplicate `getUserWithToken()` method
  - Consolidate duplicate error handling
  - Update imports in sync-orchestrator
  - _Requirements: 4.1, 4.4_

- [x] 3.4 Remove old Google sync files
  - Delete `lib/services/sync/drive-sync.ts`
  - Delete `lib/services/sync/sheets-sync.ts`
  - _Requirements: 4.1_

- [x] 3.5 Reorganize sync services
  - Move `lib/services/restore/` to `lib/services/sync/restore/`
  - Move `lib/services/tracking/` to `lib/services/sync/tracking/`
  - Update internal imports within sync services
  - _Requirements: 4.1, 4.4_

- [x] 3.6 Consolidate tracking services
  - Create `lib/services/sync/tracking/user-activity-tracker.ts`
  - Merge activity tracking from `activity-tracker.ts`
  - Merge change tracking from `change-tracker.ts`
  - Update imports in middleware and services
  - _Requirements: 4.1, 4.4_

- [x] 3.7 Remove old tracking files
  - Delete `lib/services/sync/tracking/activity-tracker.ts`
  - Delete `lib/services/sync/tracking/change-tracker.ts`
  - _Requirements: 4.1_

- [x] 3.8 Inline sync lock into orchestrator
  - Move lock logic from `sync-lock.ts` into `sync-orchestrator.ts`
  - Add `activeSyncs` Map and `withLock()` method to orchestrator
  - Update any imports of sync-lock
  - Delete `lib/services/sync/tracking/sync-lock.ts`
  - _Requirements: 4.1, 4.4_

- [x] 3.9 Rename and reorganize integration services
  - Rename `lib/services/google/` to `lib/services/integrations/`
  - Move `lib/utils/drive-service-helper.ts` to `lib/services/integrations/drive-helper.ts`
  - Update all imports of Google services
  - _Requirements: 4.1, 4.4_

- [x] 3.10 Move domain-specific utilities to analytics
  - Move `lib/utils/loan-calculator.ts` to `lib/services/analytics/loan-calculator.ts`
  - Update imports in analytics service
  - _Requirements: 4.1, 4.4_

- [x] 3.11 Update service imports across codebase
  - Update all route handlers importing services
  - Update middleware importing services
  - Update any service-to-service imports
  - _Requirements: 4.1, 4.4_

- [x] 4. Consolidate constants
  - Merge related constants, remove duplicates
  - Update all constant imports across the codebase
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 4.1 Merge small app-level constants
  - Create `lib/constants/app-config.ts`
  - Merge `database.ts`, `pagination.ts`, `session.ts`, and `time.ts` into nested structure
  - Export as single `APP_CONFIG` object with DATABASE, PAGINATION, SESSION, TIME properties
  - _Requirements: 6.1, 6.3_

- [x] 4.2 Merge sync constants
  - Create `lib/constants/sync.ts` merging `backup.ts` and `services/sync/constants.ts`
  - Include all backup, sync, and folder configuration constants
  - _Requirements: 6.1, 6.3, 6.4_

- [x] 4.3 Update constants index
  - Update `lib/constants/index.ts` to export new app-config and sync constants
  - Remove old constant exports
  - _Requirements: 6.2, 6.5_

- [x] 4.4 Update constant imports across codebase
  - Update all files importing from `lib/constants/database.ts`
  - Update all files importing from `lib/constants/pagination.ts`
  - Update all files importing from `lib/constants/session.ts`
  - Update all files importing from `lib/constants/time.ts`
  - Update all files importing from `lib/constants/backup.ts`
  - Update all files importing from `lib/services/sync/constants.ts`
  - _Requirements: 6.5_

- [x] 4.5 Remove old constant files
  - Delete `lib/constants/database.ts`
  - Delete `lib/constants/pagination.ts`
  - Delete `lib/constants/session.ts`
  - Delete `lib/constants/time.ts`
  - Delete `lib/constants/backup.ts`
  - Delete `lib/services/sync/constants.ts`
  - _Requirements: 6.4_

- [x] 5. Consolidate type definitions
  - Create centralized type modules for each domain
  - Update all type imports across the codebase
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 5.1 Create sync types module
  - Create `lib/types/sync.ts` with types from `lib/services/sync/types.ts`
  - Include BackupMetadata, BackupData, RestoreMode, etc.
  - _Requirements: 9.1, 9.2_

- [x] 5.2 Create analytics types module
  - Create `lib/types/analytics.ts` with types from `lib/services/analytics/types.ts`
  - Include AnalyticsQuery, DashboardAnalytics, VehicleAnalytics, etc.
  - _Requirements: 9.1, 9.2_

- [x] 5.3 Create database types module
  - Create `lib/types/database.ts` that re-exports types from `db/schema.ts`
  - Export User, Vehicle, Expense, and other entity types
  - _Requirements: 9.1, 9.2_

- [x] 5.4 Update types index
  - Update `lib/types/index.ts` to re-export all type modules
  - Ensure clean public API for types
  - _Requirements: 9.2, 9.3_

- [x] 5.5 Update type imports across codebase
  - Update all files importing types from service directories
  - Update files to use centralized type imports
  - _Requirements: 9.5_

- [x] 6. Consolidate tracking middleware
  - Make middleware thin wrappers around service implementations
  - Update middleware to delegate to services
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6.1 Simplify activity tracker middleware
  - Update `lib/middleware/activity-tracker.ts` to be thin wrapper
  - Delegate all logic to `lib/services/sync/tracking/activity-tracker.ts`
  - Remove duplicate logic
  - _Requirements: 5.1, 5.4_

- [x] 6.2 Simplify change tracker middleware
  - Update `lib/middleware/change-tracker.ts` to be thin wrapper (if exists)
  - Delegate all logic to `lib/services/sync/tracking/change-tracker.ts`
  - Remove duplicate logic
  - _Requirements: 5.1, 5.4_

- [x] 6.3 Update middleware error handling
  - Ensure all middleware uses `lib/core/errors/` for error handling
  - Update error-handler middleware to use consolidated errors
  - _Requirements: 5.2, 5.5_

- [x] 7. Simplify auth module
  - Merge lucia files into single module
  - Update all auth imports
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 7.1 Merge lucia files
  - Merge `lib/auth/lucia-provider.ts` into `lib/auth/lucia.ts`
  - Keep test support functions (getLucia, setTestLucia)
  - Maintain all type exports
  - _Requirements: 8.1, 8.3_

- [x] 7.2 Update auth imports
  - Update all files importing from `lib/auth/lucia-provider.ts`
  - Update to import directly from `lib/auth/lucia.ts`
  - _Requirements: 8.5_

- [x] 7.3 Remove old auth files
  - Delete `lib/auth/lucia-provider.ts`
  - _Requirements: 8.1_

- [x] 8. Clean up and remove stub files
  - Remove empty stub files and commented-out code
  - Clean up any remaining dead code
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 8.1 Remove stub route files
  - Delete `routes/analytics.ts` if it's an empty stub
  - Delete `routes/sharing.ts` if it's an empty stub
  - _Requirements: 10.1_

- [x] 8.2 Remove commented-out vehicle sharing code
  - Remove vehicle sharing comments from repository files
  - Remove any TODO comments related to unimplemented sharing
  - _Requirements: 10.2_

- [x] 8.3 Clean up remaining utilities
  - Verify only pure utilities remain in `lib/utils/`
  - Ensure logger, timeout, unit-conversions are the only files
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 9. Update documentation
  - Update code comments and documentation to reflect new structure
  - Document architectural decisions
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 9.1 Update README
  - Update backend README with new directory structure
  - Document the simplified patterns (no factory, direct exports)
  - Add migration notes for developers
  - _Requirements: 10.1, 10.2_

- [x] 9.2 Add architectural decision comments
  - Add file-level comments explaining module purposes
  - Document why factory pattern was removed
  - Document error system organization
  - _Requirements: 10.3, 10.4_

- [x] 9.3 Update inline documentation
  - Add JSDoc comments to complex functions
  - Update existing comments that reference old file locations
  - _Requirements: 10.3_

- [x] 10. Validate and test
  - Run validation scripts and ensure all tests pass
  - Verify no broken imports or missing files
  - _Requirements: All_

- [x] 10.1 Run backend validation
  - Execute `bun run validate` in backend directory
  - Fix any linting, formatting, or type errors
  - _Requirements: All_

- [x] 10.2 Run backend tests
  - Execute test suite to ensure no regressions
  - Verify repository tests work with new structure
  - Verify service tests work with reorganized services
  - _Requirements: All_

- [x] 10.3 Check for broken imports
  - Search for any remaining imports of deleted files
  - Verify all new imports resolve correctly
  - _Requirements: All_

- [x] 10.4 Verify build succeeds
  - Run production build to ensure no build errors
  - Check that all modules are properly resolved
  - _Requirements: All_
