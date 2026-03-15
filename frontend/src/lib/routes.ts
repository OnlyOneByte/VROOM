/**
 * Centralized route definitions for the app.
 *
 * All route strings live here so that if a page moves, only this file changes.
 * Use with `resolve()` from `$app/paths`:
 *
 *   import { routes } from '$lib/routes';
 *   import { resolve } from '$app/paths';
 *
 *   // Static:       resolve(routes.dashboard)
 *   // Parameterized: resolve(routes.vehicle, { id })
 *   // With query:    resolve(routes.expenseNew) + `?vehicleId=${id}`
 *   // Dynamic goto:  gotoDynamic(returnTo)   (for runtime-only strings like returnTo)
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
	analyticsFuelEfficiency: '/analytics/fuel-efficiency',
	settings: '/settings',
	settingsProviderNew: '/settings/providers/new',
	profile: '/profile',
	trips: '/trips',
	privacyPolicy: '/privacypolicy',
	termsOfService: '/termsofservice',
	vehicles: '/vehicles',
	vehicleNew: '/vehicles/new'
} as const;

// ── Parameterized routes (require params object for resolve()) ─
export const paramRoutes = {
	expense: '/expenses/[id]',
	expenseEdit: '/expenses/[id]/edit',
	insurancePolicy: '/insurance/[id]',
	insurancePolicyEdit: '/insurance/[id]/edit',
	insuranceTermEdit: '/insurance/[id]/terms/[termId]/edit',
	insuranceTermNew: '/insurance/[id]/terms/new',
	vehicle: '/vehicles/[id]',
	vehicleEdit: '/vehicles/[id]/edit', // Route page exists — VehicleInfoCard links here
	vehicleOdometerNew: '/vehicles/[id]/odometer/new',
	vehicleOdometerEntryEdit: '/vehicles/[id]/odometer/[entryId]/edit',
	settingsProviderEdit: '/settings/providers/[id]/edit'
} as const;
