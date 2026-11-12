export type ReminderFrequency = 'weekly' | 'monthly' | 'yearly' | 'custom';

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

export type ReminderType = 'expense' | 'notification';

export type TriggerMode = 'time' | 'mileage' | 'both';

export type ReminderSplitConfig =
	| { method: 'even'; vehicleIds: string[] }
	| { method: 'absolute'; allocations: { vehicleId: string; amount: number }[] }
	| { method: 'percentage'; allocations: { vehicleId: string; percentage: number }[] };

export interface Reminder {
	id: string;
	userId: string;
	name: string;
	description: string | null;
	type: ReminderType;
	actionMode: string;
	frequency: ReminderFrequency;
	intervalValue: number | null;
	intervalUnit: IntervalUnit | null;
	triggerMode: TriggerMode;
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

export interface RecurringCostSummary {
	count: number;
	monthlyTotal: number;
}
