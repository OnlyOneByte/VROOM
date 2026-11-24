import type { UnitPreferences } from '#lib/types/index.ts';
import { apiClient } from './api-client';

export type CommunityMetric = 'efficiency' | 'running_cost' | 'maintenance' | 'insurance';

export type CompareStatus =
	| 'ok'
	| 'too_few'
	| 'no_data'
	| 'needs_model'
	| 'opt_in_required'
	| 'awaiting_refresh'
	| 'feature_off';

export type CompareUnit =
	'distance_per_volume' | 'distance_per_charge' | 'cents_per_distance' | 'cents_per_year';

export interface CompareBucket {
	n: number;
	mean: number;
	p25: number | null;
	p50: number;
	p75: number | null;
	computedAt: string;
}

export interface CompareMetric {
	metric: CommunityMetric;
	status: CompareStatus;
	unit: CompareUnit | null;
	yours: number | null;
	bucket: CompareBucket | null;
}

export interface CompareResult {
	currency: string | null;
	units?: UnitPreferences;
	metrics: CompareMetric[];
}

export const communityApi = {
	async compare(vehicleId: string): Promise<CompareResult> {
		return apiClient.get<CompareResult>(
			`/community/compare?vehicleId=${encodeURIComponent(vehicleId)}`
		);
	}
};
