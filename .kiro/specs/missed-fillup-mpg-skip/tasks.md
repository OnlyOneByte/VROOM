# Tasks

## Task 1: Backend — Add missedFillup to FuelExpense interface and skip logic in vehicle-stats.ts

- [x] 1.1 Add `missedFillup: boolean` to the `FuelExpense` interface in `backend/src/utils/vehicle-stats.ts`
- [x] 1.2 Update `calculateAverageMpg()` in `vehicle-stats.ts` to skip pairs where `current.missedFillup === true` or `previous.missedFillup === true`
- [x] 1.3 Update `calculateVehicleStats()` to pass `missedFillup` from expense data into the `FuelExpense` objects

## Task 2: Backend — Add skip logic in calculations.ts

- [x] 2.1 Update `calculateAverageMPG()` in `backend/src/utils/calculations.ts` to skip pairs where `current.missedFillup === true` or `previous.missedFillup === true`

## Task 3: Frontend — Add missedFillup to types and API transformer

- [x] 3.1 Add `missedFillup?: boolean` to the `Expense` interface in `frontend/src/lib/types.ts`
- [x] 3.2 Add `missedFillup?: boolean` to the `ExpenseFormData` interface in `frontend/src/lib/types.ts`
- [x] 3.3 Add `missedFillup?: boolean` to `BackendExpenseRequest` and `BackendExpenseResponse` in `frontend/src/lib/services/api-transformer.ts`
- [x] 3.4 Update `toBackendExpense()` to pass through `missedFillup` field
- [x] 3.5 Update `fromBackendExpense()` to map `missedFillup` from backend response to frontend Expense

## Task 4: Frontend — Add skip logic in expense-helpers.ts

- [x] 4.1 Update `prepareFuelEfficiencyData()` in `frontend/src/lib/utils/expense-helpers.ts` to skip pairs where `current.missedFillup === true` or `previous.missedFillup === true`

## Task 5: Frontend — Add missed fill-up checkbox to expense form

- [x] 5.1 Add `missedFillup` field to `formData` state in `ExpenseForm.svelte` (default `false`)
- [x] 5.2 Load `missedFillup` from existing expense in `loadExpense()` when editing
- [x] 5.3 Include `missedFillup` in the submit payload in `handleSubmit()`
- [x] 5.4 Add `missedFillup` prop to `FuelFieldsSection.svelte` and render a "Missed previous fill-up" checkbox using shadcn `Checkbox`
- [x] 5.5 Suppress MPG calculation indicator in `FuelFieldsSection.svelte` when `missedFillup` is true (pass `showMpgCalculation` as `false` when flagged)

## Task 6: UI verification via Chrome DevTools MCP

- [x] 6.1 Navigate to the new expense form with category set to fuel — use `mcp_chrome_devtools_take_snapshot` to verify the "Missed previous fill-up" checkbox renders in the fuel details section
- [x] 6.2 Toggle the missed fill-up checkbox ON, enter mileage and volume — use `mcp_chrome_devtools_take_snapshot` to verify the real-time MPG calculation indicator is suppressed
- [x] 6.3 Toggle the missed fill-up checkbox OFF with the same mileage and volume — use `mcp_chrome_devtools_take_snapshot` to verify the MPG calculation indicator reappears
- [x] 6.4 Submit a fuel expense with missed fill-up checked — use `mcp_chrome_devtools_take_snapshot` to verify the expense saves successfully
- [x] 6.5 Edit the saved expense — use `mcp_chrome_devtools_take_snapshot` to verify the missed fill-up checkbox loads in the checked state
- [x] 6.6 Switch category to maintenance — use `mcp_chrome_devtools_take_snapshot` to verify the missed fill-up checkbox is hidden

## Task 7: Property-based tests with fast-check

- [x] 7.1 Create `backend/src/utils/__tests__/vehicle-stats.property.test.ts` — Property 1 (missed pairs excluded) and Property 2 (backward compat) for `calculateAverageMpg`
- [x] 7.2 Create `backend/src/utils/__tests__/calculations.property.test.ts` — Property 1 and Property 2 for `calculateAverageMPG`
- [x] 7.3 Create `frontend/src/lib/utils/__tests__/expense-helpers.property.test.ts` — Property 1 and Property 2 for `prepareFuelEfficiencyData`
- [x] 7.4 Property 3 (monotonicity) — in any of the above test files, verify that flagging an expense never increases data point count

## Task 8: Validate

- [x] 8.1 Run `bun run all:fix && bun run validate` in `backend/`
- [x] 8.2 Run `npm run all:fix && npm run validate` in `frontend/`
