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

## 10. FABs Must Use Semantic Foreground/Background

All floating action buttons must use `bg-foreground text-background`, not hardcoded gray/white or gradient overrides.

```svelte
// ❌ WRONG — found in vehicles/[id]/+page.svelte
class="bg-gray-900 hover:bg-gray-800 text-white"

// ❌ WRONG — found in settings/+page.svelte
class="!bg-gradient-to-r !from-primary-600 !to-primary-700 !text-white"

// ✅ CORRECT — matches dashboard and expenses FABs
class="bg-foreground hover:bg-foreground/90 text-background"
```

## 11. Status Colors in Utilities Must Use Semantic Tokens

Utility functions that return color classes (like `sync-status.ts`, `Navigation.svelte` `getSyncStatusInfo`) must use semantic tokens, not raw Tailwind colors.

```typescript
// ❌ WRONG — found in sync-status.ts, Navigation.svelte
return { color: 'text-green-500', ... };
return { color: 'text-red-500', ... };
return { color: 'text-yellow-500', ... };
return { color: 'text-orange-500', ... };

// ✅ CORRECT
return { color: 'text-chart-2', ... };     // success/green
return { color: 'text-destructive', ... }; // error/red
return { color: 'text-chart-5', ... };     // warning/yellow
return { color: 'text-chart-1', ... };     // pending/orange
```

## 12. Financing Components Must Use Chart Tokens for Accent Colors

`FinancingSummaryHeader`, `PaymentCalculator`, and similar components must not use raw `text-green-600`, `bg-blue-100`, etc. Use `chart-1`–`chart-5` tokens.

```svelte
// ❌ WRONG — found in FinancingSummaryHeader.svelte
<div class="bg-blue-100 dark:bg-blue-900/20">
  <DollarSign class="text-blue-600 dark:text-blue-400" />
</div>

// ✅ CORRECT
<div class="bg-chart-3/10">
  <DollarSign class="text-chart-3" />
</div>
```

## 13. Never Use `!important` Overrides on shadcn Button

Pass classes normally or use `variant` props. The `!` prefix fights the component's own styles and breaks theming.

```svelte
// ❌ WRONG — found in ExpenseForm.svelte FABs
<Button class="!bg-primary hover:!bg-primary/90 !text-primary-foreground !px-6 !border-0">

// ✅ CORRECT — use variant or pass classes without !important
<Button variant="destructive" class="rounded-full shadow-lg h-14 px-5">
<Button class="bg-foreground hover:bg-foreground/90 text-background h-14 px-6">
```

## 14. Use `border-destructive` for Validation Error Borders

Don't use hardcoded `border-red-300` for form error states. Use the semantic `border-destructive` token.

```svelte
// ❌ WRONG — found in TagInput.svelte, ExpenseForm.svelte
class="border {error ? 'border-red-300' : 'border-input'}"

// ✅ CORRECT
class="border {error ? 'border-destructive' : 'border-input'}"
```

## 15. Don't Duplicate Shared Utility Logic in Components

If a utility function exists in `$lib/utils/`, import it instead of reimplementing the same logic inline.

```typescript
// ❌ WRONG — found in Navigation.svelte (duplicated sync-status.ts logic)
function getSyncStatusInfo() {
  if (!$isOnline) return { color: 'text-destructive', icon: WifiOff };
  // ... same logic as sync-status.ts
}

// ✅ CORRECT — import from the canonical source
import { getSyncStatusInfo } from '$lib/utils/sync-status';
let statusInfo = $derived(getSyncStatusInfo({ isOnline: $isOnline, ... }));
```

## 16. Guard `console.error` in Client Error Handlers

Production error handlers should not unconditionally log to console. Guard with `import.meta.env.DEV`.

```typescript
// ❌ WRONG — found in hooks.client.ts
export const handleError: HandleClientError = ({ error, event }) => {
  console.error('Client error:', error, event);
};

// ✅ CORRECT
export const handleError: HandleClientError = ({ error, event }) => {
  if (import.meta.env.DEV) {
    console.error('Client error:', error, event);
  }
};
```

## 17. Don't Use Non-Existent CSS Classes

Raw class names like `card`, `btn`, `btn-primary` don't exist in this project. Use shadcn components or Tailwind utilities.

```svelte
// ❌ WRONG — found in ExpenseForm.svelte
<form class="card space-y-6">

// ✅ CORRECT — use Tailwind utilities or Card component
<form class="rounded-lg border bg-card p-6 space-y-6">
```


## 18. Replace Deprecated Lucide Icons

Lucide regularly deprecates icon names. Use the current names.

```typescript
// ❌ WRONG — found in CategoryBreakdownChart.svelte, ExpensesTable.svelte
import { PieChartIcon, Filter } from 'lucide-svelte';

// ✅ CORRECT
import { ChartPie, ListFilter } from 'lucide-svelte';
```

## 19. Chart Color Values Must Use CSS Custom Properties

Utility functions that produce colors for LayerChart/d3 charts must use `hsl(var(--chart-N))` instead of hardcoded hex values. This ensures charts respect the active theme.

```typescript
// ❌ WRONG — found in expense-helpers.ts getCategoryColorHex()
const colors = { fuel: '#2563eb', maintenance: '#ea580c' };

// ✅ CORRECT
const colors = { fuel: 'hsl(var(--chart-1))', maintenance: 'hsl(var(--chart-5))' };
```

## 20. Avoid `any` in Component Props

Use proper types or `unknown` with type guards. `any` in Props interfaces defeats TypeScript's purpose.

```typescript
// ❌ WRONG — found in RestoreFromDriveDialog, RestoreFromFileDialog, FinancingCharts
restorePreview: any;
restoreConflicts: any[];
class: (d: any) => string;

// ✅ CORRECT
restorePreview: Record<string, number | undefined> | null;
restoreConflicts: Array<{ table: string; id: string }>;
class: (d: { data: { isPaid: boolean } }) => string;
```

## 21. Don't Use Non-Existent CSS Classes in Templates

The `card` class doesn't exist in this project. Use Tailwind utilities or shadcn Card component.

```svelte
// ❌ WRONG — found in vehicles/[id]/+page.svelte expenses tab
<div class="card space-y-4">

// ✅ CORRECT
<div class="rounded-lg border bg-card p-6 space-y-4">
```

## 22. Don't Use Display Labels for Logic Comparisons

Never compare against display labels (e.g., `'Fuel'`) for conditional logic. Use the raw category/enum value instead. Display labels can drift from values and cause silent bugs.

```typescript
// ❌ WRONG — found in ExpenseForm.svelte, expense-form-validation.ts
let showFuelFields = $derived(selectedCategoryLabel === 'Fuel');
if (ctx.selectedCategoryLabel === 'Fuel') { ... }

// ✅ CORRECT — compare against the actual data value
let showFuelFields = $derived(formData.category === 'fuel');
if (ctx.category === 'fuel') { ... }
```

## 23. Don't Use `$effect` for Async Data Loading on Reactive State

`$effect` that watches reactive state and fires async functions (API calls) will re-fire on every change, including initial mount — causing duplicate requests when `onMount` already loads the same data.

```svelte
// ❌ WRONG — found in ExpenseForm.svelte
$effect(() => {
  if (formData.vehicleId) {
    loadVehicle();           // Also called in onMount!
    loadLastFuelExpense();   // Duplicate API call
  }
});

// ✅ CORRECT — track previous value, skip initial load
let previousVehicleId = $state('');
$effect(() => {
  if (formData.vehicleId && formData.vehicleId !== previousVehicleId) {
    previousVehicleId = formData.vehicleId;
    if (!isLoading) {  // Skip during initial mount
      loadVehicle();
      loadLastFuelExpense();
    }
  }
});

// ✅ ALSO CORRECT — use an explicit change handler instead of $effect
function handleVehicleChange(newId: string) {
  formData.vehicleId = newId;
  loadVehicle();
  loadLastFuelExpense();
}
```
