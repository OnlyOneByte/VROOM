# Backend Simplification Design

## Overview

This design document outlines a comprehensive simplification strategy for the VROOM backend. After analyzing all TypeScript files, I've identified specific opportunities to reduce complexity while maintaining functionality. The approach prioritizes clarity and maintainability for a single-developer open-source project.

### Key Simplification Themes

1. **Remove unnecessary abstractions** - QueryBuilder, complex base repository patterns
2. **Inline single-use utilities** - Small helper functions used once
3. **Consolidate duplicate logic** - Session refresh, error handling, validation
4. **Simplify type system** - Reduce re-exports, consolidate response types
5. **Flatten service layer** - Remove orchestration layers, call services directly
6. **Streamline validation** - Compose schemas better, reduce duplication

## Architecture

### Current Architecture Issues

**Over-abstraction in Data Layer:**
- QueryBuilder wraps simple Drizzle queries unnecessarily
- BaseRepository has error handling that's rarely customized
- Repositories catch-and-rethrow errors without adding value

**Middleware Complexity:**
- Session refresh logic duplicated in requireAuth middleware and auth routes
- Activity tracker has unnecessary delegation to service
- Multiple middleware files could be consolidated

**Type System Bloat:**
- Many response types that could use generics
- Duplicate enum definitions between types.ts and db/types.ts
- Unnecessary re-export layers

**Service Layer Indirection:**
- Sync orchestrator adds complexity without clear benefit
- Lock management could be simpler
- Factory functions for services are overkill

### Proposed Simplified Architecture

**Data Layer:**
```
repositories/
  ├── base.ts (minimal CRUD only)
  └── {domain}.ts (direct Drizzle queries, no QueryBuilder)
```

**Route Layer:**
```
{domain}/
  ├── routes.ts (handlers + inline validation helpers)
  └── repository.ts (data access)
```

**Shared Code:**
```
utils/
  ├── auth.ts (session helpers)
  ├── validation.ts (common schemas)
  └── errors.ts (error classes + handlers)
```

## Components and Interfaces

### 1. Simplified Repository Pattern

**Remove QueryBuilder entirely** - It adds a layer of indirection for simple operations:

```typescript
// BEFORE (with QueryBuilder)
async findByEmail(email: string): Promise<User | null> {
  return await this.queryBuilder.findOne(users, eq(users.email, email));
}

// AFTER (direct Drizzle)
async findByEmail(email: string): Promise<User | null> {
  const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] || null;
}
```

**Simplify BaseRepository** - Remove generic error handling, keep only CRUD:

```typescript
// Minimal base with just the essentials
abstract class BaseRepository<T, TNew> {
  constructor(protected db: Database, protected table: Table) {}
  
  async findById(id: string): Promise<T | null> {
    const result = await this.db.select().from(this.table).where(eq(this.table.id, id)).limit(1);
    return result[0] || null;
  }
  
  async create(data: TNew): Promise<T> {
    const result = await this.db.insert(this.table).values(data).returning();
    return result[0];
  }
  
  async update(id: string, data: Partial<TNew>): Promise<T> {
    const result = await this.db.update(this.table)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(this.table.id, id))
      .returning();
    if (!result[0]) throw new NotFoundError(this.tableName);
    return result[0];
  }
  
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(this.table).where(eq(this.table.id, id)).returning();
    if (!result[0]) throw new NotFoundError(this.tableName);
  }
}
```

### 2. Consolidated Middleware

**Extract session refresh to shared utility:**

```typescript
// utils/auth.ts
export async function refreshSessionIfNeeded(sessionId: string, lucia: Lucia) {
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user) return null;
  
  const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
  if (timeUntilExpiry < CONFIG.auth.session.refreshThreshold) {
    const newSession = await lucia.createSession(user.id, {});
    await lucia.invalidateSession(session.id);
    return { session: newSession, user, refreshed: true };
  }
  
  return { session, user, refreshed: false };
}
```

**Simplify activity tracker** - Remove delegation, track directly:

```typescript
// Inline in middleware instead of delegating to service
export const activityTracker: MiddlewareHandler = async (c, next) => {
  await next();
  
  const user = c.get('user');
  if (!user || !shouldTrackRequest(c.req)) return;
  
  const settings = await settingsRepository.getOrCreate(user.id);
  if (settings.syncOnInactivity && hasSyncEnabled(settings)) {
    recordActivity(user.id, settings.syncInactivityMinutes);
  }
};
```

### 3. Streamlined Type System

**Consolidate response types with generics:**

```typescript
// Single generic response type
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string; details?: unknown };
  count?: number;
}

// Remove all specific response types (VehicleResponse, ExpenseResponse, etc.)
// Use ApiResponse<Vehicle>, ApiResponse<Expense[]>, etc.
```

**Merge duplicate enums:**

```typescript
// types.ts has PaymentFrequency enum
// db/types.ts has PaymentFrequency type
// Keep only one definition in db/types.ts
```

### 4. Simplified Validation

**Compose validation schemas better:**

```typescript
// Common field validators
const validators = {
  id: z.string().min(1),
  positiveNumber: z.number().positive(),
  nonNegativeInt: z.number().int().min(0),
  dateString: z.coerce.date(),
  optionalUrl: z.string().url().optional(),
};

// Compose into domain schemas
const expenseSchema = z.object({
  vehicleId: validators.id,
  amount: validators.positiveNumber,
  date: validators.dateString,
  mileage: validators.nonNegativeInt.optional(),
  // ...
});
```

### 5. Route Handler Simplification

**Extract ownership validation pattern:**

```typescript
// utils/validation.ts
export async function validateVehicleOwnership(
  vehicleId: string,
  userId: string
): Promise<Vehicle> {
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');
  return vehicle;
}

// Use in routes
const vehicle = await validateVehicleOwnership(vehicleId, user.id);
```

**Move inline helpers to utilities:**

```typescript
// vehicles/routes.ts has calculateVehicleStats, calculateTotals, etc.
// Move to utils/vehicle-stats.ts
```

## Data Models

No changes to database schema or data models. All simplifications are at the code organization and implementation level.

## Correctness Properties


*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, most acceptance criteria focus on code organization and structure rather than runtime behavior. However, we can identify several key properties that ensure refactoring preserves correctness:

**Property 1: Query result equivalence**
*For any* repository query method that is simplified, the results returned before and after simplification should be equivalent for the same inputs.
**Validates: Requirements 1.5**

**Property 2: Session refresh behavior preservation**
*For any* session that is close to expiry, the authentication system should refresh the session and return a new session ID, regardless of whether the refresh logic is in middleware or a utility function.
**Validates: Requirements 3.1**

**Property 3: Activity tracking consistency**
*For any* authenticated request that modifies data, the activity tracker should record the activity with the same timestamp behavior before and after simplification.
**Validates: Requirements 3.2**

**Property 4: Error response consistency**
*For any* error thrown in the system, the HTTP response status code and error structure should be the same before and after consolidating error mapping logic.
**Validates: Requirements 3.3**

**Property 5: Type guard correctness**
*For any* enum value, the type guard should return true if and only if the value is a valid member of that enum, regardless of whether the guard is hand-written or generated.
**Validates: Requirements 4.3**

**Property 6: Sync operation equivalence**
*For any* sync operation (backup or sheets), the data synchronized should be identical before and after removing abstraction layers.
**Validates: Requirements 5.1**

**Property 7: Service initialization idempotence**
*For any* service, initializing it multiple times with the same configuration should produce functionally equivalent instances.
**Validates: Requirements 5.2**

**Property 8: Validation behavior preservation**
*For any* input data, validation schemas should accept or reject the data consistently before and after simplification.
**Validates: Requirements 6.1, 6.3**

**Property 9: Transformation equivalence**
*For any* validation transformation, the output should be identical before and after simplification for the same input.
**Validates: Requirements 6.4**

**Property 10: Utility function equivalence**
*For any* utility function that is refactored (class to function, broken into smaller functions), the output should be identical for the same inputs.
**Validates: Requirements 7.2, 7.3**

**Property 11: Error handling preservation**
*For any* error thrown in a repository or service, the error type and message should be consistent before and after removing catch-rethrow blocks.
**Validates: Requirements 10.1**

**Property 12: Error class consolidation correctness**
*For any* error scenario, consolidating similar error classes should not change the HTTP status code or error response structure.
**Validates: Requirements 10.3**

## Error Handling

Error handling will be simplified by:

1. **Removing catch-rethrow blocks** - Let errors bubble to global handler
2. **Consolidating error classes** - Merge ForbiddenError into AuthorizationError
3. **Simplifying error mapping** - Use a single ERROR_STATUS_MAP
4. **Removing redundant handlers** - handleDatabaseError logic can be in global handler

## Testing Strategy

### Unit Testing Approach

Since this is a refactoring project, the primary testing strategy is **regression testing** - ensuring existing behavior is preserved. Unit tests will:

1. **Test repository methods** - Verify queries return same results before/after
2. **Test middleware behavior** - Verify auth, activity tracking, error handling work the same
3. **Test validation schemas** - Verify same inputs pass/fail before/after
4. **Test utility functions** - Verify same outputs for same inputs
5. **Test error responses** - Verify same status codes and error structures

### Property-Based Testing Approach

Property-based testing will use **fast-check** (JavaScript/TypeScript PBT library) to verify refactoring correctness:

1. **Repository query equivalence** - Generate random query parameters, verify results match
2. **Validation schema equivalence** - Generate random inputs, verify accept/reject behavior matches
3. **Utility function equivalence** - Generate random inputs, verify outputs match
4. **Error handling consistency** - Generate random error scenarios, verify responses match
5. **Type guard correctness** - Generate random values, verify type guards work correctly

Each property-based test will:
- Run a minimum of 100 iterations
- Be tagged with the format: `**Feature: backend-simplification, Property {number}: {property_text}**`
- Reference the specific correctness property from this design document

### Testing Configuration

```typescript
// fast-check configuration
import fc from 'fast-check';

// Run each property test with 100 iterations minimum
fc.assert(
  fc.property(/* generators */, (/* inputs */) => {
    // property assertion
  }),
  { numRuns: 100 }
);
```

### Regression Testing Strategy

Before making changes:
1. Document current API behavior with integration tests
2. Capture current error responses for various scenarios
3. Record current query results for sample data

After making changes:
4. Run same tests and verify identical behavior
5. Check that all endpoints return same response structures
6. Verify error codes and messages are unchanged

## Implementation Notes

### Breaking Changes to Document

While functionality will be preserved, some internal interfaces may change:

1. **QueryBuilder removal** - Repositories will use direct Drizzle queries
2. **Response type consolidation** - Specific response types replaced with generic ApiResponse<T>
3. **Middleware signatures** - Some middleware may have simplified signatures
4. **Service initialization** - Factory functions may be replaced with direct instantiation
5. **Utility exports** - Some utility classes converted to plain functions

### Non-Breaking Simplifications

These changes are purely internal and won't affect API contracts:

1. **Error handling consolidation** - Same errors, simpler code
2. **Validation schema composition** - Same validation, better organized
3. **File reorganization** - Same exports, different file structure
4. **Dead code removal** - Removing unused code has no external impact
5. **Inline single-use helpers** - Same behavior, less indirection

### Migration Path

Since this is a refactoring project with no database changes:

1. **No database migrations needed** - Schema unchanged
2. **No API version bump needed** - Endpoints unchanged
3. **Frontend changes needed** - Only if response types change (will document)
4. **Deployment** - Standard deployment, no special steps

## Specific Simplification Opportunities

### High-Impact Simplifications

1. **Remove QueryBuilder** (~200 lines saved)
   - Replace with direct Drizzle queries
   - Simpler to understand, one less abstraction

2. **Consolidate session refresh** (~50 lines saved)
   - Extract to shared utility
   - Remove duplication between middleware and routes

3. **Simplify BaseRepository** (~100 lines saved)
   - Remove generic error handling
   - Keep only essential CRUD

4. **Inline vehicle stats helpers** (~150 lines saved)
   - Move from routes to utils/vehicle-stats.ts
   - Reusable across endpoints

5. **Consolidate response types** (~200 lines saved)
   - Use ApiResponse<T> everywhere
   - Remove 15+ specific response interfaces

6. **Merge duplicate enums** (~50 lines saved)
   - Keep only db/types.ts definitions
   - Remove duplicates from types.ts

7. **Simplify activity tracker** (~100 lines saved)
   - Remove delegation pattern
   - Track directly in middleware

8. **Remove unused exports** (~50 lines saved)
   - clearIdempotencyCache, assertApiResponse, etc.
   - Dead code that's never called

### Medium-Impact Simplifications

9. **Extract ownership validation** (~30 lines saved per domain)
   - Shared pattern across vehicles, expenses, insurance, financing
   - ~120 lines total saved

10. **Simplify error constructors** (~30 lines saved)
    - Merge ForbiddenError into AuthorizationError
    - Remove ExternalServiceError (unused)

11. **Consolidate validation helpers** (~40 lines saved)
    - validateFuelExpenseData appears in multiple places
    - Extract to shared validation utils

12. **Simplify backup validation** (~50 lines saved)
    - Reduce complexity in validateBackupData
    - Combine validation steps

### Low-Impact Simplifications

13. **Remove unused imports** (~20 lines saved)
    - Clean up imports across all files

14. **Simplify logger methods** (~30 lines saved)
    - Remove rarely-used specialized methods (http, database, external)
    - Keep core methods (error, warn, info, debug)

15. **Consolidate time constants** (~20 lines saved)
    - CONFIG.time has redundant calculations
    - Keep only used constants

## File Structure Changes

### Proposed Changes

**Merge small files:**
- `db/checkpoint.ts` → inline into `db/connection.ts` (it's just 2 functions)
- `db/init.ts` → inline into `db/connection.ts` or keep as script
- `utils/timeout.ts` → inline into sync files (only used there)

**Split large files:**
- `vehicles/routes.ts` → extract stats calculation to `utils/vehicle-stats.ts`
- `sync/restore.ts` → already well-organized, keep as-is

**Rename for clarity:**
- `utils/base-repository.ts` → `utils/repository.ts` (it's the only repository base)

**Remove files:**
- `utils/query-builder.ts` → delete entirely, use direct Drizzle queries
- `utils/backup-repository.ts` → delete, inline methods into `sync/backup.ts` (confusing to have two backup files)

### Final Structure

```
backend/src/
├── index.ts (main app)
├── config.ts (configuration)
├── types.ts (shared types - simplified)
├── errors.ts (error classes + handlers)
├── middleware.ts (all middleware)
├── auth/
│   ├── lucia.ts (auth setup)
│   ├── routes.ts (auth endpoints)
│   └── utils.ts (NEW - session refresh helpers)
├── db/
│   ├── connection.ts (includes init + checkpoint)
│   ├── schema.ts (database schema)
│   └── types.ts (domain types)
├── utils/
│   ├── logger.ts (simplified)
│   ├── validation.ts (common schemas + helpers)
│   ├── calculations.ts (pure calculation functions)
│   ├── vehicle-stats.ts (NEW - extracted from routes)
│   └── repository.ts (RENAMED from base-repository.ts)
├── vehicles/
│   ├── repository.ts (simplified)
│   └── routes.ts (simplified)
├── expenses/
│   ├── repository.ts (simplified)
│   └── routes.ts (simplified)
├── financing/
│   ├── repository.ts (simplified)
│   └── routes.ts (simplified - calculations removed)
├── insurance/
│   ├── repository.ts (simplified)
│   └── routes.ts (simplified)
├── settings/
│   ├── repository.ts (simplified)
│   └── routes.ts (simplified)
└── sync/
    ├── activity-tracker.ts (simplified)
    ├── backup.ts (simplified)
    ├── restore.ts (simplified)
    ├── google-drive.ts (simplified)
    ├── google-sheets.ts (simplified)
    └── routes.ts (simplified)
```

## Financing Calculation Strategy

### Move Calculations to Frontend

Currently, the backend performs loan amortization calculations in `financing/calculations.ts`. These calculations should move to the frontend because:

1. **No server-side state needed** - Calculations are pure functions
2. **Reduces API calls** - Frontend can calculate on-demand without network requests
3. **Better UX** - Instant feedback when user adjusts loan parameters
4. **Simpler backend** - Backend only stores and retrieves financing records

**Backend responsibilities (keep):**
- Store financing records (loan terms, balances)
- Store payment history
- Validate financing data (amounts, dates, terms)
- CRUD operations for financing entities

**Frontend responsibilities (move):**
- Calculate amortization schedules
- Calculate payment breakdowns (principal/interest)
- Generate "what-if" scenarios
- Display payment projections

**API Changes:**
- Remove `GET /api/financing/:financingId/schedule` endpoint
- Remove `financing/calculations.ts` file
- Keep validation logic for financing data
- Payment recording endpoint stays (it updates database state)

**Frontend will need:**
- Copy `calculatePaymentBreakdown()` function
- Copy `generateAmortizationSchedule()` function
- Copy `validateLoanTerms()` function
- Implement in TypeScript (same logic, client-side)

This change will be documented as a **breaking change** requiring frontend updates.

## Detailed Simplification Strategies

### 1. Repository Layer Simplification

**Remove QueryBuilder:**
```typescript
// BEFORE: VehicleRepository.findByLicensePlate
async findByLicensePlate(licensePlate: string): Promise<Vehicle | null> {
  try {
    return await this.queryBuilder.findOne(vehicles, eq(vehicles.licensePlate, licensePlate));
  } catch (error) {
    logger.error('Error finding vehicle by license plate', { licensePlate, error });
    throw new Error('Failed to find vehicle by license plate');
  }
}

// AFTER: Direct Drizzle query
async findByLicensePlate(licensePlate: string): Promise<Vehicle | null> {
  const result = await this.db.select().from(vehicles)
    .where(eq(vehicles.licensePlate, licensePlate))
    .limit(1);
  return result[0] || null;
}
```

**Simplify error handling:**
```typescript
// BEFORE: Catch, log, wrap, rethrow
try {
  return await this.queryBuilder.findOne(table, where);
} catch (error) {
  logger.error('Failed to find', { error });
  throw new DatabaseError('Failed to find', error);
}

// AFTER: Let errors bubble, global handler logs them
async findByEmail(email: string): Promise<User | null> {
  const result = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0] || null;
}
```

### 2. Middleware Simplification

**Extract session refresh:**
```typescript
// auth/utils.ts (NEW FILE)
export async function validateAndRefreshSession(sessionId: string) {
  const lucia = getLucia();
  const { session, user } = await lucia.validateSession(sessionId);
  
  if (!session || !user) return null;
  
  const timeUntilExpiry = session.expiresAt.getTime() - Date.now();
  if (timeUntilExpiry < CONFIG.auth.session.refreshThreshold) {
    const newSession = await lucia.createSession(user.id, {});
    await lucia.invalidateSession(session.id);
    return { session: newSession, user, refreshed: true };
  }
  
  return { session, user, refreshed: false };
}

// Use in both middleware and routes
const result = await validateAndRefreshSession(sessionId);
if (!result) throw new HTTPException(401, { message: 'Invalid session' });
```

**Simplify activity tracker:**
```typescript
// BEFORE: Delegates to service class
export const activityTracker: MiddlewareHandler = async (c, next) => {
  await next();
  const user = c.get('user');
  if (!user) return;
  
  const settings = await settingsRepository.getOrCreate(user.id);
  const hasSyncEnabled = settings.googleSheetsSyncEnabled || settings.googleDriveBackupEnabled;
  if (settings.syncOnInactivity && hasSyncEnabled) {
    userActivityTracker.recordActivity(user.id, {
      enabled: true,
      inactivityDelayMinutes: settings.syncInactivityMinutes,
      autoSyncEnabled: true,
    });
  }
};

// AFTER: Direct tracking
export const activityTracker: MiddlewareHandler = async (c, next) => {
  await next();
  const user = c.get('user');
  if (!user || !shouldTrackRequest(c.req)) return;
  
  const settings = await settingsRepository.getOrCreate(user.id);
  if (settings.syncOnInactivity && (settings.googleSheetsSyncEnabled || settings.googleDriveBackupEnabled)) {
    recordActivity(user.id, settings.syncInactivityMinutes);
  }
};
```

### 3. Type System Simplification

**Consolidate response types:**
```typescript
// BEFORE: 15+ specific response interfaces
export interface VehicleResponse { id: string; make: string; /* ... */ }
export interface ExpenseResponse { id: string; amount: number; /* ... */ }
export interface InsuranceResponse { id: string; company: string; /* ... */ }
// ... etc

// AFTER: Generic response type
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string; details?: unknown };
  count?: number;
}

// Usage
return c.json<ApiResponse<Vehicle>>({ success: true, data: vehicle });
return c.json<ApiResponse<Expense[]>>({ success: true, data: expenses, count: expenses.length });
```

**Merge duplicate enums:**
```typescript
// BEFORE: types.ts has PaymentFrequency enum, db/types.ts has PaymentFrequency type
// AFTER: Keep only in db/types.ts, remove from types.ts
```

**Generate type guards:**
```typescript
// BEFORE: Hand-written type guards for each enum
export const isPaymentFrequency = (value: string): value is PaymentFrequency => {
  return Object.values(PaymentFrequency).includes(value as PaymentFrequency);
};
export const isCurrency = (value: string): value is Currency => {
  return Object.values(Currency).includes(value as Currency);
};
// ... 6 more similar functions

// AFTER: Generic type guard generator
function createEnumGuard<T extends string>(enumObj: Record<string, T>) {
  const values = Object.values(enumObj);
  return (value: string): value is T => values.includes(value as T);
}

export const isPaymentFrequency = createEnumGuard(PaymentFrequency);
export const isCurrency = createEnumGuard(Currency);
// ... etc
```

### 4. Route Handler Simplification

**Extract ownership validation:**
```typescript
// utils/validation.ts (ADD)
export async function validateVehicleOwnership(vehicleId: string, userId: string): Promise<Vehicle> {
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');
  return vehicle;
}

export async function validateExpenseOwnership(expenseId: string, userId: string): Promise<Expense> {
  const expense = await expenseRepository.findById(expenseId);
  if (!expense) throw new NotFoundError('Expense');
  const vehicle = await vehicleRepository.findByUserIdAndId(userId, expense.vehicleId);
  if (!vehicle) throw new NotFoundError('Expense');
  return expense;
}

// Use in routes (saves ~10 lines per route)
const expense = await validateExpenseOwnership(id, user.id);
```

**Move inline helpers:**
```typescript
// vehicles/routes.ts has calculateVehicleStats, calculateTotals, calculateMileageStats, calculateAverageMpg
// Move all to utils/vehicle-stats.ts

// utils/vehicle-stats.ts (NEW FILE)
export function calculateVehicleStats(expenses: Expense[], initialMileage: number): VehicleStats {
  // ... implementation
}

function calculateTotals(expenses: Expense[]): { fuelAmount: number; cost: number } {
  // ... implementation
}

function calculateMileageStats(/* ... */): void {
  // ... implementation
}

function calculateAverageMpg(expenses: Expense[]): number | null {
  // ... implementation
}
```

### 5. Service Layer Simplification

**Remove sync orchestrator:**
```typescript
// BEFORE: SyncOrchestrator class with lock management
class SyncOrchestrator {
  private locks = new Map<string, number>();
  async executeSyncOperation(/* ... */) { /* complex logic */ }
}

// AFTER: Simple lock management in routes
const syncLocks = new Map<string, number>();

function acquireLock(userId: string): boolean {
  const existing = syncLocks.get(userId);
  if (existing && Date.now() - existing < 300000) return false;
  syncLocks.set(userId, Date.now());
  return true;
}

// Use directly in route
if (!acquireLock(userId)) {
  throw new SyncError(SyncErrorCode.SYNC_IN_PROGRESS, 'Sync already in progress');
}
```

**Simplify service factories:**
```typescript
// BEFORE: Factory functions
export async function createDriveServiceForUser(userId: string): Promise<GoogleDriveService> {
  const db = getDb();
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].googleRefreshToken) {
    throw new Error('User not found or Google Drive access not available');
  }
  return new GoogleDriveService(user[0].googleRefreshToken, user[0].googleRefreshToken);
}

// AFTER: Direct instantiation with helper
async function getUserToken(userId: string): Promise<string> {
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user[0]?.googleRefreshToken) throw new AuthenticationError('Google access not available');
  return user[0].googleRefreshToken;
}

// In route
const token = await getUserToken(userId);
const driveService = new GoogleDriveService(token, token);
```

### 6. Validation Simplification

**Compose schemas better:**
```typescript
// BEFORE: Repeated validation patterns
const baseVehicleSchema = createInsertSchema(vehiclesTable, {
  make: z.string().min(1, 'Make is required').max(50, 'Make must be 50 characters or less'),
  model: z.string().min(1, 'Model is required').max(50, 'Model must be 50 characters or less'),
  // ... more fields
});

// AFTER: Reusable validators
const validators = {
  requiredString: (name: string, max: number) => 
    z.string().min(1, `${name} is required`).max(max, `${name} must be ${max} characters or less`),
  optionalString: (max: number) => 
    z.string().max(max).optional(),
  positiveNumber: z.number().positive(),
  nonNegativeInt: z.number().int().min(0),
};

const baseVehicleSchema = createInsertSchema(vehiclesTable, {
  make: validators.requiredString('Make', 50),
  model: validators.requiredString('Model', 50),
  nickname: validators.optionalString(50),
  initialMileage: validators.nonNegativeInt.optional(),
  // ... cleaner and more consistent
});
```

### 7. Backup Repository Consolidation

**Merge backup-repository.ts into sync/backup.ts:**

The `utils/backup-repository.ts` file is confusing because there's also a `sync/backup.ts` file. The backup repository only has methods for fetching user data, which are only used by the backup service. Consolidate them:

```typescript
// BEFORE: Two separate files
// utils/backup-repository.ts - BackupRepository class with getUserVehicles, getUserExpenses, etc.
// sync/backup.ts - BackupService class that uses BackupRepository

// AFTER: One file
// sync/backup.ts - BackupService with inline data fetching methods
export class BackupService {
  async createBackup(userId: string): Promise<BackupData> {
    const vehicles = await this.getUserVehicles(userId);
    const expenses = await this.getUserExpenses(userId);
    // ... etc
  }
  
  private async getUserVehicles(userId: string): Promise<Vehicle[]> {
    return db.select().from(vehicles).where(eq(vehicles.userId, userId));
  }
  
  private async getUserExpenses(userId: string): Promise<Expense[]> {
    const results = await db.select().from(expenses)
      .innerJoin(vehicles, eq(expenses.vehicleId, vehicles.id))
      .where(eq(vehicles.userId, userId));
    return results.map(r => r.expenses);
  }
  
  // ... other private methods
}
```

This eliminates the confusion of having two "backup" files and makes it clear that data fetching is part of the backup service.

### 8. Utility Simplification

**Convert Logger class to functions:**
```typescript
// BEFORE: Logger class with many methods
class Logger {
  error(message: string, context?: LogContext): void { /* ... */ }
  warn(message: string, context?: LogContext): void { /* ... */ }
  info(message: string, context?: LogContext): void { /* ... */ }
  debug(message: string, context?: LogContext): void { /* ... */ }
  http(method: string, path: string, status: number, duration: number, userId?: string): void { /* ... */ }
  database(operation: string, table: string, duration: number, error?: Error): void { /* ... */ }
  auth(event: string, userId?: string, success = true): void { /* ... */ }
  external(service: string, operation: string, success: boolean, duration?: number): void { /* ... */ }
  startup(message: string, context?: LogContext): void { /* ... */ }
  shutdown(message: string, context?: LogContext): void { /* ... */ }
  checkpoint(message: string, context?: LogContext): void { /* ... */ }
  test(message: string, context?: LogContext): void { /* ... */ }
}

// AFTER: Keep only core methods, remove specialized ones (http, database, external, auth)
// Specialized methods are rarely used and can be replaced with info/error calls
class Logger {
  error(message: string, context?: LogContext): void { /* ... */ }
  warn(message: string, context?: LogContext): void { /* ... */ }
  info(message: string, context?: LogContext): void { /* ... */ }
  debug(message: string, context?: LogContext): void { /* ... */ }
}
```

## Known Limitations and TODOs

The codebase has several TODO comments indicating incomplete functionality:

1. **Auth routes** - "Check for existing Google Drive backups and auto-enable if found"
2. **Sync routes** - "Implement direct service calls after extracting GoogleSyncService"
3. **Settings routes** - "Implement actual backup logic"
4. **Activity tracker** - "Implement auto-sync after extracting GoogleSyncService"

These will be documented as known limitations but not implemented as part of this simplification effort.

## Breaking Changes for Frontend

### 1. Financing Calculations Moved to Frontend

**Removed Endpoint:**
- `GET /api/financing/:financingId/schedule` - No longer available

**Removed Backend File:**
- `financing/calculations.ts` - Deleted entirely

**Frontend Must Implement:**

Copy these functions to your frontend codebase:

```typescript
// From financing/calculations.ts
export interface LoanTerms {
  principal: number;
  apr: number;
  termMonths: number;
  startDate: Date;
}

export function calculatePaymentBreakdown(
  principal: number,
  apr: number,
  termMonths: number,
  paymentNumber: number
): { principalAmount: number; interestAmount: number } {
  // ... copy implementation
}

export function generateAmortizationSchedule(terms: LoanTerms): {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: string;
  schedule: Array<{...}>;
} {
  // ... copy implementation
}

export function validateLoanTerms(terms: LoanTerms): string[] {
  // ... copy implementation
}
```

**Benefits:**
- Instant calculation updates in UI (no API calls)
- Better user experience with real-time feedback
- Simpler backend (just stores data, doesn't calculate)
- Frontend can show multiple scenarios without server round-trips

### 2. Backup Repository Consolidation

**Removed File:**
- `utils/backup-repository.ts` - Merged into `sync/backup.ts`

**No API changes** - This is purely internal reorganization

## API Contract Changes

### Response Type Changes

All endpoints will use the generic `ApiResponse<T>` type instead of specific response interfaces. This is a TypeScript-only change and doesn't affect the actual JSON structure:

```typescript
// BEFORE
interface VehicleResponse {
  id: string;
  make: string;
  model: string;
  // ... all fields explicitly typed
}

// AFTER
type VehicleResponse = ApiResponse<Vehicle>;

// JSON structure remains identical
{
  "success": true,
  "data": {
    "id": "...",
    "make": "...",
    "model": "..."
  }
}
```

### Removed Exports

These exports will be removed as they're unused:

- `clearIdempotencyCache()` - Only used in tests (can be accessed differently)
- `assertApiResponse()` - Never called
- `formatErrorResponse()` - Only used internally
- `withErrorHandling()` - Unused wrapper function
- `createTypedError()` - Unused helper

### Middleware Changes

- `checkpointAfterWrite` - Currently exported but never used, will be removed
- Activity tracker will have simplified signature (no config object)

## Estimated Impact

### Lines of Code Reduction

- Remove QueryBuilder: ~200 lines
- Simplify BaseRepository: ~100 lines
- Consolidate response types: ~200 lines
- Extract and consolidate helpers: ~150 lines
- Remove dead code: ~100 lines
- Simplify error handling: ~80 lines
- Merge duplicate enums: ~50 lines
- Consolidate session refresh: ~50 lines
- Simplify activity tracker: ~100 lines
- Clean up imports and comments: ~50 lines

**Total estimated reduction: ~1,080 lines (~15-20% of codebase)**

### Complexity Reduction

- Fewer abstraction layers (QueryBuilder removed)
- Less indirection (direct service calls)
- Clearer ownership validation pattern
- Simpler error handling flow
- More consistent code patterns

### Maintainability Improvements

- Easier to understand data access (direct Drizzle)
- Clearer middleware flow
- Better organized utilities
- Consistent validation patterns
- Reduced cognitive load
