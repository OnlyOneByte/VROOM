/**
 * Centralized route definitions for the app.
 *
 * All route strings live here so that if a page moves, only this file changes.
 * Use with `resolve()` from `$app/paths`:
 *
 *  import { routes } from '$lib/routes';
 *  import { resolve } from '$app/paths';
 *
 *  // Static: resolve(routes.dashboard)
 *  // Parameterized: resolve(paramRoutes.vehicle, { id })
 *  // With query: resolve(routes.expenseNew) + `?vehicleId=${id}`
 *  // Dynamic goto: gotoDynamic(returnTo) (for runtime-only strings like returnTo)
 *
 * Every entry must name a path that has a `+page.svelte`. `resolve()` does NOT enforce this — it is
 * typed against `RouteId`, which includes directories that only hold child routes — so a page-less
 * entry here type-checks and then 404s. `__tests__/routes-pages-exist.test.ts` is what enforces it.
 */

// ── Static routes (no params) ──────────────────────────────────
export const routes = {
	home: '/',
	dashboard: '/dashboard',
	auth: '/auth',
	authCallback: '/auth/callback',
	expenses: '/expenses',
	expenseNew: '/expenses/new',
	insurance: '/insurance',
	insuranceNew: '/insurance/new',
	analytics: '/analytics',
	settings: '/settings',
	settingsProviderNew: '/settings/providers/new',
	profile: '/profile',
	trips: '/trips',
	privacyPolicy: '/privacypolicy',
	termsOfService: '/termsofservice',
	vehicleNew: '/vehicles/new',
	reminders: '/reminders',
	assistant: '/assistant'
} as const;

// ── Parameterized routes (require params object for resolve()) ─
export const paramRoutes = {
	expenseEdit: '/expenses/[id]/edit',
	insurancePolicyEdit: '/insurance/[id]/edit',
	insuranceTermEdit: '/insurance/[id]/terms/[termId]/edit',
	insuranceTermNew: '/insurance/[id]/terms/new',
	vehicle: '/vehicles/[id]',
	vehicleEdit: '/vehicles/[id]/edit',
	vehicleOdometerNew: '/vehicles/[id]/odometer/new',
	vehicleOdometerEntryEdit: '/vehicles/[id]/odometer/[entryId]/edit',
	settingsProviderEdit: '/settings/providers/[id]/edit'
} as const;
