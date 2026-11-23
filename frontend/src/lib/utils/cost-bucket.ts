import type { CategoryColorToken, ExpenseCategory } from '#lib/constants/expense-categories.ts';

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

export function costBucketColor(bucket: CostBucket): string {
	return `var(--${COST_BUCKET_COLOR_TOKENS[bucket]})`;
}
