import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import type { User } from '#lib/types/index.ts';

const location = vi.hoisted(() => ({ path: '/dashboard' }));
const goto = vi.hoisted(() => vi.fn());

vi.mock('$app/state', () => ({
	get page() {
		return { url: new URL(`http://localhost${location.path}`) };
	}
}));
vi.mock('$app/navigation', () => ({ goto, afterNavigate: vi.fn(), beforeNavigate: vi.fn() }));
vi.mock('virtual:pwa-info', () => ({ pwaInfo: undefined }));
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

const ls = (global as unknown as { localStorageMock: { clear: () => void } }).localStorageMock;

const { authStore } = await import('#lib/stores/auth.svelte.ts');
const { offlineExpenseQueue } = await import('#lib/stores/offline.svelte.ts');
const Layout = (await import('../+layout.svelte')).default;

const alice: User = {
	id: 'alice',
	email: 'alice@example.com',
	displayName: 'Alice',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};
const bob: User = { ...alice, id: 'bob', email: 'bob@example.com', displayName: 'Bob' };

function meOk(user: User): Response {
	return new Response(
		JSON.stringify({ success: true, data: { user, session: { expiresAt: '2099-01-01' } } }),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

function meError(status: number): Response {
	return new Response(JSON.stringify({ error: { message: 'nope' } }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function queued(id: string): OfflineExpense {
	return {
		id,
		clientId: `cid-${id}`,
		vehicleId: 'v1',
		tags: [],
		category: 'misc',
		amount: 5,
		date: '2024-06-01',
		timestamp: 0,
		synced: false,
		version: '3.0'
	};
}

function deferredMe(): (response: Response) => void {
	let answer: (response: Response) => void = () => {};
	mockFetch.mockReturnValue(
		new Promise<Response>(resolve => {
			answer = resolve;
		})
	);
	return response => answer(response);
}

const pageContent = createRawSnippet(() => ({ render: () => '<p>Page content</p>' }));

beforeEach(() => {
	vi.clearAllMocks();
	mockFetch.mockReset();
	authStore.clearUser();
	ls.clear();
	offlineExpenseQueue.current = [];
	location.path = '/dashboard';
});

describe('authStore.initialize from the remembered user', () => {
	it('signs the shell in at once and verifies the session in the background', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		const answer = deferredMe();

		const verified = authStore.initialize({ fromCache: true });

		expect(authStore.isAuthenticated).toBe(true);
		expect(authStore.isLoading).toBe(false);
		expect(authStore.user?.id).toBe('alice');
		expect(authStore.sessionUnverified).toBe(false);

		answer(meOk(alice));
		await verified;
		expect(authStore.isAuthenticated).toBe(true);
	});

	it('signs out and forgets the remembered user when the session has expired', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockResolvedValue(meError(401));

		await authStore.initialize({ fromCache: true });

		expect(authStore.isAuthenticated).toBe(false);
		expect(localStorage.getItem('vroom_last_user')).toBeNull();
	});

	it("never loads the remembered user's offline queue before the server names the user", async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		localStorage.setItem('vroom_offline_expenses:alice', JSON.stringify([queued('alice-1')]));
		localStorage.setItem('vroom_offline_expenses:bob', JSON.stringify([queued('bob-1')]));
		const answer = deferredMe();

		const verified = authStore.initialize({ fromCache: true });
		expect(offlineExpenseQueue.current).toEqual([]);

		answer(meOk(bob));
		await verified;
		expect(authStore.user?.id).toBe('bob');
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['bob-1']);
	});

	it('forgets the remembered user on sign-out, so the next visit waits for the server', async () => {
		mockFetch.mockResolvedValueOnce(meOk(alice));
		await authStore.initialize();
		expect(authStore.remembersUser()).toBe(true);
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ success: true, data: null }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		await authStore.logout();

		expect(localStorage.getItem('vroom_last_user')).toBeNull();
		expect(authStore.remembersUser()).toBe(false);
	});

	it('waits for the server when not asked to use the remembered user', () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		deferredMe();

		void authStore.initialize();

		expect(authStore.isLoading).toBe(true);
		expect(authStore.isAuthenticated).toBe(false);
	});
});

describe('the root layout paints the app shell without waiting on /auth/me', () => {
	it('shows navigation and the page, not the splash, while a remembered session is checked', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		deferredMe();

		render(Layout, { children: pageContent });

		await waitFor(() => expect(screen.getByText('Page content')).toBeInTheDocument());
		expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
		expect(screen.queryByText('Loading VROOM...')).toBeNull();
	});

	it('ends on /auth when the remembered session has expired', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		mockFetch.mockResolvedValue(meError(401));

		render(Layout, { children: pageContent });

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/auth'));
		expect(localStorage.getItem('vroom_last_user')).toBeNull();
	});

	it.each(['/', '/auth'])(
		'renders %s at once, without the splash or the app shell, when nobody signed in on this device',
		async path => {
			location.path = path;
			deferredMe();

			render(Layout, { children: pageContent });

			await waitFor(() => expect(screen.getByText('Page content')).toBeInTheDocument());
			expect(screen.queryByText('Loading VROOM...')).toBeNull();
			expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
		}
	);

	it.each(['/', '/auth'])(
		'keeps the splash on %s for a remembered user until the server answers, so the page never flashes',
		async path => {
			location.path = path;
			localStorage.setItem('vroom_last_user', JSON.stringify(alice));
			deferredMe();

			render(Layout, { children: pageContent });

			await waitFor(() => expect(screen.getByText('Loading VROOM...')).toBeInTheDocument());
			expect(screen.queryByText('Page content')).toBeNull();
			expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
			expect(authStore.isAuthenticated).toBe(false);
		}
	);

	it.each(['/privacypolicy', '/termsofservice'])('renders %s at once', path => {
		location.path = path;
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		deferredMe();

		render(Layout, { children: pageContent });

		expect(screen.getByText('Page content')).toBeInTheDocument();
		expect(screen.queryByText('Loading VROOM...')).toBeNull();
	});

	it('starts offline from the remembered user with its queue when the server is unreachable', async () => {
		localStorage.setItem('vroom_last_user', JSON.stringify(alice));
		localStorage.setItem('vroom_offline_expenses:alice', JSON.stringify([queued('alice-1')]));
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		render(Layout, { children: pageContent });

		await waitFor(() => expect(authStore.sessionUnverified).toBe(true));
		expect(screen.getByText('Page content')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
		expect(offlineExpenseQueue.current.map(e => e.id)).toEqual(['alice-1']);
	});

	it.each([
		['/dashboard', false],
		['/privacypolicy', true]
	])('a waiting account on %s never gets the app shell', async (path, showsPage) => {
		location.path = path;
		mockFetch.mockResolvedValue(
			new Response(
				JSON.stringify({
					success: true,
					data: { user: alice, session: { expiresAt: '2099-01-01' }, pendingApproval: true }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		render(Layout, { children: pageContent });

		await waitFor(() => expect(authStore.user?.pendingApproval).toBe(true));
		expect(screen.queryByRole('link', { name: 'Skip to content' })).toBeNull();
		expect(screen.queryByText('Page content') !== null).toBe(showsPage);
		expect(screen.queryByTestId('account-pending') !== null).toBe(!showsPage);
		expect(mockFetch.mock.calls.map(([url]) => String(url))).not.toContainEqual(
			expect.stringContaining('/settings')
		);
	});

	it('keeps the branded splash on a protected route when nobody signed in on this device', () => {
		deferredMe();

		render(Layout, { children: pageContent });

		expect(screen.getByText('Loading VROOM...')).toBeInTheDocument();
		expect(screen.queryByText('Page content')).toBeNull();
	});
});
