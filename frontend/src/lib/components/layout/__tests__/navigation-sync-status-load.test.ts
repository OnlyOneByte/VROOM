import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { authStore } from '#lib/stores/auth.svelte.ts';
import type { User } from '#lib/types/index.ts';
import { onWideScreen } from './wide-screen.ts';

const { panelRequested } = vi.hoisted(() => ({ panelRequested: vi.fn() }));

vi.mock('$app/state', () => ({
	get page() {
		return { url: new URL('http://localhost/dashboard') };
	}
}));

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
		backupEnabled: store(true),
		sheetsSyncEnabled: store(false),
		providerNeedsAttention: store(false)
	};
});

vi.mock('../../sync/SyncStatusInline.svelte', async importOriginal => {
	panelRequested();
	if (panelRequested.mock.calls.length === 1) throw new Error('chunk failed to load');
	return importOriginal();
});

const Navigation = (await import('../Navigation.svelte')).default;

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

describe('the sync status panel loading on demand', () => {
	onWideScreen();

	it('shows a retryable error when its code fails to load, and loads on the next open', async () => {
		authStore.setUser(alice);
		render(Navigation);
		const trigger = screen.getByRole('button', { name: /^Sync status:/ });
		expect(panelRequested).not.toHaveBeenCalled();

		await fireEvent.click(trigger);
		const panel = await screen.findByRole('dialog', { name: 'Sync status' });
		expect(await within(panel).findByText("Couldn't load sync status")).toBeInTheDocument();
		expect(within(panel).getByRole('button', { name: /Retry/ })).toBeInTheDocument();

		await fireEvent.keyDown(panel, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		await fireEvent.click(trigger);
		const reopened = await screen.findByRole('dialog', { name: 'Sync status' });
		expect(await within(reopened).findByText('Connection')).toBeInTheDocument();
		expect(panelRequested).toHaveBeenCalledTimes(2);
	});
});
