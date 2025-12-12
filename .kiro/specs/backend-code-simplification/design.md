# Design Document

## Overview

This design outlines a comprehensive code simplification strategy for the VROOM backend. The backend has already undergone file consolidation, but now requires deeper simplification at the code level. This is a refactoring effort focused on reducing complexity, improving readability, and making the codebase more maintainable for a single-developer open source project.

### Current State Analysis

**Total Lines of Code: 9,589 lines across 37 TypeScript files**

**Files Over 300 Lines (Hard to Read):**
- `sync/restore.ts` - 829 lines ⚠️
- `sync/google-sheets.ts` - 808 lines ⚠️
- `middleware.ts` - 531 lines ⚠️
- `sync/google-drive.ts` - 512 lines ⚠️
- `sync/backup.ts` - 511 lines ⚠️
- `sync/routes.ts` - 486 lines ⚠️
- `insurance/routes.ts` - 418 lines ⚠️
- `sync/activity-tracker.ts` - 404 lines ⚠️
- `financing/routes.ts` - 397 lines ⚠️
- `errors.ts` - 390 lines ⚠️
- `config.ts` - 339 lines ⚠️
- `expenses/routes.ts` - 313 lines ⚠️
- `types.ts` - 312 lines ⚠️

**13 files exceed 300 lines** - these are difficult to read and maintain.

### Expected Code Reduction

**Target: Reduce total codebase by 25-35% (2,400-3,350 lines)**

**Specific Reduction Targets:**

1. **sync/restore.ts (829 → ~400 lines)**: 
   - Remove verbose JSDoc comments (keep only essential)
   - Consolidate ConflictDetector, DataImporter, RestoreExecutor into single class
   - Simplify type conversion logic
   - **Savings: ~430 lines (52%)**

2. **sync/google-sheets.ts (808 → ~450 lines)**:
   - Remove verbose type definitions (use inline types)
   - Consolidate sheet update methods
   - Simplify data mapping logic
   - **Savings: ~360 lines (44%)**

3. **middleware.ts (531 → ~300 lines)**:
   - Remove unused middleware (checkpoint)
   - Simplify idempotency store (remove production warnings)
   - Consolidate rate limiter logic
   - **Savings: ~230 lines (43%)**

4. **sync/google-drive.ts (512 → ~350 lines)**:
   - Consolidate folder finding/creation logic
   - Remove duplicate helper functions
   - Simplify error handling
   - **Savings: ~160 lines (31%)**

5. **sync/backup.ts (511 → ~350 lines)**:
   - Simplify validation schema generation
   - Consolidate CSV conversion logic
   - Remove verbose comments
   - **Savings: ~160 lines (31%)**

6. **Route files (insurance/financing/expenses: ~1,128 → ~700 lines)**:
   - Extract common validation patterns
   - Consolidate ownership verification
   - Remove duplicate error handling
   - **Savings: ~430 lines (38%)**

7. **errors.ts (390 → ~250 lines)**:
   - Remove unused error formatters
   - Consolidate response creators
   - Simplify error mapping
   - **Savings: ~140 lines (36%)**

8. **config.ts (339 → ~250 lines)**:
   - Flatten unnecessary nesting
   - Remove verbose comments
   - Consolidate helper functions
   - **Savings: ~90 lines (26%)**

9. **types.ts (312 → ~200 lines)**:
   - Remove duplicate type definitions
   - Leverage Drizzle inference more
   - Consolidate enum definitions
   - **Savings: ~110 lines (35%)**

10. **Other files (~2,000 → ~1,500 lines)**:
    - Remove unused functions
    - Consolidate duplicates
    - Inline single-use helpers
    - **Savings: ~500 lines (25%)**

**Total Expected Savings: ~2,600 lines (27% reduction)**
**Target Codebase: ~7,000 lines**
**Files Over 300 Lines: 13 → 3-4 files**

### Readability Improvements

**File Size Guidelines:**
- **Ideal: < 200 lines** - Easy to read in one screen
- **Acceptable: 200-300 lines** - Manageable with scrolling
- **Needs Splitting: > 300 lines** - Hard to navigate and understand

**After Simplification:**
- Most files will be under 300 lines
- Only complex services (restore, google-sheets) may exceed 300 lines
- Better organization makes large files easier to navigate

The simplification will target:
- Repository layer: Remove unused methods, consolidate duplicates, simplify abstractions
- Route handlers: Extract business logic, reduce handler complexity
- Service layer: Convert thin services to utilities, keep only complex orchestration
- Utilities: Consolidate related functions, inline single-use functions
- Error handling: Standardize patterns, reduce duplication
- Middleware: Simplify responsibilities, remove unused middleware
- Configuration: Flatten unnecessary nesting, improve clarity
- Types: Consolidate duplicates, leverage Drizzle inference
- Database: Simplify connection management, standardize patterns
- Sync/Backup: Simplify orchestration, reduce abstraction layers, remove lock management

## Architecture

### Current Architecture

```
backend/
├── src/
│   ├── index.ts                 # Main application entry
│   ├── config.ts                # Centralized configuration
│   ├── errors.ts                # Error classes and handlers
│   ├── middleware.ts            # All middleware functions
│   ├── types.ts                 # Shared type definitions
│   ├── auth/                    # Authentication module
│   │   ├── lucia.ts
│   │   ├── routes.ts
│   │   └── utils.ts
│   ├── db/                      # Database layer
│   │   ├── connection.ts
│   │   ├── schema.ts
│   │   ├── types.ts
│   │   ├── init.ts
│   │   ├── checkpoint.ts
│   │   └── seed.ts
│   ├── vehicles/                # Vehicle module
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── expenses/                # Expense module
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── financing/               # Financing module
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── insurance/               # Insurance module
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── settings/                # Settings module
│   │   ├── repository.ts
│   │   └── routes.ts
│   ├── sync/                    # Sync and backup module
│   │   ├── routes.ts
│   │   ├── activity-tracker.ts
│   │   ├── backup.ts
│   │   ├── restore.ts
│   │   ├── google-drive.ts
│   │   └── google-sheets.ts
│   └── utils/                   # Utility functions
│       ├── logger.ts
│       ├── repository.ts
│       ├── validation.ts
│       ├── calculations.ts
│       ├── timeout.ts
│       ├── unit-conversions.ts
│       └── vehicle-stats.ts
```

### Target Architecture

The architecture remains the same, but with simplified implementations:
- Repositories: Leaner with only used methods
- Routes: Focused on HTTP concerns, delegating business logic
- Services: Converted to utilities where appropriate
- Utilities: Better organized by purpose
- Error handling: Consistent patterns throughout

## Components and Interfaces

### 1. Repository Layer Simplification

**Current Issues:**
- BaseRepository provides generic CRUD but some methods are unused
- Repository methods sometimes duplicate functionality
- Some repositories have methods that are never called

**Simplification Strategy:**
- Keep BaseRepository minimal: findById, create, update, delete
- Remove unused repository methods
- Consolidate duplicate methods (e.g., findByUserId vs findAccessibleVehicles)
- Use direct Drizzle queries for custom operations
- Let errors bubble to global handler

**Example Simplification:**
```typescript
// BEFORE: Multiple similar methods
async findByUserId(userId: string): Promise<Vehicle[]>
async findAccessibleVehicles(userId: string): Promise<VehicleWithFinancing[]>

// AFTER: Single method with options
async findByUserId(userId: string, includeFinancing = false): Promise<Vehicle[]>
```

### 2. Route Handler Simplification

**Current Issues:**
- Some route handlers contain business logic
- Validation logic is sometimes duplicated
- Complex handlers exceed 50 lines

**Simplification Strategy:**
- Extract business logic to utilities or services
- Use shared validation schemas from utils/validation.ts
- Break down complex handlers into helper functions
- Keep handlers focused on: validate → call repository/service → format response

**Example Simplification:**
```typescript
// BEFORE: Business logic in handler
routes.get('/:id/stats', async (c) => {
  // 50+ lines of calculation logic
});

// AFTER: Delegate to utility
routes.get('/:id/stats', async (c) => {
  const expenses = await expenseRepository.find({ vehicleId: id });
  const stats = calculateVehicleStats(expenses, vehicle.initialMileage);
  return c.json({ success: true, data: stats });
});
```

### 3. Service Layer Simplification

**Current Issues:**
- Some service classes have only 1-2 methods
- Some services just delegate to repositories
- Unnecessary abstraction layers

**Simplification Strategy:**
- Convert thin services (1-2 methods) to standalone utility functions
- Remove services that just delegate to repositories
- Keep services only for complex orchestration (e.g., RestoreExecutor)
- Move pure functions to utils/

**Services to Keep:**
- RestoreExecutor: Complex multi-step restore logic
- BackupService: Complex backup creation and validation
- GoogleDriveService: External API integration
- GoogleSheetsService: External API integration

**Services to Convert:**
- Simple calculation services → utils/calculations.ts
- Simple validation services → utils/validation.ts

### 4. Utility Function Consolidation

**Current Issues:**
- Some utilities are used in only one place
- Related utilities are scattered across files
- Some utility files are too small

**Simplification Strategy:**
- Group related utilities in same file
- Inline single-use utilities
- Consolidate small utility files
- Add JSDoc for complex utilities

**Utility Organization:**
```
utils/
├── logger.ts              # Logging (keep as-is)
├── repository.ts          # Base repository (keep as-is)
├── validation.ts          # All validation schemas and helpers
├── calculations.ts        # All calculation utilities
├── database.ts            # Database helpers (merge timeout, vehicle-stats)
├── formatting.ts          # Unit conversions and display formatting
└── errors.ts              # Error handling utilities (if needed)
```

### 5. Error Handling Standardization

**Current State:**
- Error classes defined in errors.ts
- Global error handler in middleware.ts
- Some duplication in error handling patterns

**Simplification Strategy:**
- Keep typed error classes (AppError, ValidationError, etc.)
- Standardize error throwing in repositories
- Use handleSyncError for sync operations
- Remove duplicate error handling code
- Ensure all errors flow through global handler

**Error Flow:**
```
Repository → Throw typed error → Global handler → HTTP response
Route → Throw typed error → Global handler → HTTP response
Sync → handleSyncError → Formatted response
```

### 6. Middleware Simplification

**Current Issues:**
- Some middleware might be doing too much
- Middleware responsibilities could be clearer

**Simplification Strategy:**
- Ensure each middleware has single responsibility
- Remove unused middleware
- Simplify complex middleware by delegating to services
- Keep middleware focused on cross-cutting concerns

**Middleware to Keep:**
- requireAuth: Authentication check
- optionalAuth: Optional authentication
- bodyLimit: Request size limiting
- rateLimiter: Rate limiting
- errorHandler: Global error handling
- activityTracker: User activity tracking
- changeTracker: Data change tracking
- idempotency: Idempotent request handling

### 7. Configuration Simplification

**Current State:**
- CONFIG object in config.ts with nested structure
- Some nesting might be unnecessary

**Simplification Strategy:**
- Flatten single-property nested objects
- Keep logical grouping for related config
- Add comments for complex sections
- Ensure all config comes from CONFIG object

**Example:**
```typescript
// BEFORE
auth: {
  session: {
    secret: env.SESSION_SECRET,
  }
}

// AFTER (if session only has secret)
auth: {
  sessionSecret: env.SESSION_SECRET,
}
```

### 8. Type Definition Consolidation

**Current Issues:**
- Some types might be duplicated
- Some types could use Drizzle inference

**Simplification Strategy:**
- Consolidate duplicate types in types.ts
- Use Drizzle's $inferSelect and $inferInsert
- Keep local types in their files if only used there
- Remove unused type definitions

### 9. Database Layer Simplification

**Current State:**
- Connection management in db/connection.ts
- Schema in db/schema.ts
- Types in db/types.ts

**Simplification Strategy:**
- Keep current structure (already well organized)
- Ensure all code uses getDb() for connections
- Standardize transaction usage
- Remove any unused database utilities

### 10. Sync/Backup Simplification

**Current Issues:**
- Lock management adds unnecessary complexity
- Some abstraction might be unnecessary
- Sync implementation is incomplete (marked as TODO)

**Simplification Strategy:**
- **Remove lock management entirely** - rely on rate limiting and idempotency middleware instead
- Ensure backup/restore logic is sequential and clear
- Remove unnecessary abstraction layers
- Keep service classes for complex operations (BackupService, RestoreExecutor, GoogleDriveService, GoogleSheetsService)

**Rationale for Removing Locks:**
- Rate limiting already prevents abuse (50 requests per 15 minutes)
- Idempotency middleware handles duplicate requests
- Single-user project doesn't need complex concurrency control
- Simpler code is easier to maintain
- Can add back later if concurrent sync becomes an actual problem

## Data Models

No changes to data models - this is a code simplification effort that maintains the existing database schema and API contracts.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, most acceptance criteria are about code organization and architecture rather than testable behavior. However, we can define a few properties for the testable aspects:

### Property 1: Repository error types
*For any* repository operation that fails due to a missing resource, the repository SHALL throw a NotFoundError instance
**Validates: Requirements 1.5, 5.1**

### Property 2: Validation error types
*For any* validation failure in the application, the system SHALL throw a ValidationError instance with a descriptive message
**Validates: Requirements 5.3**

### Property 3: Error handler status codes
*For any* typed error (AppError subclass), the global error handler SHALL return an HTTP status code that matches the error's statusCode property
**Validates: Requirements 5.4**

### Property 4: Type guard correctness
*For any* type guard function, it SHALL return true only for values that actually match the guarded type
**Validates: Requirements 8.4**

## Error Handling

### Error Types

All errors inherit from AppError or are standard JavaScript errors:
- **ValidationError** (400): Invalid input data
- **AuthenticationError** (401): Missing or invalid authentication
- **AuthorizationError** (403): Insufficient permissions
- **NotFoundError** (404): Resource not found
- **ConflictError** (409): Resource conflict (e.g., duplicate)
- **RateLimitError** (429): Too many requests
- **DatabaseError** (500): Database operation failed
- **SyncError**: Sync-specific errors with codes

### Error Flow

1. **Repository Layer**: Throws typed errors (NotFoundError, DatabaseError)
2. **Route Layer**: Throws typed errors or uses handleSyncError for sync operations
3. **Global Handler**: Catches all errors, formats response, returns appropriate status code

### Error Handling Patterns

```typescript
// Repository
async findById(id: string): Promise<T | null> {
  const result = await this.db.select()...;
  return result[0] || null; // Return null, let caller handle
}

// Route
const vehicle = await vehicleRepository.findById(id);
if (!vehicle) {
  throw new NotFoundError('Vehicle');
}

// Sync operations
try {
  // sync logic
} catch (error) {
  return handleSyncError(c, error, 'operation name');
}
```

## Testing Strategy

### Unit Testing

Since this is a refactoring effort, the focus is on maintaining existing functionality:

1. **Regression Testing**: Ensure all existing API endpoints continue to work
2. **Error Handling Tests**: Verify error types and status codes
3. **Repository Tests**: Verify CRUD operations work correctly
4. **Utility Tests**: Test pure functions with various inputs

### Property-Based Testing

Given that most requirements are about code organization rather than behavior, property-based testing is limited to:

1. **Error Type Properties**: Verify repositories throw correct error types
2. **Validation Properties**: Verify validation failures produce ValidationError
3. **Type Guard Properties**: Verify type guards correctly identify types
4. **Error Handler Properties**: Verify error-to-status-code mapping

### Testing Approach

- **No new tests required** for code organization changes
- **Existing tests must pass** after refactoring
- **Add tests only** for new utility functions or extracted logic
- **Manual testing** for API endpoints to ensure no regressions

### Test Organization

Tests are not part of this refactoring effort. The focus is on code simplification while maintaining existing functionality.

## Implementation Notes

### Breaking Changes

This refactoring may include breaking changes to internal APIs:
- Repository method signatures may change
- Service classes may be removed
- Utility function locations may change
- Internal error handling patterns may change

**External API contracts remain unchanged** - all HTTP endpoints maintain their current request/response formats.

### Migration Strategy

1. **Read all files**: Understand current implementation
2. **Identify simplifications**: Find unused code, duplicates, over-abstraction
3. **Refactor incrementally**: One module at a time
4. **Verify functionality**: Ensure no regressions
5. **Update imports**: Fix any broken imports from moved code

### Performance Considerations

- Simplification should not impact performance
- Removing abstraction layers may slightly improve performance
- Database query patterns remain unchanged
- No changes to caching or optimization strategies

### Security Considerations

- Authentication and authorization logic remains unchanged
- Error handling must not leak sensitive information
- Rate limiting and security middleware remain in place
- No changes to security-critical code paths
