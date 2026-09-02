# Expense Source System Migration

## Context

The reminders feature introduced `source_type` / `source_id` columns on the `expenses` table as a generic provenance system. This document scopes the work to migrate the two existing one-off linkage patterns (`isFinancingPayment` and `insurance_term_id`) to use this unified system.

Since we are not in production, there is no backfill migration. Instead, we remove the deprecated columns from the schema, delete the existing `drizzle/0000_*` migration + meta, regenerate a fresh `0000`, and recreate the dev database.

## Current State

The `expenses` table has two domain-specific linkage fields:

1. `isFinancingPayment` (boolean) — marks an expense as a financing payment, but doesn't link to *which* financing record. The link is inferred by matching the vehicle and hoping there's one active financing.
2. `insurance_term_id` (FK → insurance_terms, ON DELETE SET NULL) — directly links to an insurance term. Uses a real FK with cascade.

## Target State

Both replaced by the generic source system:

| Current | Target |
|---|---|
| `isFinancingPayment = true` | `source_type = 'financing'`, `source_id = <financing_id>` |
| `insurance_term_id = 'term_abc'` | `source_type = 'insurance_term'`, `source_id = 'term_abc'` |

## Why Migrate

- `isFinancingPayment` is fragile — it's a boolean with no link to the actual financing record. Can't answer "show all payments for this specific loan" without guessing.
- `insurance_term_id` is a dedicated FK that does the same job `source_type`/`source_id` would do, but as a one-off column. Every new domain relationship would need another dedicated FK column.
- Unified source system means one query pattern for all provenance: `WHERE source_type = ? AND source_id = ?`
- One index `(source_type, source_id)` covers all source types.

## Key Decisions

### 1. Client sends `sourceType` / `sourceId` directly

No convenience fields like `financingId` or `isFinancingPayment`. The expense create/update API accepts `sourceType` and `sourceId` as optional fields. The backend validates them:
- If `sourceType = 'financing'`: verify the financing record exists and is active
- If `sourceType = 'insurance_term'`: verify the term exists
- Both or neither must be set (enforced via `.refine()`)

The frontend has access to the financing ID via `vehicle.financing.id` (loaded in FinanceTab), so it can pass it directly.

### 2. Insurance term deletion → delete auto-created expenses

Auto-created insurance expenses are system-generated (not user-entered), so deleting them when the term is removed is the right behavior. Matches current behavior.

### 3. Financing deletion/payoff → null-out source fields

Payment history should persist as standalone expenses. Only the link is severed.

## Cascade Behavior

`source_id` can't have a real FK constraint because it's polymorphic. Cascade behavior is handled in application code via hooks files:

| Source Type | On Source Deletion | Rationale |
|---|---|---|
| `reminder` | No cleanup — expenses survive | Auto-created expenses are real financial records |
| `insurance_term` | Delete expenses | System-generated, not user-entered; matches current behavior |
| `financing` | Null-out source fields (keep expenses) | Payment history should persist |

Each source type's cleanup logic lives in its domain's `hooks.ts` file.

---

## Scoped Work

### Schema Changes (`backend/src/db/schema.ts`)

1. Remove `isFinancingPayment` column from `expenses` table
2. Remove `insuranceTermId` column and its FK reference to `insuranceTerms`
3. Remove the `insuranceTermIdx` index (the `sourceIdx` on `(sourceType, sourceId)` covers it)
4. Remove or update the `expensesRelations` block (currently defines `insuranceTerm` relation)

After changes:
- Delete `backend/drizzle/0000_ambiguous_thing.sql` + `backend/drizzle/meta/*`
- Run `bun run db:generate` from `backend/`
- Delete and recreate the dev database

---

### Backend: Expense Domain

#### `backend/src/api/expenses/routes.ts`

- Un-omit `sourceType` and `sourceId` from `createExpenseSchema` (currently omitted as server-set)
- Add validation:
  ```typescript
  sourceType: z.enum(['financing', 'insurance_term', 'reminder']).optional(),
  sourceId: z.string().min(1).optional(),
  ```
  With a `.refine()` enforcing both-or-neither
- POST handler: if `sourceType === 'financing'`, validate the financing record exists and is active (replaces the old `isFinancingPayment` check). If `sourceType === 'insurance_term'`, validate the term exists.
- Remove `isFinancingPayment` from `baseExpenseSchema`
- Remove the `financingRepository` import and the old financing validation block

#### `backend/src/api/expenses/repository.ts`

- Remove `deleteByInsuranceTermId()` method
- Add generic `deleteBySource(sourceType, sourceId, userId)` method
- Add `clearSource(sourceType, sourceId, userId)` method (sets both to NULL)
- `createSplitExpense()`: replace `insuranceTermId` param with `sourceType` / `sourceId`
- `updateSplitExpense()`: preserve `sourceType` / `sourceId` from old siblings instead of `insuranceTermId`

#### `backend/src/api/expenses/split-service.ts`

- `createSiblings()`: replace `insuranceTermId` param with `sourceType` / `sourceId`
- Update row construction to set `sourceType` / `sourceId` instead of `insuranceTermId`
- Remove `isFinancingPayment: false` hardcoding (column gone)

#### `backend/src/api/expenses/validation.ts`

- Update `createSplitExpenseSchema` if it references `insuranceTermId` — replace with `sourceType` / `sourceId`

---

### Backend: Financing Domain

#### `backend/src/api/financing/repository.ts`

- `computeBalance()`: change query from `WHERE vehicleId = ? AND isFinancingPayment = 1` to `WHERE source_type = 'financing' AND source_id = ?` (using the financing record's ID). This correctly attributes payments to a specific financing record rather than summing all financing payments for a vehicle.

#### New file: `backend/src/api/financing/hooks.ts`

- `onFinancingDeactivated(financingId, userId)`: runs `UPDATE expenses SET source_type = NULL, source_id = NULL WHERE source_type = 'financing' AND source_id = ?` — nulls out the link but keeps the expense records
- Called from DELETE and payoff routes

#### `backend/src/api/financing/routes.ts`

- DELETE handler: call `onFinancingDeactivated()` after deactivating
- PUT payoff handler: call `onFinancingDeactivated()` after marking as paid off

---

### Backend: Insurance Domain

#### `backend/src/api/insurance/hooks.ts`

- `createTermExpenses()`: replace `insuranceTermId: termId` with `sourceType: 'insurance_term', sourceId: termId`
- `updateTermExpenses()`: replace `deleteByInsuranceTermId(termId, userId)` with `deleteBySource('insurance_term', termId, userId)`

#### `backend/src/api/insurance/repository.ts`

- `deleteTerm()`: currently relies on FK `ON DELETE SET NULL` to null out `insuranceTermId`. After removing the FK, the cascade is gone. Expense cleanup must be handled explicitly.

#### `backend/src/api/insurance/routes.ts`

- DELETE term handler: add explicit expense cleanup before deleting the term — call `expenseRepository.deleteBySource('insurance_term', termId, userId)`. This replaces the FK cascade behavior.

---

### Backend: Backup / Restore / Sync

No backward compatibility with old backups — only new format going forward.

#### `backend/src/api/sync/backup.ts`

- `validateReferentialIntegrity()`: remove `insuranceTermId` FK validation. Extend existing `sourceType`/`sourceId` validation to also check `financing` and `insurance_term` source types (verify referenced records exist).
- Column removal from schema automatically removes them from CSV exports — no manual change needed.

#### `backend/src/api/sync/restore.ts`

- No translation of old columns. Old backups with `isFinancingPayment` / `insuranceTermId` are simply not supported — the columns won't exist in the schema, so `coerceRow` will ignore them.

#### `backend/src/api/sync/google-sheets.ts`

- No backward-compat handling needed. Old spreadsheets with the old columns are not supported.

#### `backend/src/api/sync/__tests__/backup.test.ts`

- Remove all `isFinancingPayment` coercion tests (column gone)
- Update validation tests for new source-based referential integrity checks

---

### Backend: Tests

| Test file | Changes |
|---|---|
| `financing/__tests__/financing-balance.property.test.ts` | Create test expenses with `sourceType='financing'` + `sourceId` instead of `isFinancingPayment=true` |
| `insurance/__tests__/*` | Create expenses with `sourceType='insurance_term'` + `sourceId` instead of `insuranceTermId` |
| `expenses/__tests__/*` | Update any references to `isFinancingPayment` or `insuranceTermId` |
| `db/__tests__/migration-0000.test.ts` | Verify new schema: no `isFinancingPayment`, no `insuranceTermId`, has `sourceType`/`sourceId` |
| `db/__tests__/migration-general.test.ts` | Update expected column lists |
| `sync/__tests__/backup.test.ts` | Remove `isFinancingPayment` coercion tests, add backward-compat restore tests |

---

### Frontend: Types

#### `frontend/src/lib/types/expense.ts`

- Remove `isFinancingPayment: boolean` from `Expense` interface
- Add `sourceType?: string` and `sourceId?: string` (optional, nullable)

---

### Frontend: Services

#### `frontend/src/lib/services/api-transformer.ts`

- Remove `isFinancingPayment` from `BackendExpenseRequest` and `BackendExpenseResponse`
- Add `sourceType?: string` and `sourceId?: string` to both
- `toBackendExpense()`: remove `isFinancingPayment` mapping, add `sourceType`/`sourceId` pass-through
- `fromBackendExpense()`: remove `isFinancingPayment`, map `sourceType`/`sourceId`

#### `frontend/src/lib/services/expense-api.ts`

- `createSplitExpense()`: remove `insuranceTermId` from params type — insurance hooks on the backend now set source fields directly

---

### Frontend: Components

#### `frontend/src/lib/components/expenses/form/ExpenseForm.svelte`

- Remove `formData.isFinancingPayment` state and all references
- Remove the "Apply as payment towards financing" checkbox UI
- Financing payment status is now determined by `sourceType === 'financing'` (read-only from server)
- For creating financing payments: read `financingId` from URL query param (passed by FinanceTab), send as `sourceType: 'financing', sourceId: financingId` in the create request
- `isInsuranceManaged` detection: check `sourceType === 'insurance_term'` instead of (or in addition to) `tags.includes('insurance')`
- Replace `insuranceTermId` state variable with reading `sourceId` when `sourceType === 'insurance_term'`
- `insurancePolicyId` for linking back to insurance page: look up the policy from the term ID via the existing insurance data, or have the backend include it in the response. Current behavior infers it — this can stay as-is for now.

#### `frontend/src/lib/components/vehicles/FinanceTab.svelte`

- Filter financing expenses by `e.sourceType === 'financing'` instead of `e.isFinancingPayment === true`
- Update `recordPaymentHref` URL: replace `isFinancingPayment=true` with `financingId=${vehicle.financing.id}`

#### `frontend/src/routes/expenses/new/+page.svelte`

- Remove `preselectedIsFinancingPayment` query param handling
- Add `financingId` query param handling — pass to ExpenseForm

---

### Frontend: Tests

| Test file | Changes |
|---|---|
| `utils/__tests__/financing-calculations.property.test.ts` | Update mock expenses: replace `isFinancingPayment: true` with `sourceType: 'financing', sourceId: '<id>'` |

---

## Notes

- The source system is extensible: future integrations (CSV import, API sync, etc.) just use their own `source_type` value
- `sourceType` enum in the Zod schema should be kept open to extension — consider using `.refine()` with a known-types check rather than a closed `z.enum()` if new source types are expected soon
