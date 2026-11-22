import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Vehicle } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

const CAMRY: Vehicle = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve([CAMRY])),
		getVehicle: vi.fn(() => Promise.resolve(CAMRY))
	}
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: { getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] })) }
}));

const PARKED: OfflineExpense = {
	id: 'offline_1',
	clientId: 'client-1',
	vehicleId: 'v1',
	tags: [],
	category: 'maintenance',
	amount: 1_000_001,
	date: '2026-06-10T12:00:00.000Z',
	timestamp: 1,
	synced: false,
	needsAttention: true,
	attentionReason: 'Amount must be 1,000,000 or less'
};

const loadPendingPhotos = vi.fn<(clientId: string) => Promise<File[]>>();
vi.mock('#lib/utils/offline-storage.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/utils/offline-storage.ts')>()),
	findParkedExpense: vi.fn(() => PARKED),
	loadPendingPhotos
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

function retryButton(): HTMLElement {
	return screen.getByRole('button', {
		name: 'Retry',
		description: /Couldn't load this entry's photos/
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	loadPendingPhotos.mockRejectedValueOnce(new Error('photo store unavailable'));
});

describe('Retry on the unreadable-photos note', () => {
	test('a Retry that fails says so and keeps focus on Retry', async () => {
		render(ExpenseForm, { props: { queuedExpenseId: 'offline_1' } });
		const retry = await vi.waitFor(retryButton);
		loadPendingPhotos.mockRejectedValueOnce(new Error('still unavailable'));

		retry.focus();
		await fireEvent.click(retry);

		await screen.findByText("Still couldn't load them. Try again in a moment.");
		expect(screen.getByRole('status').textContent).toContain('Still couldn');
		expect(document.activeElement).toBe(retryButton());
	});

	test('a second failed Retry in a row is announced again', async () => {
		render(ExpenseForm, { props: { queuedExpenseId: 'offline_1' } });
		const retry = await vi.waitFor(retryButton);
		loadPendingPhotos.mockRejectedValueOnce(new Error('still unavailable'));
		await fireEvent.click(retry);
		await screen.findByText("Still couldn't load them. Try again in a moment.");
		const status = screen.getByRole('status');
		const texts: string[] = [];
		const observer = new MutationObserver(() => texts.push(status.textContent?.trim() ?? ''));
		observer.observe(status, { childList: true, characterData: true, subtree: true });
		loadPendingPhotos.mockRejectedValueOnce(new Error('still unavailable'));

		await fireEvent.click(retryButton());

		await vi.waitFor(() => expect(texts.at(-1)).toContain('Still couldn'));
		observer.disconnect();
		expect(texts).toContain('');
	});

	test('a Retry that works brings the photo picker back and moves focus into it', async () => {
		render(ExpenseForm, { props: { queuedExpenseId: 'offline_1' } });
		const retry = await vi.waitFor(retryButton);
		loadPendingPhotos.mockResolvedValueOnce([]);

		retry.focus();
		await fireEvent.click(retry);

		await vi.waitFor(() => expect(screen.queryByTestId('queued-photos-unreadable')).toBeNull());
		await vi.waitFor(() =>
			expect((document.activeElement as HTMLElement).textContent?.trim()).toBe('Add')
		);
	});
});
