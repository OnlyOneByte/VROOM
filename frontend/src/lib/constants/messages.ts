/**
 * UI messages and labels for i18n readiness
 */

export const COMMON_MESSAGES = {
	// Loading states
	LOADING: 'Loading...',
	LOADING_VROOM: 'Loading VROOM...',

	// Empty states
	NO_DATA: 'No data available',
	NO_EXPENSES: 'No expenses yet',
	NO_VEHICLES: 'No vehicles yet',
	NO_FUEL_DATA: 'No fuel data yet',

	// Actions
	ADD_EXPENSE: 'Add Expense',
	ADD_FIRST_EXPENSE: 'Add First Expense',
	ADD_FUEL_EXPENSE: 'Add Fuel Expense',
	ADD_VEHICLE: 'Add Vehicle',
	CLEAR_FILTERS: 'Clear Filters',
	SAVE: 'Save',
	CANCEL: 'Cancel',
	DELETE: 'Delete',
	EDIT: 'Edit',
	BACK: 'Back',

	// Filters
	ALL_VEHICLES: 'All Vehicles',
	ALL_CATEGORIES: 'All Categories',
	FILTERS: 'Filters',
	SEARCH_EXPENSES: 'Search expenses...',

	// Errors
	ERROR_LOADING: 'Failed to load data',
	ERROR_SAVING: 'Failed to save',
	ERROR_DELETING: 'Failed to delete',

	// Success
	SUCCESS_SAVED: 'Successfully saved',
	SUCCESS_DELETED: 'Successfully deleted'
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

export const MAINTENANCE_MESSAGES = {
	COMING_SOON: 'Maintenance reminders coming soon',
	COMING_SOON_DESC: 'Set up reminders for oil changes, tire rotations, and more'
} as const;
