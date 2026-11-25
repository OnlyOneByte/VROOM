import type { PaginatedResponse, Trip, TripPurpose, TripSummary } from '#lib/types/index.ts';
import { apiClient } from './api-client';
import { buildQueryString } from './api-utils';
import { userTimeZone } from './analytics-api';

interface TripListFilters {
	vehicleId?: string;
	purpose?: TripPurpose;
	limit?: number;
	offset?: number;
}

interface CreateTripRequest {
	vehicleId: string;
	startOdometer: number;
	endOdometer: number;
	purpose: TripPurpose;
	tripDate: string;
	startLocation?: string;
	endLocation?: string;
	note?: string;
	driverId?: string | null;
}

type UpdateTripRequest = Partial<Omit<CreateTripRequest, 'vehicleId'>>;

export const tripApi = {
	async list(filters?: TripListFilters): Promise<PaginatedResponse<Trip>> {
		const qs = buildQueryString({
			vehicleId: filters?.vehicleId || undefined,
			purpose: filters?.purpose || undefined,
			limit: filters?.limit,
			offset: filters?.offset
		});
		return apiClient.getPaginated<Trip>(`/trips${qs}`);
	},

	async getSummary(params?: { vehicleId?: string; rate?: number }): Promise<TripSummary> {
		const qs = buildQueryString({
			vehicleId: params?.vehicleId || undefined,
			rate: params?.rate
		});
		return apiClient.get<TripSummary>(`/trips/summary${qs}`);
	},

	async create(data: CreateTripRequest): Promise<Trip> {
		return apiClient.post<Trip>('/trips', { ...data, timeZone: userTimeZone() });
	},

	async update(id: string, data: UpdateTripRequest): Promise<Trip> {
		return apiClient.put<Trip>(`/trips/${id}`, { ...data, timeZone: userTimeZone() });
	},

	async delete(id: string, keepOdometer = true): Promise<void> {
		const qs = keepOdometer
			? ''
			: buildQueryString({ keepOdometer: 'false', timeZone: userTimeZone() });
		await apiClient.delete(`/trips/${id}${qs}`);
	}
};

export type { TripListFilters, CreateTripRequest, UpdateTripRequest };
