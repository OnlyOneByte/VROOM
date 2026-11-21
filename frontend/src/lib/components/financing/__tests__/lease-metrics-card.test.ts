import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { UnitPreferences, VehicleFinancing } from '#lib/types/index.ts';
import { makeLease, makeLoan } from './financing-fixtures';

const store = vi.hoisted(() => ({
	unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
}));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return null;
		},
		get unitPreferences() {
			return store.unitPreferences;
		}
	}
}));

import LeaseMetricsCard from '../LeaseMetricsCard.svelte';

const KM: UnitPreferences = { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' };

function mount(
	props: {
		financing?: VehicleFinancing;
		currentMileage?: number | null;
		initialMileage?: number | null;
		unitPreferences?: UnitPreferences;
	} = {}
) {
	return render(LeaseMetricsCard, {
		props: {
			financing: props.financing ?? makeLease(),
			currentMileage: props.currentMileage === undefined ? 25_000 : props.currentMileage,
			initialMileage: props.initialMileage === undefined ? 10_000 : props.initialMileage,
			unitPreferences: props.unitPreferences
		}
	});
}

function usageBar(): HTMLElement {
	return screen.getByRole('progressbar', { name: 'Mileage usage' });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2025, 5, 15, 12, 0, 0));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('LeaseMetricsCard', () => {
	test('shows miles driven against the term allowance with the usage percentage', () => {
		mount();
		expect(screen.getByRole('region', { name: 'Mileage' })).toBeTruthy();
		expect(screen.getByText(/15,000/)).toBeTruthy();
		expect(screen.getByText(/\/ 36,000\s+mi/)).toBeTruthy();
		expect(screen.getByText('42%')).toBeTruthy();
		expect(usageBar().getAttribute('aria-valuenow')).toBe(String((15_000 / 36_000) * 100));
	});

	test('shows the odometer reading against the odometer at which the allowance runs out', () => {
		mount();
		expect(screen.getByText('25,000')).toBeTruthy();
		expect(screen.getByText(/\/ 46,000 mi/)).toBeTruthy();
		expect(screen.getByText(/21,000 left/)).toBeTruthy();
	});

	test('an over-mileage lease caps usage at 100% with nothing left', () => {
		mount({ currentMileage: 50_000 });
		expect(screen.getByText('100%')).toBeTruthy();
		expect(screen.getByText(/^\s*0 left/)).toBeTruthy();
		expect(usageBar().getAttribute('aria-valuenow')).toBe('100');
	});

	test('a missing initial reading counts all odometer miles as driven', () => {
		mount({ currentMileage: 9_000, initialMileage: null });
		expect(screen.getByText('25%')).toBeTruthy();
		expect(screen.getAllByText(/\/ 36,000\s+mi/)).toHaveLength(2);
		expect(screen.getByText(/27,000 left/)).toBeTruthy();
	});

	test('uses the vehicle unit preferences for the distance label', () => {
		mount({ unitPreferences: KM });
		expect(screen.getByText(/\/ 36,000\s+km/)).toBeTruthy();
		expect(screen.queryByText(/\bmi\b/)).toBeNull();
	});

	test('falls back to the user settings units when the vehicle has none', () => {
		store.unitPreferences = { ...KM };
		try {
			mount();
			expect(screen.getByText(/\/ 46,000 km/)).toBeTruthy();
		} finally {
			store.unitPreferences = {
				distanceUnit: 'miles',
				volumeUnit: 'gallons_us',
				chargeUnit: 'kwh'
			};
		}
	});

	test.each<[string, { financing?: VehicleFinancing; currentMileage?: number | null }]>([
		['a loan', { financing: makeLoan({ mileageLimit: 12_000 }) }],
		['a lease without a mileage limit', { financing: makeLease({ mileageLimit: undefined }) }],
		['an unknown odometer', { currentMileage: null }],
		['a lease with an invalid start date', { financing: makeLease({ startDate: 'nope' }) }]
	])('renders nothing for %s', (_label, props) => {
		mount(props);
		expect(screen.queryByRole('region', { name: 'Mileage' })).toBeNull();
	});
});
