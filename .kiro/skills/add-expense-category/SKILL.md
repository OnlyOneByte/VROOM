---
name: Add Expense Category
description: Guided workflow for adding a new expense category to the app. Updates the enum, all category maps, colors, labels, validation, and tests across frontend and backend.
---

# Add Expense Category

Use this skill when adding a new expense category. The closed set today is `fuel`, `maintenance`,
`financial`, `regulatory`, `enhancement`, `misc`, and it is spelled out by hand across two dozen
files — missing one is a silent UI or analytics bug, not a type error.

## Prerequisites

Know the internal value (lowercase, e.g. `tolls`), the display label, and the description. Pick a
color token for it (`chart-1` … `chart-8`, all eight defined by every built-in theme in
`frontend/src/lib/theme/theme-registry.ts`, or `neutral`); sharing one with an existing category is
allowed. See "Color and label" below — the token is assigned in exactly one place.

## Find every site

```bash
grep -rn "enhancement" backend/src frontend/src
```

Every category site names `enhancement`; the only other hits are two prose uses of the word, in
`routes/assistant/+page.svelte` and `theme/__tests__/theme-contrast.test.ts`. Work the list below,
then re-run the grep and confirm nothing is left.

## Backend

| File | Change |
|---|---|
| `backend/src/db/types.ts` | add the value to `EXPENSE_CATEGORIES`, the label to `EXPENSE_CATEGORY_LABELS`, the description to `EXPENSE_CATEGORY_DESCRIPTIONS` (the latter two are `Record<ExpenseCategory, …>`, so these are type errors if you forget) |
| `backend/src/utils/analytics-charts.ts` | `VALID_CATEGORIES` — three builders fold anything not in it into `misc`, so a missing entry silently misattributes money rather than erroring. Plus the three hardcoded per-category shapes in `buildMonthlyCostHeatmap` (return type, inner map type, zero-init object) |
| `backend/src/api/analytics/repository.ts` | the `monthlyCostHeatmap` field shape on `FuelAdvancedData` |
| `backend/src/api/analytics/api-transform.ts` | the per-category `c(...)` money conversion in `fuelAdvancedToApi` |
| `backend/src/api/expenses/fuelio-import.ts` | the foreign-tracker category map, if imported rows should land in the new category |
| `backend/src/api/providers/domains/vlm/prompt.ts` | the hand-written category-hint line and the "one of the 6" comment; the enum list itself interpolates `EXPENSE_CATEGORIES` |

Validation needs nothing: `expenseCategorySchema` in `expenses/routes.ts`, the reminder and
import-mapping schemas, and `GET /api/v1/expenses/categories` all derive from `EXPENSE_CATEGORIES`.
Backup/restore needs nothing either — `expenses.category` is a plain `text()` column with no
database-level enum. Only add validation if the category has special field requirements, alongside
`validateFuelExpenseData` in `backend/src/utils/validation.ts`.

## Frontend

| File | Change |
|---|---|
| `frontend/src/lib/types/expense.ts` | the `ExpenseCategory` union (re-exported via the `types/index.ts` barrel) |
| `frontend/src/lib/utils/chart-colors.ts` | `CATEGORY_COLOR_TOKENS` (the one color assignment) and `CATEGORY_LABELS` (the one label map) — both keyed `Record<ExpenseCategory, …>`, so a missing key is a type error |
| `frontend/src/lib/utils/expense-helpers.ts` | `CATEGORY_ICONS` (read by `getCategoryIcon`) — the only per-category map left here. `categoryLabels` re-exports `CATEGORY_LABELS`, and badge classes derive from `CATEGORY_COLOR_TOKENS` |
| `frontend/src/lib/components/expenses/form/CategorySelector.svelte` | the `categories` array (value, short picker label, description). Its icons come from the shared `CATEGORY_ICONS` — don't add a local one |
| `frontend/src/lib/components/reminders/ReminderForm.svelte` | the local `EXPENSE_CATEGORIES` list — `satisfies readonly ExpenseCategory[]` rejects a bad value but does *not* catch a missing one |
| `frontend/src/lib/components/analytics/fuel/AdvancedCharts.svelte` | `heatmapCategories` |
| `frontend/src/lib/types/analytics.ts` | the `monthlyCostHeatmap` field shape |

Keep `CategorySelector` labels to a single word — they share a 2-column mobile grid where a
multi-word label wraps and breaks the row rhythm. `category-selector-labels.test.ts` enforces it.

## Color and label

ONE assignment, `CATEGORY_COLOR_TOKENS` in `chart-colors.ts`. Add the new category here and
nowhere else:

| Category | Token |
|---|---|
| fuel | `chart-1` |
| maintenance | `chart-2` |
| financial | `chart-3` |
| regulatory | `chart-4` |
| enhancement | `chart-5` |
| misc | `neutral` |

Every surface derives its own rendering from that token: `getCategoryChartColor` returns
`var(--chart-N)` (`neutral` → `var(--primary)`, which reads against the card), and
`getCategoryBadgeClasses` returns the Tailwind pair (`neutral` → `text-muted-foreground bg-muted`,
quiet enough behind small text). `getCategoryColor` survives in both modules as a deprecated alias
for its own module's helper — don't add call sites.

A token outside `chart-1`…`chart-5` / `neutral` also needs a `BADGE_CLASSES_BY_TOKEN` entry in
`expense-helpers.ts`: `Record<CategoryColorToken, …>` makes a missing one a compile error, and
Tailwind only resolves complete class strings, so spell the `text-*`/`bg-*` pair out literally.

## Tests

Four hard-fail the moment the union grows — they mirror the category list and assert exact keys or
an exact count against the real maps, so they go red immediately and stay red until updated:

- `frontend/src/lib/utils/__tests__/expense-category-maps.test.ts` — `ALL_CATEGORIES`, `toBe(6)`,
  exact key set on `categoryLabels`
- `frontend/src/lib/utils/__tests__/category-color-label-convergence.test.ts` — `ALL_CATEGORIES`,
  plus a whole-object `toEqual` on `CATEGORY_COLOR_TOKENS`
- `frontend/src/lib/components/expenses/form/__tests__/category-selector-labels.test.ts` — `toBe(6)`
- `frontend/src/lib/utils/__tests__/chart-colors.property.test.ts` — `CATEGORY_ENUM`, plus exact
  key sets on `CATEGORY_COLORS` and `CATEGORY_LABELS`

The rest are fixtures — nothing fails if you miss them, so they need a deliberate pass:

- `frontend/src/lib/services/__tests__/api-transformer.property.test.ts`
- `frontend/src/lib/services/__tests__/analytics-api.test.ts` — heatmap fixtures

Backend `fc.constantFrom` arbitraries derive from `EXPENSE_CATEGORIES` and need no change.

## Verification Checklist

- [ ] `EXPENSE_CATEGORIES`, `EXPENSE_CATEGORY_LABELS`, `EXPENSE_CATEGORY_DESCRIPTIONS` updated
- [ ] `ExpenseCategory` union updated
- [ ] `CATEGORY_COLOR_TOKENS` + `CATEGORY_LABELS` (`chart-colors.ts`) and `CATEGORY_ICONS`
      (`expense-helpers.ts`) updated; no second color, label, or icon map introduced
- [ ] `CategorySelector`, `ReminderForm`, `AdvancedCharts` lists updated
- [ ] All six `monthlyCostHeatmap` shapes updated (3 in `analytics-charts.ts`, plus
      `analytics/repository.ts`, `api-transform.ts`, `types/analytics.ts`)
- [ ] Test lists and count assertions updated
- [ ] `grep -rn "enhancement" backend/src frontend/src` shows a sibling for every new-category site
- [ ] `bun run validate` passes in `backend/`, `npm run validate` in `frontend/`
