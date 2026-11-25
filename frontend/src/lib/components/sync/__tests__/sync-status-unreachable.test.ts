import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { onlineStatus, syncState, offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
import { authStore } from '#lib/stores/auth.svelte.ts';
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
		lastBackupTime: store<Date | null>(null),
		lastSheetsSync: store<Date | null>(null),
		lastDataChangeTime: store<Date | null>(null),
		backupEnabled: store(false),
		sheetsSyncEnabled: store(false),
		providerNeedsAttention: store(false)
	};
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

const SyncStatusInline = (await import('../SyncStatusInline.svelte')).default;

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

describe('SyncStatusInline — server unreachable', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		onlineStatus.current = true;
		syncState.current = 'idle';
		offlineExpenseQueue.current = [];
	});

	it("says Can't reach VROOM, not Up to date, while the session is unverified", async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await authStore.initialize();

		render(SyncStatusInline);

		expect(screen.getByRole('status')).toHaveTextContent("Can't reach VROOM");
		expect(screen.queryAllByText('Up to date')).toHaveLength(0);
	});

	it('says Up to date once the server answers', () => {
		authStore.setUser(alice);

		render(SyncStatusInline);

		expect(screen.getByRole('status')).toHaveTextContent('Up to date');
	});

	it('reads the full status but only speaks connection changes, not the steps of a background sync', async () => {
		authStore.setUser(alice);
		render(SyncStatusInline);
		const status = screen.getByRole('status');
		const spoken = screen.getByTestId('sync-status-announcement');

		expect(status).toHaveAttribute('aria-live', 'off');
		expect(spoken).toHaveAttribute('aria-live', 'polite');
		for (const [step, text] of [
			['syncing', 'Syncing...'],
			['success', 'Synced'],
			['error', 'Sync failed']
		] as const) {
			syncState.current = step;
			await Promise.resolve();
			expect(status).toHaveTextContent(text);
			expect(spoken).toHaveTextContent('Up to date');
		}
		onlineStatus.current = false;
		await Promise.resolve();
		expect(spoken).toHaveTextContent('Offline');
	});
});
