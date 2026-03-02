---
name: Add Expense Category
description: Guided workflow for adding a new expense category to the app. Updates the enum, all category maps, colors, labels, validation, and tests across frontend and backend.
---

# Add Expense Category

Use this skill when adding a new expense category to the VROOM app. Categories appear throughout the codebase — missing one location causes silent bugs.

## Prerequisites

- Know the new category's internal value (lowercase, e.g., `tolls`), display label (e.g., `Tolls`), and description
- Know which chart token to assign for its color (pick from `chart-1` through `chart-5`, or reuse an existing one)

## Steps

### 1. Update the Backend Category Enum

File: `backend/src/db/types.ts`

Add the new category value to `EXPENSE_CATEGORIES`, `EXPENSE_CATEGORY_LABELS`, and `EXPENSE_CATEGORY_DESCRIPTIONS`.

### 2. Update Backend Validation

File: `backend/src/api/expenses/routes.ts`

The `expenseCategorySchema` derives from `EXPENSE_CATEGORIES` via `z.enum()`, so it picks up the new value automatically. No change needed unless the new category has special validation (like fuel requires mileage/fuelAmount).

If the new category has special field requirements, add validation in `backend/src/utils/validation.ts` similar to `validateFuelExpenseData`.

### 3. Update Frontend Category Maps

Search for all category maps and update them. These are the known locations:

- `frontend/src/lib/constants/` — category color maps, label maps
- `frontend/src/lib/utils/` — any utility that maps category → color/label/icon
- `frontend/src/lib/components/expenses/` — category selectors, filters, breakdown charts

Use this search to find all locations:
```
grep -r "fuel.*maintenance.*financial\|'fuel'\|\"fuel\"" frontend/src/lib/ --include="*.ts" --include="*.svelte" -l
```

Every map that contains the existing 6 categories (`fuel`, `maintenance`, `financial`, `regulatory`, `enhancement`, `misc`) must be updated.

### 4. Update Frontend Types

File: `frontend/src/lib/types/index.ts` (or wherever `ExpenseCategory` is defined)

Add the new category to the type union.

### 5. Assign a Color Token

Use semantic chart tokens. The current assignments are:
- `chart-1` — fuel (blue)
- `chart-2` — maintenance (green)
- `chart-3` — financial (purple)
- `chart-4` — regulatory (orange)
- `chart-5` — enhancement (yellow)
- `chart-1` or a muted variant — misc

Pick an unused token or share one. Update all category → color maps to include the new category.

### 6. Update Tests

- Update any test generators that use `fc.constantFrom(...)` with category values
- Update mock data that hardcodes category lists
- Run `bun run validate` in backend/ and `npm run validate` in frontend/

### 7. Update Backup/Restore

If the new category changes how expenses are validated during restore, verify that `backend/src/api/sync/backup.ts` and `restore.ts` handle it correctly. The Zod schema validation during restore derives from the same schema, so it should work automatically.

## Verification Checklist

- [ ] `EXPENSE_CATEGORIES` array includes the new value
- [ ] `EXPENSE_CATEGORY_LABELS` has the display label
- [ ] `EXPENSE_CATEGORY_DESCRIPTIONS` has the description
- [ ] All frontend category → color/label maps updated
- [ ] Frontend type union updated
- [ ] Chart color token assigned
- [ ] Test generators updated
- [ ] `bun run validate` passes in backend/
- [ ] `npm run validate` passes in frontend/
