# Backend Simplification Migration Guide

This document outlines breaking changes introduced by the backend simplification effort and provides guidance for frontend updates.

## Breaking Changes

### 1. Financing Calculations Moved to Frontend

**Removed Endpoint:**
- `GET /api/financing/:financingId/schedule` - This endpoint has been removed

**Removed Backend File:**
- `backend/src/financing/calculations.ts` - Deleted entirely

**Rationale:**
Financing calculations are pure functions that don't require server-side state. Moving them to the frontend provides:
- Instant calculation updates in UI (no API calls)
- Better user experience with real-time feedback
- Simpler backend (just stores data, doesn't calculate)
- Frontend can show multiple scenarios without server round-trips

**Frontend Must Implement:**

Copy these three functions to your frontend codebase:

```typescript
// From backend/src/financing/calculations.ts

export interface LoanTerms {
  principal: number;
  apr: number;
  termMonths: number;
  startDate: Date;
}

export function validateLoanTerms(terms: LoanTerms): string[] {
  const errors: string[] = [];

  if (terms.principal <= 0) {
    errors.push('Principal must be greater than 0');
  }

  if (terms.apr < 0 || terms.apr > 100) {
    errors.push('APR must be between 0 and 100');
  }

  if (terms.termMonths <= 0) {
    errors.push('Term must be at least 1 month');
  }

  return errors;
}

export function calculatePaymentBreakdown(
  principal: number,
  apr: number,
  termMonths: number,
  paymentNumber: number
): {
  principalAmount: number;
  interestAmount: number;
} {
  const monthlyRate = apr / 100 / 12;
  const monthlyPayment =
    (principal * monthlyRate * (1 + monthlyRate) ** termMonths) /
    ((1 + monthlyRate) ** termMonths - 1);

  // Calculate remaining balance before this payment
  const remainingBalance =
    (principal * ((1 + monthlyRate) ** termMonths - (1 + monthlyRate) ** (paymentNumber - 1))) /
    ((1 + monthlyRate) ** termMonths - 1);

  const interestAmount = remainingBalance * monthlyRate;
  const principalAmount = monthlyPayment - interestAmount;

  return {
    principalAmount: Math.max(0, principalAmount),
    interestAmount: Math.max(0, interestAmount),
  };
}

export function generateAmortizationSchedule(terms: LoanTerms): {
  monthlyPayment: number;
  totalInterest: number;
  totalPayments: number;
  payoffDate: string;
  schedule: Array<{
    paymentNumber: number;
    paymentDate: string;
    paymentAmount: number;
    principalAmount: number;
    interestAmount: number;
    remainingBalance: number;
  }>;
} {
  const monthlyRate = terms.apr / 100 / 12;
  const monthlyPayment =
    (terms.principal * monthlyRate * (1 + monthlyRate) ** terms.termMonths) /
    ((1 + monthlyRate) ** terms.termMonths - 1);

  let remainingBalance = terms.principal;
  let totalInterest = 0;
  const schedule = [];

  for (let i = 1; i <= terms.termMonths; i++) {
    const interestAmount = remainingBalance * monthlyRate;
    const principalAmount = monthlyPayment - interestAmount;
    remainingBalance -= principalAmount;
    totalInterest += interestAmount;

    const paymentDate = new Date(terms.startDate);
    paymentDate.setMonth(paymentDate.getMonth() + i);

    schedule.push({
      paymentNumber: i,
      paymentDate: paymentDate.toISOString(),
      paymentAmount: monthlyPayment,
      principalAmount,
      interestAmount,
      remainingBalance: Math.max(0, remainingBalance),
    });
  }

  const payoffDate = new Date(terms.startDate);
  payoffDate.setMonth(payoffDate.getMonth() + terms.termMonths);

  return {
    monthlyPayment,
    totalInterest,
    totalPayments: monthlyPayment * terms.termMonths,
    payoffDate: payoffDate.toISOString(),
    schedule,
  };
}
```

**Frontend Implementation Steps:**

1. Create a new file: `frontend/src/lib/utils/financing-calculations.ts`
2. Copy the three functions above into this file
3. Update any components that were calling `GET /api/financing/:financingId/schedule` to use `generateAmortizationSchedule()` locally
4. Update any components that need payment breakdowns to use `calculatePaymentBreakdown()` locally
5. Use `validateLoanTerms()` for client-side validation before submitting financing data

**Example Usage:**

```typescript
import { generateAmortizationSchedule, type LoanTerms } from '$lib/utils/financing-calculations';

// Instead of fetching from API:
// const response = await fetch(`/api/financing/${financingId}/schedule`);
// const schedule = await response.json();

// Calculate locally:
const terms: LoanTerms = {
  principal: 25000,
  apr: 4.5,
  termMonths: 60,
  startDate: new Date('2024-01-01'),
};

const schedule = generateAmortizationSchedule(terms);
console.log(schedule.monthlyPayment); // Monthly payment amount
console.log(schedule.totalInterest); // Total interest over loan term
console.log(schedule.schedule); // Full amortization schedule
```

## Non-Breaking Changes

The following changes are purely internal and don't affect API contracts:

### 1. QueryBuilder Removed
- Repositories now use direct Drizzle queries
- `utils/query-builder.ts` deleted
- No API changes

### 2. BaseRepository Simplified
- Removed excessive error handling
- Removed getTableName() helper
- Errors bubble to global handler
- File renamed from `utils/base-repository.ts` to `utils/repository.ts`
- No API changes

### 3. Backup Repository Consolidated
- `utils/backup-repository.ts` merged into `sync/backup.ts`
- Methods moved as private methods in BackupService
- No API changes

### 4. Session Refresh Utility Extracted
- Created `auth/utils.ts` with `validateAndRefreshSession()` function
- Removed duplicate session refresh logic from middleware and routes
- No API changes

### 5. Ownership Validation Helpers Added
- Added `validateVehicleOwnership()` to `utils/validation.ts`
- Added `validateExpenseOwnership()` to `utils/validation.ts`
- Added `validateFinancingOwnership()` to `utils/validation.ts`
- Added `validateInsuranceOwnership()` to `utils/validation.ts`
- These helpers can be used in route handlers for consistent ownership validation
- No API changes

### 6. Vehicle Stats Calculations Extracted
- Created `utils/vehicle-stats.ts` with calculation functions
- Moved `calculateVehicleStats()`, `calculateTotals()`, `calculateMileageStats()`, `calculateAverageMpg()` from `vehicles/routes.ts`
- No API changes

### 7. Duplicate Enum Definitions Merged
- Removed duplicate `PaymentFrequency`, `PaymentType`, `AuthProvider` enums from `types.ts`
- Now re-exported from `db/types.ts` to avoid duplication
- Type guards also re-exported to maintain backward compatibility
- No API changes

### 8. Type Guards Generated Programmatically
- Created `createEnumGuard()` helper function in `db/types.ts`
- Replaced hand-written type guards with generated ones
- Reduces code duplication and makes adding new enums easier
- No API changes

### 9. Error Handling Consolidated
- Marked `ForbiddenError` as deprecated (use `AuthorizationError` instead)
- Removed unused `ExternalServiceError` class
- Both classes kept for backward compatibility but deprecated
- No API changes

### 10. Unused Exports and Dead Code Removed
- Removed `clearIdempotencyCache()` export (only used for testing)
- Removed `assertApiResponse()` function (never called)
- Made `formatErrorResponse()` internal (only used by middleware)
- Removed `withErrorHandling()` function (unused)
- Removed `createTypedError()` function (unused)
- Removed `checkpointAfterWrite` middleware (exported but never used)
- No API changes

### 11. Activity Tracker Middleware Simplified
- Removed complex `SyncConfig` object parameter
- Simplified `recordActivity()` to take `inactivityDelayMinutes` directly
- Renamed `updateSyncConfig()` to `updateInactivityDelay()` with simpler signature
- Removed `nextSyncIn` from `getSyncStatus()` return value
- No API changes

### 12. Logger Specialized Methods Simplified
- Removed unused specialized methods: `http()`, `database()`, `auth()`, `external()`, `test()`
- Kept only used methods: `error()`, `warn()`, `info()`, `debug()`, `startup()`, `checkpoint()`
- Call sites can use `info()` or `error()` instead of specialized methods
- No API changes

### 13. Shared Validation Logic Extracted
- Moved `validateFuelExpenseData()` from `expenses/routes.ts` to `utils/validation.ts`
- Both create and update routes now use the shared function
- No API changes

### 14. Sync Service Factories Simplified
- Created shared `getUserToken()` helper in both `google-drive.ts` and `google-sheets.ts`
- Simplified `createDriveServiceForUser()` and `createSheetsServiceForUser()` to use helper
- Reduced code duplication
- No API changes

### 15. Validation Schemas Composed with Reusable Validators
- Added `validators` object to `utils/validation.ts` with common patterns
- Includes: `requiredString()`, `optionalString()`, `positiveNumber()`, `nonNegativeInt()`, etc.
- Can be used to compose validation schemas consistently
- No API changes

### 16. Response Types Consolidated
- Removed specific response interfaces (VehicleResponse, ExpenseResponse, etc.)
- Use generic `ApiResponse<T>` with domain types instead
- Example: `ApiResponse<Vehicle>`, `ApiResponse<Expense[]>`
- No API changes (JSON structure remains identical)

## Questions?

If you encounter any issues during migration, please refer to the design document at `.kiro/specs/backend-simplification/design.md` or open an issue.
