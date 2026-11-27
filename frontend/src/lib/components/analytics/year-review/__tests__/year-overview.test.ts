import { describe, expect, test } from 'vitest';
import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
import {
	biggestMonth,
	coveredCars,
	cheapestToRun,
	mostFills,
	percentChange,
	yearCounts,
	yearRange,
	yearRequests
} from '../year-overview';

const secs = (d: Date) => Math.floor(d.getTime() / 1000);
const NOW = new Date(2026, 10, 27, 15, 0);
const series = (values: Record<string, number | null>) =>
	({
		series: Object.entries(values).map(([key, v]) => ({ key, label: key, values: [v] }))
	}) as unknown as AnalyticsQueryResponse;

describe('yearRange', () => {
	test('the current year runs to the end of today and is "so far"', () => {
		expect(yearRange(2026, NOW)).toEqual({
			start: secs(new Date(2026, 0, 1)),
			end: secs(new Date(2026, 10, 28)),
			soFar: true
		});
	});

	test('a past year is the whole year', () => {
		expect(yearRange(2025, NOW)).toEqual({
			start: secs(new Date(2025, 0, 1)),
			end: secs(new Date(2026, 0, 1)),
			soFar: false
		});
	});
});

describe('yearRequests', () => {
	test('this year compares with the same point last year', () => {
		const q = yearRequests(2026, NOW);
		expect(q.monthly).toMatchObject({ metric: 'cost', interval: 'month', include: 'all' });
		expect(q.previous).toMatchObject({
			start: secs(new Date(2025, 0, 1)),
			end: secs(new Date(2025, 10, 28))
		});
	});

	test('on Feb 29 the comparison stops at the end of Feb 28 last year', () => {
		expect(yearRequests(2028, new Date(2028, 1, 29, 9)).previous).toMatchObject({
			end: secs(new Date(2027, 2, 1))
		});
	});

	test('a past year compares with the whole year before it', () => {
		expect(yearRequests(2025, NOW).previous).toMatchObject({
			start: secs(new Date(2024, 0, 1)),
			end: secs(new Date(2025, 0, 1))
		});
	});
});

describe('covered cars', () => {
	test('the year sends no separate per-car query', () => {
		expect(Object.keys(yearRequests(2026, NOW))).not.toContain('cars');
	});

	test('counts every car the query covered and names each left-out currency once', () => {
		const response = {
			coverage: {
				vehicleIds: ['civic', 'rav4'],
				otherCurrency: [
					{ vehicleId: 'golf', currency: 'EUR' },
					{ vehicleId: 'polo', currency: 'EUR' },
					{ vehicleId: 'mini', currency: 'GBP' }
				],
				unavailable: 0
			}
		} as unknown as AnalyticsQueryResponse;
		expect(coveredCars(response)).toEqual({ count: 2, otherCurrencies: ['EUR', 'GBP'] });
		expect(coveredCars(null)).toEqual({ count: 0, otherCurrencies: [] });
	});
});

describe('year figures', () => {
	test('counts add up every category and pick out fill-ups', () => {
		expect(yearCounts(series({ fuel: 90, maintenance: 20, misc: 13 }))).toEqual({
			expenses: 123,
			fills: 90
		});
	});

	test('cheapest to run needs two cars; most fill-ups needs one', () => {
		expect(cheapestToRun(series({ Civic: 0.12 }))).toBeNull();
		expect(cheapestToRun(series({ Civic: 0.12, RAV4: 0.09, F150: null }))).toEqual({
			label: 'RAV4',
			value: 0.09
		});
		expect(mostFills(series({ Civic: 20, RAV4: 36 }))).toEqual({ label: 'RAV4', value: 36 });
		expect(mostFills(series({}))).toBeNull();
	});

	test('biggest month and the change on last year', () => {
		const monthly = {
			buckets: ['2026-01', '2026-02', '2026-03'],
			series: [{ key: 'total', label: 'Cost', values: [100, 300, null] }]
		} as unknown as AnalyticsQueryResponse;
		expect(biggestMonth(monthly)).toEqual({ bucket: '2026-02', value: 300 });
		expect(percentChange(110, 100)).toBeCloseTo(10);
		expect(percentChange(100, 0)).toBeNull();
	});
});
