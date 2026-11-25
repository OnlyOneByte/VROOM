import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Driver } from '#lib/types/index.ts';

const list = vi.fn<(vehicleId: string) => Promise<Driver[] | null>>();

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: { list: (vehicleId: string) => list(vehicleId) }
}));

import CarSharingCard from '../CarSharingCard.svelte';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

afterEach(() => {
	cleanup();
	list.mockReset();
});

describe('CarSharingCard', () => {
	test('loads the drivers once and lists guests with their actions', async () => {
		list.mockResolvedValue([
			{ id: 'd-1', userId: 'u-1', name: 'Sam', color: 'chart-1', archived: false },
			{ id: 'd-2', userId: null, name: 'Riley', color: 'chart-3', archived: false }
		]);
		render(CarSharingCard, { props: { vehicleId: 'car', enabled: true } });
		await settle();
		expect(list).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Rename Riley' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Rename Sam' })).toBeNull();
	});

	test('a failed load says so and can be retried', async () => {
		list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
		render(CarSharingCard, { props: { vehicleId: 'car', enabled: true } });
		await settle();
		expect(screen.getByRole('alert').textContent).toContain("Couldn't load the drivers.");
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await settle();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	test('with car sharing off it asks for nothing', async () => {
		render(CarSharingCard, { props: { vehicleId: 'car', enabled: false } });
		await settle();
		expect(list).not.toHaveBeenCalled();
	});
});
