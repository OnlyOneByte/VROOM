// Reminder frequency options
export type ReminderFrequency = 'weekly' | 'monthly' | 'yearly' | 'custom';

// Custom interval units
export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

// Reminder action types
export type ReminderType = 'expense' | 'notification';

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
	startDate: string;
	endDate: string | null;
	nextDueDate: string;
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
	dueDate: string;
	isRead: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface TriggerResult {
	createdExpenses: unknown[];
	notifications: ReminderNotification[];
	skipped: Array<{ reminderId: string; reason: string; message?: string }>;
}
