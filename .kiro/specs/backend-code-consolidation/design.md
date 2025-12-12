# Design Document

## Overview

This design outlines a comprehensive refactoring of the backend codebase to eliminate duplication, improve organization, and establish clearer architectural boundaries. The refactoring maintains backward compatibility while modernizing patterns and consolidating scattered functionality.

### Expected File Reduction

**Files to Remove** (24 files):
- `lib/utils/error-handler.ts`
- `lib/utils/error-response.ts`
- `lib/repositories/factory.ts`
- `lib/repositories/interfaces.ts`
- `lib/repositories/backup.ts` (merge into backup-service)
- `lib/auth/lucia-provider.ts`
- `lib/services/sync/sync-errors.ts`
- `lib/services/sync/constants.ts`
- `lib/services/sync/backup-parser.ts` (merge into backup-service)
- `lib/services/sync/backup-validator.ts` (merge into backup-service)
- `lib/services/sync/drive-sync.ts` (merge into google-sync)
- `lib/services/sync/sheets-sync.ts` (merge into google-sync)
- `lib/services/tracking/activity-tracker.ts` (merge into user-activity-tracker)
- `lib/services/tracking/change-tracker.ts` (merge into user-activity-tracker)
- `lib/services/tracking/sync-lock.ts` (inline into orchestrator)
- `lib/constants/backup.ts`
- `lib/constants/database.ts` (merge into app-config)
- `lib/constants/pagination.ts` (merge into app-config)
- `lib/constants/session.ts` (merge into app-config)
- `lib/constants/time.ts` (merge into app-config)
- `lib/middleware/change-tracker.ts` (inline)
- `lib/middleware/body-limit.ts` (use Hono's built-in)
- `lib/middleware/checkpoint.ts` (inline)
- `lib/middleware/idempotency.ts` (move to services/sync/)

**Files to Create** (10 files):
- `lib/core/errors/classes.ts`
- `lib/core/errors/handlers.ts`
- `lib/core/errors/responses.ts`
- `lib/core/errors/index.ts`
- `lib/types/sync.ts`
- `lib/types/analytics.ts`
- `lib/types/database.ts`
- `lib/constants/app-config.ts` (merged constants)
- `lib/services/sync/backup-service.ts` (merged backup files)
- `lib/services/sync/google-sync.ts` (merged drive + sheets)
- `lib/services/sync/tracking/user-activity-tracker.ts` (merged tracking)

**Files to Move** (3 files):
- `lib/utils/query-builder.ts` → `lib/repositories/query-builder.ts`
- `lib/utils/drive-service-helper.ts` → `lib/services/integrations/drive-helper.ts`
- `lib/utils/loan-calculator.ts` → `lib/services/analytics/loan-calculator.ts`

**Net Reduction**: ~14-16 files (depending on stub files present)
**Improved Organization**: Clearer structure with better domain boundaries

## Architecture

### Current State Analysis

The backend follows a layered architecture:
- **Core Layer**: Configuration, database, errors
- **Data Layer**: Repositories with factory pattern
- **Service Layer**: Business logic (analytics, sync, tracking)
- **Middleware Layer**: Request interceptors (auth, rate limiting, error handling)
- **Utility Layer**: Helpers (logger, query builder, error responses)

**Issues Identified:**
1. Error handling split across 3 files (`core/errors.ts`, `utils/error-handler.ts`, `utils/error-response.ts`)
2. Database service mixes concerns (validation, health checks, transactions)
3. Inconsistent repository patterns (some use QueryBuilder, others don't)
4. Duplicate error response formatting logic
5. Auth module has unnecessary provider abstraction
6. Constants scattered with some duplication
7. Service layer lacks consistent dependency injection

### Target Architecture

```
lib/
├── core/                    # Core infrastructure
│   ├── config.ts           # Environment & configuration
│   ├── database.ts         # Database service (simplified)
│   └── errors/             # Consolidated error handling
│       ├── classes.ts      # Error classes
│       ├── handlers.ts     # Error handling logic
│       ├── responses.ts    # Response formatting
│       └── index.ts        # Exports
├── constants/              # Configuration constants
│   ├── index.ts           # Central export
│   ├── database.ts
│   ├── validation.ts
│   ├── rate-limits.ts
│   ├── sync.ts            # Merged backup + sync constants
│   └── ...
├── repositories/           # Data access layer (simplified)
│   ├── base.ts            # BaseRepository (simplified)
│   ├── query-builder.ts   # Moved from utils
│   ├── index.ts           # Direct exports
│   └── [entity].ts        # Entity repositories
├── services/              # Business logic by domain
│   ├── analytics/
│   │   ├── analytics-service.ts
│   │   ├── expense-calculator.ts
│   │   ├── loan-calculator.ts  # Moved from utils
│   │   └── types.ts
│   ├── integrations/      # External service integrations
│   │   ├── google-drive.ts
│   │   ├── google-sheets.ts
│   │   └── drive-helper.ts  # Moved from utils
│   └── sync/              # Sync operations
│       ├── backup/
│       ├── restore/
│       ├── tracking/      # Activity & change tracking
│       ├── sync-orchestrator.ts
│       └── types.ts
├── middleware/            # Request/response interceptors
│   ├── auth.ts
│   ├── error-handler.ts   # Uses core/errors
│   ├── activity-tracker.ts  # Thin wrapper
│   └── ...
├── auth/                  # Authentication (simplified)
│   └── lucia.ts          # Single file for Lucia setup
├── utils/                 # Pure utilities only
│   ├── logger.ts
│   ├── timeout.ts
│   └── unit-conversions.ts
└── types/                 # Shared type definitions
    ├── index.ts
    ├── api.ts             # API responses
    ├── sync.ts            # Sync/backup types
    ├── analytics.ts       # Analytics types
    └── database.ts        # Re-exports from schema
```

## Components and Interfaces

### 1. Consolidated Error System

**Directory: `lib/core/errors/`**

Consolidates all error-related functionality into a structured module:

**`lib/core/errors/classes.ts`**
- Error classes (AppError, ValidationError, etc.)
- Sync error classes (SyncError, SyncErrorCode)
- Type guards (isAppError, isOperationalError)

**`lib/core/errors/handlers.ts`**
- Database error handling (handleDatabaseError)
- Sync error handling (handleSyncError)
- HTTP status mapping

**`lib/core/errors/responses.ts`**
- Error response formatting (formatErrorResponse)
- Response creation (createErrorResponse, createSuccessResponse)
- Response interfaces (ErrorResponse, SuccessResponse)

**`lib/core/errors/index.ts`**
- Re-exports all error functionality

**Sources Consolidated**:
- `lib/core/errors.ts` → `errors/classes.ts`
- `lib/utils/error-handler.ts` → `errors/handlers.ts`
- `lib/utils/error-response.ts` → `errors/responses.ts`
- `lib/services/sync/sync-errors.ts` → `errors/classes.ts`

**Rationale**: Organized error system with clear separation of concerns - classes, handlers, and responses.

### 2. Simplified Database Service

**File: `lib/core/database.ts`**

Streamlined responsibilities:
- Database instance management
- Repository factory access
- Health checks
- Transaction wrapper
- Test database support

**Removed**:
- Legacy validation functions (migrate to Zod schemas in routes)
- Duplicate error exports (use core/errors directly)

```typescript
export class DatabaseService {
  private static instance: DatabaseService;
  private testDatabase: typeof db | null = null;

  getDatabase() { ... }
  getRepositories() { ... }
  async healthCheck() { ... }
  async shutdown() { ... }
  async transaction<T>(...) { ... }
  setTestDatabase(...) { ... } // For testing only
}

export const databaseService = DatabaseService.getInstance();
export type Database = typeof db;
```

**Rationale**: Clear separation of concerns - database service manages connections, repositories manage data access.

### 3. Simplified Repository Pattern

**Simplification: Remove factory pattern and interfaces**

The factory pattern and interfaces add unnecessary complexity without providing dependency injection benefits.

**Changes**:
1. Move QueryBuilder from `utils/` to `repositories/`
2. Remove `repositories/factory.ts`
3. Remove `repositories/interfaces.ts`
4. Simplify `repositories/base.ts` (remove test hooks)
5. Export repository instances directly from `repositories/index.ts`

**New Pattern**:
```typescript
// repositories/index.ts
import { db } from '../../db/connection';

export const userRepository = new UserRepository(db);
export const vehicleRepository = new VehicleRepository(db);
export const expenseRepository = new ExpenseRepository(db);
// ... etc

// For testing, repositories can be instantiated with test db
export { UserRepository, VehicleRepository, ExpenseRepository };
```

**Repository Implementation**:
```typescript
export class UserRepository extends BaseRepository<User, NewUser> {
  private queryBuilder: QueryBuilder<User>;

  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, users);
    this.queryBuilder = new QueryBuilder(db);
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.queryBuilder.findOne(users, eq(users.email, email));
  }
}
```

**Rationale**: Simpler, more direct, easier to understand. Factory pattern without DI framework is over-engineering.

### 4. Service Layer Reorganization

**Reorganization: Group services by business domain**

**Current Issues**:
- `services/restore/` should be under `services/sync/`
- `services/tracking/` should be under `services/sync/`
- `services/google/` should be renamed to `services/integrations/`
- Utilities mixed in wrong locations

**New Structure**:
```
services/
├── analytics/
│   ├── analytics-service.ts
│   ├── expense-calculator.ts
│   ├── loan-calculator.ts      # Moved from utils
│   └── types.ts
├── integrations/               # Renamed from google/
│   ├── google-drive.ts
│   ├── google-sheets.ts
│   └── drive-helper.ts         # Moved from utils
└── sync/
    ├── backup/
    │   ├── backup-creator.ts
    │   ├── backup-parser.ts
    │   └── backup-validator.ts
    ├── restore/                # Moved from top level
    │   ├── conflict-detector.ts
    │   ├── data-importer.ts
    │   └── restore-executor.ts
    ├── tracking/               # Moved from top level
    │   ├── activity-tracker.ts
    │   ├── change-tracker.ts
    │   └── sync-lock.ts
    ├── drive-sync.ts
    ├── sheets-sync.ts
    ├── sync-orchestrator.ts
    └── types.ts                # Consolidated sync types
```

**Service Instantiation**:
```typescript
// Direct instantiation with repository dependencies
export const analyticsService = new AnalyticsService(
  expenseRepository,
  vehicleRepository
);
```

**Rationale**: Clear domain boundaries, related functionality grouped together, easier navigation.

### 5. Simplified Auth Module

**Consolidation: Merge lucia.ts and lucia-provider.ts**

The provider abstraction adds unnecessary complexity. Merge into single file:

```typescript
// lib/auth/lucia.ts
export const lucia = new Lucia(...);
export const google = new Google(...);
export type AuthUser = User;

// For testing only
let testLucia: Lucia | null = null;
export function getLucia(): Lucia {
  return testLucia || lucia;
}
export function setTestLucia(instance: Lucia | null) {
  testLucia = instance;
}
```

**Rationale**: Simpler, fewer files, testing support maintained.

### 6. Middleware Improvements

**Standardization**:
- All middleware uses centralized logger
- All middleware uses core/errors for error handling
- Consistent error response format
- Clear separation of concerns

**Example**:
```typescript
// middleware/error-handler.ts
import { formatErrorResponse, isAppError, SyncError } from '../core/errors';

export const errorHandler: ErrorHandler = (err, c) => {
  // Use consolidated error formatting
  const response = formatErrorResponse(err, isDevelopment);
  return c.json(response, response.statusCode);
};
```

### 7. Constants Consolidation

**Consolidation: Merge sync-related constants**

**Changes**:
1. Merge `constants/backup.ts` + `services/sync/constants.ts` → `constants/sync.ts`
2. Remove duplicate time constants
3. Ensure consistent naming conventions

**New Structure**:
```
constants/
├── index.ts              # Re-exports all
├── database.ts          # Database settings
├── pagination.ts        # Pagination limits
├── rate-limits.ts       # Rate limit configs
├── session.ts           # Session/auth settings
├── sync.ts              # Merged backup + sync constants
├── time.ts              # Time constants
└── validation.ts        # Validation limits
```

**Example Consolidation**:
```typescript
// constants/sync.ts
export const SYNC_CONFIG = {
  // From backup.ts
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  CURRENT_VERSION: '1.0.0',
  SUPPORTED_MODES: ['preview', 'replace', 'merge'] as const,
  DEFAULT_RETENTION_COUNT: 10,
  
  // From services/sync/constants.ts
  FOLDER_NAMES: {
    MAIN: 'VROOM',
    RECEIPTS: 'Receipts',
    MAINTENANCE: 'Maintenance Records',
    PHOTOS: 'Vehicle Photos',
    BACKUPS: 'Backups',
  },
  // ... etc
} as const;
```

**Rationale**: Single source for all sync-related configuration, eliminates duplication.

### 8. Tracking Middleware Consolidation

**Problem**: Duplicate tracking logic in middleware and services

**Current State**:
- `middleware/activity-tracker.ts` - Middleware wrapper
- `services/tracking/activity-tracker.ts` - Service implementation
- `middleware/change-tracker.ts` - Middleware wrapper
- `services/tracking/change-tracker.ts` - Service implementation

**Solution**: Keep services, make middleware thin wrappers

**Middleware Pattern**:
```typescript
// middleware/activity-tracker.ts
import { activityTracker } from '../services/sync/tracking/activity-tracker';

export const activityTrackerMiddleware = async (c: Context, next: Next) => {
  await next();
  
  const user = c.get('user');
  if (user && shouldTrack(c)) {
    // Delegate to service
    await activityTracker.recordActivity(user.id, getTrackingConfig(user.id));
  }
};
```

**Rationale**: Middleware should be thin, business logic in services. Eliminates duplication.

### 9. Type Definition Consolidation

**Problem**: Types scattered across multiple locations

**Current State**:
- `lib/types/api-response.ts` (only 1 file)
- `lib/services/analytics/types.ts`
- `lib/services/sync/types.ts`
- Types in `db/schema.ts`

**Solution**: Centralize domain types

**New Structure**:
```
types/
├── index.ts              # Re-exports all
├── api.ts               # API request/response types
├── sync.ts              # Sync/backup types (from services/sync/types.ts)
├── analytics.ts         # Analytics types (from services/analytics/types.ts)
└── database.ts          # Re-exports from db/schema.ts
```

**Example**:
```typescript
// types/sync.ts
export interface BackupMetadata { ... }
export interface BackupData { ... }
export interface RestoreMode { ... }

// types/analytics.ts
export interface AnalyticsQuery { ... }
export interface DashboardAnalytics { ... }

// types/database.ts
export type { User, Vehicle, Expense } from '../db/schema';
```

**Rationale**: Single location for type discovery, easier imports, better organization.

### 10. Utility Reorganization

**Moves and Removals**:
- `utils/error-handler.ts` → `core/errors/handlers.ts`
- `utils/error-response.ts` → `core/errors/responses.ts`
- `utils/query-builder.ts` → `repositories/query-builder.ts`
- `utils/drive-service-helper.ts` → `services/integrations/drive-helper.ts`
- `utils/loan-calculator.ts` → `services/analytics/loan-calculator.ts`

**Remaining Pure Utilities**:
```
utils/
├── logger.ts              # Singleton logger
├── timeout.ts             # Timeout utilities
└── unit-conversions.ts    # Unit conversion helpers
```

**Rationale**: Utilities should be pure helpers. Domain-specific logic belongs in services/repositories.

## Data Models

No changes to database schema or data models. This refactoring focuses on code organization, not data structure.

## Error Handling

### Consolidated Error Flow

```
Request → Middleware → Route Handler
                ↓
         Service Layer
                ↓
      Repository Layer
                ↓
         Database
                ↓
    Error (if occurs)
                ↓
    core/errors.ts (formatting)
                ↓
    middleware/error-handler.ts
                ↓
    JSON Response
```

### Error Response Format

Standardized across all endpoints:
```typescript
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: unknown
  }
}
```

## Testing Strategy

### Unit Testing Approach

1. **Repository Tests**: Use test database instance via `DatabaseService.setTestDatabase()`
2. **Service Tests**: Mock repository interfaces
3. **Middleware Tests**: Mock Hono context
4. **Error Handler Tests**: Verify response formatting

### Integration Testing

- Maintain existing integration test patterns
- Ensure backward compatibility
- Test error handling paths

### Migration Testing

- Run full test suite after each consolidation step
- Verify no behavioral changes
- Check for import errors

### 11. Additional Middleware Consolidations

**Problem**: Some middleware can be simplified or moved

**Changes**:

1. **Remove `body-limit.ts`**: Hono has built-in `bodyLimit()` middleware - use that instead
2. **Remove `checkpoint.ts`**: Inline checkpoint logic into routes that need it (or use a simpler approach)
3. **Move `idempotency.ts`**: This is sync-specific logic, move to `services/sync/idempotency.ts`
4. **Inline `change-tracker.ts`**: It's a thin wrapper - can inline the call directly in routes

**Rationale**: Reduce middleware files, use framework features, move domain logic to services.

### 12. Consolidate Backup Repository

**Problem**: `repositories/backup.ts` is just a convenience wrapper around other repositories

**Solution**: Move backup data fetching logic into `services/sync/backup-creator.ts`

The backup repository methods are only used by the backup service, so they belong there:

```typescript
// services/sync/backup-creator.ts
private async fetchUserData(userId: string) {
  const [vehicles, expenses, financing, payments, insurance] = await Promise.all([
    vehicleRepository.findByUserId(userId),
    expenseRepository.find({ userId }),
    vehicleFinancingRepository.findByUserId(userId),
    // ... etc
  ]);
  
  return { vehicles, expenses, financing, payments, insurance };
}
```

**Rationale**: Eliminates unnecessary repository layer, keeps backup logic together.

### 13. Merge Backup Service Files

**Problem**: Three tightly-coupled backup files that are always used together

**Current State**:
- `backup-creator.ts` - Creates backups
- `backup-parser.ts` - Parses backup files
- `backup-validator.ts` - Validates backup data

**Solution**: Merge into single `backup-service.ts`

```typescript
// services/sync/backup-service.ts
export class BackupService {
  // Creation
  async createBackup(userId: string): Promise<BackupData> { ... }
  async exportAsZip(userId: string): Promise<Buffer> { ... }
  
  // Parsing
  async parseZipBackup(file: Buffer): Promise<ParsedBackupData> { ... }
  private parseCSV(content: string): Record<string, unknown>[] { ... }
  
  // Validation
  validateBackupData(backup: ParsedBackupData): ValidationResult { ... }
  validateFileSize(size: number): ValidationResult { ... }
  validateUserId(backupUserId: string, requestUserId: string): ValidationResult { ... }
  
  // Private helpers
  private convertToCSV(data: Record<string, unknown>[], columns: string[]): string { ... }
  private getColumnNames(table: any): string[] { ... }
}
```

**Rationale**: These are all backup operations, always used together. Single service is more cohesive.

### 14. Merge Google Sync Services

**Problem**: `drive-sync.ts` and `sheets-sync.ts` have duplicate code

**Duplicate Code**:
- `getUserWithToken()` - Identical in both files
- Error handling patterns - Same SyncError usage
- Settings repository access - Same pattern

**Solution**: Merge into `google-sync.ts`

```typescript
// services/sync/google-sync.ts
export class GoogleSyncService {
  // Drive operations
  async uploadBackupToDrive(userId: string): Promise<BackupSyncResult> { ... }
  async listDriveBackups(userId: string) { ... }
  async initializeDrive(userId: string) { ... }
  
  // Sheets operations
  async syncToSheets(userId: string): Promise<SheetsSyncResult> { ... }
  
  // Shared private methods (DRY)
  private async getUserWithToken(userId: string) { ... }
  private async getSettings(userId: string) { ... }
  private handleAuthError(error: unknown): never { ... }
}
```

**Rationale**: Eliminates 50+ lines of duplicate code, clearer API.

### 15. Merge Small Constants Files

**Problem**: 4 tiny constants files with 5-15 lines each

**Current State**:
- `database.ts` - 7 lines
- `pagination.ts` - 5 lines
- `session.ts` - 6 lines
- `time.ts` - 15 lines

**Solution**: Merge into `app-config.ts`

```typescript
// constants/app-config.ts
export const APP_CONFIG = {
  DATABASE: {
    CACHE_SIZE: 1_000_000,
    WAL_CHECKPOINT_PAGES: 1000,
    CHECKPOINT_INTERVAL_DEV: 5 * 60 * 1000,
    CHECKPOINT_INTERVAL_PROD: 15 * 60 * 1000,
    QUERY_TIMEOUT: 30_000,
  },
  PAGINATION: {
    DEFAULT_PAGE_SIZE: 20,
    MAX_PAGE_SIZE: 100,
    MIN_PAGE_SIZE: 1,
  },
  SESSION: {
    COOKIE_MAX_AGE: 30 * 24 * 60 * 60,
    SESSION_DURATION: 30 * 24 * 60 * 60 * 1000,
    REFRESH_THRESHOLD: 24 * 60 * 60 * 1000,
    OAUTH_STATE_EXPIRY: 10 * 60 * 1000,
  },
  TIME: {
    MS_PER_MINUTE: 60 * 1000,
    MS_PER_HOUR: 60 * 60 * 1000,
    MS_PER_DAY: 24 * 60 * 60 * 1000,
    SECONDS_PER_HOUR: 60 * 60,
    SECONDS_PER_DAY: 24 * 60 * 60,
  },
} as const;
```

**Rationale**: These are all app-level config, not domain-specific. Single file is easier to find.

### 16. Consolidate Tracking Services

**Problem**: Two tracking services that both track user activity

**Current State**:
- `activity-tracker.ts` - Tracks user activity for sync triggers
- `change-tracker.ts` - Tracks data changes for sync optimization

**Solution**: Merge into `user-activity-tracker.ts`

```typescript
// services/sync/tracking/user-activity-tracker.ts
export class UserActivityTracker {
  // Activity tracking (for sync triggers)
  recordUserActivity(userId: string, config: ActivityConfig): void { ... }
  getLastActivity(userId: string): Date | null { ... }
  
  // Change tracking (for sync optimization)
  markDataChanged(userId: string): Promise<void> { ... }
  hasChangesSinceLastSync(userId: string): Promise<boolean> { ... }
  getChangeStatus(userId: string): Promise<ChangeStatus> { ... }
}
```

**Rationale**: Both track user activity, just different aspects. Single service is clearer.

### 17. Inline Sync Lock

**Problem**: `sync-lock.ts` is likely a simple lock mechanism in its own file

**Solution**: Inline into `sync-orchestrator.ts`

```typescript
// services/sync/sync-orchestrator.ts
export class SyncOrchestrator {
  private activeSyncs = new Map<string, Promise<unknown>>();
  
  private async withLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    if (this.activeSyncs.has(userId)) {
      throw new SyncError(SyncErrorCode.SYNC_IN_PROGRESS, 'Sync already in progress');
    }
    
    const promise = operation();
    this.activeSyncs.set(userId, promise);
    
    try {
      return await promise;
    } finally {
      this.activeSyncs.delete(userId);
    }
  }
}
```

**Rationale**: Simple lock logic doesn't need its own file. Keeps orchestrator self-contained.

### 18. Remove Stub Files and Incomplete Features

**Problem**: Empty stub files and commented-out code

**Files to Remove**:
- `routes/analytics.ts` - Empty stub (if exists)
- `routes/sharing.ts` - Empty stub (if exists)
- Vehicle sharing code comments in repositories

**Rationale**: Remove dead code and stubs. Implement features when ready, don't leave placeholders.

## Implementation Phases

### Phase 1: Error System Consolidation (High Priority)
- Create `core/errors/` directory structure
- Split error functionality into classes, handlers, responses
- Update all imports across codebase
- Remove old error files
- **Impact**: Removes 3 files, creates 4 files (net +1 but better organized)

### Phase 2: Repository Simplification (High Priority)
- Move QueryBuilder to repositories/
- Remove factory.ts, interfaces.ts, and backup.ts
- Simplify base.ts (remove test hooks)
- Update repositories/index.ts with direct exports
- Move backup data fetching to backup-creator service
- Update all repository consumers
- **Impact**: Removes 3 files, moves 1 file (net -3)

### Phase 3: Service Reorganization (High Priority)
- Move restore/ and tracking/ under sync/
- Rename google/ to integrations/
- Move domain-specific utilities to services
- Move idempotency from middleware to services/sync/
- Update all service imports
- **Impact**: Removes 1 file, moves 4 files (net -1)

### Phase 4: Middleware Simplification (High Priority)
- Remove body-limit.ts (use Hono's built-in)
- Remove checkpoint.ts (inline where needed)
- Inline change-tracker.ts logic
- Make activity-tracker.ts a thin wrapper
- Update middleware to use core/errors
- **Impact**: Removes 3 files (net -3)

### Phase 5: Constants Consolidation (Medium Priority)
- Merge backup.ts and sync/constants.ts into sync.ts
- Remove duplicate constants
- Update all constant imports
- **Impact**: Removes 2 files, creates 1 file (net -1)

### Phase 6: Type Consolidation (Medium Priority)
- Create types/ directory structure
- Move service types to centralized location
- Create database.ts re-exports
- Update all type imports
- **Impact**: Creates 3 files (net +3 but better organized)

### Phase 7: Auth Simplification (Low Priority)
- Merge lucia.ts and lucia-provider.ts
- Update auth imports
- Maintain test support
- **Impact**: Removes 1 file (net -1)

### Phase 8: Cleanup (Low Priority)
- Remove stub files (analytics, sharing routes)
- Remove commented-out code
- Update documentation
- **Impact**: Removes 0-2 files depending on stubs present

**Total Expected Reduction**: 8-11 files removed, better organization throughout

## Migration Path

### Direct Migration Approach

All changes will be direct one-to-one replacements:
- Consolidate files immediately
- Update all imports in a single pass
- Remove old files completely
- No deprecation period needed

### Rollout Plan

1. Consolidate modules into new locations
2. Update all imports across the codebase
3. Remove old duplicate files
4. Verify all tests pass

## Performance Considerations

- No performance impact expected
- Potential improvements from reduced module loading
- QueryBuilder may improve query consistency

## Security Considerations

- No security changes
- Maintain existing auth patterns
- Ensure error messages don't leak sensitive data

## Documentation Updates

- Update README with new structure
- Document architectural decisions
- Add migration guide for developers
- Update code comments
