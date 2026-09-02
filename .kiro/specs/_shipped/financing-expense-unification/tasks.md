# Implementation Plan: Financing-Expense Unification

## Overview

Unify financing payments with the expense system by adding an `isFinancingPayment` boolean to expenses, dropping the `vehicle_financing_payments` table, wiring financing hooks into expense CRUD, and updating the frontend financing tab to derive payment data from expenses.

## Tasks

- [x] 1. Backend schema and type changes
  - [x] 1.1 Add `isFinancingPayment` column to expenses table and drop `vehicle_financing_payments` table
    - Add `isFinancingPayment: integer('is_financing_payment', { mode: 'boolean' }).notNull().default(false)` to the expenses table in `backend/src/db/schema.ts`
    - Remove the `vehicle_financing_payments` table definition from `backend/src/db/schema.ts`
    - Update `backend/src/db/types.ts` to reflect the new column and remove payment table types
    - Update Zod validation schemas in `backend/src/utils/validation.ts` to include `isFinancingPayment` (default `false`)
    - Remove `FINANCING_TAGS` constant and any tag-based financing detection logic
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3_

  - [x] 1.2 Update frontend types to include `isFinancingPayment` and remove old payment types
    - Add `isFinancingPayment: boolean` to the `Expense` type in `frontend/src/lib/types/index.ts`
    - Remove `VehicleFinancingPayment`, `FinancingPayment`, and any related types
    - Add `DerivedPaymentEntry` interface to `frontend/src/lib/types/index.ts`
    - Update `frontend/src/lib/services/api-transformer.ts` if it references old payment types
    - _Requirements: 1.3, 2.2, 7.1, 7.2_

- [x] 2. Backend financing hooks and expense route integration
  - [x] 2.1 Implement financing hook functions
    - Create `backend/src/api/financing/hooks.ts` with `isFinancingExpense()`, `handleFinancingOnCreate()`, `handleFinancingOnDelete()`, and `handleFinancingOnUpdate()` functions
    - `handleFinancingOnCreate`: subtract `expenseAmount` from `currentBalance`, clamp to 0, auto-complete if balance ≤ 0.01
    - `handleFinancingOnDelete`: add back `expenseAmount`, clamp to `originalAmount`, reactivate if previously auto-completed
    - `handleFinancingOnUpdate`: handle all four cases (was/is financing flag combinations), compute balance delta, clamp to `[0, originalAmount]`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.2 Write property test: Balance Consistency (Property 1)
    - **Property 1: Balance Consistency**
    - For any vehicle with active financing and any set of financing expenses, `currentBalance` should equal `originalAmount - sum(expenseAmounts)`
    - **Validates: Requirements 3.1, 4.1, 5.1, 5.5, 7.2**

  - [x] 2.3 Write property test: Create-Delete Symmetry (Property 2)
    - **Property 2: Create-Delete Symmetry**
    - Creating then deleting a financing expense should restore `currentBalance` to its pre-creation value (clamped to `[0, originalAmount]`)
    - **Validates: Requirements 3.1, 3.2, 4.1, 4.2**

  - [x] 2.4 Write property test: Update Delta Correctness (Property 3)
    - **Property 3: Update Delta Correctness**
    - Updating a financing expense from amount `a1` to `a2` should change balance by `a1 - a2`, including flag transitions
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

  - [x] 2.5 Write property test: Non-Financing Expense Isolation (Property 5)
    - **Property 5: Non-Financing Expense Isolation**
    - Expenses with `isFinancingPayment` false/undefined/null should never change any `currentBalance`
    - **Validates: Requirements 3.5, 4.4, 5.4**

  - [x] 2.6 Write property test: Financing Active Status Consistency (Property 6)
    - **Property 6: Financing Active Status Consistency**
    - Balance ≤ 0.01 after payment → `isActive = false`; deletion restoring balance > 0.01 on auto-completed financing → `isActive = true`, `endDate = null`
    - **Validates: Requirements 3.3, 4.3**

  - [x] 2.7 Integrate financing hooks into expense routes
    - Modify `backend/src/api/expenses/routes.ts` POST handler to call `handleFinancingOnCreate()` after expense creation and return financing data in response
    - Modify DELETE handler to call `handleFinancingOnDelete()` before expense deletion
    - Modify PUT handler to call `handleFinancingOnUpdate()` with existing and updated expense data, return financing data in response
    - Add validation: reject expense creation with `isFinancingPayment: true` if vehicle has no active financing
    - _Requirements: 3.1, 3.4, 4.1, 5.1, 11.1, 11.2, 11.3_

  - [x] 2.8 Write property test: Financing Payment Validation (Property 8)
    - **Property 8: Financing Payment Validation**
    - Creating an expense with `isFinancingPayment: true` when vehicle has no active financing should be rejected
    - **Validates: Requirement 3.4**

- [x] 3. Backend financing expense query and cleanup
  - [x] 3.1 Add `findFinancingByVehicleId` to expense repository
    - Add method to `backend/src/api/expenses/repository.ts` that queries expenses with `isFinancingPayment = true` for a given vehicle, sorted by date ascending
    - _Requirements: 6.1, 6.2_

  - [x] 3.2 Write property test: Financing Expense Query Correctness (Property 7)
    - **Property 7: Financing Expense Query Correctness**
    - Query should return exactly those expenses where `isFinancingPayment === true` and `vehicleId` matches, sorted by date ascending
    - **Validates: Requirements 6.1, 6.2**

  - [x] 3.3 Remove old financing payments code
    - Remove payment-related repository methods from `backend/src/api/financing/repository.ts` (e.g., `getFinancingPayments`, `createFinancingPayment`, etc.)
    - Remove payment-related route handlers from `backend/src/api/financing/routes.ts`
    - Remove payment-related route handlers from `backend/src/api/vehicles/routes.ts` if any exist
    - Remove `getFinancingPayments` from `frontend/src/lib/services/vehicle-api.ts`
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Checkpoint - Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Frontend `derivePaymentEntries` utility
  - [x] 5.1 Implement `derivePaymentEntries()` in `frontend/src/lib/utils/financing-calculations.ts`
    - Sort financing expenses by date ascending, assign sequential `paymentNumber` from 1
    - Compute `remainingBalance` as `originalAmount - cumulativeSum`, clamped to 0
    - Look up `principalAmount` and `interestAmount` from amortization schedule for loans with APR > 0; for leases or no-APR loans, set `principalAmount = expenseAmount`, `interestAmount = 0`
    - Classify `paymentType` as `'extra'` if `expenseAmount > financing.paymentAmount`, otherwise `'standard'`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 5.2 Write property test: Payment Number Monotonicity and Remaining Balance (Property 4)
    - **Property 4: Payment Number Monotonicity and Remaining Balance**
    - `paymentNumber` equals 1-based index, `remainingBalance` is non-increasing across sequential entries
    - **Validates: Requirements 7.1, 7.2**

  - [x] 5.3 Write property test: Payment Type Classification (Property 9)
    - **Property 9: Payment Type Classification**
    - `expenseAmount > paymentAmount` → `'extra'`; otherwise → `'standard'`
    - **Validates: Requirement 7.5**

  - [x] 5.4 Write property test: Principal and Interest Derivation (Property 10)
    - **Property 10: Principal and Interest Derivation**
    - Loan with APR > 0: `principalAmount` and `interestAmount` match amortization schedule; lease or no APR: `principalAmount = expenseAmount`, `interestAmount = 0`
    - **Validates: Requirements 7.3, 7.4**

- [x] 6. Frontend expense form financing checkbox
  - [x] 6.1 Add financing payment checkbox to expense form
    - In the expense form component under `frontend/src/lib/components/expenses/`, add a checkbox labeled "Apply as payment towards financing"
    - Show checkbox only when `category === 'financial'` AND the selected vehicle has active financing
    - When checked, include `isFinancingPayment: true` in the submitted payload; when unchecked, include `isFinancingPayment: false`
    - Handle pre-filling `isFinancingPayment: true` from URL params (for "Record Payment" flow)
    - Update `frontend/src/lib/services/expense-api.ts` to pass `isFinancingPayment` in create/update requests
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.2_

  - [x] 6.2 Visual verification: expense form financing checkbox
    - Using Chrome MCP, navigate to the expense form for a vehicle with active financing
    - Select the `financial` category and verify the "Apply as payment towards financing" checkbox appears
    - Switch to a non-financial category and verify the checkbox hides
    - Switch back to `financial` for a vehicle without financing and verify the checkbox does not appear
    - Take screenshots to confirm correct behavior

- [x] 7. Frontend financing tab migration
  - [x] 7.1 Update financing tab to load payment data from expenses
    - Replace `vehicleApi.getFinancingPayments()` calls with expense-based queries filtered by `isFinancingPayment === true`
    - Call `derivePaymentEntries()` to transform expenses into `DerivedPaymentEntry[]`
    - Remove all references to the old `vehicle_financing_payments` API endpoint
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 7.2 Update financing components to use `DerivedPaymentEntry`
    - Update `PaymentHistory.svelte` props from `VehicleFinancingPayment[]` to `DerivedPaymentEntry[]`
    - Update `FinancingCharts.svelte` props to accept `DerivedPaymentEntry[]`
    - Update `NextPaymentCard.svelte` props to accept `DerivedPaymentEntry`
    - Adjust rendering logic in each component to use the new data shape
    - _Requirements: 10.2, 7.1, 7.2, 7.3_

  - [x] 7.3 Add "Record Payment" button to financing tab
    - Add a button on the financing tab that navigates to the expense form with prefilled URL params: `vehicleId`, `category=financial`, `isFinancingPayment=true`, `amount=paymentAmount`
    - Only show the button when `financing.isActive === true`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 7.4 Visual verification: financing tab and Record Payment button
    - Using Chrome MCP, navigate to a vehicle detail page with active financing and open the Finance tab
    - Verify the "Record Payment" button is visible
    - Verify payment history renders correctly with derived payment entries (payment numbers, remaining balances, principal/interest breakdown)
    - Verify charts display correctly with the new data source
    - Click "Record Payment" and verify the expense form opens pre-filled with the correct vehicle, `financial` category, financing checkbox checked, and payment amount
    - Take screenshots to confirm correct behavior

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. End-to-end visual verification of full flow
  - [x] 9.1 E2E: Record payment from financing tab
    - Using Chrome MCP, navigate to a vehicle with active financing, note the current balance
    - Click "Record Payment" on the Finance tab, confirm the pre-filled expense form, submit
    - Navigate back to the Finance tab and verify the balance decreased, payment appears in history, charts updated
    - Take screenshots at each step

  - [x] 9.2 E2E: Record payment from expense form
    - Using Chrome MCP, navigate to the expense form directly
    - Select a vehicle with active financing, choose `financial` category
    - Verify the financing checkbox appears, check it, fill in amount and date, submit
    - Navigate to the vehicle's Finance tab and verify the balance decreased and payment appears in history
    - Navigate to the Expenses tab and verify the expense appears in the expense list
    - Take screenshots at each step

  - [x] 9.3 E2E: Delete a financing payment and verify balance restoration
    - Using Chrome MCP, navigate to the expenses list, find a financing payment expense
    - Delete it and verify the vehicle's financing balance is restored on the Finance tab
    - Take screenshots at each step

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The app is not in production, so no data migration is needed — the old table is simply dropped
