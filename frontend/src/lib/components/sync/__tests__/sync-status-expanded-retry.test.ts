import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
		sheetsSyncEnabled: store(false)
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

describe('SyncStatusInline expanded — Retry connection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
		onlineStatus.current = true;
		syncState.current = 'idle';
		offlineExpenseQueue.current = [];
	});

	it('re-checks the session from the expanded panel, with a 40px target below lg', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await authStore.initialize();
		render(SyncStatusInline, { props: { isExpanded: true } });

		const retry = screen.getByRole('button', { name: 'Retry connection' });
		expect(retry.className).toContain('max-lg:h-10');

		mockFetch.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					success: true,
					data: { user: alice, session: { id: 's', expiresAt: '2099' } }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		await fireEvent.click(retry);

		await waitFor(() => expect(authStore.sessionUnverified).toBe(false));
	});

	it('keeps focus on Retry connection while it checks, and ignores a second press', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await authStore.initialize();
		render(SyncStatusInline, { props: { isExpanded: true } });

		let answer: (response: Response) => void = () => {};
		mockFetch.mockReset();
		mockFetch.mockImplementation(() => new Promise<Response>(resolve => (answer = resolve)));
		const retry = screen.getByRole('button', { name: 'Retry connection' });
		retry.focus();
		await fireEvent.click(retry);

		await waitFor(() => expect(retry).toHaveAttribute('aria-disabled', 'true'));
		expect(retry).toHaveTextContent('Checking...');
		expect(retry).toBeEnabled();
		expect(retry).toHaveFocus();
		await fireEvent.click(retry);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		answer(
			new Response(
				JSON.stringify({
					success: true,
					data: { user: alice, session: { id: 's', expiresAt: '2099' } }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		await waitFor(() => expect(authStore.sessionUnverified).toBe(false));
	});

	function meResponse(): Response {
		return new Response(
			JSON.stringify({
				success: true,
				data: { user: alice, session: { id: 's', expiresAt: '2099' } }
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } }
		);
	}

	async function startUnreachable(): Promise<void> {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await authStore.initialize();
	}

	it.each([true, false])(
		'a successful Retry moves focus, without scrolling, to the sync status that names the result (expanded: %s)',
		async isExpanded => {
			await startUnreachable();
			render(SyncStatusInline, { props: { isExpanded } });
			const retry = screen.getByRole('button', { name: 'Retry connection' });
			mockFetch.mockResolvedValueOnce(meResponse());
			const focus = vi.spyOn(HTMLElement.prototype, 'focus');
			retry.focus();
			await fireEvent.click(retry);

			await waitFor(() =>
				expect(screen.getByRole('group', { name: 'Sync status: Up to date' })).toHaveFocus()
			);
			expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
			expect(screen.queryByRole('button', { name: 'Retry connection' })).toBeNull();
			expect(screen.queryByText('Connected to VROOM again')).toBeNull();
			focus.mockRestore();
		}
	);

	it('a recheck that signs the user out moves no focus', async () => {
		await startUnreachable();
		render(SyncStatusInline, { props: { isExpanded: true } });
		const retry = screen.getByRole('button', { name: 'Retry connection' });
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ success: false, error: { message: 'Unauthorized' } }), {
				status: 401,
				headers: { 'content-type': 'application/json' }
			})
		);
		retry.focus();
		await fireEvent.click(retry);

		await waitFor(() => expect(authStore.isAuthenticated).toBe(false));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(screen.getByRole('group', { name: /^Sync status/ })).not.toHaveFocus();
	});

	it('a successful Retry leaves focus alone when the user moved it during the check', async () => {
		await startUnreachable();
		const elsewhere = document.createElement('button');
		document.body.appendChild(elsewhere);
		render(SyncStatusInline, { props: { isExpanded: true } });
		let answer: (response: Response) => void = () => {};
		mockFetch.mockImplementationOnce(() => new Promise<Response>(resolve => (answer = resolve)));
		const retry = screen.getByRole('button', { name: 'Retry connection' });
		retry.focus();
		await fireEvent.click(retry);
		elsewhere.focus();

		answer(meResponse());
		await waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(elsewhere).toHaveFocus();
		elsewhere.remove();
	});
});
