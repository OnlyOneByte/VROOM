import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { authStore } from '#lib/stores/auth.svelte.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import type { User } from '#lib/types/index.ts';
import { onWideScreen } from './wide-screen.ts';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/expenses') }
}));

vi.mock('#lib/utils/sync/sync-manager.ts', () => {
	const store = <T>(value: T) => ({
		get current() {
			return value;
		}
	});
	return {
		syncManager: { setupAutoSync: vi.fn(), syncAll: vi.fn() },
		fetchLastSyncTime: vi.fn(),
		syncConflicts: store<unknown[]>([]),
		lastBackupTime: store<Date | null>(null),
		lastSheetsSync: store<Date | null>(null),
		lastDataChangeTime: store<Date | null>(null),
		backupEnabled: store(false),
		sheetsSyncEnabled: store(false)
	};
});

const Navigation = (await import('../Navigation.svelte')).default;

const user: User = {
	id: 'u1',
	email: 'driver@example.com',
	displayName: 'Driver',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z'
};

const originalFetch = global.fetch;

beforeEach(() => {
	authStore.setUser(user, 'token');
	appStore.reset();
});

afterEach(() => {
	global.fetch = originalFetch;
	authStore.clearUser();
});

async function signOutButton(): Promise<HTMLElement> {
	await fireEvent.click(screen.getByRole('button', { name: 'More' }));
	return screen.findByRole('button', { name: 'Sign out' });
}

function messages(): string[] {
	return appStore.notifications.map(n => n.message);
}

describe.each([
	['in the More menu at lg and up', true],
	['in the More sheet on a phone', false]
])('Sign out %s', (_where, isWide) => {
	if (isWide) onWideScreen();

	it('offline, says it could not sign out and keeps the user signed in', async () => {
		global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
		render(Navigation);

		await fireEvent.click(await signOutButton());

		await vi.waitFor(() =>
			expect(messages()).toContain("Couldn't sign out. Check your connection and try again.")
		);
		expect(authStore.isAuthenticated).toBe(true);
	});

	it('signs out with no error when the request succeeds', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: () => Promise.resolve({ success: true, data: null })
		});
		render(Navigation);

		await fireEvent.click(await signOutButton());

		await vi.waitFor(() => expect(authStore.isAuthenticated).toBe(false));
		expect(appStore.notifications.filter(n => n.type === 'error')).toHaveLength(0);
	});
});
