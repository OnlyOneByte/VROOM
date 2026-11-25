import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { DriverFigures, DriverStats } from '#lib/types/index.ts';

const stats = vi.fn<() => Promise<DriverStats | null>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: { stats: () => stats() }
}));

import DriversCard from '../DriversCard.svelte';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const figures = (name: string, total: number, extra: Partial<DriverFigures> = {}) => ({
	driverId: name,
	name,
	color: 'chart-1',
	archived: false,
	you: false,
	distance: { trips: total, estimated: 0, total },
	share: null,
	fuelBought: 0,
	fuelUsed: null,
	chargeBought: 0,
	chargeUsed: null,
	runningCostsPaid: 0,
	...extra
});

const mount = () =>
	render(DriversCard, {
		props: { vehicleId: 'car', distanceUnit: 'miles', from: new Date(0), to: new Date() }
	});

afterEach(() => {
	cleanup();
	stats.mockReset();
});

describe('DriversCard', () => {
	test('a manager sees every driver, their share, the unattributed rest and a described bar', async () => {
		stats.mockResolvedValue({
			scope: 'everyone',
			estimates: true,
			distance: { total: 1000, attributed: 900, unattributed: 100 },
			runningCosts: 300,
			costPerDistance: 0.3,
			drivers: [
				figures('Alex', 600, { you: true, share: 0.6667, runningCostsPaid: 84 }),
				figures('Sam', 300, { share: 0.3333 })
			]
		});
		mount();
		await settle();
		expect(screen.getByText('Drivers')).toBeTruthy();
		const label = screen.getByRole('img').getAttribute('aria-label');
		expect(label).toContain('Alex: 600 mi, 60% of the bar');
		expect(label).toContain('Unattributed: 100 mi, 10% of the bar');
		expect(screen.getByText('Unattributed')).toBeTruthy();
		expect(screen.getByText(/67% of the distance · \$84\.00 paid/)).toBeTruthy();
		expect(screen.getByText('(you)')).toBeTruthy();
	});

	test('a driver sees only their own row, with no bar and no share', async () => {
		stats.mockResolvedValue({
			scope: 'own',
			estimates: true,
			distance: null,
			runningCosts: null,
			costPerDistance: null,
			drivers: [figures('Sam', 300, { you: true })]
		});
		mount();
		await settle();
		expect(screen.getByText('Your driving')).toBeTruthy();
		expect(screen.queryByRole('img')).toBeNull();
		expect(screen.queryByText(/Unattributed/)).toBeNull();
	});

	test('without access the card stays out of the way', async () => {
		stats.mockResolvedValue(null);
		const { container } = mount();
		await settle();
		expect(container.textContent?.trim()).toBe('');
	});
});
