import type { CostBucketTotals } from '#lib/types/index.ts';

export interface CostPerDistance {
	total: number;
	running: number;
	ownership: number;
}

export function costPerDistance(
	totals: CostBucketTotals,
	distance: number | null
): CostPerDistance | null {
	if (distance === null || !(distance > 0)) return null;
	return {
		total: (totals.runningTotal + totals.ownershipTotal) / distance,
		running: totals.runningTotal / distance,
		ownership: totals.ownershipTotal / distance
	};
}

export function distanceDriven(
	currentOdometer: number | null,
	initialMileage: number | null | undefined
): number | null {
	if (currentOdometer === null) return null;
	const driven = currentOdometer - (initialMileage ?? 0);
	return driven > 0 ? driven : null;
}
