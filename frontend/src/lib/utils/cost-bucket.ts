import {
	EXPENSE_CATEGORIES,
	type CategoryColorToken,
	type ExpenseCategory
} from '#lib/constants/expense-categories.ts';
import type { ExpenseSummary } from '#lib/types/index.ts';

export const COST_BUCKETS = ['ownership', 'energy', 'upkeep'] as const;

export type CostBucket = (typeof COST_BUCKETS)[number];

const BUCKET_BY_CATEGORY: Record<ExpenseCategory, CostBucket> = {
	fuel: 'energy',
	maintenance: 'upkeep',
	financial: 'ownership',
	regulatory: 'upkeep',
	enhancement: 'upkeep',
	misc: 'upkeep'
};

export const COST_BUCKET_COLOR_TOKENS: Record<
	CostBucket,
	Exclude<CategoryColorToken, 'neutral'>
> = {
	ownership: 'chart-3',
	energy: 'chart-1',
	upkeep: 'chart-2'
};

export function costBucket(category: ExpenseCategory): CostBucket {
	return BUCKET_BY_CATEGORY[category];
}

export type BucketAmounts = Record<CostBucket, number>;

export function bucketAmounts(breakdown: ExpenseSummary['categoryBreakdown']): BucketAmounts {
	const amounts: BucketAmounts = { ownership: 0, energy: 0, upkeep: 0 };
	for (const row of breakdown) {
		if ((EXPENSE_CATEGORIES as readonly string[]).includes(row.category)) {
			amounts[costBucket(row.category as ExpenseCategory)] += row.amount;
		}
	}
	return amounts;
}

export function costBucketColor(bucket: CostBucket): string {
	return `var(--${COST_BUCKET_COLOR_TOKENS[bucket]})`;
}
