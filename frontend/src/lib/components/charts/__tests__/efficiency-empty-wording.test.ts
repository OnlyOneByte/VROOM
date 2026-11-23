import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import FuelEfficiencyTrendChart from '../FuelEfficiencyTrendChart.svelte';
import type { UnitPreferences } from '#lib/types/index.ts';

const UNITS: UnitPreferences = {
	distanceUnit: 'miles',
	volumeUnit: 'gallons_us',
	chargeUnit: 'kwh'
};

describe('FuelEfficiencyTrendChart empty state', () => {
	test.each([
		['electric', 'No efficiency trend yet', /isn't charted for electric vehicles yet/],
		['gas', 'Insufficient fuel data', /fuel entries with mileage and volume/],
		['hybrid', 'Insufficient fuel data', /fuel entries with mileage and volume/]
	] as const)(
		'a %s vehicle gets wording that fits its data',
		async (fuelType, title, description) => {
			render(FuelEfficiencyTrendChart, { props: { data: [], fuelType, unitPreferences: UNITS } });

			expect(await screen.findByText(title)).toBeTruthy();
			expect(screen.getByText(description)).toBeTruthy();
		}
	);
});
