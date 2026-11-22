import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import { makeVehicle } from './expense-form-fixtures';

const { addNotification, gotoDynamic, requestAutoSync, syncAll, online, storage } = vi.hoisted(
	() => ({
		addNotification: vi.fn(),
		gotoDynamic: vi.fn(() => Promise.resolve()),
		requestAutoSync: vi.fn(),
		syncAll: vi.fn(() => Promise.resolve({})),
		online: { current: true },
		storage: {
			findParkedExpense: vi.fn(),
			replaceParkedExpense: vi.fn(() => Promise.resolve('saved')),
			loadPendingPhotos: vi.fn(() => Promise.resolve([] as File[]))
		}
	})
);

vi.mock('#lib/stores/app.svelte.ts', () => ({ appStore: { addNotification } }));
vi.mock('#lib/utils/navigation.ts', () => ({ gotoDynamic }));
vi.mock('#lib/stores/offline.svelte.ts', () => ({
	onlineStatus: online,
	offlineExpenseQueue: { current: [] }
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({ syncManager: { requestAutoSync, syncAll } }));
vi.mock('#lib/utils/offline-storage.ts', () => ({
	...storage,
	cacheVehicleHistory: vi.fn(),
	cacheVehicles: vi.fn(),
	loadCachedVehicleHistory: vi.fn(() => null),
	loadCachedVehicles: vi.fn(() => [])
}));

const { ExpenseFormState } = await import('../expense-form-state.svelte');
const { loadQueuedExpense } = await import('../expense-form-loaders');
const { saveQueuedExpense, REQUEUE_FAILED_MESSAGE, REQUEUE_NOT_PARKED_MESSAGE } =
	await import('../requeue-expense');

const parked: OfflineExpense = {
	id: 'offline_1',
	clientId: 'client-1',
	vehicleId: 'v1',
	tags: ['fuel'],
	category: 'fuel',
	amount: 1_000_001,
	date: dateOnlyToISO('2025-03-10'),
	mileage: 31000,
	volume: 12.5,
	fuelType: '87 (Regular)',
	description: 'Shell',
	timestamp: 1,
	synced: false,
	needsAttention: true,
	attentionReason: 'Amount must be 1,000,000 or less'
};

function newState() {
	return new ExpenseFormState({ expenseId: undefined, returnTo: '/expenses' }, true);
}

beforeEach(() => {
	vi.clearAllMocks();
	online.current = true;
	storage.findParkedExpense.mockReturnValue(parked);
	storage.replaceParkedExpense.mockResolvedValue('saved');
});

describe('loadQueuedExpense', () => {
	test('prefills the form from the parked entry and its saved photos', async () => {
		const photo = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
		storage.loadPendingPhotos.mockResolvedValueOnce([photo]);
		const state = newState();

		await loadQueuedExpense(state, 'offline_1');

		expect(state.queuedExpense).toEqual(parked);
		expect(state.formData).toMatchObject({
			vehicleId: 'v1',
			category: 'fuel',
			amount: '1000001',
			date: '2025-03-10',
			mileage: '31000',
			volume: '12.5',
			fuelType: '87 (Regular)',
			description: 'Shell'
		});
		expect(state.pendingFiles).toEqual([photo]);
		expect(storage.loadPendingPhotos).toHaveBeenCalledWith('client-1');
	});

	test('an entry that is gone says so and goes back', async () => {
		storage.findParkedExpense.mockReturnValue(undefined);
		const state = newState();

		await loadQueuedExpense(state, 'offline_gone');

		expect(state.queuedExpense).toBeNull();
		expect(addNotification).toHaveBeenCalledWith({
			type: 'error',
			message: 'That entry is no longer waiting to sync.'
		});
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
	});
});

describe('saveQueuedExpense', () => {
	async function loadedState() {
		const state = newState();
		await loadQueuedExpense(state, 'offline_1');
		state.vehicle = makeVehicle('v1');
		state.isLoading = false;
		return state;
	}

	test('the form still blocks the amount the server rejected', async () => {
		const state = await loadedState();

		await saveQueuedExpense(state);

		expect(state.errors['amount']).toBe('Amount must be 1,000,000 or less');
		expect(storage.replaceParkedExpense).not.toHaveBeenCalled();
	});

	test('a fixed entry replaces the parked one, asks for a sync and goes back', async () => {
		const state = await loadedState();
		state.formData.amount = '45.10';

		await saveQueuedExpense(state);

		expect(storage.replaceParkedExpense).toHaveBeenCalledWith(
			'offline_1',
			expect.objectContaining({ vehicleId: 'v1', category: 'fuel', amount: 45.1, volume: 12.5 }),
			[]
		);
		expect(syncAll).toHaveBeenCalledWith({ skipConflicted: true });
		expect(addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: 'Entry updated. Syncing it now.'
		});
		expect(gotoDynamic).toHaveBeenCalledWith('/expenses');
		expect(state.isSubmitting).toBe(false);
	});

	test('offline, it says the entry will sync later', async () => {
		online.current = false;
		const state = await loadedState();
		state.formData.amount = '45.10';

		await saveQueuedExpense(state);

		expect(addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: "Entry updated. It will sync when you're back online."
		});
		expect(syncAll).not.toHaveBeenCalled();
		expect(requestAutoSync).toHaveBeenCalled();
	});

	test('a sync already running hands the entry to the auto-sync instead', async () => {
		syncAll.mockRejectedValueOnce(new Error('Sync already in progress'));
		const state = await loadedState();
		state.formData.amount = '45.10';

		await saveQueuedExpense(state);
		await vi.waitFor(() => expect(requestAutoSync).toHaveBeenCalled());
	});

	test('a failed write stays on the form with an error', async () => {
		storage.replaceParkedExpense.mockResolvedValue('failed');
		const state = await loadedState();
		state.formData.amount = '45.10';

		await saveQueuedExpense(state);

		expect(state.submitError).toBe(REQUEUE_FAILED_MESSAGE);
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(syncAll).not.toHaveBeenCalled();
	});

	test('a retry that fails validation clears the earlier refusal', async () => {
		storage.replaceParkedExpense.mockResolvedValue('failed');
		const state = await loadedState();
		state.formData.amount = '45.10';
		await saveQueuedExpense(state);
		expect(state.submitError).toBe(REQUEUE_FAILED_MESSAGE);

		state.formData.amount = '';
		await saveQueuedExpense(state);

		expect(state.submitError).toBeNull();
		expect(storage.replaceParkedExpense).toHaveBeenCalledTimes(1);
	});

	test('an entry that started syncing meanwhile keeps the form open and says so', async () => {
		storage.replaceParkedExpense.mockResolvedValue('not-parked');
		const state = await loadedState();
		state.formData.amount = '45.10';

		await saveQueuedExpense(state);

		expect(state.submitError).toBe(REQUEUE_NOT_PARKED_MESSAGE);
		expect(addNotification).toHaveBeenCalledWith({
			type: 'error',
			message: REQUEUE_NOT_PARKED_MESSAGE
		});
		expect(gotoDynamic).not.toHaveBeenCalled();
		expect(syncAll).not.toHaveBeenCalled();
	});

	test("offline, the entry's own queued copy doesn't block a new date or mileage", async () => {
		const state = await loadedState();
		state.formData.amount = '45.10';
		state.formData.date = '2025-03-12';
		state.formData.mileage = '30900';
		state.allVehicleExpenses = [
			{ ...parked, date: '2025-03-10', tags: [] } as never,
			{ id: 'earlier', date: '2025-03-01', mileage: 30000 } as never
		];

		expect(state.validateForm()).toBe(true);

		state.formData.mileage = '29000';
		expect(state.validateForm()).toBe(false);
		expect(state.errors['mileage']).toContain('greater than 30,000');
	});
});
