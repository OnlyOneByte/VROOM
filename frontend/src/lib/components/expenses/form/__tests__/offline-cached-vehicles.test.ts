import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';

const { addNotification, getVehicles, getVehicle, getExpensesByVehicle } = vi.hoisted(() => ({
	addNotification: vi.fn(),
	getVehicles: vi.fn(),
	getVehicle: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
	getExpensesByVehicle: vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));
vi.mock('#lib/stores/app.svelte.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/stores/app.svelte.ts')>();
	return { appStore: Object.assign(actual.appStore, { addNotification }) };
});
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles, getVehicle } }));
vi.mock('#lib/services/expense-api.ts', () => ({ expenseApi: { getExpensesByVehicle } }));

const { onlineStatus } = await import('#lib/stores/offline.svelte.ts');
const { setOfflineQueueOwner } = await import('#lib/utils/offline-storage.ts');
const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

const CAMRY = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const storage = new Map<string, string>();
const localStorageMock = window.localStorage as unknown as {
	getItem: ReturnType<typeof vi.fn>;
	setItem: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
	vi.clearAllMocks();
	storage.clear();
	localStorageMock.getItem.mockImplementation((key: string) => storage.get(key) ?? null);
	localStorageMock.setItem.mockImplementation((key: string, value: string) => {
		storage.set(key, value);
	});
	setOfflineQueueOwner('u1');
});

afterEach(() => {
	onlineStatus.current = true;
	setOfflineQueueOwner(null);
});

describe('the expense form offline', () => {
	test('opens with the vehicles cached on the last online load, without an error', async () => {
		getVehicles.mockResolvedValueOnce([CAMRY]);
		const online = render(ExpenseForm);
		await screen.findByText(/2020 Toyota Camry/);
		online.unmount();

		onlineStatus.current = false;
		getVehicles.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		addNotification.mockClear();
		render(ExpenseForm);

		expect(await screen.findByText(/2020 Toyota Camry/)).toBeInTheDocument();
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(screen.queryByTestId('vehicles-load-error')).not.toBeInTheDocument();
		expect(screen.queryByTestId('vehicle-load-error')).not.toBeInTheDocument();
		expect(addNotification).not.toHaveBeenCalled();
	});

	test('online, a failed load still reports the error even with a cache', async () => {
		storage.set('vroom_offline_vehicles:u1', JSON.stringify([CAMRY]));
		getVehicles.mockRejectedValueOnce(new Error('boom'));

		render(ExpenseForm);

		expect(await screen.findByTestId('vehicles-load-error')).toBeInTheDocument();
	});

	test("never reads another user's cached vehicles", async () => {
		storage.set('vroom_offline_vehicles:someone-else', JSON.stringify([CAMRY]));
		onlineStatus.current = false;
		getVehicles.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		render(ExpenseForm);

		expect(await screen.findByTestId('vehicles-load-error')).toBeInTheDocument();
	});
});
