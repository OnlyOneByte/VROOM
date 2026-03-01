---
description: Frontend code quality rules and common pitfalls found in this Svelte 5 codebase. Covers bugs, deprecated APIs, consistency issues, and best practices.
inclusion: auto
---

# Frontend Code Quality Rules

Rules derived from a comprehensive codebase review. Every item below references a real pattern found in this project that should be avoided or fixed.

## 1. Use `$app/state` Instead of `$app/stores`

`$app/stores` is deprecated in SvelteKit 2+. Use `$app/state` which provides rune-compatible reactive state without needing `$derived($page)` wrappers.

```svelte
// ❌ WRONG — found in expenses/new/+page.svelte, auth/callback/+page.svelte,
//   vehicles/[id]/edit/+page.svelte, expenses/[id]/edit/+page.svelte,
//   vehicles/[id]/expenses/new/+page.svelte, vehicles/[id]/expenses/[expenseId]/edit/+page.svelte
import { page } from '$app/stores';
let returnTo = $derived($page.url.searchParams.get('returnTo'));

// ✅ CORRECT — already used in +layout.svelte and vehicles/[id]/+page.svelte
import { page } from '$app/state';
let returnTo = $derived(page.url.searchParams.get('returnTo'));
```

## 2. Use `apiClient` Instead of Raw `fetch()` in Components

The project has a centralized `apiClient` in `$lib/services/api-client.ts` that handles credentials, error unwrapping, and consistent error handling. Components should never call `fetch()` directly.

```svelte
// ❌ WRONG — found in VehicleForm.svelte (5 raw fetch calls) and ExpensesTable.svelte (1 raw fetch call)
const response = await fetch(`/api/v1/vehicles/${vehicleId}`, {
  credentials: 'include'
});
const result = await response.json();

// ✅ CORRECT — use the existing apiClient or domain-specific API services
import { apiClient } from '$lib/services/api-client';
const vehicle = await apiClient.get(`/api/v1/vehicles/${vehicleId}`);

// ✅ EVEN BETTER — use the domain API service layer
import { vehicleApi } from '$lib/services/vehicle-api';
const vehicle = await vehicleApi.getVehicle(vehicleId);
```

## 3. Avoid Empty or No-Op `$effect()` Blocks

An `$effect()` that just calls a function with no reactive dependencies tracked inside it is a no-op — it runs once and never re-runs. If you need derived filtering, use `$derived` instead.

```svelte
// ❌ WRONG — found in expenses/+page.svelte — these effects track nothing and run once
$effect(() => {
  handleSearch();
});
$effect(() => {
  handleFilterChange();
});

// ✅ CORRECT — make filteredExpenses a $derived that reacts to its dependencies
let filteredExpenses = $derived.by(() => {
  let filtered = [...expenses];
  if (selectedVehicleId) {
    filtered = filtered.filter(e => e.vehicleId === selectedVehicleId);
  }
  if (searchTerm.trim()) { /* ... */ }
  return filtered;
});
```

## 4. Don't Duplicate Utility Logic in Components

If a utility function exists in `$lib/utils/`, use it. Don't reimplement the same logic inline in a page component.

```svelte
// ❌ WRONG — expenses/+page.svelte reimplements filterExpenses() inline in applyFiltersAndSort()
//   when $lib/utils/expense-filters.ts already exports filterExpenses()

// ✅ CORRECT — import and use the existing utility
import { filterExpenses } from '$lib/utils/expense-filters';
let filteredExpenses = $derived(filterExpenses(expenses, searchTerm, filters));
```

## 5. Remove Dead Code

Unused variables, functions, and imports must be removed. They add confusion and trigger lint warnings.

```svelte
// ❌ WRONG — found in expenses/+page.svelte
function toggleTag(tag: string): void { ... }  // declared but never used in template

// ✅ CORRECT — delete it, or if it was meant to replace addTag/removeTag, wire it up
```

## 6. Svelte 5 Event Modifiers Are Not Supported on Attributes

Svelte 5 removed the `|modifier` syntax from event attributes. Call the modifier inside the handler instead.

```svelte
// ❌ WRONG — causes "not a valid attribute name" error
<button onmousedown|preventDefault={() => addTag(suggestion)}>

// ✅ CORRECT
<button onmousedown={(e) => { e.preventDefault(); addTag(suggestion); }}>
```

## 7. Guard Against Possibly-Undefined Array Access

When accessing array elements by index, TypeScript strict mode may flag them as `T | undefined`. Always guard or assert.

```typescript
// ❌ WRONG — found in expenses/+page.svelte handleTagKeydown
if (e.key === 'Enter' && tagSuggestions.length > 0) {
  addTag(tagSuggestions[0]); // TS error: possibly undefined
}

// ✅ CORRECT
const first = tagSuggestions[0];
if (e.key === 'Enter' && first) {
  addTag(first);
}
```

## 8. Avoid `any` Types

Using `any` defeats TypeScript's purpose. Use proper types or `unknown` with type guards.

```typescript
// ❌ WRONG — found in VehicleForm.svelte, settings/+page.svelte, ExpenseForm.svelte
let vehicles = $state<any[]>([]);
let lastFuelExpense = $state<any>(null);
let restorePreview = $state<any>(null);
const vehicleData: any = { ... };

// ✅ CORRECT — use the actual types from $lib/types
let vehicles = $state<Vehicle[]>([]);
let lastFuelExpense = $state<Expense | null>(null);
```

## 9. Use `Select.Root` from shadcn-svelte Instead of Native `<select>`

The project uses shadcn-svelte's Select component in most places, but some pages still use raw `<select>` elements, creating visual inconsistency.

```svelte
// ❌ WRONG — found in analytics/+page.svelte, vehicles/[id]/+page.svelte,
//   analytics/fuel-efficiency/+page.svelte
<select id="groupBy" bind:value={groupBy} class="block w-full rounded-md ...">
  <option value="day">Daily</option>
</select>

// ✅ CORRECT — use shadcn-svelte Select for consistency
<Select.Root type="single" value={groupBy} onValueChange={v => { groupBy = v; }}>
  <Select.Trigger class="w-full">...</Select.Trigger>
  <Select.Content>
    <Select.Item value="day" label="Daily">Daily</Select.Item>
  </Select.Content>
</Select.Root>
```

## 10. Use Consistent Color Tokens (Not Hardcoded Colors)

The project uses shadcn/tailwind semantic tokens (`text-muted-foreground`, `bg-background`, `text-foreground`, etc.) in most places, but some components still use hardcoded Tailwind colors like `text-gray-900`, `bg-white`, `border-gray-300`. This breaks dark mode and theme consistency.

```svelte
// ❌ WRONG — found in TagInput.svelte, CategorySelector.svelte, ExpenseForm.svelte,
//   fuel-efficiency/+page.svelte, settings/+page.svelte, trips/+page.svelte
<h1 class="text-2xl font-bold text-gray-900">
<div class="border-gray-300 bg-white">
<p class="text-gray-600">

// ✅ CORRECT — use semantic tokens
<h1 class="text-2xl font-bold text-foreground">
<div class="border-input bg-background">
<p class="text-muted-foreground">
```

## 11. Don't Leave `console.log` in Production Code

Debug logging should use the project's logger or be removed. `console.error` for actual errors is fine, but `console.log` for debugging should not ship.

```typescript
// ❌ WRONG — found in VehicleForm.svelte
console.log('Submitting vehicle data:', vehicleData);
console.log('Submitting financing data:', financingData);

// ✅ CORRECT — remove debug logs, keep console.error for actual error handling
```

## 12. Prefer `$derived` Over `$state` + Manual Sync for Computed Values

If a value is always computed from other state, use `$derived`. Don't use `$state` and then manually keep it in sync with `$effect`.

```svelte
// ❌ WRONG pattern — found in expenses/+page.svelte
let filteredExpenses = $state<Expense[]>([]);
// ... later manually calling applyFiltersAndSort() to update it

// ✅ CORRECT — let Svelte handle reactivity
let filteredExpenses = $derived.by(() => {
  return filterExpenses(expenses, searchTerm, filters);
});
```

## 13. Loading Spinner Consistency

The project has two patterns for loading spinners: a custom CSS `.loading-spinner` class (in ExpenseForm.svelte, VehicleForm.svelte, ExpensesTable.svelte) and Lucide's `LoaderCircle` with `animate-spin` (in settings/+page.svelte). Pick one.

```svelte
// ❌ INCONSISTENT — custom CSS spinner in some files
<div class="loading-spinner h-5 w-5"></div>
<style>
  .loading-spinner { border: 2px solid #f3f4f6; ... }
</style>

// ❌ INCONSISTENT — Lucide icon in other files
<LoaderCircle class="h-8 w-8 animate-spin text-primary-600" />

// ✅ PICK ONE — prefer the Lucide approach (no custom CSS needed)
import { LoaderCircle } from 'lucide-svelte';
<LoaderCircle class="h-5 w-5 animate-spin" />
```

## 14. Avoid Shadowing Variable Names

Don't declare a local variable with the same name as a component-level variable — it creates confusion about which one is being referenced.

```svelte
// ❌ WRONG — found in ExpensesTable.svelte
// Component has a `vehicles` prop, then inside the template:
{@const vehicle = getVehicleForExpense(expense)}
// And in ExpenseForm.svelte, the #each loop variable shadows the component state:
{#each vehicles as vehicle (vehicle.id)}
  // `vehicle` here shadows the component-level `vehicle` state variable

// ✅ CORRECT — use distinct names
{@const expenseVehicle = getVehicleForExpense(expense)}
{#each vehicles as v (v.id)}
```

## 15. Form Submit Buttons Outside `<form>` Don't Submit

In ExpenseForm.svelte and VehicleForm.svelte, the submit button is in a floating action bar outside the `<form>` element. Using `type="submit"` on a button outside the form does nothing — the `onclick={handleSubmit}` is what actually works. Either move the button inside the form, use the `form` attribute to associate it, or just use `type="button"` to be explicit.

```svelte
// ❌ MISLEADING — button is outside <form>, type="submit" does nothing
<form onsubmit={handleSubmit} class="card space-y-6">
  <!-- form fields -->
</form>
<!-- ... floating bar outside form ... -->
<Button type="submit" onclick={handleSubmit}>Save</Button>

// ✅ CORRECT — be explicit that onclick is the mechanism
<Button type="button" onclick={handleSubmit}>Save</Button>

// ✅ ALSO CORRECT — use form attribute to associate
<form id="expense-form" onsubmit={handleSubmit}>...</form>
<Button type="submit" form="expense-form">Save</Button>
```

## 16. Raw `fetch()` in Stores and Utils

The `apiClient` rule applies beyond components. Stores (`auth.ts`) and utils (`sync-manager.ts`) also use raw `fetch()` for API calls, bypassing centralized error handling and credential management.

```typescript
// ❌ WRONG — found in auth.ts store (initialize, refreshToken, logout)
const response = await fetch('/api/v1/auth/me', { credentials: 'include' });

// ❌ WRONG — found in sync-manager.ts (syncSingleExpense, checkForExistingExpense, resolveConflict)
const response = await fetch(`/api/v1/expenses`, { method: 'POST', ... });

// ✅ CORRECT — use apiClient everywhere
import { apiClient } from '$lib/services/api-client';
const user = await apiClient.get('/api/v1/auth/me');
await apiClient.post('/api/v1/expenses', backendExpense);
```

## 17. Unbounded Memoization Caches

`memoize.ts` uses `Map` caches that grow without limit. For functions called with many unique argument sets (like `calculateAmortizationSchedule`), this leaks memory.

```typescript
// ❌ WRONG — cache grows forever
const cache = new Map<string, R>();

// ✅ CORRECT — add max size with LRU eviction
const MAX_CACHE_SIZE = 100;
if (cache.size >= MAX_CACHE_SIZE) {
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}
```

## 18. Don't Call Stubbed/Broken API Functions from UI

`analytics-api.ts` has all functions stubbed with `throw new Error('Analytics endpoint not implemented')`. The analytics page calls these and always shows an error. Show a "coming soon" state instead.

```svelte
// ❌ WRONG — analytics/+page.svelte calls getDashboardAnalytics() which always throws
const [dashboard, trends] = await Promise.all([
  getDashboardAnalytics(...),  // throws immediately
  getTrendData(...)            // throws immediately
]);

// ✅ CORRECT — show a placeholder until the backend is implemented
<EmptyState>
  {#snippet title()}Analytics Coming Soon{/snippet}
  {#snippet description()}Analytics features are under development.{/snippet}
</EmptyState>
```

## 19. SSR-Unsafe Module-Level Side Effects

Code that accesses browser APIs (`window`, `PerformanceObserver`, `document`) at module level will fail during SSR. Guard with `browser` from `$app/environment` or lazy initialization.

```typescript
// ❌ WRONG — found in performance.ts: WebVitalsMonitor constructor runs on import
export const webVitalsMonitor = new WebVitalsMonitor(); // accesses window at module level

// ✅ CORRECT — lazy init or guard
import { browser } from '$app/environment';
export const webVitalsMonitor = browser ? new WebVitalsMonitor() : null;
```

## 20. Hardcoded Colors in Toast/Notification CSS

`app.css` Sonner toast customization uses hardcoded `rgb()` values that don't adapt to dark mode. Use CSS custom properties or Tailwind tokens instead.

```css
/* ❌ WRONG — hardcoded light-mode colors */
[data-sonner-toast][data-type='success'] {
  background-color: rgb(240 253 244) !important;
  color: rgb(22 101 52) !important;
}

/* ✅ CORRECT — use oklch tokens or CSS variables that respect theme */
```
