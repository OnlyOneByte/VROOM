import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

const providers = vi.fn(() => Promise.resolve<UserProviderInfo[]>([]));
const DRIVE: UserProviderInfo = {
	id: 'prov-1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'Family Drive',
	status: 'active',
	config: { accountEmail: 'demo@example.com' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

vi.mock('#lib/services/photo-api.ts', () => ({
	orphanedPhotosApi: { count: () => Promise.resolve(0), remove: vi.fn() }
}));
vi.mock('#lib/services/provider-api.ts', async importOriginal => {
	const actual = await importOriginal<typeof import('#lib/services/provider-api.ts')>();
	return {
		...actual,
		providerApi: {
			getProviders: () => providers(),
			getSyncStatus: () => Promise.resolve(null),
			backfillProvider: vi.fn()
		}
	};
});
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => Promise.resolve({ storageConfig: null, backupConfig: { providers: {} } }),
		updateSettings: vi.fn()
	}
}));
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	fetchLastSyncTime: () => Promise.resolve(null)
}));

const StorageProvidersCard = (await import('../StorageProvidersCard.svelte')).default;

function expectTouchHeight(button: HTMLElement): void {
	expect(button.className).toMatch(/(^|\s)(h-10|min-h-10)(\s|$)/);
}

describe('Storage Providers controls are 40px tap targets on phones', () => {
	test('with no providers: one Add storage button under Connected and no photo-source settings yet', async () => {
		providers.mockResolvedValue([]);
		render(StorageProvidersCard, { props: {} });

		await screen.findByText(/No storage connected yet/);
		expect(screen.getByRole('heading', { level: 2, name: 'Connected' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { level: 2, name: 'Back up now and restore' })
		).toBeInTheDocument();
		const addButtons = screen.getAllByRole('button', { name: /^Add / });
		expect(addButtons).toHaveLength(1);
		expect(addButtons[0]).toHaveAccessibleName('Add storage');
		expectTouchHeight(addButtons[0] as HTMLElement);
		expect(screen.queryByRole('button', { name: /Customize per photo type/ })).toBeNull();
		expect(screen.queryByText(/Enable backup on a provider/)).toBeNull();
	});

	test('a provider’s edit, delete and expand icons and Sync All, spaced 8px apart', async () => {
		providers.mockResolvedValue([DRIVE]);
		render(StorageProvidersCard, { props: {} });

		const edit = await screen.findByRole('button', { name: 'Edit Family Drive' });
		const del = screen.getByRole('button', { name: 'Delete Family Drive' });
		const expand = screen.getByRole('button', { name: 'Expand provider details' });
		for (const button of [edit, del, expand]) expect(button.className).toContain('size-10');
		expect(edit.parentElement?.className).toMatch(/(^|\s)gap-2(\s|$)/);

		await fireEvent.click(expand);
		expectTouchHeight(await screen.findByRole('button', { name: /Sync All/ }));
	});

	test('with a provider: one Add storage button under Connected, no empty state', async () => {
		providers.mockResolvedValue([DRIVE]);
		render(StorageProvidersCard, { props: {} });

		await screen.findByRole('button', { name: 'Edit Family Drive' });
		const addButtons = screen.getAllByRole('button', { name: /^Add / });
		expect(addButtons).toHaveLength(1);
		expect(addButtons[0]).toHaveAccessibleName('Add storage');
		expectTouchHeight(addButtons[0] as HTMLElement);
		expect(screen.queryByText(/No storage connected yet/)).toBeNull();
		expectTouchHeight(screen.getByRole('button', { name: /Customize per photo type/ }));
	});

	test('Restore, without a phone flex-basis that overrides the height, and no duplicate ZIP export', async () => {
		providers.mockResolvedValue([]);
		render(StorageProvidersCard, { props: {} });

		const restore = await screen.findByRole('button', { name: /Restore/ });
		expectTouchHeight(restore);
		expect(restore.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
		expect(screen.queryByRole('button', { name: /Download Backup/ })).toBeNull();
	});
});
