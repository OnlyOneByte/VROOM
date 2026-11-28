export const COMMON_MESSAGES = {
	NO_EXPENSES: 'No expenses yet',
	NO_FUEL_DATA: 'No fuel data yet',

	ADD_EXPENSE: 'Add expense',
	ADD_FIRST_EXPENSE: 'Add first expense',
	ADD_FUEL_EXPENSE: 'Add fuel expense',
	CLEAR_FILTERS: 'Clear filters',

	ALL_VEHICLES: 'All vehicles'
} as const;

export const VEHICLE_MESSAGES = {
	VEHICLE_NOT_FOUND: 'Vehicle not found',
	VEHICLE_NOT_FOUND_DESC:
		"The vehicle you're looking for doesn't exist or you don't have access to it.",
	BACK_TO_DASHBOARD: 'Back to Dashboard'
} as const;

export const EXPENSE_MESSAGES = {
	EXPENSES_BY_CATEGORY: 'Expenses by category',
	PENDING_SYNC: 'Pending sync',
	RECENTLY_SYNCED: 'Recently synced',
	NO_EXPENSES_DESC: 'Start tracking your vehicle expenses to see insights and analytics.',
	ADD_FUEL_DESC: 'Add fuel expenses with mileage to see detailed fuel statistics'
} as const;
