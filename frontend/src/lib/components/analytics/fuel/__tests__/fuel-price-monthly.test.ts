import { describe, expect, test } from 'vitest';
import { monthlyPriceRows, monthlyPriceSeries } from '../FuelCharts.svelte';

function chargingHistory() {
	const history: { date: string; fuelType: string; pricePerVolume: number }[] = [];
	const start = new Date(2025, 0, 1);
	for (let day = 0; day < 365; day += 4) {
		const d = new Date(start.getTime() + day * 86400000);
		const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		history.push({ date, fuelType: 'Level 2 (AC)', pricePerVolume: 0.14 + (day % 3) * 0.01 });
		if (day % 20 === 0) history.push({ date, fuelType: 'DC Fast Charging', pricePerVolume: 0.42 });
	}
	return history;
}

describe('monthly price roll-up', () => {
	test('home and fast charging each draw one unbroken line, one point per month', () => {
		const rows = monthlyPriceRows(chargingHistory());
		expect(rows).toHaveLength(12);
		for (const { key, data } of monthlyPriceSeries(rows, ['Level 2 (AC)', 'DC Fast Charging'])) {
			expect(data.length, key).toBe(12);
			expect(
				data.every(row => typeof row[key] === 'number'),
				key
			).toBe(true);
		}
	});

	test('a type missing in some months still connects across them', () => {
		const rows = monthlyPriceRows([
			{ date: '2025-01-05', fuelType: 'Home', pricePerVolume: 0.1 },
			{ date: '2025-01-09', fuelType: 'DC', pricePerVolume: 0.4 },
			{ date: '2025-02-05', fuelType: 'Home', pricePerVolume: 0.1 },
			{ date: '2025-03-05', fuelType: 'Home', pricePerVolume: 0.1 },
			{ date: '2025-03-20', fuelType: 'DC', pricePerVolume: 0.5 }
		]);
		const [, dc] = monthlyPriceSeries(rows, ['Home', 'DC']);
		expect(dc!.data.map(r => r['month'])).toEqual(['2025-01', '2025-03']);
	});

	test('gas fill-ups keep their values: each month is the mean of its fill-ups, with count and range', () => {
		const rows = monthlyPriceRows([
			{ date: '2025-04-02', fuelType: 'Regular', pricePerVolume: 3.4 },
			{ date: '2025-04-12', fuelType: 'Regular', pricePerVolume: 3.6 },
			{ date: '2025-04-28', fuelType: 'Regular', pricePerVolume: 3.8 },
			{ date: '2025-05-03', fuelType: 'Regular', pricePerVolume: 3.5 }
		]);
		expect(rows.map(r => r['month'])).toEqual(['2025-04', '2025-05']);
		expect(rows[0]!['Regular']).toBeCloseTo(3.6, 10);
		expect(rows[0]!['Regular:stats']).toEqual({ count: 3, min: 3.4, max: 3.8 });
		expect(rows[1]!['Regular']).toBe(3.5);
		expect(rows[0]!['date']).toEqual(new Date(2025, 3, 1));
	});
});
