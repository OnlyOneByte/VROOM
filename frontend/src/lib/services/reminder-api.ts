import type {
	BackendExpenseResponse,
	Expense,
	RecurringCostSummary,
	Reminder,
	ReminderNotification,
	ReminderWithVehicles,
	TriggerResult
} from '$lib/types';
import { apiClient } from './api-client';
import { fromBackendExpense } from './api-transformer';
import { buildQueryString } from './api-utils';

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
		return apiClient.post<ReminderWithVehicles>('/api/v1/reminders', data);
	},

	async list(filters?: ReminderListFilters): Promise<ReminderWithVehicles[]> {
		const qs = buildReminderQuery(filters);
		return apiClient.get<ReminderWithVehicles[]>(`/api/v1/reminders${qs}`);
	},

	async getById(id: string): Promise<ReminderWithVehicles> {
		return apiClient.get<ReminderWithVehicles>(`/api/v1/reminders/${id}`);
	},

	async update(
		id: string,
		data: Partial<Reminder> & { vehicleIds?: string[] }
	): Promise<ReminderWithVehicles> {
		return apiClient.put<ReminderWithVehicles>(`/api/v1/reminders/${id}`, data);
	},

	async delete(id: string): Promise<void> {
		await apiClient.delete(`/api/v1/reminders/${id}`);
	},

	async trigger(): Promise<TriggerResult> {
		return apiClient.post<TriggerResult>('/api/v1/reminders/trigger');
	},

	async markServiced(id: string): Promise<Reminder> {
		return apiClient.post<Reminder>(`/api/v1/reminders/${id}/mark-serviced`);
	},

	async getMaterializedExpenses(id: string): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>(`/api/v1/reminders/${id}/expenses`);
		return data.map(fromBackendExpense);
	},

	async getRecurringCost(): Promise<RecurringCostSummary> {
		return apiClient.get<RecurringCostSummary>('/api/v1/reminders/recurring-cost');
	},

	async getNotifications(unreadOnly?: boolean): Promise<ReminderNotification[]> {
		const query = unreadOnly ? '?unreadOnly=true' : '';
		return apiClient.get<ReminderNotification[]>(`/api/v1/reminders/notifications${query}`);
	},

	async markNotificationRead(id: string): Promise<ReminderNotification> {
		return apiClient.put<ReminderNotification>(`/api/v1/reminders/notifications/${id}/read`);
	}
};
