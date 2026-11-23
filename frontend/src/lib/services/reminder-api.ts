import type {
	BackendExpenseResponse,
	Expense,
	RecurringCostSummary,
	Reminder,
	ReminderNotification,
	ReminderWithVehicles,
	TriggerResult
} from '#lib/types/index.ts';
import { apiClient } from './api-client';
import { fromBackendExpense } from './api-transformer';
import { buildQueryString } from './api-utils';
import { userTimeZone } from './analytics-api';

function safeTimeZone(): string | undefined {
	try {
		return userTimeZone() || undefined;
	} catch {
		return undefined;
	}
}

interface ReminderListFilters {
	vehicleId?: string;
	type?: string;
	isActive?: boolean;
}

function buildReminderQuery(filters?: ReminderListFilters): string {
	if (!filters) return '';
	return buildQueryString({
		vehicleId: filters.vehicleId || undefined,
		type: filters.type || undefined,
		isActive: filters.isActive
	});
}

export const reminderApi = {
	async create(data: Partial<Reminder> & { vehicleIds: string[] }): Promise<ReminderWithVehicles> {
		return apiClient.post<ReminderWithVehicles>('/reminders', data);
	},

	async list(filters?: ReminderListFilters): Promise<ReminderWithVehicles[]> {
		const qs = buildReminderQuery(filters);
		return apiClient.get<ReminderWithVehicles[]>(`/reminders${qs}`);
	},

	async update(
		id: string,
		data: Partial<Reminder> & { vehicleIds?: string[] }
	): Promise<ReminderWithVehicles> {
		return apiClient.put<ReminderWithVehicles>(`/reminders/${id}`, {
			timeZone: safeTimeZone(),
			...data
		});
	},

	async delete(id: string): Promise<void> {
		await apiClient.delete(`/reminders/${id}`);
	},

	async trigger(): Promise<TriggerResult> {
		return apiClient.post<TriggerResult>(
			`/reminders/trigger${buildQueryString({ timeZone: safeTimeZone() })}`
		);
	},

	async markServiced(id: string): Promise<Reminder> {
		return apiClient.post<Reminder>(
			`/reminders/${id}/mark-serviced${buildQueryString({ timeZone: safeTimeZone() })}`
		);
	},

	async getMaterializedExpenses(id: string): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>(`/reminders/${id}/expenses`);
		return data.map(fromBackendExpense);
	},

	async getRecurringCost(): Promise<RecurringCostSummary> {
		return apiClient.get<RecurringCostSummary>('/reminders/recurring-cost');
	},

	async getNotifications(unreadOnly?: boolean): Promise<ReminderNotification[]> {
		const query = unreadOnly ? '?unreadOnly=true' : '';
		return apiClient.get<ReminderNotification[]>(`/reminders/notifications${query}`);
	},

	async markNotificationRead(id: string): Promise<ReminderNotification> {
		return apiClient.put<ReminderNotification>(`/reminders/notifications/${id}/read`);
	}
};
