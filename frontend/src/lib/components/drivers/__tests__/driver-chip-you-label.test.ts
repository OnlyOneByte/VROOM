import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { Driver } from '#lib/types/index.ts';

const DRIVERS: Driver[] = [
	{ id: 'd-me', userId: 'u-me', guest: false, name: 'Alex', color: 'chart-1', archived: false },
	{ id: 'd-sam', guest: false, name: 'Sam', color: 'chart-2', archived: false },
	{ id: 'd-riley', guest: true, name: 'Riley', color: 'chart-3', archived: false }
];

vi.mock('#lib/services/driver-api.ts', () => ({
	driverApi: { list: () => Promise.resolve(DRIVERS) }
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicle: vi.fn() } }));

import { authStore } from '#lib/stores/auth.svelte.ts';
import DriverChip from '../DriverChip.svelte';

const settle = async () => {
	for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

async function optionText(): Promise<string[]> {
	render(DriverChip, { props: { vehicleId: 'car', value: undefined, id: 'drv', sharing: true } });
	await settle();
	await fireEvent.click(screen.getByRole('combobox'));
	await settle();
	return screen.getAllByRole('option').map(o => o.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

afterEach(() => {
	cleanup();
	authStore.clearUser();
	localStorage.clear();
});

describe('DriverChip "(you)" label', () => {
	test('marks only the signed-in account’s own driver', async () => {
		authStore.setUser({
			id: 'u-me',
			email: 'me@example.com',
			displayName: 'Alex',
			createdAt: '2026-01-01T00:00:00Z',
			updatedAt: '2026-01-01T00:00:00Z'
		});
		const options = await optionText();
		expect(options.filter(o => o.includes('(you)'))).toEqual(['Alex (you)']);
		expect(options).toContain('Riley · guest');
	});

	test('marks nobody as you before the account is known, and still marks the guest', async () => {
		const options = await optionText();
		expect(options.some(o => o.includes('(you)'))).toBe(false);
		expect(options).toContain('Riley · guest');
	});
});
