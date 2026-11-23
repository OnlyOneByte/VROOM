import type { ExpenseCategory } from '#lib/constants/expense-categories.ts';
import type { CostBucketTotals, ExpenseSummary } from '#lib/types/index.ts';
import { COST_BUCKETS, costBucket, type CostBucket } from './cost-bucket.ts';

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

export function bucketAmounts(
	breakdown: ExpenseSummary['categoryBreakdown']
): Record<CostBucket, number> {
	const amounts = Object.fromEntries(COST_BUCKETS.map(bucket => [bucket, 0])) as Record<
		CostBucket,
		number
	>;
	for (const { category, amount } of breakdown) {
		amounts[costBucket(category as ExpenseCategory) ?? 'upkeep'] += amount;
	}
	return amounts;
}

export function distanceDriven(
	currentOdometer: number | null,
	initialMileage: number | null | undefined
): number | null {
	if (currentOdometer === null) return null;
	const driven = currentOdometer - (initialMileage ?? 0);
	return driven > 0 ? driven : null;
}
