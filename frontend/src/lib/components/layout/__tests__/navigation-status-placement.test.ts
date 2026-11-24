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
		sheetsSyncEnabled: store(false)
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
	const header = document.querySelector<HTMLElement>('div.fixed.top-0');
	if (!header) throw new Error('mobile header not rendered');
	return header;
}

describe('the sync status indicator lives in the navigation, never floating over a page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

	describe('in the desktop sidebar', () => {
		onWideScreen();

		it('offers Retry connection in the desktop sidebar, which re-checks the session', async () => {
			await startWithUnreachableServer();
			render(Navigation);

			const sidebarRetry = screen.getByRole('button', { name: 'Retry connection' });
			expect(document.querySelector('div.fixed.top-0')).toBeNull();

			mockFetch.mockReset();
			mockFetch.mockResolvedValue(me());
			await waitFor(() => expect(sidebarRetry).not.toHaveAttribute('aria-disabled', 'true'));
			await fireEvent.click(sidebarRetry);

			await waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		});

		it('the collapsed sidebar offers Sync Now, with the pending count only on the status badge', async () => {
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

			expect(screen.getByRole('button', { name: 'Sync Now' })).toBeInTheDocument();
			const panel = screen.getByRole('group', { name: 'Sync status' });
			expect(within(panel).getByRole('status')).toHaveTextContent('1 pending');
			expect(panel.querySelector('[data-slot="badge"]')).toHaveTextContent('1');
			expect(within(panel).getByRole('status')).toHaveAttribute('aria-live', 'off');
		});

		it('the sidebar action under the pointer survives the hover that expands the sidebar', async () => {
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
			const sidebar = document.querySelector<HTMLElement>('div.lg\\:inset-y-0');
			const sync = screen.getByRole('button', { name: 'Sync Now' });

			await fireEvent.mouseEnter(sidebar!);

			expect(sync.isConnected).toBe(true);
			expect(sync).toHaveTextContent('Sync Now');
			await fireEvent.click(sync);
			const { syncManager } = await import('#lib/utils/sync/sync-manager.ts');
			expect(syncManager.syncAll).toHaveBeenCalled();
		});

		it('the sidebar status is announced as a status with its text', async () => {
			await startWithUnreachableServer();
			render(Navigation);

			const statuses = screen.getAllByRole('status');
			expect(statuses.some(status => status.textContent === "Can't reach VROOM")).toBe(true);
		});
	});

	it('the root layout floats the indicator only on pages without the navigation', () => {
		expect(LAYOUT_SRC).toMatch(/\{#if !showNavigation\}\s*<OfflineIndicator \/>\s*\{\/if\}/);
	});
});
