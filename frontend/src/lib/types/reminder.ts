// Reminder frequency options
export type ReminderFrequency = 'weekly' | 'monthly' | 'yearly' | 'custom';

// Custom interval units
export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

// Reminder action types
export type ReminderType = 'expense' | 'notification';

// Trigger axis (maintenance-schedule): by time, by odometer mileage, or whichever comes first.
export type TriggerMode = 'time' | 'mileage' | 'both';

// Split config for reminder expenses (mirrors backend ReminderSplitConfig)
export type ReminderSplitConfig =
	| { method: 'even'; vehicleIds: string[] }
	| { method: 'absolute'; allocations: { vehicleId: string; amount: number }[] }
	| { method: 'percentage'; allocations: { vehicleId: string; percentage: number }[] };

export interface Reminder {
	id: string;
	userId: string;
	name: string;
	description: string | null;
	type: string; // ReminderType
	actionMode: string;
	frequency: string; // ReminderFrequency
	intervalValue: number | null;
	intervalUnit: string | null; // IntervalUnit
	// Maintenance-schedule (T4 backend). triggerMode defaults to 'time'; the mileage fields are set
	// only for 'mileage'/'both'. nextDueOdometer is the server-derived milestone cache
	// (= lastServiceOdometer + intervalMileage). Distances are unitless ints in the vehicle's
	// distanceUnit (convert-on-read). nextDueDate is null for a pure-mileage reminder.
	triggerMode: string; // TriggerMode
	intervalMileage: number | null;
	lastServiceOdometer: number | null;
	nextDueOdometer: number | null;
	startDate: string;
	endDate: string | null;
	nextDueDate: string | null;
	expenseCategory: string | null;
	expenseTags: string[] | null;
	expenseAmount: number | null;
	expenseDescription: string | null;
	expenseSplitConfig: ReminderSplitConfig | null;
	isActive: boolean;
	lastTriggeredAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ReminderWithVehicles {
	reminder: Reminder;
	vehicleIds: string[];
}

export interface ReminderNotification {
	id: string;
	reminderId: string;
	userId: string;
	// A time-axis notification carries a dueDate; a mileage-axis one carries a dueOdometer instead
	// (exactly one is set). Both nullable as of the maintenance-schedule work.
	dueDate: string | null;
	dueOdometer: number | null;
	isRead: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface TriggerResult {
	createdExpenses: unknown[];
	notifications: ReminderNotification[];
	skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}
