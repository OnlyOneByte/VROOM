---
inclusion: fileMatch
fileMatchPattern: "frontend/**"
---

# Frontend Code Quality Rules

Rules derived from comprehensive codebase reviews. Every item references a real pattern found in this project.

## 1. Use Semantic Color Tokens (Not Hardcoded Colors)

Hardcoded Tailwind colors break dark mode and theme consistency. Use shadcn/tailwind semantic tokens everywhere.

```svelte
// ❌ WRONG — found in FuelFieldsSection, UserProfile, ExpenseForm floating bar,
//   auth/callback, profile/+page, trips/+page, sync-status.ts
<div class="bg-blue-50 text-blue-700">
<div class="bg-white hover:bg-gray-100">
<p class="text-gray-900">

// ✅ CORRECT
<div class="bg-primary/10 text-primary">
<div class="bg-background hover:bg-muted">
<p class="text-foreground">
```

Semantic token cheat sheet:
- `text-gray-900` → `text-foreground`
- `text-gray-500/600` → `text-muted-foreground`
- `bg-white` → `bg-background`
- `bg-gray-50/100` → `bg-muted`
- `border-gray-200/300` → `border-border` or `border-input`
- `bg-blue-50` → `bg-primary/10`
- `text-blue-700` → `text-primary`
- `bg-green-50` → `bg-green-500/10` (status colors are acceptable as `color/opacity`)
- `bg-red-50` → `bg-destructive/10`
- For distinct accent colors in stat cards/charts, use `chart-1` through `chart-5` tokens (e.g., `text-chart-1`, `bg-chart-2/10`)
- `bg-gray-900 text-white` (FABs) → `bg-foreground text-background`

## 2. Use Domain API Services Over Raw `apiClient`

When a domain service method exists, use it. Only use `apiClient` directly for endpoints not covered by a service.

```typescript
// ❌ WRONG — found in VehicleForm.svelte, ExpenseForm.svelte
await apiClient.put<Vehicle>(`/api/v1/vehicles/${vehicleId}`, vehicleData);
await apiClient.get<BackendExpenseResponse>(`/api/v1/expenses/${expenseId}`);

// ✅ CORRECT — domain services already have these methods
import { vehicleApi } from '$lib/services/vehicle-api';
import { expenseApi } from '$lib/services/expense-api';
await vehicleApi.deleteVehicle(vehicleId);
await expenseApi.getExpense(expenseId);
```

## 3. Use `LoaderCircle` for All Loading Spinners

Don't mix custom CSS spinners with Lucide icons. Use one pattern everywhere.

```svelte
// ❌ WRONG — found in ProtectedRoute, auth/callback, PWAInstallPrompt, SyncConflictResolver
<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>

// ✅ CORRECT
import { LoaderCircle } from 'lucide-svelte';
<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
```

## 4. Guard Browser APIs for SSR Safety

Code that accesses `window`, `PerformanceObserver`, or `document` at module level crashes during SSR.

```typescript
// ❌ WRONG — found in performance.ts
export const webVitalsMonitor = new WebVitalsMonitor(); // constructor uses window

// ✅ CORRECT
import { browser } from '$app/environment';
export const webVitalsMonitor = browser ? new WebVitalsMonitor() : null;
```

## 5. Keep Category Maps in Sync with the Category Enum

The app uses categories: `fuel`, `maintenance`, `financial`, `regulatory`, `enhancement`, `misc`. Any map of category → color/label must use these exact keys.

```typescript
// ❌ WRONG — found in RecentActivityCard.svelte
const categoryColors = {
  fuel: '...', maintenance: '...', insurance: '...', // ← stale keys
  registration: '...', parking: '...', tolls: '...', cleaning: '...', other: '...'
};

// ✅ CORRECT — use the actual categories
const categoryColors = {
  fuel: '...', maintenance: '...', financial: '...',
  regulatory: '...', enhancement: '...', misc: '...'
};
```

## 6. Don't Duplicate Utilities

Check `$lib/utils/` before adding helpers. One canonical implementation per utility.

```typescript
// ❌ WRONG — debounce exists in both formatters.ts and memoize.ts
// formatters.ts: export function debounce(...)
// memoize.ts:   export function debounce(...)

// ✅ CORRECT — keep one, delete the other, update imports
```

## 7. Remove Redundant Ternaries

Don't write ternaries where both branches produce the same value.

```svelte
// ❌ WRONG — found in CategorySelector.svelte
<span class="{value === category.value ? 'text-foreground' : 'text-foreground'}">

// ✅ CORRECT
<span class="text-foreground">
```

## 8. Don't Duplicate Type Definitions

`BackendExpenseRequest` and `BackendExpenseResponse` are defined in both `types.ts` and `api-transformer.ts`. Keep them in one place.

## 9. Test Mocks Must Match Current Types

```typescript
// ❌ WRONG — found in test-helpers.ts
export const mockExpense = {
  type: 'fuel',        // ← field doesn't exist on Expense
  gallons: 12.5,       // ← field doesn't exist on Expense
  location: 'Shell',   // ← field doesn't exist on Expense
};

// ✅ CORRECT — use actual Expense fields
export const mockExpense = {
  category: 'fuel',
  tags: ['fuel'],
  volume: 12.5,
};
```
