// A parked row must not count as pending: the sync loop skips it, so a badge counting it would never clear.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '$lib/stores/offline.svelte';
import type { OfflineExpense } from '$lib/utils/offline-storage';

vi.mock('svelte', () => import('../../../../../node_modules/svelte/src/index-client.js' as string));

const syncOfflineExpenses = vi.fn(async () => {});
vi.mock('$lib/utils/offline-storage', () => ({ syncOfflineExpenses }));

const setupAutoSync = vi.fn();
const syncAll = vi.fn(async () => ({ success: true, conflicts: [] }));
vi.mock('$lib/utils/sync/sync-manager', () => {
	const store = <T>(value: T) => ({
		get current() {
			return value;
		}
	});
	return {
		syncManager: { setupAutoSync, syncAll },
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
