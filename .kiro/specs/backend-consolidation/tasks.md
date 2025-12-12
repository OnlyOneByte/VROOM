# Implementation Plan

- [x] 1. Consolidate and restructure the VROOM backend codebase
  - Create new consolidated files (config, types, errors, middleware)
  - Create feature-based domain directories
  - Migrate all functionality to new structure
  - Remove old directory structure
  - Verify all functionality works
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.2, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 1.1 Create consolidated config.ts file
  - Merge lib/constants.ts, lib/constants/index.ts, and lib/core/config.ts
  - Create single CONFIG object with all application configuration
  - Include: env, server, database, auth, cors, logging, pagination, rateLimit, backup, validation, time
  - Export as const for type safety
  - _Requirements: 2.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 1.2 Create consolidated types.ts file
  - Merge all 12 type files from src/types/, lib/types/, and service-specific types
  - Re-export database entity types from db/schema
  - Include: API types, Analytics types, Sync types, Enums
  - Organize with clear section comments
  - Remove duplicate type definitions
  - _Requirements: 4.4, 8.3_

- [x] 1.3 Keep errors.ts as-is (already consolidated)
  - Verify lib/core/errors.ts contains all error classes, handlers, and response formatters
  - No changes needed - this file is already well-organized
  - _Requirements: 2.2, 3.2_

- [x] 1.4 Create consolidated middleware.ts file
  - Merge all 8 middleware files from lib/middleware/
  - Include: requireAuth, optionalAuth, bodyLimit, rateLimiter, idempotency, errorHandler, activityTracker, changeTracker, checkpointAfterWrite
  - Keep each middleware as a separate exported function
  - Maintain all existing functionality
  - _Requirements: 2.4, 5.5_

- [x] 1.5 Simplify db/connection.ts with helper functions
  - Remove dependency on lib/core/database.ts
  - Add helper functions: setTestDb, getDb, transaction
  - Keep existing: checkpointWAL, forceCheckpointWAL, checkDatabaseHealth, closeDatabaseConnection
  - Export db instance directly
  - _Requirements: 2.1_

- [x] 1.6 Create utils/base-repository.ts
  - Move lib/repositories/base.ts to utils/base-repository.ts
  - Update imports to use errors from ../errors
  - Update imports to use logger from ./logger
  - Keep all existing functionality (findById, create, update, delete)
  - _Requirements: 3.1, 4.1_

- [x] 1.7 Create utils/query-builder.ts
  - Move lib/repositories/query-builder.ts to utils/query-builder.ts
  - Update imports to use getDb from ../db/connection
  - Keep all existing functionality (findOne, findMany, exists, count)
  - _Requirements: 3.1_

- [x] 1.8 Create auth/ directory structure
  - Create auth/lucia.ts (move from lib/auth/lucia.ts)
  - Create auth/routes.ts (move from routes/auth.ts)
  - Update imports to use new paths (../db/connection, ../config, ../errors, ../utils/logger)
  - _Requirements: 1.1, 1.2_

- [x] 1.9 Create vehicles/ domain directory
  - Create vehicles/repository.ts (move from lib/repositories/vehicle.ts)
  - Create vehicles/routes.ts (move from routes/vehicles.ts)
  - Create vehicles/analytics.ts (extract vehicle analytics from lib/services/analytics.ts)
  - Update all imports to use new structure
  - Export singleton: export const vehicleRepository = new VehicleRepository(getDb())
  - _Requirements: 1.1, 5.1, 5.3_

- [x] 1.10 Create expenses/ domain directory
  - Create expenses/repository.ts (move from lib/repositories/expense.ts)
  - Create expenses/routes.ts (move from routes/expenses.ts)
  - Create expenses/analytics.ts (extract expense analytics from lib/services/analytics.ts)
  - Update all imports to use new structure
  - Export singleton: export const expenseRepository = new ExpenseRepository(getDb())
  - _Requirements: 1.1, 5.1, 5.3_

- [x] 1.11 Create financing/ domain directory
  - Create financing/repository.ts (move from lib/repositories/financing.ts)
  - Create financing/routes.ts (move from routes/financing.ts)
  - Create financing/calculations.ts (extract loan calculations from lib/services/analytics.ts)
  - Update all imports to use new structure
  - Export singleton: export const financingRepository = new FinancingRepository(getDb())
  - _Requirements: 1.1, 5.1, 5.3_

- [x] 1.12 Create insurance/ domain directory
  - Create insurance/repository.ts (move from lib/repositories/insurancePolicy.ts)
  - Create insurance/routes.ts (move from routes/insurance.ts)
  - Update all imports to use new structure
  - Export singleton: export const insurancePolicyRepository = new InsurancePolicyRepository(getDb())
  - _Requirements: 1.1, 5.1, 5.3_

- [x] 1.13 Create settings/ domain directory
  - Create settings/repository.ts (move from lib/repositories/settings.ts)
  - Create settings/routes.ts (move from routes/settings.ts)
  - Update all imports to use new structure
  - Export singleton: export const settingsRepository = new SettingsRepository(getDb())
  - _Requirements: 1.1, 5.1, 5.3_

- [x] 1.14 Create sync/backup.ts
  - Extract BackupService class from lib/services/sync.ts
  - Include: createBackup, exportAsZip, parseZipBackup, validateBackupData
  - Include: CSV conversion helpers, validation helpers
  - Update imports to use new structure
  - Export singleton: export const backupService = new BackupService()
  - _Requirements: 7.2, 7.5_

- [x] 1.15 Create sync/google-drive.ts
  - Move lib/services/integrations/google-drive.ts to sync/google-drive.ts
  - Inline functionality from lib/services/integrations/drive-helper.ts
  - Update imports to use new structure
  - Keep all existing functionality
  - _Requirements: 7.1, 7.5_

- [x] 1.16 Create sync/google-sheets.ts
  - Move lib/services/integrations/google-sheets.ts to sync/google-sheets.ts
  - Update imports to use new structure
  - Keep all existing functionality
  - _Requirements: 7.1, 7.5_

- [x] 1.17 Create sync/restore.ts
  - Consolidate lib/services/sync/restore/conflict-detector.ts
  - Consolidate lib/services/sync/restore/data-importer.ts
  - Consolidate lib/services/sync/restore/restore-executor.ts
  - Create single RestoreService class with all restore operations
  - Include: restoreFromBackup, restoreFromSheets, autoRestoreFromLatestBackup
  - Include: conflict detection, data import, validation
  - Export singleton: export const restoreService = new RestoreService()
  - _Requirements: 7.2, 7.5_

- [x] 1.18 Create sync/activity-tracker.ts
  - Move lib/services/sync/tracking/user-activity-tracker.ts to sync/activity-tracker.ts
  - Keep all existing functionality (activity tracking, change tracking, auto-sync)
  - Update imports to use new structure
  - Export singleton: export const activityTracker = new ActivityTracker()
  - _Requirements: 7.3, 7.5_

- [x] 1.19 Create sync/routes.ts
  - Consolidate routes/sync/index.ts, routes/sync/backups.ts, routes/sync/restore.ts
  - Remove SyncOrchestrator usage, call services directly
  - Add simple lock management (Map-based) directly in routes
  - Include all sync endpoints: sync, status, configure, backups, restore
  - Update imports to use new structure
  - _Requirements: 2.3, 7.4_

- [x] 1.20 Update src/index.ts entry point
  - Update all route imports to use new domain structure
  - Update middleware imports to use ./middleware
  - Update config imports to use ./config
  - Update error handler import to use ./errors
  - Mount routes: auth, vehicles, expenses, financing, insurance, settings, sync
  - _Requirements: 1.3_

- [x] 1.21 Update all repository imports throughout codebase
  - Replace imports from lib/repositories with domain-specific imports
  - Example: import { vehicleRepository } from '../vehicles/repository'
  - Update in: routes, services, middleware
  - _Requirements: 1.3, 4.1_

- [x] 1.22 Update all type imports throughout codebase
  - Replace imports from src/types/, lib/types/, service types with ../types
  - Update in: all files that import types
  - Verify no duplicate type definitions remain
  - _Requirements: 1.3, 4.4_

- [x] 1.23 Update all config/constants imports throughout codebase
  - Replace imports from lib/constants, lib/core/config with ../config
  - Update in: all files that import configuration
  - Verify no duplicate constants remain
  - _Requirements: 1.3, 4.5_

- [x] 1.24 Update all middleware imports throughout codebase
  - Replace imports from lib/middleware/* with ../middleware
  - Update in: index.ts, route files
  - _Requirements: 1.3_

- [x] 1.25 Update all error imports throughout codebase
  - Replace imports from lib/core/errors with ../errors
  - Update in: all files that throw or handle errors
  - _Requirements: 1.3, 3.2_

- [x] 1.26 Run type checking and fix any import errors
  - Run: bun run type-check
  - Fix any TypeScript errors related to imports or types
  - Verify all files compile successfully
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 1.27 Run linting and formatting
  - Run: bun run all:fix
  - Fix any linting or formatting issues
  - Verify code style is consistent
  - _Requirements: 8.1, 8.4, 8.5_

- [x] 1.28 Run all existing tests
  - Run: bun run test
  - Verify all tests pass with new structure
  - Fix any test failures related to import changes
  - _Requirements: 6.1, 6.2_

- [x] 1.29 Test API endpoints manually
  - Start dev server: bun run dev
  - Test auth flow (login, callback, me, logout)
  - Test vehicle CRUD operations
  - Test expense CRUD operations
  - Test financing operations
  - Test insurance operations
  - Test settings operations
  - Test sync operations (backup, restore, sheets)
  - Verify all endpoints work correctly
  - _Requirements: 5.2_

- [x] 1.30 Remove old directory structure
  - Delete lib/repositories/ directory
  - Delete lib/services/ directory
  - Delete lib/middleware/ directory
  - Delete lib/types/ directory
  - Delete lib/constants/ directory
  - Delete lib/core/database.ts
  - Delete routes/ directory (old structure)
  - Verify no broken imports remain
  - _Requirements: 1.4, 8.2_

- [x] 1.31 Update README.md with new structure
  - Update project structure diagram
  - Update import examples
  - Update architecture section
  - Remove migration notes (no longer needed)
  - Add new structure explanation
  - _Requirements: 1.5_

- [x] 1.32 Run final validation
  - Run: bun run validate
  - Verify: type-check passes
  - Verify: biome check passes
  - Verify: all tests pass
  - Verify: build succeeds
  - _Requirements: All_

- [x] 1.33 Final verification and cleanup
  - Search for any remaining unused imports
  - Search for any remaining commented-out code
  - Verify all files follow naming conventions
  - Verify all exports are used
  - Ensure all tests pass, ask the user if questions arise
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.2, 9.4, 9.5_
