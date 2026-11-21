import { describe, expect, test } from 'vitest';
import { consumptionChartRows } from '../FuelCharts.svelte';

describe('consumptionChartRows', () => {
	test('a month with no efficiency figure becomes a gap, not null, so the tooltip skips it', () => {
		const rows = consumptionChartRows([
			{ month: '2024-01', efficiency: null, volume: 10 },
			{ month: '2024-02', efficiency: 30, volume: 12 }
		]);

		expect(rows[0]?.efficiency).toBeUndefined();
		expect(rows[0]?.volume).toBe(10);
		expect(rows[1]?.efficiency).toBe(30);
		expect(rows[1]?.date).toEqual(new Date(2024, 1, 1));
	});
});
