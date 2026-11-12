export const COMMON_MESSAGES = {
	NO_EXPENSES: 'No expenses yet',
	NO_FUEL_DATA: 'No fuel data yet',

	ADD_EXPENSE: 'Add Expense',
	ADD_FIRST_EXPENSE: 'Add First Expense',
	ADD_FUEL_EXPENSE: 'Add Fuel Expense',
	CLEAR_FILTERS: 'Clear Filters',

	ALL_VEHICLES: 'All Vehicles'
} as const;

export const VEHICLE_MESSAGES = {
	VEHICLE_NOT_FOUND: 'Vehicle not found',
	VEHICLE_NOT_FOUND_DESC:
		"The vehicle you're looking for doesn't exist or you don't have access to it.",
	BACK_TO_DASHBOARD: 'Back to Dashboard'
} as const;

export const EXPENSE_MESSAGES = {
	TOTAL_EXPENSES: 'Total Expenses',
	TOTAL_COUNT: 'Total Count',
	MONTHLY_AVERAGE: 'Monthly Average',
	LAST_EXPENSE: 'Last Expense',
	EXPENSES_BY_CATEGORY: 'Expenses by Category',
	PENDING_SYNC: 'Pending Sync',
	RECENTLY_SYNCED: 'Recently Synced',
	NO_EXPENSES_DESC: 'Start tracking your vehicle expenses to see insights and analytics.',
	ADD_FUEL_DESC: 'Add fuel expenses with mileage to see detailed fuel statistics'
} as const;
