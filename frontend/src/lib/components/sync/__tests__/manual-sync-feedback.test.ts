import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '#lib/stores/offline.svelte.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

type SyncResultStub = {
	success: boolean;
	synced: number;
	failed: number;
	needsAttention: number;
	conflicts: unknown[];
	errors: string[];
};
const syncAll = vi.fn<() => Promise<SyncResultStub>>();
vi.mock('#lib/utils/sync/sync-manager.ts', () => {
	const store = <T>(value: T) => ({
		get current() {
			return value;
		}
	});
	return {
		syncManager: { setupAutoSync: vi.fn(), syncAll, retryParked: vi.fn() },
		fetchLastSyncTime: vi.fn(),
		syncConflicts: store<unknown[]>([]),
		lastBackupTime: store<Date | null>(null),
		lastSheetsSync: store<Date | null>(null),
		lastDataChangeTime: store<Date | null>(null),
		backupEnabled: store(false),
		sheetsSyncEnabled: store(false),
		providerNeedsAttention: store(false)
	};
});

const SyncStatusInline = (await import('../SyncStatusInline.svelte')).default;

const PENDING: OfflineExpense[] = [
	{
		id: 'pending',
		vehicleId: 'v1',
		tags: [],
		category: 'maintenance',
		amount: 42,
		date: '2026-01-05',
		timestamp: 0,
		synced: false,
		version: '3.0'
	}
];

function result(overrides: Partial<SyncResultStub>): SyncResultStub {
	return {
		success: true,
		synced: 0,
		failed: 0,
		needsAttention: 0,
		conflicts: [],
		errors: [],
		...overrides
	};
}

function messages(): string[] {
	return appStore.notifications.map(n => `${n.type}: ${n.message}`);
}

async function syncNow(): Promise<void> {
	render(SyncStatusInline);
	await fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }));
}

beforeEach(() => {
	vi.clearAllMocks();
	onlineStatus.current = true;
	syncState.current = 'idle';
	offlineExpenseQueue.current = PENDING;
	appStore.clearNotifications();
});

describe('SyncStatusInline — Sync Now tells the user what happened', () => {
	it('reports a failed delivery', async () => {
		syncAll.mockResolvedValueOnce(result({ success: false, failed: 1, errors: ['Server Error'] }));
		await syncNow();

		await waitFor(() =>
			expect(messages()).toContain("error: 1 expense couldn't sync. VROOM will retry.")
		);
	});

	it('reports every outcome of a mixed run, and no success', async () => {
		syncAll.mockResolvedValueOnce(
			result({ success: false, synced: 1, failed: 2, needsAttention: 2, conflicts: [{}] })
		);
		await syncNow();

		await waitFor(() =>
			expect(messages()).toEqual(
				expect.arrayContaining([
					"error: 2 expenses couldn't sync. VROOM will retry.",
					'warning: 2 expenses need attention — open expenses to fix them',
					'warning: 1 sync conflict to resolve'
				])
			)
		);
		expect(messages().some(m => m.startsWith('success:'))).toBe(false);
	});

	it('reports a sync that could not start at all, with its reason', async () => {
		syncAll.mockRejectedValueOnce(new Error('Sync already in progress'));
		await syncNow();

		await waitFor(() =>
			expect(
				messages().some(m => m.startsWith('error:') && m.includes('Sync already in progress'))
			).toBe(true)
		);
	});

	it('confirms a successful delivery', async () => {
		syncAll.mockResolvedValueOnce(result({ synced: 2 }));
		await syncNow();

		await waitFor(() => expect(messages()).toContain('success: 2 expenses synced'));
	});

	it('points at entries the server rejected', async () => {
		syncAll.mockResolvedValueOnce(result({ success: false, needsAttention: 1 }));
		await syncNow();

		await waitFor(() =>
			expect(messages()).toContain('warning: 1 expense needs attention — open expenses to fix it')
		);
	});
});
