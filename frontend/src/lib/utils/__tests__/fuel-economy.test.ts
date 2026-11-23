import { describe, expect, test } from 'vitest';
import { bestEfficiency, lastTwelveMonths, monthOutlier } from '../fuel-economy.ts';

const point = (y: number, m: number, d: number, efficiency: number) => ({
	date: new Date(y, m, d, 12),
	efficiency
});

describe('lastTwelveMonths', () => {
	test('keeps points from the last 365 days', () => {
		const now = new Date(2026, 10, 23, 12);
		const points = [point(2026, 10, 1, 30), point(2025, 11, 1, 31), point(2025, 9, 1, 32)];

		expect(lastTwelveMonths(points, now).map(p => p.efficiency)).toEqual([30, 31]);
	});
});

describe('bestEfficiency', () => {
	test('is the highest point, or nothing with no points', () => {
		expect(bestEfficiency([point(2026, 0, 1, 30), point(2026, 1, 1, 36.2)])).toBe(36.2);
		expect(bestEfficiency([])).toBeNull();
	});
});

describe('monthOutlier', () => {
	test('names the lowest month when it is more than 15% under the average', () => {
		const points = [
			point(2026, 6, 4, 19),
			point(2026, 6, 20, 19),
			point(2026, 7, 3, 32),
			point(2026, 8, 3, 33)
		];

		expect(monthOutlier(points, 31)).toEqual({
			month: new Date(2026, 6, 1),
			efficiency: 19,
			count: 2,
			direction: 'below'
		});
	});

	test('with no dip, names the highest month when it is more than 15% over', () => {
		const points = [point(2026, 9, 4, 30), point(2026, 10, 3, 30), point(2026, 10, 20, 84)];

		expect(monthOutlier(points, 32.5)).toEqual({
			month: new Date(2026, 10, 1),
			efficiency: 57,
			count: 2,
			direction: 'above'
		});
	});

	test('stays quiet when every month is close to the average', () => {
		expect(monthOutlier([point(2026, 6, 4, 29), point(2026, 7, 3, 31)], 30)).toBeNull();
	});

	test('needs at least two months and an average', () => {
		expect(monthOutlier([point(2026, 6, 4, 10), point(2026, 6, 9, 40)], 30)).toBeNull();
		expect(monthOutlier([point(2026, 6, 4, 10), point(2026, 7, 9, 40)], null)).toBeNull();
	});
});
