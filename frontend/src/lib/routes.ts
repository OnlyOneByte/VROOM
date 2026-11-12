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
