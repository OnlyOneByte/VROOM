import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { offlineExpenseQueue, onlineStatus, syncState } from '#lib/stores/offline.svelte.ts';
import { authStore } from '#lib/stores/auth.svelte.ts';
import type { User } from '#lib/types/index.ts';
import { onWideScreen } from './wide-screen.ts';

vi.mock('$app/state', () => ({
	get page() {
		return { url: new URL('http://localhost/dashboard') };
	}
}));

const attention = { current: false };

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
		providerNeedsAttention: attention
	};
});

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
		attention.current = false;
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
			const retry = await within(panel).findByRole('button', { name: 'Retry connection' });

			mockFetch.mockReset();
			mockFetch.mockResolvedValue(me());
			await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'));
			await fireEvent.click(retry);

			await waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		});

		it('offers Sync now, with the pending count on the status badge', async () => {
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
			await fireEvent.click(await within(panel).findByRole('button', { name: 'Sync now' }));
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

		beforeEach(() => authStore.setUser(alice));

		it('is never reported as Up to date, and the panel links to Backups and storage', async () => {
			attention.current = true;
			render(Navigation);

			const trigger = screen.getByRole('button', {
				name: 'Sync status: Backup storage needs attention'
			});
			expect(screen.queryByText('Up to date')).toBeNull();
			expect(screen.getByTestId('sync-status-announcement')).toHaveTextContent(
				'Backup storage needs attention'
			);

			await fireEvent.click(trigger);
			const panel = await screen.findByRole('dialog', { name: 'Sync status' });
			expect(
				await within(panel).findByRole('link', { name: 'Fix it in Settings → Backups and storage' })
			).toHaveAttribute('href', '/settings/storage');
		});

		it('reads Up to date when /sync/status reports no provider needing attention', () => {
			render(Navigation);

			expect(screen.getByRole('button', { name: 'Sync status: Up to date' })).toBeInTheDocument();
		});
	});

	it('the root layout floats the indicator only on pages without the navigation', () => {
		expect(LAYOUT_SRC).toMatch(/\{#if !showNavigation\}\s*<OfflineIndicator \/>\s*\{\/if\}/);
	});
});
