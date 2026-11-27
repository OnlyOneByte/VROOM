import { describe, expect, test } from 'vitest';
import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
import { categoryRows, perHero, perVehicleRequests } from '../per-overview';

const spend = (amounts: Record<string, number | null>) =>
	({
		series: Object.entries(amounts).map(([key, v]) => ({ key, label: key, values: [v] }))
	}) as unknown as AnalyticsQueryResponse;

describe('perVehicleRequests', () => {
	test('lifetime queries have no dates; the monthly one covers the range for one car', () => {
		const { lifetime, monthly } = perVehicleRequests('civic', { startDate: 5, endDate: 9 });
		expect(lifetime.every(q => q.start === undefined && q.vehicleIds?.[0] === 'civic')).toBe(true);
		expect(monthly).toMatchObject({ interval: 'month', include: 'running', start: 5, end: 9 });
	});
});

describe('categoryRows', () => {
	test('drops empty categories, ranks by amount and scales to the largest', () => {
		const rows = categoryRows(
			spend({ fuel: 50, misc: 0, maintenance: 100, regulatory: null }),
			false
		);
		expect(rows.map(r => [r.category, r.share])).toEqual([
			['maintenance', 1],
			['fuel', 0.5]
		]);
	});

	test('leaves out financial when it is hidden', () => {
		expect(categoryRows(spend({ financial: 900, fuel: 100 }), true).map(r => r.category)).toEqual([
			'fuel'
		]);
	});
});

describe('perHero', () => {
	test('names a category only at 40% or more, and running costs only when there is a loan', () => {
		const even = perHero(categoryRows(spend({ fuel: 35, maintenance: 35, misc: 30 }), false));
		expect(even).toEqual({ total: 100, top: undefined, running: undefined });

		const loan = perHero(categoryRows(spend({ financial: 60, fuel: 40 }), false));
		expect(loan?.top).toEqual({ percent: 60, reason: 'loan and insurance payments' });
		expect(loan?.running).toBe(40);
	});

	test('no spending means no hero', () => {
		expect(perHero([])).toBeNull();
	});
});
