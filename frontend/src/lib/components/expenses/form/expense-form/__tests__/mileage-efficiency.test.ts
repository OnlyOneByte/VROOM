import { describe, expect, test } from 'vitest';
import { calculateMileageEfficiency, type MileageEfficiencyInput } from '../mileage-efficiency';

const GAS_FILL: MileageEfficiencyInput = {
	category: 'fuel',
	mileage: '1300',
	previousMileage: 1000,
	fuelType: '87 (Regular)',
	volume: '10',
	charge: '',
	distanceUnit: 'miles',
	volumeUnit: 'gallons_us'
};

const HIDDEN = { calculatedMpg: null, calculatedEfficiency: null, showMpgCalculation: false };

describe('calculateMileageEfficiency', () => {
	test('a fuel fill reports MPG from the miles since the previous fuel entry', () => {
		expect(calculateMileageEfficiency(GAS_FILL)).toEqual({
			calculatedMpg: 30,
			calculatedEfficiency: null,
			showMpgCalculation: true
		});
	});

	test('an electric charge reports efficiency from the charge instead of volume', () => {
		expect(
			calculateMileageEfficiency({
				...GAS_FILL,
				fuelType: 'Electric',
				volume: '',
				charge: '40'
			})
		).toEqual({ calculatedMpg: null, calculatedEfficiency: 7.5, showMpgCalculation: true });
	});

	test('rounds to two decimal places', () => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, volume: '3' })?.calculatedMpg).toBe(100);
		expect(
			calculateMileageEfficiency({ ...GAS_FILL, mileage: '1100', volume: '3' })?.calculatedMpg
		).toBe(33.33);
	});

	test.each([
		['below 5 MPG', { mileage: '1010', volume: '3' }],
		['above 100 MPG', { mileage: '1400', volume: '3' }]
	])('a fill %s hides the calculation, as the fuel stats skip it', (_label, overrides) => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, ...overrides })).toEqual(HIDDEN);
	});

	test('applies the MPG bounds in the vehicle units', () => {
		const metric = { ...GAS_FILL, distanceUnit: 'kilometers', volumeUnit: 'liters' } as const;
		expect(
			calculateMileageEfficiency({ ...metric, mileage: '1500', volume: '40' })?.calculatedMpg
		).toBe(12.5);
		expect(calculateMileageEfficiency({ ...metric, mileage: '1500', volume: '2' })).toEqual(HIDDEN);
	});

	test('a charge outside 1 to 10 miles per kWh hides the calculation', () => {
		const ev = { ...GAS_FILL, fuelType: 'Electric', volume: '' };
		expect(calculateMileageEfficiency({ ...ev, charge: '400' })).toEqual(HIDDEN);
		expect(calculateMileageEfficiency({ ...ev, charge: '20' })).toEqual(HIDDEN);
	});

	test('a reading at or below the previous odometer hides the calculation', () => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, mileage: '1000' })).toEqual(HIDDEN);
	});

	test('a fill with no quantity for the active energy field hides the calculation', () => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, volume: '' })?.showMpgCalculation).toBe(false);
	});

	test('a non-fuel category is not calculated, so the existing figures are left alone', () => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, category: 'maintenance' })).toBeNull();
	});

	test('no previous fuel reading leaves the existing figures alone', () => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, previousMileage: null })).toBeNull();
		expect(calculateMileageEfficiency({ ...GAS_FILL, previousMileage: undefined })).toBeNull();
		expect(calculateMileageEfficiency({ ...GAS_FILL, previousMileage: 0 })).toBeNull();
	});

	test('an empty mileage leaves the existing figures alone', () => {
		expect(calculateMileageEfficiency({ ...GAS_FILL, mileage: '' })).toBeNull();
	});
});
