# Design Document

## Overview

This design document outlines the technical approach for migrating the VROOM frontend to align with the comprehensive backend rewrite. The backend has been simplified and refactored, introducing breaking changes in API contracts, field naming conventions, and endpoint structures. This migration ensures the frontend correctly communicates with the new backend while maintaining all existing functionality and improving code quality.

The migration addresses three critical areas:
1. **API Field Name Mismatches**: Frontend uses `amount`/`volume`/`charge` while backend expects `expenseAmount`/`fuelAmount`
2. **Missing Analytics Endpoints**: Frontend calls `/api/v1/analytics/*` endpoints that don't exist in the backend
3. **Removed Financing Schedule Endpoint**: Backend removed `GET /api/financing/:financingId/schedule` (frontend already uses local calculations)

## Architecture

### Current State

**Frontend Architecture:**
- SvelteKit 2.x with Svelte 5 runes mode
- Type-safe API services in `lib/services/`
- Centralized state management with Svelte stores
- Offline-first expense tracking with local storage
- Client-side financing calculations already implemented

**Backend Architecture:**
- Hono framework with Bun runtime
- SQLite database with Drizzle ORM
- Repository pattern for data access
- Versioned API endpoints (`/api/v1/*`)
- Consolidated error handling

### Target State

**Frontend Changes:**
- API service layer updated with field name transformations
- Analytics API calls removed or replaced with client-side calculations
- Type definitions synchronized with backend schema
- Validation rules aligned with backend CONFIG constants
- Offline sync updated to use correct field names

**Backend Changes:**
- New analytics routes module created
- Analytics service implementing aggregation logic
- Expense repository extended with analytics queries
- Vehicle statistics calculations exposed via dedicated endpoints

## Components and Interfaces

### 1. API Transformation Layer

**Purpose**: Transform frontend data models to backend API contracts and vice versa

**Location**: `frontend/src/lib/services/api-transformer.ts` (new file)

**Interface**:
```typescript
export interface ApiTransformer {
  // Expense transformations
  toBackendExpense(frontendExpense: FrontendExpense): BackendExpenseRequest;
  fromBackendExpense(backendExpense: BackendExpenseResponse): FrontendExpense;
  
  // Batch transformations
  fromBackendExpenses(backendExpenses: BackendExpenseResponse[]): FrontendExpense[];
}
```

**Key Functions**:
- `toBackendExpense()`: Maps `amount` → `expenseAmount`, `volume` → `fuelAmount`, `charge` → `fuelAmount` (with unit tracking)
- `fromBackendExpense()`: Maps `expenseAmount` → `amount`, `fuelAmount` → `volume` or `charge` based on vehicle type
- Handles null/undefined values gracefully
- Preserves all other fields unchanged

### 2. Analytics Service (Backend)

**Purpose**: Provide aggregated statistics and trends for dashboard and analytics pages

**Location**: `backend/src/api/analytics/` (new module)

**Files**:
- `routes.ts`: HTTP route handlers
- `service.ts`: Business logic for calculations
- `repository.ts`: Database queries for analytics (extends expense repository)

**Endpoints**:
```typescript
GET /api/v1/analytics/dashboard
  Query params: startDate?, endDate?, groupBy? (day|week|month|year)
  Response: {
    vehicles: Vehicle[],
    totalExpenses: number,
    monthlyTrends: Array<{ period: string, amount: number }>,
    categoryBreakdown: Record<category, { amount, count, percentage }>,
    fuelEfficiency: { averageMPG, totalVolume, totalFuelCost, averageCostPerGallon },
    costPerMile: { totalCostPerMile, totalCost, totalMiles }
  }

GET /api/v1/analytics/vehicle/:vehicleId
  Query params: startDate?, endDate?, groupBy?
  Response: {
    vehicle: Vehicle,
    totalExpenses: number,
    monthlyTrends: Array<{ period: string, amount: number }>,
    categoryBreakdown: Record<category, { amount, count, percentage }>,
    fuelEfficiency: { averageMPG, totalVolume, totalMiles, trend: Array<{ date, mpg, mileage }> },
    costPerMile: { costPerMile, totalCost, totalMiles }
  }

GET /api/v1/analytics/trends
  Query params: startDate?, endDate?, groupBy?
  Response: {
    costTrends: Array<{ period, amount }>,
    milesTrends: Array<{ period, miles }>,
    costPerMileTrends: Array<{ period, costPerMile }>
  }
```

### 3. Expense Service Updates (Frontend)

**Purpose**: Update expense API service to use field transformations

**Location**: `frontend/src/lib/services/expense-api.ts` (existing file)

**Changes**:
- Import and use `ApiTransformer`
- Transform all outgoing expense data before sending
- Transform all incoming expense data after receiving
- Update TypeScript types to reflect backend schema

### 4. Offline Sync Manager Updates

**Purpose**: Ensure offline expenses sync with correct field names

**Location**: `frontend/src/lib/utils/sync-manager.ts` (existing file)

**Changes**:
- Use `ApiTransformer` for offline expense sync
- Update sync request payload to use backend field names
- Maintain backward compatibility with existing offline storage format
- Migrate stored offline expenses to new format on first load

### 5. Type Definitions Synchronization

**Purpose**: Ensure TypeScript types match between frontend and backend

**Location**: `frontend/src/lib/types/index.ts` (existing file)

**Changes**:
- Update `Expense` interface to include both frontend and backend field names
- Add type guards for field name checking
- Create utility types for API requests/responses
- Document field name mappings in comments

## Data Models

### Expense Entity Field Mapping

**Frontend Internal Model**:
```typescript
interface Expense {
  id: string;
  vehicleId: string;
  tags: string[];
  category: ExpenseCategory;
  amount: number;           // Internal: total cost
  date: string;
  mileage?: number;
  volume?: number;          // Internal: fuel volume (gallons/liters)
  charge?: number;          // Internal: electric charge (kWh)
  fuelType?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Backend API Model**:
```typescript
interface BackendExpense {
  id: string;
  vehicleId: string;
  tags: string[];
  category: string;
  expenseAmount: number;    // API: total cost
  date: Date;
  mileage?: number;
  fuelAmount?: number;      // API: fuel volume OR charge (unified)
  fuelType?: string;
  description?: string;
  receiptUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

**Transformation Rules**:
1. `amount` ↔ `expenseAmount`: Direct 1:1 mapping
2. `volume` → `fuelAmount`: For gas/hybrid vehicles
3. `charge` → `fuelAmount`: For electric vehicles (store unit type separately)
4. `fuelAmount` → `volume` OR `charge`: Based on vehicle type or stored unit type
5. Date strings ↔ Date objects: ISO string conversion

### Analytics Data Models

**Dashboard Analytics Response**:
```typescript
interface DashboardAnalytics {
  vehicles: Array<{ id: string, name: string, nickname?: string }>;
  totalExpenses: number;
  monthlyTrends: Array<{ period: string, amount: number }>;
  categoryBreakdown: Record<string, {
    amount: number;
    count: number;
    percentage: number;
  }>;
  fuelEfficiency: {
    averageMPG: number;
    totalVolume: number;
    totalFuelCost: number;
    averageCostPerGallon: number;
  };
  costPerMile: {
    totalCostPerMile: number;
    totalCost: number;
    totalMiles: number;
  };
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Expense field name transformation consistency
*For any* expense data submitted from frontend to backend, the request payload should contain `expenseAmount` and `fuelAmount` fields and should NOT contain `amount` or `volume` fields.
**Validates: Requirements 1.1, 1.2, 12.3**

### Property 2: Expense field name reverse transformation consistency
*For any* expense data received from backend, the frontend internal representation should contain `amount` and `volume`/`charge` fields and should NOT contain `expenseAmount` or `fuelAmount` fields.
**Validates: Requirements 1.3, 1.4**

### Property 3: Electric vehicle charge mapping
*For any* electric vehicle charging expense, the charge value should be stored in the backend `fuelAmount` field, and when retrieved, should be mapped back to the frontend `charge` field.
**Validates: Requirements 1.5**

### Property 4: Analytics date range filtering
*For any* analytics request with startDate and endDate parameters, all returned expense data should have dates within the specified range (inclusive).
**Validates: Requirements 2.5**

### Property 5: Analytics grouping correctness
*For any* analytics request with a groupBy parameter (day/week/month/year), all trend data should be grouped according to the specified period with no overlapping or missing periods.
**Validates: Requirements 2.3**

### Property 6: Tags array handling
*For any* expense creation or update, if tags are provided, they should be stored as a JSON array, and when retrieved, should be parsed back to an array (not a string).
**Validates: Requirements 3.2, 3.4**

### Property 7: Legacy expense compatibility
*For any* expense retrieved from the backend that lacks a `tags` field, the frontend should treat it as having an empty tags array without throwing errors.
**Validates: Requirements 3.3**

### Property 8: Tag filtering correctness
*For any* expense filter with selected tags, the filtered results should include only expenses where at least one tag in the expense's tags array matches at least one tag in the filter.
**Validates: Requirements 3.5**

### Property 9: Loan terms validation
*For any* loan terms with principal, APR, and termMonths, the `validateLoanTerms` function should return errors if and only if: principal ≤ 0, APR < 0 or APR > 100, or termMonths ≤ 0.
**Validates: Requirements 4.2**

### Property 10: Payment breakdown calculation accuracy
*For any* valid loan with principal, APR, termMonths, and paymentNumber, the sum of principalAmount and interestAmount from `calculatePaymentBreakdown` should equal the monthly payment amount (within rounding tolerance of $0.01).
**Validates: Requirements 4.3**

### Property 11: API versioning compliance
*For any* API request made by the frontend, the URL should start with `/api/v1/` prefix.
**Validates: Requirements 5.1**

### Property 12: Backend redirect correctness
*For any* request to an unversioned endpoint `/api/X`, the backend should redirect to `/api/v1/X` with HTTP status 308.
**Validates: Requirements 5.3**

### Property 13: Error response format consistency
*For any* error returned by the backend, the response should have the structure `{ success: false, error: { code: string, message: string, details?: unknown } }`.
**Validates: Requirements 6.1**

### Property 14: Error message extraction
*For any* error response received by the frontend, the displayed error message should be extracted from `error.message` field.
**Validates: Requirements 6.2**

### Property 15: Validation error field mapping
*For any* validation error with field-specific details, the frontend should display error messages on the corresponding form fields.
**Validates: Requirements 6.5**

### Property 16: Backup validation rejection
*For any* backup file uploaded with invalid structure or mismatched user ID, the backend should reject it with a validation error before processing.
**Validates: Requirements 7.2**

### Property 17: Sync timestamp updates
*For any* successful sync operation (sheets or backup), the backend should update the corresponding timestamp field (`lastSyncDate` or `lastBackupDate`) in user settings.
**Validates: Requirements 7.5**

### Property 18: Vehicle statistics period filtering
*For any* vehicle statistics request with a period parameter, the backend should include only expenses within that period in the calculations.
**Validates: Requirements 8.2**

### Property 19: MPG calculation from consecutive readings
*For any* sequence of fuel expenses with mileage data, the average MPG should be calculated using (mileage[i] - mileage[i-1]) / fuelAmount[i] for consecutive pairs.
**Validates: Requirements 8.3**

### Property 20: Insurance expiration alert generation
*For any* insurance policy with endDate within 30 days of current date, the backend response should include an expirationAlert object with appropriate severity.
**Validates: Requirements 9.2, 9.3**

### Property 21: Payment history sorting
*For any* payment history response, payments should be ordered by paymentDate in descending order (most recent first).
**Validates: Requirements 10.1, 19.4**

### Property 22: Payment ownership verification
*For any* payment history request, the backend should verify the user owns the vehicle associated with the financing before returning data.
**Validates: Requirements 10.2**

### Property 23: Settings partial update
*For any* settings update request, only the fields included in the request body should be modified in the database, leaving other fields unchanged.
**Validates: Requirements 11.1**

### Property 24: Settings validation bounds
*For any* settings update with `syncInactivityMinutes`, the backend should reject values less than 1 or greater than 30.
**Validates: Requirements 11.5**

### Property 25: Offline expense field transformation
*For any* offline expense synced to the backend, the sync request should use `expenseAmount` and `fuelAmount` field names, not `amount` and `volume`.
**Validates: Requirements 12.3**

### Property 26: Offline expense validation consistency
*For any* offline expense synced to the backend, the validation rules applied should be identical to those applied to expenses created online.
**Validates: Requirements 12.4**

### Property 27: Financing upsert behavior
*For any* vehicle, creating financing when financing already exists should update the existing record, resulting in exactly one financing record per vehicle.
**Validates: Requirements 13.3**

### Property 28: Initial financing balance
*For any* newly created financing record, the `currentBalance` field should equal the `originalAmount` field.
**Validates: Requirements 13.5**

### Property 29: Conditional loan validation
*For any* financing submission with `financingType` equal to `loan` and `apr` provided, the backend should validate the loan terms; otherwise validation should be skipped.
**Validates: Requirements 13.2**

### Property 30: Query parameter date format
*For any* expense filter request with date range, the `startDate` and `endDate` query parameters should be ISO 8601 formatted strings.
**Validates: Requirements 18.4**

### Property 31: Expense query filter application
*For any* expense query with multiple filters (vehicleId, category, tags, dateRange), the backend should return only expenses matching ALL specified filters (AND logic).
**Validates: Requirements 18.5**

### Property 32: Payment calculation correctness
*For any* payment recorded on a loan, the backend should calculate principalAmount, interestAmount, and remainingBalance such that: remainingBalance = previousBalance - principalAmount.
**Validates: Requirements 19.2**

### Property 33: Payment number increment
*For any* new payment created for a financing record, the paymentNumber should equal the count of existing payments plus one.
**Validates: Requirements 19.5**

### Property 34: Validation rule consistency
*For any* data field validated by both frontend and backend, the validation rules should be identical (same min/max values, same required/optional status).
**Validates: Requirements 16.1, 16.2, 16.3**

### Property 35: Fuel expense required fields
*For any* expense with category `fuel`, both frontend and backend should require `mileage` and `fuelAmount` fields to be present and non-null.
**Validates: Requirements 16.4**

### Property 36: Backup retention policy
*For any* user with `googleDriveBackupRetentionCount` set to N, after uploading a new backup, the backend should ensure at most N backup files exist in the user's Drive folder.
**Validates: Requirements 20.5**

## Error Handling

### Error Categories

1. **Field Mapping Errors**: Occur when transformation fails due to unexpected data types
   - Mitigation: Validate data types before transformation
   - Fallback: Use default values for missing fields
   - Logging: Log transformation failures with original data

2. **API Contract Violations**: Occur when backend changes aren't reflected in frontend
   - Mitigation: Use TypeScript strict mode to catch type mismatches
   - Fallback: Graceful degradation with user notification
   - Logging: Log unexpected response structures

3. **Analytics Calculation Errors**: Occur when insufficient data exists for calculations
   - Mitigation: Check data availability before calculations
   - Fallback: Return null or zero values with appropriate messaging
   - Logging: Log calculation failures with input data

4. **Offline Sync Failures**: Occur when offline expenses can't be synced
   - Mitigation: Retry with exponential backoff
   - Fallback: Keep in offline queue with error indicator
   - Logging: Log sync failures with expense details

### Error Response Handling

**Backend Error Format**:
```typescript
{
  success: false,
  error: {
    code: string,      // e.g., "VALIDATION_ERROR", "NOT_FOUND"
    message: string,   // Human-readable message
    details?: unknown  // Optional field-specific details
  }
}
```

**Frontend Error Handling Strategy**:
1. Extract error from `error.message` field
2. Map error codes to user-friendly messages
3. Display field-specific errors from `error.details` on form fields
4. Show toast notifications for general errors
5. Log full error object for debugging

## Testing Strategy

### Unit Tests

**Frontend Unit Tests**:
- API transformer functions (to/from backend format)
- Field name mapping logic
- Date string to ISO conversion
- Null/undefined handling in transformations
- Offline expense field transformation

**Backend Unit Tests**:
- Analytics service calculations (grouping, aggregation)
- Expense repository analytics queries
- Date range filtering logic
- Category breakdown calculations
- Fuel efficiency calculations

### Property-Based Tests

**Testing Framework**: fast-check (JavaScript/TypeScript property-based testing library)

**Configuration**: Each property test should run a minimum of 100 iterations to ensure thorough coverage of the input space.

**Test Organization**: Each property-based test MUST be tagged with a comment explicitly referencing the correctness property in this design document using the format: `**Feature: frontend-backend-migration, Property {number}: {property_text}**`

**Property Test Implementations**:

1. **Property 1 Test**: Generate random expense objects, transform to backend format, verify `expenseAmount` and `fuelAmount` exist and `amount`/`volume` don't
2. **Property 2 Test**: Generate random backend expense responses, transform to frontend format, verify `amount` and `volume`/`charge` exist
3. **Property 4 Test**: Generate random expenses with dates, filter by random date range, verify all results are within range
4. **Property 9 Test**: Generate random loan terms (including invalid ones), verify validation returns errors only for invalid cases
5. **Property 10 Test**: Generate random loan parameters, calculate payment breakdown, verify principal + interest = monthly payment
6. **Property 19 Test**: Generate sequential fuel expenses, calculate MPG, verify formula correctness
7. **Property 24 Test**: Generate random syncInactivityMinutes values, verify rejection for values < 1 or > 30
8. **Property 31 Test**: Generate random expenses and filters, verify results match ALL filter criteria
9. **Property 32 Test**: Generate random payments, verify balance calculation: newBalance = oldBalance - principal
10. **Property 34 Test**: Compare frontend and backend validation rules programmatically, verify they match

### Integration Tests

**API Integration Tests**:
- End-to-end expense creation with field transformation
- Analytics endpoint responses match expected structure
- Offline expense sync with correct field names
- Backup/restore with field name compatibility
- Session refresh during long-running operations

**Test Scenarios**:
1. Create expense online → verify backend receives correct field names
2. Retrieve expenses → verify frontend receives correct field names
3. Create expense offline → sync → verify transformation applied
4. Request analytics → verify response structure and calculations
5. Upload backup → restore → verify data integrity with field mappings

### Manual Testing Checklist

- [ ] Create fuel expense for gas vehicle → verify `volume` maps to `fuelAmount`
- [ ] Create charging expense for electric vehicle → verify `charge` maps to `fuelAmount`
- [ ] View dashboard analytics → verify charts display correctly
- [ ] Filter expenses by date range → verify correct results
- [ ] Create expense offline → go online → verify auto-sync works
- [ ] View vehicle statistics → verify MPG calculations are accurate
- [ ] Record financing payment → verify balance updates correctly
- [ ] View insurance policies → verify expiration alerts appear
- [ ] Download backup → restore → verify all data preserved
- [ ] Change settings → verify preferences persist correctly

## Implementation Notes

### Migration Strategy

**Phase 1: Backend Analytics Implementation**
1. Create analytics module structure
2. Implement analytics service with calculation logic
3. Create analytics routes with proper validation
4. Add analytics endpoints to main app router
5. Test analytics endpoints independently

**Phase 2: Frontend API Transformation Layer**
1. Create API transformer utility
2. Implement to/from backend transformation functions
3. Add unit tests for transformations
4. Update type definitions

**Phase 3: Frontend Service Layer Updates**
1. Update expense-api.ts to use transformations
2. Update vehicle-api.ts if needed
3. Update offline sync manager
4. Update all fetch calls to use transformations

**Phase 4: Integration and Testing**
1. Test expense creation/update flows
2. Test analytics pages
3. Test offline sync
4. Test backup/restore
5. Fix any issues discovered

### Backward Compatibility

**Offline Storage Migration**:
- Existing offline expenses use old field names (`amount`, `volume`)
- On first load after migration, transform stored expenses to new format
- Keep transformation logic to handle both old and new formats during transition

**API Response Handling**:
- Frontend should handle both old and new response formats during deployment
- Use feature detection to determine which format is being used
- Gracefully degrade if unexpected format encountered

### Performance Considerations

**Analytics Calculations**:
- Cache analytics results for 5 minutes to reduce database load
- Use database indexes on date and vehicleId columns
- Limit date ranges to prevent excessive data processing
- Implement pagination for large result sets

**Field Transformations**:
- Transformations are pure functions with O(1) complexity
- Batch transformations for arrays to minimize overhead
- Memoize transformation results for repeated data

**Offline Sync**:
- Process offline expenses in batches of 10
- Use exponential backoff for retries (1s, 2s, 4s, 8s)
- Limit concurrent sync operations to 1 per user

## Security Considerations

1. **Field Name Validation**: Ensure transformation doesn't introduce injection vulnerabilities
2. **Analytics Authorization**: Verify user owns vehicles before returning analytics
3. **Backup User ID Validation**: Reject backups with mismatched user IDs
4. **Query Parameter Sanitization**: Validate and sanitize all query parameters
5. **Rate Limiting**: Apply rate limits to analytics endpoints to prevent abuse

## Deployment Strategy

### Rolling Deployment

1. Deploy backend with analytics endpoints first
2. Verify analytics endpoints work correctly
3. Deploy frontend with transformations
4. Monitor error rates and rollback if issues detected
5. Gradually migrate users to new frontend version

### Rollback Plan

1. Keep old frontend version available
2. Backend maintains backward compatibility with redirects
3. If critical issues found, route traffic back to old frontend
4. Fix issues in new version and redeploy

### Monitoring

- Track API error rates by endpoint
- Monitor field transformation failures
- Alert on analytics calculation errors
- Track offline sync success rates
- Monitor session refresh failures

## Open Questions

1. Should we maintain a mapping table for electric vehicle charge units to properly reverse the `fuelAmount` → `charge` transformation?
2. Should analytics endpoints support real-time calculations or use cached/pre-aggregated data?
3. Should we migrate existing offline expenses in local storage or require users to sync them first?
4. Should we add a migration endpoint to help users transition their data?
5. Should we version the offline storage format to handle future changes?

## Dependencies

- fast-check: ^3.15.0 (for property-based testing)
- Existing frontend dependencies (SvelteKit, Svelte 5, TypeScript)
- Existing backend dependencies (Hono, Drizzle, Zod)

## Timeline Estimate

- Backend analytics implementation: 2-3 days
- Frontend transformation layer: 1-2 days
- Service layer updates: 1-2 days
- Testing and bug fixes: 2-3 days
- **Total**: 6-10 days

## Success Criteria

1. All expense operations work without field name errors
2. Dashboard analytics display correctly with real data
3. Offline expenses sync successfully with correct field names
4. All existing features continue to work
5. No increase in error rates after deployment
6. TypeScript compilation succeeds with no type errors
7. All property-based tests pass with 100+ iterations
8. Integration tests pass for all critical flows
