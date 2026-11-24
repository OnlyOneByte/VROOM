import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '#lib/stores/offline.svelte.ts';
import { authStore } from '#lib/stores/auth.svelte.ts';
import type { User } from '#lib/types/index.ts';
import type { UserSettings } from '#lib/types/settings.ts';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { onWideScreen } from './wide-screen.ts';

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
		sheetsSyncEnabled: store(false)
	};
});

const getProviders = vi.fn();
vi.mock('#lib/services/provider-api.ts', () => ({ providerApi: { getProviders } }));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const Navigation = (await import('../Navigation.svelte')).default;

const LAYOUT_SRC = readFileSync(`${process.cwd()}/src/routes/+layout.svelte`, 'utf8');

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

function me(): Response {
	return new Response(
		JSON.stringify({
			success: true,
			data: { user: alice, session: { id: 's', expiresAt: '2099' } }
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

async function startWithUnreachableServer(): Promise<void> {
	localStorage.setItem('vroom_last_user', JSON.stringify(alice));
	mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
	await authStore.initialize();
}

function mobileHeader(): HTMLElement {
	const header = document.querySelector<HTMLElement>('header.fixed.top-0');
	if (!header) throw new Error('mobile header not rendered');
	return header;
}

describe('the sync status indicator lives in the navigation, never floating over a page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getProviders.mockResolvedValue([]);
		settingsStore.reset();
		authStore.clearUser();
		onlineStatus.current = true;
		syncState.current = 'idle';
		offlineExpenseQueue.current = [];
	});

	it('renders inside the mobile header row, not as a fixed overlay', async () => {
		await startWithUnreachableServer();
		render(Navigation);

		const header = mobileHeader();
		expect(within(header).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect(document.querySelector('div.fixed.top-4.right-4')).toBeNull();
	});

	describe('at lg and up, behind the sync status in the header', () => {
		onWideScreen();

		async function openSyncPanel(): Promise<HTMLElement> {
			await fireEvent.click(screen.getByRole('button', { name: /^Sync status:/ }));
			return screen.findByRole('dialog', { name: 'Sync status' });
		}

		it('offers Retry connection, which re-checks the session', async () => {
			await startWithUnreachableServer();
			render(Navigation);

			const panel = await openSyncPanel();
			const retry = within(panel).getByRole('button', { name: 'Retry connection' });

			mockFetch.mockReset();
			mockFetch.mockResolvedValue(me());
			await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'));
			await fireEvent.click(retry);

			await waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		});

		it('offers Sync Now, with the pending count on the status badge', async () => {
			authStore.setUser(alice);
			offlineExpenseQueue.current = [
				{
					id: 'p1',
					vehicleId: 'v1',
					tags: [],
					category: 'misc',
					amount: 1,
					date: '2024-06-01',
					timestamp: 0,
					synced: false,
					version: '3.0'
				}
			];
			render(Navigation);

			expect(screen.getByLabelText('1 pending items')).toHaveTextContent('1');
			const panel = await openSyncPanel();
			await fireEvent.click(within(panel).getByRole('button', { name: 'Sync Now' }));
			const { syncManager } = await import('#lib/utils/sync/sync-manager.ts');
			expect(syncManager.syncAll).toHaveBeenCalled();
		});

		it('announces the status as a status with its text', async () => {
			await startWithUnreachableServer();
			render(Navigation);

			const statuses = screen.getAllByRole('status');
			expect(statuses.some(status => status.textContent === "Can't reach VROOM")).toBe(true);
		});
	});

	describe('a backup provider that needs reconnecting', () => {
		onWideScreen();

		beforeEach(() => {
			authStore.setUser(alice);
			vi.spyOn(settingsStore, 'settings', 'get').mockReturnValue({
				backupConfig: {
					providers: {
						drive: { enabled: true, folderPath: '/VROOM', retentionCount: 10 },
						spare: { enabled: false, folderPath: '/VROOM', retentionCount: 10 }
					}
				}
			} as unknown as UserSettings);
		});

		afterEach(() => vi.restoreAllMocks());

		it('is never reported as Up to date, and the panel links to Storage Providers', async () => {
			getProviders.mockResolvedValue([{ id: 'drive', status: 'needs_reauth' }]);
			render(Navigation);

			const trigger = await screen.findByRole('button', {
				name: 'Sync status: A backup provider needs attention'
			});
			expect(screen.queryByText('Up to date')).toBeNull();
			expect(getProviders).toHaveBeenCalledWith('storage');

			await fireEvent.click(trigger);
			const panel = await screen.findByRole('dialog', { name: 'Sync status' });
			expect(
				within(panel).getByRole('link', { name: 'Fix it in Settings → Storage Providers' })
			).toHaveAttribute('href', '/settings#settings-connections');
		});

		it('ignores an unhealthy provider that has backups and Sheets sync off', async () => {
			getProviders.mockResolvedValue([
				{ id: 'drive', status: 'active' },
				{ id: 'spare', status: 'error' }
			]);
			render(Navigation);

			await waitFor(() => expect(getProviders).toHaveBeenCalled());
			expect(
				await screen.findByRole('button', { name: 'Sync status: Up to date' })
			).toBeInTheDocument();
		});
	});

	it('the root layout floats the indicator only on pages without the navigation', () => {
		expect(LAYOUT_SRC).toMatch(/\{#if !showNavigation\}\s*<OfflineIndicator \/>\s*\{\/if\}/);
	});
});
