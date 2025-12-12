# Backend Refactoring Design Document

## Overview

This design outlines a practical refactoring of the VROOM backend to eliminate code duplication and improve organization. The focus is on **consolidation and simplification**, not adding abstraction layers. We'll leverage Drizzle's TypeScript-native approach to use database models directly throughout the stack.

### Key Goals

1. **Reduce Duplication**: Merge duplicate code, don't abstract it
2. **Simplify Organization**: Group related code together logically
3. **Use Drizzle Types Directly**: No separate model layer - use Drizzle's inferred types everywhere
4. **Maintain Compatibility**: Preserve all existing API contracts and functionality
5. **Keep It Simple**: Avoid over-engineering for a non-enterprise app

## Architecture

### Current State Analysis

**Major Duplication Issues:**
1. **Error Handling**: Split across 3 files (classes.ts, handlers.ts, responses.ts) - should be 1 file
2. **Sync Services**: Split across 3 files (backup-service.ts, google-sync.ts, sync-orchestrator.ts) - should be 1-2 files
3. **Analytics**: Split across 3 files (analytics-service.ts, expense-calculator.ts, loan-calculator.ts) - should be 1 file
4. **Calculations**: Duplicate MPG and cost-per-mile logic in multiple places
5. **Validation Schemas**: Duplicate param schemas in every route file
6. **Constants**: Split across multiple files in different locations

**Organization Issues:**
- Too many small files that should be combined
- Related code scattered across directories
- No clear benefit from the current separation

### Proposed Architecture

**Simple, Consolidated Structure:**

```
backend/src/
├── db/
│   ├── schema.ts              # Database schemas (unchanged)
│   └── types.ts               # Enums only
├── lib/
│   ├── core/
│   │   ├── database.ts        # Database service
│   │   ├── config.ts          # Configuration
│   │   └── errors.ts          # MERGED: All error handling in one file
│   ├── repositories/          # Keep flat
│   │   ├── base.ts            # Base repository (existing)
│   │   ├── user.ts
│   │   ├── vehicle.ts
│   │   ├── expense.ts
│   │   ├── financing.ts       # MERGED: financing + payments
│   │   ├── insurance.ts
│   │   ├── backup.ts
│   │   └── index.ts           # Barrel export
│   ├── services/
│   │   ├── analytics.ts       # MERGED: analytics + calculators + loan
│   │   ├── sync.ts            # MERGED: backup + google + orchestrator
│   │   ├── integrations/      # External services (keep separate)
│   │   │   ├── google-drive.ts
│   │   │   └── google-sheets.ts
│   │   └── restore/           # Keep as subfolder (multiple files)
│   ├── middleware/            # Keep as-is
│   ├── utils/
│   │   ├── calculations.ts    # MERGED: All calculation functions
│   │   ├── formatters.ts      # MERGED: All formatting functions
│   │   ├── validation.ts      # MERGED: Common validation schemas
│   │   ├── logger.ts
│   │   └── timeout.ts
│   └── constants.ts           # MERGED: All constants in one file
└── routes/                    # Keep structure, reduce duplication
```

**Key Changes:**
- Merge 3 error files → 1 file
- Merge 3 sync files → 1 file  
- Merge 3 analytics files → 1 file
- Merge 2 financing repositories → 1 file
- Merge scattered constants → 1 file
- Create shared validation schemas
- Create shared calculation functions

## Components and Interfaces

### 1. Use Drizzle Types Directly

**No separate model layer - Drizzle is TypeScript-native:**

```typescript
// db/schema.ts - Single source of truth
export const vehicles = sqliteTable('vehicles', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  make: text('make').notNull(),
  // ... fields
});

// Automatically inferred types - use these everywhere
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

// In repositories, services, routes - just import and use:
import type { Vehicle, NewVehicle } from '../../db/schema';

// For validation, use drizzle-zod:
import { createInsertSchema } from 'drizzle-zod';
const vehicleSchema = createInsertSchema(vehicles, {
  // Add custom refinements only
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1),
});
```

### 2. Merged Error Handling

**One file for all error logic:**

```typescript
// lib/core/errors.ts
// Merge classes.ts, handlers.ts, responses.ts into one file

// Error classes
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
  }
}

// ... other error classes

// Error handlers
export function handleDatabaseError(error: unknown): AppError {
  if (error instanceof Error) {
    if (error.message.includes('UNIQUE constraint')) {
      return new ConflictError('Resource already exists');
    }
    // ... other mappings
  }
  return new DatabaseError('Unknown database error');
}

// Response formatters
export function createErrorResponse(code: string, message: string, details?: unknown) {
  return { success: false, error: { code, message, details } };
}

export function createSuccessResponse<T>(data?: T, message?: string) {
  return { success: true, data, message };
}

// Everything in one place, easy to find
```

### 3. Merged Sync Service

**Combine backup, google, and orchestrator:**

```typescript
// lib/services/sync.ts
// Merge backup-service.ts, google-sync.ts, sync-orchestrator.ts

export class SyncService {
  // Backup operations
  async createBackup(userId: string): Promise<BackupData> { /* ... */ }
  async exportAsZip(userId: string): Promise<Buffer> { /* ... */ }
  async parseZipBackup(file: Buffer): Promise<ParsedBackupData> { /* ... */ }
  
  // Google Drive operations
  async uploadToDrive(userId: string): Promise<BackupSyncResult> { /* ... */ }
  async listDriveBackups(userId: string): Promise<DriveFile[]> { /* ... */ }
  async downloadFromDrive(userId: string, fileId: string): Promise<Buffer> { /* ... */ }
  
  // Google Sheets operations
  async syncToSheets(userId: string): Promise<SheetsSyncResult> { /* ... */ }
  
  // Orchestration
  async executeSync(userId: string, types: string[]): Promise<SyncResult> { /* ... */ }
  
  // Lock management (keep simple in-memory for now)
  private locks = new Map<string, number>();
  acquireLock(userId: string): boolean { /* ... */ }
  releaseLock(userId: string): void { /* ... */ }
}

export const syncService = new SyncService();
```

### 4. Merged Analytics Service

**Combine analytics, expense calculator, and loan calculator:**

```typescript
// lib/services/analytics.ts
// Merge analytics-service.ts, expense-calculator.ts, loan-calculator.ts

export class AnalyticsService {
  // High-level analytics
  async getDashboardAnalytics(userId: string, query: AnalyticsQuery) { /* ... */ }
  async getVehicleAnalytics(vehicleId: string, query: AnalyticsQuery) { /* ... */ }
  
  // Expense calculations (previously ExpenseCalculator)
  calculateTotal(expenses: Expense[]): number {
    return expenses.reduce((sum, e) => sum + e.expenseAmount, 0);
  }
  
  calculateBreakdown(expenses: Expense[]) {
    // Category breakdown logic
  }
  
  calculateTrends(expenses: Expense[], groupBy: string) {
    // Trend calculation logic
  }
  
  // Fuel efficiency (previously in ExpenseCalculator)
  calculateFuelEfficiency(expenses: Expense[], vehicles: Vehicle[]) {
    // Use shared calculation functions
    return {
      averageMPG: calculateAverageMPG(fuelExpenses),
      // ...
    };
  }
  
  // Loan calculations (previously loan-calculator.ts)
  calculateMonthlyPayment(principal: number, apr: number, months: number): number {
    if (apr === 0) return principal / months;
    const rate = apr / 100 / 12;
    return (principal * rate * (1 + rate) ** months) / ((1 + rate) ** months - 1);
  }
  
  generateAmortizationSchedule(terms: LoanTerms) {
    // Amortization logic
  }
}

export const analyticsService = new AnalyticsService(expenseRepository, vehicleRepository);
```

### 5. Shared Calculation Functions

**One file for all calculations:**

```typescript
// lib/utils/calculations.ts
// Pure functions, no classes needed

export function calculateMPG(miles: number, fuel: number): number {
  return fuel > 0 ? miles / fuel : 0;
}

export function calculateAverageMPG(expenses: FuelExpense[]): number | null {
  const mpgValues: number[] = [];
  
  for (let i = 1; i < expenses.length; i++) {
    const current = expenses[i];
    const previous = expenses[i - 1];
    
    if (current.mileage && previous.mileage && current.fuelAmount) {
      const miles = current.mileage - previous.mileage;
      const mpg = miles / current.fuelAmount;
      if (mpg > 0 && mpg < 150) mpgValues.push(mpg);
    }
  }
  
  return mpgValues.length > 0
    ? mpgValues.reduce((sum, mpg) => sum + mpg, 0) / mpgValues.length
    : null;
}

export function calculateCostPerMile(cost: number, miles: number): number {
  return miles > 0 ? cost / miles : 0;
}

export function groupByPeriod(date: Date, period: 'day' | 'week' | 'month' | 'year'): string {
  const d = new Date(date);
  switch (period) {
    case 'day': return d.toISOString().substring(0, 10);
    case 'week': {
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      return weekStart.toISOString().substring(0, 10);
    }
    case 'month': return d.toISOString().substring(0, 7);
    case 'year': return d.getFullYear().toString();
  }
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
```

### 6. Shared Validation Schemas

**Common schemas used across routes:**

```typescript
// lib/utils/validation.ts

export const commonSchemas = {
  // ID schemas
  id: z.string().min(1, 'ID is required'),
  
  // Param schemas (reuse across routes)
  idParam: z.object({ id: z.string().min(1) }),
  vehicleIdParam: z.object({ vehicleId: z.string().min(1) }),
  
  // Query schemas
  pagination: z.object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }),
  
  dateRange: z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
};

// Usage in routes:
// const params = zValidator('param', commonSchemas.idParam);
// const query = zValidator('query', commonSchemas.pagination);
```

### 7. Merged Constants

**One file for all constants:**

```typescript
// lib/constants.ts
// Merge app-config.ts, rate-limits.ts, sync.ts, validation.ts

export const APP_CONFIG = {
  SESSION: {
    COOKIE_MAX_AGE: 60 * 60 * 24 * 30,
    OAUTH_STATE_EXPIRY: 10 * 60 * 1000,
    REFRESH_THRESHOLD: 24 * 60 * 60 * 1000,
  },
};

export const RATE_LIMITS = {
  SYNC: { windowMs: 60000, limit: 5 },
  BACKUP: { windowMs: 60000, limit: 3 },
  DRIVE_INIT: { windowMs: 300000, limit: 5 },
  CLEANUP_INTERVAL: 60000,
};

export const VALIDATION_LIMITS = {
  VEHICLE: {
    MAKE_MAX_LENGTH: 50,
    MODEL_MAX_LENGTH: 50,
    MIN_YEAR: 1900,
  },
  EXPENSE: {
    DESCRIPTION_MAX_LENGTH: 500,
    TAG_MAX_LENGTH: 30,
    MAX_TAGS: 10,
  },
  // ... other limits
};

export const BACKUP_CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024,
  CURRENT_VERSION: '1.0.0',
  DEFAULT_RETENTION_COUNT: 10,
};

// Everything in one place
```

### 8. Merged Financing Repository

**Combine financing and payment repositories:**

```typescript
// lib/repositories/financing.ts
// Merge vehicleFinancing.ts and vehicleFinancingPayment.ts

export class FinancingRepository extends BaseRepository<VehicleFinancing, NewVehicleFinancing> {
  constructor(db: BunSQLiteDatabase<Record<string, unknown>>) {
    super(db, vehicleFinancing);
  }
  
  // Financing methods
  async findByVehicleId(vehicleId: string): Promise<VehicleFinancing | null> { /* ... */ }
  async updateBalance(id: string, newBalance: number): Promise<VehicleFinancing> { /* ... */ }
  async markAsCompleted(id: string, endDate: Date): Promise<VehicleFinancing> { /* ... */ }
  
  // Payment methods (previously in separate repository)
  async createPayment(payment: NewVehicleFinancingPayment): Promise<VehicleFinancingPayment> {
    return this.db.insert(vehicleFinancingPayments).values(payment).returning()[0];
  }
  
  async findPaymentsByFinancingId(financingId: string): Promise<VehicleFinancingPayment[]> {
    return this.db
      .select()
      .from(vehicleFinancingPayments)
      .where(eq(vehicleFinancingPayments.financingId, financingId))
      .orderBy(desc(vehicleFinancingPayments.paymentDate));
  }
  
  async getLastPayment(financingId: string): Promise<VehicleFinancingPayment | null> {
    const result = await this.db
      .select()
      .from(vehicleFinancingPayments)
      .where(eq(vehicleFinancingPayments.financingId, financingId))
      .orderBy(desc(vehicleFinancingPayments.paymentDate))
      .limit(1);
    return result[0] || null;
  }
}

// One repository for related data
```

## Data Models

### Model Strategy: Use Drizzle Types Directly

**Single source of truth:**

```
Database Schema (Drizzle)
    ↓ (automatic inference)
TypeScript Types (use everywhere)
    ↓ (drizzle-zod when needed)
Zod Validation Schemas (for API input)
```

**Example:**

```typescript
// db/schema.ts
export const vehicles = sqliteTable('vehicles', { /* ... */ });
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

// In repository
import type { Vehicle, NewVehicle } from '../../db/schema';
export class VehicleRepository extends BaseRepository<Vehicle, NewVehicle> { /* ... */ }

// In service
import type { Vehicle } from '../../db/schema';
async function processVehicle(vehicle: Vehicle) { /* ... */ }

// In route (for validation only)
import { createInsertSchema } from 'drizzle-zod';
import { vehicles } from '../../db/schema';
const vehicleSchema = createInsertSchema(vehicles);
```

## Error Handling

### Consolidated Error System

All error handling in one file (`lib/core/errors.ts`):

```
Error Occurs
    ↓
Caught by try/catch or middleware
    ↓
Transformed to AppError (if needed)
    ↓
Mapped to HTTP status code
    ↓
Formatted as ErrorResponse
    ↓
Returned to client
```

## Testing Strategy

### Focus on Behavior, Not Structure

Since this is a refactoring, tests should verify that behavior doesn't change:

**Unit Tests:**
- Test calculation functions with same inputs produce same outputs
- Test error transformation produces correct status codes
- Test validation schemas accept/reject same inputs

**Integration Tests:**
- Test API endpoints return same responses before/after refactoring
- Test database operations produce same results
- Test sync operations work the same way

**Property-Based Tests:**
- Test calculation functions with random inputs
- Test date grouping with random dates
- Test error handling with random error types

## Migration Strategy

### Incremental Approach

**Phase 1: Create Merged Files (No Breaking Changes)**
1. Create `lib/core/errors.ts` with all error code
2. Create `lib/utils/calculations.ts` with all calculation functions
3. Create `lib/utils/validation.ts` with common schemas
4. Create `lib/constants.ts` with all constants
5. Keep old files temporarily

**Phase 2: Update Imports**
1. Update repositories to import from new files
2. Update services to import from new files
3. Update routes to import from new files
4. Run tests after each change

**Phase 3: Merge Services**
1. Create `lib/services/sync.ts` with all sync code
2. Create `lib/services/analytics.ts` with all analytics code
3. Update route imports
4. Run tests

**Phase 4: Merge Repositories**
1. Merge financing repositories
2. Update service imports
3. Run tests

**Phase 5: Cleanup**
1. Delete old files
2. Update barrel exports
3. Run full test suite
4. Update documentation

## Performance Considerations

- No performance impact expected - just moving code
- Query patterns remain the same
- No new abstractions that could slow things down
- Simpler code should be easier to optimize later

## Security Considerations

- No security changes - just reorganizing code
- All existing auth/validation remains
- Error handling improvements may reduce information leakage

## Monitoring and Observability

- Logging remains the same
- Metrics remain the same
- Health checks remain the same
- Simpler code should be easier to debug


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, most requirements focus on code organization and structure rather than functional behavior. This is expected for a refactoring project - the goal is to reorganize code without changing behavior. However, we identified several properties that ensure the refactoring maintains correctness:

**Testable Properties:**
- Response format consistency (2.2)
- Error transformation consistency (3.1, 3.2, 3.3)
- Calculation consistency (4.1, 4.2, 4.3, 4.4)

**Non-Testable (Structural):**
- Code organization and directory structure (Requirements 1, 5, 6, 7, 8, 9)
- Code reuse and elimination of duplication (most sub-requirements)
- Type system and build-time code generation (Requirement 9)

The testable properties focus on ensuring that after refactoring, the system still produces the same outputs for the same inputs - a critical guarantee for any refactoring effort.

### Property 1: Response Format Consistency

*For any* successful API response, the response object should contain a `success: true` field and follow the standard SuccessResponse structure
**Validates: Requirements 2.2**

### Property 2: Error Transformation Consistency

*For any* error that occurs in the application, when transformed by the error handling system, it should produce a consistent ErrorResponse structure with `success: false`, error code, and message
**Validates: Requirements 3.1, 3.3**

### Property 3: SQLite Error Mapping Consistency

*For any* SQLite error (UNIQUE constraint, FOREIGN KEY constraint, NOT NULL constraint), the error handler should always map it to the same HTTP status code (409, 400, 400 respectively)
**Validates: Requirements 3.2**

### Property 4: Fuel Efficiency Calculation Consistency

*For any* set of fuel expenses with mileage data, calculating fuel efficiency using the centralized calculation functions should produce the same result as the current implementation
**Validates: Requirements 4.1**

### Property 5: Cost Per Mile Calculation Consistency

*For any* set of expenses and mileage data, calculating cost per mile using the centralized calculation functions should produce the same result as the current implementation
**Validates: Requirements 4.2**

### Property 6: Date Grouping Consistency

*For any* date and grouping period (day, week, month, year), the centralized date grouping function should produce the same grouping key as the current implementation
**Validates: Requirements 4.3**

### Property 7: Number Formatting Consistency

*For any* number value, formatting it using the centralized formatting utilities should produce the same output as the current implementation
**Validates: Requirements 4.4**

### Property 8: API Behavior Preservation

*For any* API endpoint, after refactoring, sending the same request should produce the same response (status code, body structure, and data)
**Validates: All requirements (overall system correctness)**

Note: This is a comprehensive property that validates the entire refactoring maintains backward compatibility. It can be tested through integration tests that compare API responses before and after refactoring.
