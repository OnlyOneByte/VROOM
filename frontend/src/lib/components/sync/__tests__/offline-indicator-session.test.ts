import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { authStore } from '#lib/stores/auth.svelte.ts';
import { onlineStatus } from '#lib/stores/offline.svelte.ts';
import type { User } from '#lib/types/index.ts';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const OfflineIndicator = (await import('../OfflineIndicator.svelte')).default;

const unreachableLabel = (_: string, element: Element | null) =>
	element?.tagName === 'SPAN' &&
	element.textContent?.replace(/\s+/g, ' ').trim() === "Can't reach VROOM";

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

function serverStaysDown(): void {
	mockFetch.mockImplementation(
		() => new Promise((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 0))
	);
}

async function startWithUnreachableServer(): Promise<void> {
	localStorage.setItem('vroom_last_user', JSON.stringify(alice));
	mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
	await authStore.initialize();
}

describe('OfflineIndicator — unverified session', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authStore.clearUser();
	});

	it('says the server is unreachable while online and offers a retry that re-checks the session', async () => {
		onlineStatus.current = true;
		serverStaysDown();
		await startWithUnreachableServer();

		render(OfflineIndicator);

		expect(await screen.findByText(unreachableLabel)).toBeInTheDocument();

		const retry = screen.getByRole('button', { name: 'Retry' });
		await vi.waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'));
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(me());
		await fireEvent.click(retry);

		await vi.waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		expect(screen.queryByText(unreachableLabel)).not.toBeInTheDocument();
	});

	it('keeps focus on Retry while it re-checks, and ignores a second press', async () => {
		onlineStatus.current = true;
		serverStaysDown();
		await startWithUnreachableServer();
		render(OfflineIndicator);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		await vi.waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'));
		let answer: (response: Response) => void = () => {};
		mockFetch.mockReset();
		mockFetch.mockImplementation(() => new Promise<Response>(resolve => (answer = resolve)));
		retry.focus();
		await fireEvent.click(retry);

		await vi.waitFor(() => expect(retry).toHaveAttribute('aria-disabled', 'true'));
		expect(retry).toBeEnabled();
		expect(retry).toHaveFocus();
		await fireEvent.click(retry);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		answer(me());
		await vi.waitFor(() => expect(authStore.sessionUnverified).toBe(false));
	});

	it('re-checks the session by itself when the device comes back online', async () => {
		onlineStatus.current = false;
		await startWithUnreachableServer();
		render(OfflineIndicator);
		mockFetch.mockResolvedValue(me());

		onlineStatus.current = true;

		await vi.waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		expect(authStore.isAuthenticated).toBe(true);
	});

	it('checks the session once per reconnect, not in a loop while the server stays down', async () => {
		onlineStatus.current = false;
		await startWithUnreachableServer();
		const { unmount } = render(OfflineIndicator);
		mockFetch.mockReset();
		serverStaysDown();

		onlineStatus.current = true;
		await new Promise(resolve => setTimeout(resolve, 300));
		unmount();

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('a successful Retry moves focus to the main heading and announces the connection', async () => {
		onlineStatus.current = true;
		serverStaysDown();
		await startWithUnreachableServer();
		const main = document.createElement('main');
		main.innerHTML = '<h1>Dashboard</h1>';
		document.body.appendChild(main);
		render(OfflineIndicator);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		await vi.waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'));
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(me());
		retry.focus();
		await fireEvent.click(retry);

		const heading = main.querySelector('h1');
		await vi.waitFor(() => expect(heading).toHaveFocus());
		expect(heading).toHaveAttribute('tabindex', '-1');
		expect(screen.getByText('Connected to VROOM again')).toHaveAttribute('role', 'status');
		main.remove();
	});

	it('a successful Retry leaves focus alone when the user moved it during the check', async () => {
		onlineStatus.current = true;
		serverStaysDown();
		await startWithUnreachableServer();
		const main = document.createElement('main');
		main.innerHTML = '<h1>Dashboard</h1><button>Elsewhere</button>';
		document.body.appendChild(main);
		render(OfflineIndicator);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		await vi.waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled', 'true'));
		let answer: (response: Response) => void = () => {};
		mockFetch.mockReset();
		mockFetch.mockImplementation(() => new Promise<Response>(resolve => (answer = resolve)));
		retry.focus();
		await fireEvent.click(retry);
		const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
		elsewhere.focus();

		answer(me());
		await vi.waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(elsewhere).toHaveFocus();
		main.remove();
	});
});
