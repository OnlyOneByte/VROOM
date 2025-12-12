# Design Document: Backend Consolidation

## Overview

This design outlines a comprehensive consolidation and simplification of the VROOM backend codebase. The refactoring will transform the current 60+ file structure into a more maintainable, readable architecture that prioritizes simplicity without sacrificing functionality.

**Core Philosophy:**
- Flat over nested (reduce directory depth)
- Direct over indirect (eliminate unnecessary abstractions)
- Consolidated over scattered (group related functionality)
- Simple over clever (prefer obvious solutions)

## Architecture

### Current Structure Problems

1. **Type Duplication**: Types defined in 3 places (src/types, lib/types, service-specific types)
2. **Mega Files**: analytics.ts and sync.ts are 1000+ lines each
3. **Inconsistent Patterns**: README references lib/core/errors/ subdirectory that doesn't exist
4. **Over-Abstraction**: Sync orchestrator adds complexity without clear value
5. **Scattered Logic**: Related functionality split across multiple directories

### Proposed Structure

```
backend/src/
├── index.ts                    # App entry point
├── config.ts                   # All configuration (env, constants, validation limits)
├── types.ts                    # All shared types (consolidated from 12 files)
├── errors.ts                   # All error classes and handlers (keep existing)
├── middleware.ts               # All middleware (8 files → 1 file)
├── db/
│   ├── schema.ts              # Database schema (no changes)
│   ├── connection.ts          # DB connection, WAL, and helper functions
│   ├── seed.ts                # Seed data (no changes)
│   └── types.ts               # DB-specific types and enums (no changes)
├── auth/
│   ├── lucia.ts               # Lucia setup (no changes)
│   └── routes.ts              # Auth routes (moved from routes/auth.ts)
├── vehicles/
│   ├── repository.ts          # Vehicle data access
│   ├── routes.ts              # Vehicle routes
│   └── analytics.ts           # Vehicle-specific analytics
├── expenses/
│   ├── repository.ts          # Expense data access
│   ├── routes.ts              # Expense routes
│   └── analytics.ts           # Expense-specific analytics
├── financing/
│   ├── repository.ts          # Financing data access
│   ├── routes.ts              # Financing routes
│   └── calculations.ts        # Loan amortization calculations
├── insurance/
│   ├── repository.ts          # Insurance data access
│   └── routes.ts              # Insurance routes
├── settings/
│   ├── repository.ts          # Settings data access
│   └── routes.ts              # Settings routes
├── sync/
│   ├── backup.ts              # Backup creation/parsing/validation
│   ├── google-drive.ts        # Google Drive operations
│   ├── google-sheets.ts       # Google Sheets operations
│   ├── restore.ts             # Restore operations (includes conflict detection, data import)
│   ├── activity-tracker.ts    # Activity and change tracking (unified)
│   └── routes.ts              # All sync routes (consolidated from routes/sync/*)
└── utils/
    ├── base-repository.ts     # BaseRepository class (moved from lib/repositories/)
    ├── query-builder.ts       # Reusable query patterns (moved from lib/repositories/)
    ├── logger.ts              # Logging utility (no changes)
    ├── calculations.ts        # Pure calculation functions (no changes)
    ├── validation.ts          # Validation schemas (no changes)
    └── unit-conversions.ts    # Unit display helpers (no changes)
```

**Key Changes:**
- **60+ files → ~35 files** (42% reduction)
- **4 levels deep → 2 levels deep** (lib/services/sync/restore/ → sync/)
- **12 type files → 1 type file** (types.ts)
- **8 middleware files → 1 middleware file** (middleware.ts)
- **3 config files → 1 config file** (config.ts)
- **Removed SyncOrchestrator** (unnecessary indirection)
- **Simplified DatabaseService** (class → helper functions)
- **Feature-based organization** (vehicles/, expenses/, sync/ instead of repositories/, services/, routes/)
- **Each domain is self-contained** with its repository, routes, and domain logic

## Components and Interfaces

### 1. Configuration Module (config.ts)

**Purpose:** Single source of truth for all configuration

**Consolidates:**
- lib/constants.ts (APP_CONFIG, RATE_LIMITS, BACKUP_CONFIG, VALIDATION_LIMITS)
- lib/constants/index.ts
- lib/core/config.ts

**Structure:**
```typescript
export const CONFIG = {
  env: Environment,
  server: { port, host },
  database: { url, cacheSize, walCheckpointPages },
  auth: { google, session },
  cors: { origins },
  logging: { level },
  pagination: { defaultPageSize, maxPageSize },
  rateLimit: { global, sync, backup, restore, driveInit },
  backup: { maxFileSize, currentVersion, supportedModes },
  validation: { vehicle, expense, insurance, financing, settings },
  time: { msPerMinute, msPerHour, msPerDay },
}
```

### 2. Types Module (types.ts)

**Purpose:** All shared type definitions in one place

**Consolidates:**
- src/types/* (api.ts, api-responses.ts, enums.ts, index.ts)
- lib/types/* (analytics.ts, api-response.ts, database.ts, sync.ts, index.ts)
- lib/services/analytics/types.ts
- lib/services/sync/types.ts

**Structure:**
```typescript
// Database entity types (re-exported from db/schema)
export type { User, Vehicle, Expense, ... }

// API types
export interface ApiResponse<T> { ... }

// Analytics types
export interface DashboardAnalytics { ... }
export interface VehicleAnalytics { ... }

// Sync types
export interface BackupData { ... }
export interface BackupMetadata { ... }

// Enums
export enum VehicleType { ... }
export enum ExpenseCategory { ... }
```

### 3. Error Module (errors.ts)

**Purpose:** All error handling in one file

**Consolidates:**
- lib/core/errors.ts (currently 400+ lines)
- Non-existent lib/core/errors/* subdirectory

**Structure:**
```typescript
// Error classes
export class AppError extends Error { ... }
export class ValidationError extends AppError { ... }
export class NotFoundError extends AppError { ... }
// ... other error classes

// Error handlers
export function handleDatabaseError(error: unknown): AppError { ... }
export function handleSyncError(c: Context, error: unknown): Response { ... }

// Response formatters
export function createErrorResponse(...): ErrorResponse { ... }
export function createSuccessResponse<T>(...): SuccessResponse<T> { ... }

// Type guards
export function isAppError(error: unknown): error is AppError { ... }
```

### 4. Middleware Module (middleware.ts)

**Purpose:** All middleware in one file

**Consolidates:**
- lib/middleware/activity-tracker.ts
- lib/middleware/auth.ts
- lib/middleware/body-limit.ts
- lib/middleware/change-tracker.ts
- lib/middleware/checkpoint.ts
- lib/middleware/error-handler.ts
- lib/middleware/idempotency.ts
- lib/middleware/rate-limiter.ts

**Structure:**
```typescript
// Auth middleware
export const requireAuth: MiddlewareHandler = ...
export const optionalAuth: MiddlewareHandler = ...

// Security middleware
export function bodyLimit(config): MiddlewareHandler { ... }
export function rateLimiter(config): MiddlewareHandler { ... }
export function idempotency(config): MiddlewareHandler { ... }

// Error handling
export const errorHandler: ErrorHandler = ...

// Tracking middleware
export const activityTracker: MiddlewareHandler = ...
export const changeTracker: MiddlewareHandler = ...
export const checkpointAfterWrite: MiddlewareHandler = ...
```

### 5. Domain Modules (vehicles/, expenses/, etc.)

**Purpose:** Self-contained feature modules

**Pattern for each domain:**
```typescript
// domain/repository.ts
export class DomainRepository extends BaseRepository { ... }
export const domainRepository = new DomainRepository(db);

// domain/routes.ts
const routes = new Hono();
routes.get('/', ...);
routes.post('/', ...);
export { routes };

// domain/analytics.ts (if needed)
export class DomainAnalytics { ... }
```

### 6. Sync Module (sync/)

**Purpose:** All sync/backup functionality

**Consolidates:**
- lib/services/sync.ts (1300+ lines → split into focused files)
- lib/services/integrations/* (3 files → 2 files)
- lib/services/sync/restore/* (3 files → 1 file)
- lib/services/sync/tracking/* (1 file → 1 file)
- routes/sync/* (3 files → 1 file)

**Removes:**
- SyncOrchestrator class (unnecessary indirection)
- drive-helper.ts (inline into google-drive.ts)

**Structure:**
```typescript
// sync/backup.ts - Backup creation, parsing, validation
export class BackupService {
  createBackup(userId): Promise<BackupData>
  exportAsZip(userId): Promise<Buffer>
  parseZipBackup(file): Promise<ParsedBackupData>
  validateBackupData(backup): ValidationResult
}
export const backupService = new BackupService();

// sync/google-drive.ts - Google Drive operations
export class GoogleDriveService {
  createVroomFolderStructure(userName): Promise<FolderStructure>
  uploadFile(name, content, mimeType, parentId?): Promise<DriveFile>
  downloadFile(fileId): Promise<Buffer>
  deleteFile(fileId): Promise<void>
  listFilesInFolder(folderId): Promise<DriveFile[]>
}

// sync/google-sheets.ts - Google Sheets operations
export class GoogleSheetsService {
  createOrUpdateVroomSpreadsheet(userId, userName): Promise<SpreadsheetInfo>
  readSpreadsheetData(spreadsheetId): Promise<ParsedBackupData>
}

// sync/restore.ts - All restore operations
export class RestoreService {
  restoreFromBackup(userId, file, mode): Promise<RestoreResponse>
  restoreFromSheets(userId, mode): Promise<RestoreResponse>
  autoRestoreFromLatestBackup(userId): Promise<AutoRestoreResult>
  // Includes: conflict detection, data import, validation
}
export const restoreService = new RestoreService();

// sync/activity-tracker.ts - Activity and change tracking
export class ActivityTracker {
  recordActivity(userId, config?): void
  markDataChanged(userId): Promise<void>
  hasChangesSinceLastSync(userId): Promise<boolean>
  getSyncStatus(userId): SyncStatus
  triggerManualSync(userId): Promise<SyncResult>
}
export const activityTracker = new ActivityTracker();

// sync/routes.ts - All sync routes (consolidated)
const routes = new Hono();
routes.post('/', handleSync);                    // Main sync endpoint
routes.get('/status', getSyncStatus);            // Sync status
routes.post('/configure', configureSyncSettings); // Update settings
routes.get('/backups', listBackups);             // List Drive backups
routes.get('/backups/download', downloadBackup); // Download local backup
routes.get('/backups/:fileId/download', downloadFromDrive);
routes.delete('/backups/:fileId', deleteBackup);
routes.post('/backups/initialize-drive', initializeDrive);
routes.post('/restore/from-backup', restoreFromBackup);
routes.post('/restore/from-sheets', restoreFromSheets);
routes.post('/restore/auto', autoRestore);
export { routes };
```

**Lock Management (Simplified):**
Instead of SyncOrchestrator, use simple Map in routes.ts:
```typescript
// sync/routes.ts
const syncLocks = new Map<string, number>(); // userId → timestamp

function acquireLock(userId: string): boolean {
  const existing = syncLocks.get(userId);
  if (existing && Date.now() - existing < 300000) return false;
  syncLocks.set(userId, Date.now());
  return true;
}

function releaseLock(userId: string): void {
  syncLocks.delete(userId);
}
```

**Benefits:**
- Direct service calls (no orchestrator indirection)
- Lock management co-located with routes
- Easier to understand flow
- ~200 lines of code removed

### 7. Base Repository Pattern (Keep)

**Location:** `utils/base-repository.ts` (moved from lib/repositories/base.ts)

**Purpose:** Provides common CRUD operations with consistent error handling and logging

**Benefits:**
- Eliminates ~100 lines of duplicate code per repository
- Consistent error handling (SQLite errors → typed errors)
- Consistent logging format
- Easy to extend for new repositories

```typescript
// utils/base-repository.ts
export abstract class BaseRepository<T, TNew> {
  protected queryBuilder: QueryBuilder<T>;
  
  constructor(protected db: Database, protected table: SQLiteTable) {
    this.queryBuilder = new QueryBuilder<T>(db);
  }
  
  async findById(id: string): Promise<T | null> { ... }
  async create(data: TNew): Promise<T> { ... }
  async update(id: string, data: Partial<TNew>): Promise<T> { ... }
  async delete(id: string): Promise<void> { ... }
}

// utils/query-builder.ts
export class QueryBuilder<T> {
  findOne(table, where, orderBy?): Promise<T | null>
  findMany(table, where?, orderBy?, limit?): Promise<T[]>
  exists(table, where): Promise<boolean>
  count(table, where?): Promise<number>
}

// Each domain/repository.ts
export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> {
  constructor(db: Database) {
    super(db, vehicles);
  }
  
  // Domain-specific methods
  async findByUserId(userId: string): Promise<Vehicle[]> { ... }
  async findByLicensePlate(plate: string): Promise<Vehicle | null> { ... }
}

// Export singleton instance
export const vehicleRepository = new VehicleRepository(getDb());
```

## Data Models

No changes to database schema - this refactoring is purely about code organization.

**Database Schema (db/schema.ts):**
- users
- vehicles
- vehicleFinancing
- vehicleFinancingPayments
- insurancePolicies
- expenses
- userSettings
- sessions

### Database Connection (Simplified)

**Current:** DatabaseService class with singleton pattern

**New:** Simple helper functions in db/connection.ts

```typescript
// db/connection.ts
export const db = drizzle(sqlite, { schema });

// Test database support
let testDb: typeof db | null = null;
export function setTestDb(database: typeof db | null): void {
  testDb = database;
}
export function getDb(): typeof db {
  return testDb || db;
}

// Utilities
export function checkDatabaseHealth(): boolean { ... }
export function closeDatabaseConnection(): void { ... }
export async function transaction<T>(callback: (tx) => Promise<T>): Promise<T> {
  return getDb().transaction(callback);
}

// WAL checkpoint functions (keep existing)
export function checkpointWAL(): void { ... }
export function forceCheckpointWAL(): void { ... }
```

**Benefits:**
- Simpler (no class, no singleton pattern)
- More direct (import what you need)
- Keeps test database swapping
- Keeps transaction helper
- Removes unnecessary abstraction

**Usage:**
```typescript
// In repositories
import { getDb } from '../db/connection';
const db = getDb();

// In tests
import { setTestDb } from '../db/connection';
setTestDb(testDatabase);
```

## Correctness Properties


*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Note on Testability:** Many of the acceptance criteria for this refactoring are structural requirements that can be verified through code inspection rather than runtime testing. These are marked as "examples" rather than "properties" because they verify specific structural characteristics rather than universal behaviors.

### Structural Verification (Examples)

**Example 1: Feature-based organization**
The codebase should be organized by feature/domain (vehicles/, expenses/, sync/) rather than technical layer (repositories/, services/, routes/).
**Validates: Requirements 1.1**

**Example 2: Reduced nesting**
The maximum directory depth should be reduced from 4+ levels to 2-3 levels maximum.
**Validates: Requirements 1.2**

**Example 3: File count reduction**
The total number of TypeScript files should be reduced from 60+ to approximately 35 files.
**Validates: Requirements 1.4**

**Example 4: No factory pattern**
The codebase should not contain repository factory files or dependency injection patterns.
**Validates: Requirements 2.1**

**Example 5: Single error module**
All error classes, handlers, and response formatters should be in a single errors.ts file.
**Validates: Requirements 2.2**

**Example 6: Simplified orchestration**
The sync orchestrator should be removed or significantly simplified, with sync operations directly accessible.
**Validates: Requirements 2.3**

**Example 7: Consolidated middleware**
All middleware should be in a single middleware.ts file (8 files → 1 file).
**Validates: Requirements 2.4**

**Example 8: Consolidated configuration**
All constants and configuration should be in a single config.ts file.
**Validates: Requirements 2.5, 10.1, 10.2, 10.3, 10.4, 10.5**

**Example 9: Single types file**
All shared type definitions should be in a single types.ts file (consolidating 3 locations).
**Validates: Requirements 4.4**

**Example 10: Domain self-containment**
Each domain directory (vehicles/, expenses/, etc.) should contain its repository, routes, and domain logic.
**Validates: Requirements 5.3**

**Example 11: Test file co-location**
Test files should be co-located with source files using .test.ts suffix.
**Validates: Requirements 6.4**

**Example 12: Sync module consolidation**
Google Drive, Sheets, backup, and restore operations should each be in separate, focused files within sync/.
**Validates: Requirements 7.1, 7.2, 7.3, 7.5**

### Universal Properties

**Property 1: Repository CRUD consistency**
*For all* repository classes, the base CRUD operations (findById, create, update, delete) should have identical signatures and error handling patterns.
**Validates: Requirements 3.1**

**Property 2: Error handling consistency**
*For all* error throws in the codebase, they should use error classes from the centralized errors module.
**Validates: Requirements 3.2**

**Property 3: Validation consistency**
*For all* route handlers that accept input, they should use Zod schemas with zValidator middleware.
**Validates: Requirements 3.3**

**Property 4: Async pattern consistency**
*For all* asynchronous operations, they should use async/await syntax without callback patterns.
**Validates: Requirements 3.4**

**Property 5: Logger consistency**
*For all* logging statements, they should use the same logger instance imported from utils/logger.
**Validates: Requirements 3.5**

**Property 6: No duplicate CRUD**
*For all* repository classes, common CRUD operations should only be implemented in BaseRepository, not duplicated in child classes.
**Validates: Requirements 4.1**

**Property 7: No duplicate utilities**
*For all* utility functions, each function should exist in only one location with a unique name.
**Validates: Requirements 4.3**

**Property 8: No duplicate constants**
*For all* configuration constants, each constant should be defined in only one location.
**Validates: Requirements 4.5**

**Property 9: Thin route handlers**
*For all* route handlers, they should delegate business logic to services/repositories and contain minimal logic themselves.
**Validates: Requirements 5.2**

**Property 10: Pure utility functions**
*For all* functions in utils/, they should be pure functions that don't modify external state or make I/O operations.
**Validates: Requirements 5.4**

**Property 11: Single-concern middleware**
*For all* middleware functions, they should have a single, clearly defined responsibility.
**Validates: Requirements 5.5**

**Property 12: No unused imports**
*For all* TypeScript files, they should have no unused import statements.
**Validates: Requirements 8.1**

**Property 13: No unused exports**
*For all* exported functions, classes, and types, they should be imported and used somewhere in the codebase.
**Validates: Requirements 8.2, 8.3**

**Property 14: No commented code**
*For all* TypeScript files, they should contain no commented-out code blocks.
**Validates: Requirements 8.4, 8.5**

**Property 15: Function naming convention**
*For all* function names, they should follow verb-noun patterns (e.g., createVehicle, findExpenses, validateBackup).
**Validates: Requirements 9.2**

**Property 16: No abbreviations in types**
*For all* type names, they should use full words without abbreviations (except common ones like ID, URL, API).
**Validates: Requirements 9.4**

**Property 17: Consistent export pattern**
*For all* modules, they should use named exports consistently (no mixing of default and named exports).
**Validates: Requirements 9.5**

## Error Handling

### Consolidated Error System

All error handling will be in a single `errors.ts` file:

```typescript
// Error classes (keep existing)
export class AppError extends Error { ... }
export class ValidationError extends AppError { ... }
export class NotFoundError extends AppError { ... }
export class DatabaseError extends AppError { ... }
export class SyncError extends Error { ... }

// Error handlers
export function handleDatabaseError(error: unknown): AppError
export function handleSyncError(c: Context, error: unknown, operation: string): Response

// Response formatters
export function createErrorResponse(code: string, message: string, details?: unknown): ErrorResponse
export function createSuccessResponse<T>(data?: T, message?: string): SuccessResponse<T>

// Type guards
export function isAppError(error: unknown): error is AppError
export function isSyncError(error: unknown): error is SyncError
```

### Error Handling Strategy

1. **Route Level**: Use try-catch in route handlers, delegate to error handlers
2. **Repository Level**: Throw typed errors (ValidationError, NotFoundError, DatabaseError)
3. **Service Level**: Throw SyncError for sync operations, AppError for others
4. **Middleware Level**: Global error handler catches all unhandled errors

## Testing Strategy

### Unit Testing Approach

**Focus Areas:**
- Repository CRUD operations
- Calculation functions (MPG, cost per mile, loan amortization)
- Validation functions
- Type conversion functions (CSV parsing)

**Testing Framework:** Bun's built-in test runner

**Test Organization:**
- Co-locate tests with source files using `.test.ts` suffix
- Example: `vehicles/repository.test.ts`, `sync/backup.test.ts`

**Test Patterns:**
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('VehicleRepository', () => {
  let testDb: Database;
  let repository: VehicleRepository;
  
  beforeEach(() => {
    testDb = createTestDatabase();
    repository = new VehicleRepository(testDb);
  });
  
  test('findById returns vehicle when exists', async () => {
    // Arrange
    const vehicle = await repository.create({ ... });
    
    // Act
    const found = await repository.findById(vehicle.id);
    
    // Assert
    expect(found).toEqual(vehicle);
  });
});
```

### Property-Based Testing

**Library:** fast-check (TypeScript property-based testing library)

**Installation:**
```bash
bun add -d fast-check
```

**Focus Areas:**
- Calculation functions (should work for all valid inputs)
- Validation functions (should correctly accept/reject inputs)
- Type conversion (CSV → objects should preserve data)
- Error handling (should always return proper error types)

**Property Test Patterns:**
```typescript
import { fc, test } from '@fast-check/ava';

test.prop([fc.integer({ min: 0 }), fc.float({ min: 0.01 })])(
  'calculateMPG returns non-negative for valid inputs',
  (miles, fuel) => {
    const mpg = calculateMPG(miles, fuel);
    return mpg >= 0;
  }
);
```

**Property Test Requirements:**
- Each property test should run minimum 100 iterations
- Each test should reference the design property it validates using format: `// Property X: <property text>`
- Property tests should be co-located with unit tests in `.test.ts` files

### Integration Testing

**Scope:** API endpoint testing with test database

**Approach:**
- Use Bun's test runner with Hono's test client
- Create test database for each test suite
- Test complete request/response cycles
- Verify authentication, validation, and error handling

## Implementation Strategy

### Phase 1: Create New Structure (Parallel Development)

Create the new structure alongside the existing code to avoid breaking changes:

1. Create new directory structure
2. Create consolidated files (config.ts, types.ts, errors.ts, middleware.ts)
3. Create domain directories with new implementations
4. Implement and test each domain module independently

### Phase 2: Migration

1. Update imports in index.ts to use new structure
2. Run tests to verify functionality
3. Fix any issues discovered
4. Remove old files once new structure is verified

### Phase 3: Cleanup

1. Remove old directory structure
2. Update README with new structure
3. Run full validation (lint, format, type-check, tests)
4. Verify all functionality works end-to-end

### Migration Safety

- Keep old files until new structure is fully tested
- Use git branches for safety
- Run comprehensive tests after each phase
- Verify API endpoints work with integration tests

## File Mapping

### Files to Consolidate

**Configuration (→ config.ts):**
- lib/constants.ts
- lib/constants/index.ts
- lib/core/config.ts

**Types (→ types.ts):**
- src/types/api.ts
- src/types/api-responses.ts
- src/types/enums.ts
- src/types/index.ts
- lib/types/analytics.ts
- lib/types/api-response.ts
- lib/types/database.ts
- lib/types/sync.ts
- lib/types/index.ts
- lib/services/analytics/types.ts
- lib/services/sync/types.ts

**Errors (→ errors.ts):**
- lib/core/errors.ts (keep as-is, it's already consolidated)

**Middleware (→ middleware.ts):**
- lib/middleware/activity-tracker.ts
- lib/middleware/auth.ts
- lib/middleware/body-limit.ts
- lib/middleware/change-tracker.ts
- lib/middleware/checkpoint.ts
- lib/middleware/error-handler.ts
- lib/middleware/idempotency.ts
- lib/middleware/rate-limiter.ts

**Vehicles Domain (→ vehicles/):**
- lib/repositories/vehicle.ts → vehicles/repository.ts
- routes/vehicles.ts → vehicles/routes.ts
- (analytics logic from lib/services/analytics.ts) → vehicles/analytics.ts

**Expenses Domain (→ expenses/):**
- lib/repositories/expense.ts → expenses/repository.ts
- routes/expenses.ts → expenses/routes.ts
- (analytics logic from lib/services/analytics.ts) → expenses/analytics.ts

**Financing Domain (→ financing/):**
- lib/repositories/financing.ts → financing/repository.ts
- routes/financing.ts → financing/routes.ts
- (loan calculations from lib/services/analytics.ts) → financing/calculations.ts

**Insurance Domain (→ insurance/):**
- lib/repositories/insurancePolicy.ts → insurance/repository.ts
- routes/insurance.ts → insurance/routes.ts

**Settings Domain (→ settings/):**
- lib/repositories/settings.ts → settings/repository.ts
- routes/settings.ts → settings/routes.ts

**Sync Domain (→ sync/):**
- (backup logic from lib/services/sync.ts) → sync/backup.ts
- lib/services/integrations/google-drive.ts → sync/google-drive.ts
- lib/services/integrations/google-sheets.ts → sync/google-sheets.ts
- lib/services/sync/restore/* → sync/restore.ts (consolidate conflict-detector, data-importer, restore-executor)
- lib/services/sync/tracking/user-activity-tracker.ts → sync/activity-tracker.ts
- routes/sync/* → sync/routes.ts (consolidate index.ts, backups.ts, restore.ts)
- **Remove:** SyncOrchestrator class (unnecessary indirection)

**Utilities (→ utils/):**
- lib/repositories/base.ts → utils/base-repository.ts (move)
- lib/repositories/query-builder.ts → utils/query-builder.ts (move)
- lib/utils/logger.ts → utils/logger.ts (keep)
- lib/utils/calculations.ts → utils/calculations.ts (keep)
- lib/utils/validation.ts → utils/validation.ts (keep)
- lib/utils/unit-conversions.ts → utils/unit-conversions.ts (keep)
- lib/utils/timeout.ts → utils/timeout.ts (keep, used in sync routes)

**Auth (→ auth/):**
- lib/auth/lucia.ts → auth/lucia.ts
- routes/auth.ts → auth/routes.ts

**Database (→ db/):**
- Keep all existing db/ files as-is (no changes needed)

### Files to Remove

**Complete directories to remove:**
- lib/repositories/ (moved to domain directories and utils/)
- lib/services/ (split into domain directories)
- lib/middleware/ (consolidated into middleware.ts)
- lib/types/ (consolidated into types.ts)
- lib/constants/ (consolidated into config.ts)
- routes/ (moved to domain directories)

**Specific files to remove:**
- lib/core/database.ts (simplified into db/connection.ts)
- lib/services/integrations/drive-helper.ts (inline into google-drive.ts)
- All 12 type definition files (consolidated into types.ts)
- All 8 middleware files (consolidated into middleware.ts)
- All 3 config/constants files (consolidated into config.ts)

**Total removal:** ~40 files removed, functionality preserved in ~35 new files

## Dependencies

**Keep All Existing Dependencies:**
- Bun runtime
- Hono framework
- Drizzle ORM
- Lucia Auth
- Zod validation
- Google APIs
- All other existing dependencies

**Add for Testing:**
- fast-check (property-based testing library)

## Performance Considerations

**No Performance Impact Expected:**
- File organization doesn't affect runtime performance
- Same database queries and operations
- Same middleware stack
- Same API endpoints

**Potential Improvements:**
- Faster IDE navigation (fewer files to search)
- Faster builds (fewer files to process)
- Better tree-shaking (clearer dependency graph)

## Security Considerations

**No Security Changes:**
- All existing security middleware remains
- Same authentication and authorization
- Same rate limiting
- Same input validation
- Same CSRF protection

**Verification:**
- All security tests must pass after refactoring
- Manual security review of auth and middleware consolidation

## Migration Path

### Step 1: Create Consolidated Files

Create new consolidated files without removing old ones:
- config.ts
- types.ts
- middleware.ts

### Step 2: Create Domain Directories

Create each domain directory with its files:
- vehicles/
- expenses/
- financing/
- insurance/
- settings/
- sync/
- auth/

### Step 3: Update Entry Point

Update src/index.ts to import from new structure.

### Step 4: Verify and Test

- Run type checking
- Run all tests
- Run validation script
- Test API endpoints manually

### Step 5: Remove Old Files

Once everything works, remove old directory structure:
- lib/repositories/
- lib/services/
- lib/middleware/
- lib/types/
- routes/ (old structure)

### Step 6: Update Documentation

- Update README.md with new structure
- Update any developer documentation
- Update import examples

## Rollback Plan

If issues arise:
1. Revert index.ts to use old imports
2. Keep old files until new structure is proven
3. Use git to revert changes if needed

## Success Criteria

1. All existing tests pass
2. `bun run validate` succeeds without warnings
3. All API endpoints function correctly
4. File count reduced from 60+ to ~35
5. Maximum directory depth reduced to 2-3 levels
6. All types consolidated into single file
7. All middleware consolidated into single file
8. All configuration consolidated into single file
9. Code is more readable and maintainable
10. New developers can understand structure quickly

## Design Decisions

### 1. BaseRepository Pattern: **Keep and Move**

**Decision:** Keep the BaseRepository pattern, move from `lib/repositories/base.ts` to `utils/base-repository.ts`

**Rationale:**
- Eliminates duplicate CRUD code across 7 repositories
- Provides consistent error handling (SQLite errors → typed errors)
- Provides consistent logging for all database operations
- Includes QueryBuilder for complex queries
- Easy to extend for new repositories

**What it provides:**
```typescript
abstract class BaseRepository<T, TNew> {
  findById(id: string): Promise<T | null>
  create(data: TNew): Promise<T>
  update(id: string, data: Partial<TNew>): Promise<T>
  delete(id: string): Promise<void>
  protected queryBuilder: QueryBuilder<T>
}
```

**Benefits:** Reduces ~100 lines of duplicate code per repository while maintaining clarity.

### 2. Sync Orchestrator: **Remove Completely**

**Decision:** Remove SyncOrchestrator class entirely

**Current problems:**
- Adds unnecessary indirection (routes → orchestrator → services)
- In-memory locks won't work in production (multi-instance deployments)
- Most methods just delegate to other services
- Adds complexity without clear value for single-instance app

**What it does:**
- Lock management (prevent concurrent syncs)
- Delegates to backupService and googleSyncService
- Aggregates results from multiple sync types

**New approach:**
- Routes call services directly
- Simple lock check in route handler (Map in routes.ts)
- If production scaling needed later, add Redis-based locking

**Before:**
```typescript
// routes/sync/index.ts
await syncOrchestrator.uploadBackupToDrive(userId)
  → await googleSyncService.uploadBackupToGoogleDrive(userId)
```

**After:**
```typescript
// sync/routes.ts
await googleSyncService.uploadBackupToGoogleDrive(userId)
```

**Benefits:** Removes ~200 lines of indirection, makes code flow obvious.

### 3. Test Location: **Keep Separate test/ Directory**

**Decision:** Keep tests in `backend/test/` directory (current structure)

**Rationale:**
- Matches current project structure
- Clear separation between source and tests
- Easier to exclude from builds
- Familiar pattern for the project

### 4. DatabaseService: **Simplify to Helper Functions**

**Decision:** Remove DatabaseService class, use simple helper functions

**Current DatabaseService:**
```typescript
class DatabaseService {
  setTestDatabase(testDb) { ... }
  getDatabase() { ... }
  healthCheck() { ... }
  shutdown() { ... }
  transaction(callback) { ... }
}
```

**New approach in db/connection.ts:**
```typescript
export const db = drizzle(sqlite, { schema });

// For testing
let testDb: typeof db | null = null;
export function setTestDb(db: typeof db | null) { testDb = db; }
export function getDb() { return testDb || db; }

// Utilities
export function checkDatabaseHealth(): boolean { ... }
export function closeDatabaseConnection(): void { ... }
export async function transaction<T>(callback: (tx) => Promise<T>): Promise<T> {
  return getDb().transaction(callback);
}
```

**Benefits:**
- ✅ Simpler (no class, no singleton pattern)
- ✅ More direct (just import what you need)
- ✅ Keeps test database swapping
- ✅ Keeps transaction helper
- ✅ Removes unnecessary abstraction

**Trade-off:** Slightly less "enterprise-y" but much more readable for a single-developer app.

## Next Steps

After design approval:
1. Create implementation task list
2. Begin Phase 1 (create new structure)
3. Implement domain by domain
4. Test thoroughly
5. Complete migration
6. Remove old files
7. Update documentation
