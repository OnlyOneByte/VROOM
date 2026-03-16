import type {
	Reminder,
	ReminderNotification,
	ReminderWithVehicles,
	TriggerResult
} from '$lib/types';
import { apiClient } from './api-client';

interface ReminderListFilters {
	vehicleId?: string;
	type?: string;
	isActive?: boolean;
}

function buildReminderQuery(filters?: ReminderListFilters): string {
	if (!filters) return '';
	const query = new URLSearchParams();
	if (filters.vehicleId) query.set('vehicleId', filters.vehicleId);
	if (filters.type) query.set('type', filters.type);
	if (filters.isActive !== undefined) query.set('isActive', String(filters.isActive));
	const qs = query.toString();
	return qs ? `?${qs}` : '';
}

/**
 * Reminder API service
 * Centralized API calls for reminder-related operations
 */
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

	async getNotifications(unreadOnly?: boolean): Promise<ReminderNotification[]> {
		const query = unreadOnly ? '?unreadOnly=true' : '';
		return apiClient.get<ReminderNotification[]>(`/api/v1/reminders/notifications${query}`);
	},

	async markNotificationRead(id: string): Promise<ReminderNotification> {
		return apiClient.put<ReminderNotification>(`/api/v1/reminders/notifications/${id}/read`);
	}
};
