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
	const months = (...perMonth: Array<[number, number[]]>) =>
		perMonth.flatMap(([m, values]) => values.map((v, i) => point(2026, m, 3 + i * 10, v)));

	test('names the lowest month when it is more than 15% under the average', () => {
		const points = months([6, [19, 19]], [7, [32, 32]], [8, [33, 33]]);

		expect(monthOutlier(points, 28)).toEqual({
			month: new Date(2026, 6, 1),
			efficiency: 19,
			count: 2,
			direction: 'below'
		});
	});

	test('with no dip, names the highest month when it is more than 15% over', () => {
		const points = months([8, [30, 30]], [9, [30, 30]], [10, [40, 44]]);

		expect(monthOutlier(points, 34)).toEqual({
			month: new Date(2026, 10, 1),
			efficiency: 42,
			count: 2,
			direction: 'above'
		});
	});

	test('is steady when every judged month is close to the average', () => {
		expect(monthOutlier(months([6, [29, 30]], [7, [31, 31]]), 30)).toBe('steady');
	});

	test('ignores months with a single tank, so one odd fill-up is not named', () => {
		const points = months([6, [30, 30]], [7, [31, 31]], [8, [84]]);

		expect(monthOutlier(points, 41)).toEqual(expect.objectContaining({ direction: 'below' }));
		expect(monthOutlier(months([6, [30, 30]], [7, [84]]), 48)).toBeNull();
	});

	test('needs two judged months and an average', () => {
		expect(monthOutlier(months([6, [10, 40]]), 30)).toBeNull();
		expect(monthOutlier(months([6, [10, 12]], [7, [40, 40]]), null)).toBeNull();
	});
});
