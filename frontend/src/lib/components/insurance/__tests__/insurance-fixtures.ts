import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import type {
	InsuranceClaim,
	InsurancePolicy,
	InsuranceTerm,
	PaginatedResponse,
	Photo,
	Vehicle
} from '#lib/types/index.ts';

export const VEHICLES: Vehicle[] = [
	{
		id: 'v1',
		make: 'Toyota',
		model: 'Camry',
		year: 2020,
		nickname: 'Daily',
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	},
	{
		id: 'v2',
		make: 'Honda',
		model: 'Civic',
		year: 2019,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z'
	}
];

export function makeTerm(overrides: Partial<InsuranceTerm> = {}): InsuranceTerm {
	return {
		id: 't1',
		policyId: 'p1',
		startDate: '2025-06-01',
		endDate: '2026-06-01',
		createdAt: '2025-06-01T00:00:00.000Z',
		updatedAt: '2025-06-01T00:00:00.000Z',
		...overrides
	};
}

export function makePolicy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
	return {
		id: 'p1',
		company: 'Acme Mutual',
		isActive: true,
		vehicleIds: [],
		terms: [],
		termVehicleCoverage: [],
		createdAt: '2025-01-01T00:00:00.000Z',
		updatedAt: '2025-01-01T00:00:00.000Z',
		...overrides
	};
}

export function makeClaim(overrides: Partial<InsuranceClaim> = {}): InsuranceClaim {
	return {
		id: 'c1',
		policyId: 'p1',
		claimDate: dateOnlyToISO('2026-03-15'),
		claimType: 'collision',
		status: 'filed',
		createdAt: '2026-03-15T12:00:00.000Z',
		updatedAt: '2026-03-15T12:00:00.000Z',
		...overrides
	};
}

export function makePhoto(overrides: Partial<Photo> = {}): Photo {
	return {
		id: 'd1',
		entityType: 'insurance_policy',
		entityId: 'p1',
		fileName: 'card.jpg',
		mimeType: 'image/jpeg',
		fileSize: 1024,
		isCover: false,
		sortOrder: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

export function photoPage(data: Photo[]): PaginatedResponse<Photo> {
	return { data, pagination: { totalCount: data.length, limit: 20, offset: 0, hasMore: false } };
}

export async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

export function resolveRoute(path: string, params: Record<string, string> = {}): string {
	return path.replace(/\[(\w+)\]/g, (_match, key: string) => params[key] ?? '');
}
