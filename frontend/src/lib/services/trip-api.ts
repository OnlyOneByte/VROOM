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
	/** ISO timestamp (the form sends a local-day → noon-local ISO, the C61/dateOnlyToISO discipline). */
	tripDate: string;
	startLocation?: string;
	endLocation?: string;
	note?: string;
}

type UpdateTripRequest = Partial<Omit<CreateTripRequest, 'vehicleId'>>;

/**
 * Trip API service (trips-location T6 FE seam) — the C149/C163 service pattern over the C210/C212 routes:
 *   GET    /api/v1/trips                — paginated list (optional vehicleId/purpose filter)
 *   GET    /api/v1/trips/summary        — the R4 mileage rollup (optional vehicleId scope + business rate)
 *   GET    /api/v1/trips/vehicle/:id    — one vehicle's trips (newest first)
 *   GET    /api/v1/trips/:id            — one trip
 *   POST   /api/v1/trips                — create (vehicleId in body)
 *   PUT    /api/v1/trips/:id            — update
 *   DELETE /api/v1/trips/:id            — delete
 */
export const tripApi = {
	async list(filters?: TripListFilters): Promise<PaginatedResponse<Trip>> {
		// vehicleId/purpose drop when empty (|| undefined → omitted from the query string).
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

	/**
	 * The mileage-summary rollup (R4). `vehicleId` scopes to one vehicle (else cross-fleet); `rate` is the
	 * business-mileage reimbursement rate ($/mile) — both optional, dropped from the query when absent.
	 */
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

	async delete(id: string): Promise<void> {
		await apiClient.delete(`/api/v1/trips/${id}`);
	}
};

export type { TripListFilters, CreateTripRequest, UpdateTripRequest };
