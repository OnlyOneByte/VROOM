import { describe, expect, test } from 'vitest';
import { economyRows, priceSummary } from '../fuel-overview';

const fill = (month: string, pricePerVolume: number) => ({
	date: `${month}-10`,
	month,
	fuelType: 'regular',
	pricePerVolume
});

describe('fuel overview figures', () => {
	test('the average is over fill-ups; the range and cheapest month are over monthly averages', () => {
		const summary = priceSummary([
			fill('2026-10', 3.6),
			fill('2026-10', 3.7),
			fill('2026-11', 3.5),
			fill('2026-12', 3.8)
		]);
		expect(summary).toMatchObject({ low: 3.5, high: 3.8, cheapestMonth: '2026-11', months: 3 });
		expect(summary?.average).toBeCloseTo(3.65);
		expect(priceSummary([])).toBeNull();
	});

	test('economy bars skip cars with no figure, sort best first and scale to the best', () => {
		const rows = economyRows([
			{
				vehicleId: 'a',
				vehicleName: 'Daily',
				fuelEfficiency: 31,
				maintenanceCost: 0,
				reliability: 0,
				annualCost: 0,
				mileage: 0
			},
			{
				vehicleId: 'b',
				vehicleName: 'EV',
				fuelEfficiency: null,
				maintenanceCost: 0,
				reliability: 0,
				annualCost: 0,
				mileage: 0
			},
			{
				vehicleId: 'c',
				vehicleName: 'Weekend',
				fuelEfficiency: 35,
				maintenanceCost: 0,
				reliability: 0,
				annualCost: 0,
				mileage: 0
			}
		]);
		expect(rows.map(r => r.label)).toEqual(['Weekend', 'Daily']);
		expect(rows[0]?.share).toBe(1);
		expect(rows[1]?.share).toBeCloseTo(31 / 35);
	});
});
