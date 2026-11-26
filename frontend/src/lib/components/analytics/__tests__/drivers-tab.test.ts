import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { DriverStats, Vehicle } from '#lib/types/index.ts';

const stats = vi.fn<(vehicleId: string) => Promise<DriverStats | null>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: { stats: (vehicleId: string) => stats(vehicleId) }
}));

import DriversTab from '../DriversTab.svelte';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const car = (id: string, nickname: string) =>
	({ id, make: 'Honda', model: 'Civic', year: 2021, nickname }) as Vehicle;

const range = { startDate: 1_700_000_000, endDate: 1_700_500_000, ytdStart: 1_690_000_000 };

const mount = (props: Partial<{ vehicles: Vehicle[]; preferredVehicleId: string }> = {}) =>
	render(DriversTab, {
		props: {
			vehicles: props.vehicles ?? [car('a', 'Family'), car('b', 'Work')],
			dateRange: range,
			rangeText: 'Last 12 months',
			preferredVehicleId: props.preferredVehicleId
		}
	});

afterEach(() => {
	cleanup();
	stats.mockReset();
});

describe('DriversTab', () => {
	test('opens on the preferred car and offers a picker when several cars share', async () => {
		stats.mockResolvedValue(null);
		mount({ preferredVehicleId: 'b' });
		await settle();
		expect(stats).toHaveBeenCalledWith('b');
		expect(screen.getByLabelText('Vehicle')).toBeTruthy();
	});

	test('says so when the figures for the chosen car are not yours to see', async () => {
		stats.mockResolvedValue(null);
		mount({ vehicles: [car('a', 'Family')] });
		await settle();
		expect(screen.getByText(/can't see driver figures for this car/)).toBeTruthy();
		expect(screen.queryByLabelText('Vehicle')).toBeNull();
	});

	test('a new date range object with the same dates asks for nothing again', async () => {
		stats.mockResolvedValue(null);
		const view = mount({ vehicles: [car('a', 'Family')] });
		await settle();
		await view.rerender({ dateRange: { ...range } });
		await settle();
		expect(stats).toHaveBeenCalledTimes(1);
	});
});
