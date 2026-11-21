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
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
		await startWithUnreachableServer();

		render(OfflineIndicator);

		expect(await screen.findByText(unreachableLabel)).toBeInTheDocument();

		const retry = screen.getByRole('button', { name: 'Retry' });
		await vi.waitFor(() => expect(retry).toBeEnabled());
		mockFetch.mockReset();
		mockFetch.mockResolvedValue(me());
		await fireEvent.click(retry);

		await vi.waitFor(() => expect(authStore.sessionUnverified).toBe(false));
		expect(screen.queryByText(unreachableLabel)).not.toBeInTheDocument();
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
		render(OfflineIndicator);
		mockFetch.mockReset();
		mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

		onlineStatus.current = true;
		await new Promise(resolve => setTimeout(resolve, 300));

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
