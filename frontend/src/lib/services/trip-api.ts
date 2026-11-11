import type { PaginatedResponse, Trip, TripPurpose, TripSummary } from '$lib/types';
import { apiClient } from './api-client';
import { buildQueryString } from './api-utils';

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
	/** ISO timestamp; send noon-local (see dateOnlyToISO) so the calendar day does not shift across timezones. */
	tripDate: string;
	startLocation?: string;
	endLocation?: string;
	note?: string;
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
		return apiClient.getPaginated<Trip>(`/api/v1/trips${qs}`);
	},

	async getByVehicle(vehicleId: string): Promise<Trip[]> {
		return apiClient.get<Trip[]>(`/api/v1/trips/vehicle/${vehicleId}`);
	},

	async getById(id: string): Promise<Trip> {
		return apiClient.get<Trip>(`/api/v1/trips/${id}`);
	},

	async getSummary(params?: { vehicleId?: string; rate?: number }): Promise<TripSummary> {
		const qs = buildQueryString({
			vehicleId: params?.vehicleId || undefined,
			rate: params?.rate
		});
		return apiClient.get<TripSummary>(`/api/v1/trips/summary${qs}`);
	},

	async create(data: CreateTripRequest): Promise<Trip> {
		return apiClient.post<Trip>('/api/v1/trips', data);
	},

	async update(id: string, data: UpdateTripRequest): Promise<Trip> {
		return apiClient.put<Trip>(`/api/v1/trips/${id}`, data);
	},

	// Creating a trip also writes an odometer entry. Keeping it is the default; keepOdometer=false removes it too.
	async delete(id: string, keepOdometer = true): Promise<void> {
		const qs = keepOdometer ? '' : '?keepOdometer=false';
		await apiClient.delete(`/api/v1/trips/${id}${qs}`);
	}
};

export type { TripListFilters, CreateTripRequest, UpdateTripRequest };
