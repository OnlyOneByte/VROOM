import { describe, expect, test } from 'vitest';
import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';
import { THEME_REGISTRY } from '#lib/theme/theme-registry.ts';
import { COST_BUCKETS, COST_BUCKET_COLOR_TOKENS, costBucket } from '../cost-bucket';

describe('costBucket', () => {
	test.each([...EXPENSE_CATEGORIES])('%s has a bucket', category => {
		expect(COST_BUCKETS).toContain(costBucket(category));
	});

	test('ownership is exactly the financial category (decision D1)', () => {
		expect(EXPENSE_CATEGORIES.filter(category => costBucket(category) === 'ownership')).toEqual([
			'financial'
		]);
		expect(costBucket('fuel')).toBe('energy');
	});

	test('every bucket has at least one category', () => {
		const used = new Set(EXPENSE_CATEGORIES.map(costBucket));
		expect([...used].sort()).toEqual([...COST_BUCKETS].sort());
	});
});

describe('cost bucket colours', () => {
	test('each bucket has its own fixed chart token', () => {
		expect(COST_BUCKET_COLOR_TOKENS).toEqual({
			ownership: 'chart-3',
			energy: 'chart-1',
			upkeep: 'chart-2'
		});
		expect(new Set(Object.values(COST_BUCKET_COLOR_TOKENS)).size).toBe(COST_BUCKETS.length);
	});

	test('every theme defines the bucket tokens the chart contrast gate checks', () => {
		for (const theme of Object.values(THEME_REGISTRY)) {
			for (const variant of ['light', 'dark'] as const) {
				for (const token of Object.values(COST_BUCKET_COLOR_TOKENS)) {
					expect(theme[variant][token], `${theme.id}.${variant}.${token}`).toMatch(/^oklch\(/);
				}
			}
		}
	});
});
