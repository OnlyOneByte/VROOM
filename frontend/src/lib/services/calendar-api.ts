import { apiClient } from './api-client';

export interface CalendarFeedOptions {
	reminders: boolean;
	insurance: boolean;
	loans: boolean;
	vehicleNames: boolean;
	amounts: boolean;
}

export interface CalendarFeedInfo {
	options: CalendarFeedOptions;
	createdAt: string;
	lastUsedAt: string | null;
}

export const calendarApi = {
	async getFeed(): Promise<CalendarFeedInfo | null> {
		return (await apiClient.get<{ feed: CalendarFeedInfo | null }>('/calendar/feed')).feed;
	},

	async createFeed(
		options?: Partial<CalendarFeedOptions>
	): Promise<{ feed: CalendarFeedInfo; path: string }> {
		return apiClient.post<{ feed: CalendarFeedInfo; path: string }>(
			'/calendar/feed',
			options ? { options } : {}
		);
	},

	async updateOptions(options: Partial<CalendarFeedOptions>): Promise<CalendarFeedInfo> {
		return (await apiClient.put<{ feed: CalendarFeedInfo }>('/calendar/feed', { options })).feed;
	},

	async turnOff(): Promise<void> {
		await apiClient.delete('/calendar/feed');
	}
};
