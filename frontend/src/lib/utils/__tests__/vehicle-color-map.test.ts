import { describe, expect, test } from 'vitest';
import { buildVehicleColorMap, VEHICLE_COLORS } from '../chart-colors.ts';

describe('buildVehicleColorMap', () => {
	test('a vehicle gets the same colour whatever order the ids arrive in', () => {
		const a = buildVehicleColorMap(['civic', 'camry', 'model3']);
		const b = buildVehicleColorMap(['model3', 'civic', 'camry', 'civic']);
		expect(a).toEqual(b);
		expect(a).toEqual({
			camry: VEHICLE_COLORS[0],
			civic: VEHICLE_COLORS[1],
			model3: VEHICLE_COLORS[2]
		});
	});

	test('the first cars take the C3 vehicle colours: amber, steel, cyan, then green', () => {
		expect(VEHICLE_COLORS.slice(0, 4)).toEqual([
			'var(--chart-1)',
			'var(--chart-3)',
			'var(--chart-4)',
			'var(--chart-2)'
		]);
		expect(new Set(VEHICLE_COLORS).size).toBe(8);
	});

	test('a ninth vehicle wraps round the eight chart colours', () => {
		const ids = Array.from({ length: 9 }, (_, i) => `v${i}`);
		expect(buildVehicleColorMap(ids)['v8']).toBe(VEHICLE_COLORS[0]);
	});
});
