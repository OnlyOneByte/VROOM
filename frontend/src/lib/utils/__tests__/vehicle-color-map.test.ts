import { describe, expect, test } from 'vitest';
import { buildVehicleColorMap, CHART_COLORS } from '../chart-colors.ts';

describe('buildVehicleColorMap', () => {
	test('a vehicle gets the same colour whatever order the ids arrive in', () => {
		const a = buildVehicleColorMap(['civic', 'camry', 'model3']);
		const b = buildVehicleColorMap(['model3', 'civic', 'camry', 'civic']);
		expect(a).toEqual(b);
		expect(a).toEqual({ camry: CHART_COLORS[0], civic: CHART_COLORS[1], model3: CHART_COLORS[2] });
	});

	test('a ninth vehicle wraps round the eight chart colours', () => {
		const ids = Array.from({ length: 9 }, (_, i) => `v${i}`);
		expect(buildVehicleColorMap(ids)['v8']).toBe(CHART_COLORS[0]);
	});
});
