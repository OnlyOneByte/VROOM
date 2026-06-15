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
	// vehicleId/type keep their truthy-drop (an empty string is omitted, not serialized) via
	// `|| undefined`; isActive must SURVIVE when false, so pass the boolean through as-is (the
	// shared filter drops only null/undefined). Matches the prior hand-rolled construction exactly.
	return buildQueryString({
		vehicleId: filters.vehicleId || undefined,
		type: filters.type || undefined,
		isActive: filters.isActive
	});
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

	/**
	 * Mark a maintenance reminder serviced — re-arms it (D3). The backend anchors the mileage axis
	 * to the vehicle's current odometer (recomputing the next milestone) and/or advances the time
	 * axis one period. Returns the updated reminder.
	 */
	async markServiced(id: string): Promise<Reminder> {
		return apiClient.post<Reminder>(`/api/v1/reminders/${id}/mark-serviced`);
	},

	/**
	 * The expense rows this reminder has materialized (recurring-expenses T6 — the "this reminder
	 * created N expenses" view). Backend: GET /:id/expenses → expenseRepository.findBySource
	 * (ownership-checked, user-scoped), ordered oldest-first.
	 *
	 * The route returns RAW repository rows (backend shape: `expenseAmount`, un-split `volume`), so
	 * map each through `fromBackendExpense` exactly like every other expense read (expense-api.ts) —
	 * otherwise a consumer reading `expense.amount` gets undefined and an electric charge stays in
	 * `volume` instead of `charge`. (The FE→BE-seam type-lie NORTH_STAR #3 warns about.)
	 */
	async getMaterializedExpenses(id: string): Promise<Expense[]> {
		const data = await apiClient.get<BackendExpenseResponse[]>(`/api/v1/reminders/${id}/expenses`);
		return data.map(fromBackendExpense);
	},

	/**
	 * The monthly recurring run-rate across the user's active expense reminders (recurring-expenses
	 * T7). Backend: GET /recurring-cost → recurringCostSummary (a read-only derivation, no new table).
	 * The dashboard "recurring costs" widget renders this.
	 */
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
