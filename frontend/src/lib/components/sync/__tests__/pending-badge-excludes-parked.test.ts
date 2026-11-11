// A parked row must not count as pending: the sync loop skips it, so a badge counting it would never clear.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '$lib/stores/offline.svelte';
import { appStore } from '$lib/stores/app.svelte';
import type { OfflineExpense } from '$lib/utils/offline-storage';

const setupAutoSync = vi.fn();
type SyncResultStub = { synced: number; needsAttention: number };
const syncAll = vi.fn(async () => ({ success: true, conflicts: [] }));
const retryParked = vi.fn(async (): Promise<SyncResultStub> => ({ synced: 0, needsAttention: 0 }));
vi.mock('$lib/utils/sync/sync-manager', () => {
	const store = <T>(value: T) => ({
		get current() {
			return value;
		}
	});
	return {
		syncManager: { setupAutoSync, syncAll, retryParked },
		fetchLastSyncTime: vi.fn(),
		syncConflicts: store<unknown[]>([]),
		lastBackupTime: store<Date | null>(null),
		lastSheetsSync: store<Date | null>(null),
		lastDataChangeTime: store<Date | null>(null),
		backupEnabled: store(false),
		sheetsSyncEnabled: store(false)
	};
});

const OfflineIndicator = (await import('../OfflineIndicator.svelte')).default;
const SyncStatusInline = (await import('../SyncStatusInline.svelte')).default;

function row(overrides: Partial<OfflineExpense> & { id: string }): OfflineExpense {
	return {
		vehicleId: 'v1',
		tags: [],
		category: 'maintenance',
		amount: 42,
		date: '2026-01-05',
		timestamp: 1_767_600_000_000,
		synced: false,
		version: '3.0',
		...overrides
	};
}

const PARKED = [row({ id: 'parked', needsAttention: true, attentionReason: 'server said no' })];
const PENDING = [row({ id: 'pending' })];

beforeEach(() => {
	vi.clearAllMocks();
	onlineStatus.current = true;
	syncState.current = 'idle';
	offlineExpenseQueue.current = [];
	appStore.clearNotifications();
});

describe('OfflineIndicator', () => {
	it('offers no sync control when the only unsynced row is parked', () => {
		offlineExpenseQueue.current = PARKED;
		render(OfflineIndicator);

		expect(screen.queryByRole('button', { name: /sync/i })).toBeNull();
	});

	it('still offers one for a genuinely pending row', () => {
		offlineExpenseQueue.current = PENDING;
		render(OfflineIndicator);

		expect(screen.getByRole('button', { name: /sync 1/i })).toBeInTheDocument();
	});

	it('delivers through SyncManager when the sync control is pressed', async () => {
		offlineExpenseQueue.current = PENDING;
		render(OfflineIndicator);

		await fireEvent.click(screen.getByRole('button', { name: /sync 1/i }));

		expect(syncAll).toHaveBeenCalledTimes(1);
	});

	it('surfaces a refused sync instead of swallowing it', async () => {
		offlineExpenseQueue.current = PENDING;
		syncAll.mockRejectedValueOnce(new Error('Sync already in progress'));
		render(OfflineIndicator);

		await fireEvent.click(screen.getByRole('button', { name: /sync 1/i }));

		await waitFor(() =>
			expect(appStore.notifications.at(-1)).toMatchObject({
				type: 'error',
				message: expect.stringContaining('Sync already in progress')
			})
		);
	});
});

describe('SyncStatusInline', () => {
	it('reports a parked row as needing attention, not as pending sync', () => {
		offlineExpenseQueue.current = PARKED;
		render(SyncStatusInline, { props: { isExpanded: true } });

		expect(screen.queryByText('Pending')).toBeNull();
		expect(screen.queryByRole('button', { name: /sync now/i })).toBeNull();
		expect(screen.getByText('Needs attention')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /1 expense needs attention/i })).toHaveAttribute(
			'href',
			'/expenses'
		);
	});

	it('still reports a genuinely pending row as pending, with a sync control', () => {
		offlineExpenseQueue.current = PENDING;
		render(SyncStatusInline, { props: { isExpanded: true } });

		expect(screen.getByText('Pending')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /sync now/i })).toBeInTheDocument();
		expect(screen.queryByText('Needs attention')).toBeNull();
	});
});

describe('SyncStatusInline — retrying parked rows', () => {
	const retryButton = () => screen.getByRole('button', { name: /retry 1 needing attention/i });

	it('offers no retry when nothing is parked', () => {
		offlineExpenseQueue.current = PENDING;
		render(SyncStatusInline, { props: { isExpanded: true } });

		expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
	});

	it('offers no retry while offline, since the re-send could not run', () => {
		onlineStatus.current = false;
		offlineExpenseQueue.current = PARKED;
		render(SyncStatusInline, { props: { isExpanded: true } });

		expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
	});

	it('re-admits and re-sends parked rows, showing progress while it runs', async () => {
		offlineExpenseQueue.current = PARKED;
		let finish: (r: SyncResultStub) => void = () => {};
		retryParked.mockImplementationOnce(
			() => new Promise<SyncResultStub>(resolve => (finish = resolve))
		);
		render(SyncStatusInline, { props: { isExpanded: true } });

		await fireEvent.click(retryButton());

		expect(retryParked).toHaveBeenCalledTimes(1);
		const busy = screen.getByRole('button', { name: /retrying/i });
		expect(busy).toBeDisabled();
		expect(busy).toHaveAttribute('aria-busy', 'true');

		offlineExpenseQueue.current = [];
		finish({ synced: 1, needsAttention: 0 });

		await waitFor(() =>
			expect(appStore.notifications.at(-1)).toMatchObject({
				type: 'success',
				message: '1 expense synced'
			})
		);
	});

	it('tells the user when a row is still rejected after the retry', async () => {
		offlineExpenseQueue.current = PARKED;
		retryParked.mockResolvedValueOnce({ synced: 0, needsAttention: 1 });
		render(SyncStatusInline, { props: { isExpanded: true } });

		await fireEvent.click(retryButton());

		await waitFor(() =>
			expect(appStore.notifications.at(-1)).toMatchObject({
				type: 'warning',
				message: expect.stringMatching(/still needs attention/i)
			})
		);
		expect(retryButton()).toBeEnabled();
	});

	it('reports a failed retry and re-enables the control', async () => {
		offlineExpenseQueue.current = PARKED;
		retryParked.mockRejectedValueOnce(new Error('Cannot sync while offline'));
		render(SyncStatusInline, { props: { isExpanded: true } });

		await fireEvent.click(retryButton());

		await waitFor(() =>
			expect(appStore.notifications.at(-1)).toMatchObject({
				type: 'error',
				message: expect.stringContaining('Cannot sync while offline')
			})
		);
		expect(retryButton()).toBeEnabled();
	});
});
