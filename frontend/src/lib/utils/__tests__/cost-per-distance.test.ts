import { describe, expect, test } from 'vitest';
import { costPerDistance, distanceDriven } from '../cost-per-distance.ts';

describe('costPerDistance', () => {
	test('splits the all-in cost per distance into running and ownership parts', () => {
		expect(costPerDistance({ runningTotal: 2907, ownershipTotal: 10154 }, 22360)).toEqual({
			total: 13061 / 22360,
			running: 2907 / 22360,
			ownership: 10154 / 22360
		});
	});

	test('works the same in kilometres, since the distance is already in the vehicle unit', () => {
		expect(costPerDistance({ runningTotal: 300, ownershipTotal: 0 }, 1500)?.total).toBe(0.2);
	});

	test.each([null, 0, -5, Number.NaN])('has nothing to show for a distance of %s', distance => {
		expect(costPerDistance({ runningTotal: 100, ownershipTotal: 50 }, distance)).toBeNull();
	});
});

describe('distanceDriven', () => {
	test('is the distance since the initial odometer reading', () => {
		expect(distanceDriven(40360, 18000)).toBe(22360);
		expect(distanceDriven(500, undefined)).toBe(500);
	});

	test('is unknown with no reading or no distance yet', () => {
		expect(distanceDriven(null, 18000)).toBeNull();
		expect(distanceDriven(18000, 18000)).toBeNull();
	});
});
