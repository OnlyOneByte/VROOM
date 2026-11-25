import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { onlineStatus, syncState, offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
import { authStore } from '#lib/stores/auth.svelte.ts';
import { providerNeedsAttention } from '#lib/utils/sync/sync-state.svelte.ts';
import type { User } from '#lib/types/index.ts';

vi.mock('#lib/utils/sync/sync-manager.ts', () => {
	const store = <T>(value: T) => ({
		get current() {
			return value;
		}
	});
	return {
		syncManager: { setupAutoSync: vi.fn(), syncAll: vi.fn(), retryParked: vi.fn() },
		fetchLastSyncTime: vi.fn(),
		syncConflicts: store<unknown[]>([]),
		lastBackupTime: store<Date | null>(new Date()),
		lastSheetsSync: store<Date | null>(null),
		lastDataChangeTime: store<Date | null>(null),
		backupEnabled: store(true),
		sheetsSyncEnabled: store(false)
	};
});

const SyncStatusInline = (await import('../SyncStatusInline.svelte')).default;

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

describe('SyncStatusInline — backup provider needs attention', () => {
	beforeEach(() => {
		authStore.setUser(alice);
		onlineStatus.current = true;
		syncState.current = 'idle';
		offlineExpenseQueue.current = [];
		providerNeedsAttention.current = false;
	});

	it('says a backup provider needs attention instead of Up to date, and links to the fix', () => {
		providerNeedsAttention.current = true;
		render(SyncStatusInline);

		expect(screen.getByRole('status')).toHaveTextContent('A backup provider needs attention');
		expect(screen.queryAllByText('Up to date')).toHaveLength(0);
		expect(screen.getByRole('link', { name: 'Fix in Settings' })).toHaveAttribute(
			'href',
			'/settings#storage-providers'
		);
	});

	it('keeps saying Up to date, with no fix link, while every provider is healthy', () => {
		render(SyncStatusInline);

		expect(screen.getByRole('status')).toHaveTextContent('Up to date');
		expect(screen.queryByRole('link', { name: 'Fix in Settings' })).toBeNull();
	});

	it('names the problem in the collapsed menu too', () => {
		providerNeedsAttention.current = true;
		render(SyncStatusInline, { isExpanded: false });

		expect(screen.getByRole('status')).toHaveTextContent('A backup provider needs attention');
		expect(screen.getByTitle('A backup provider needs attention')).toBeInTheDocument();
	});
});
