import { beforeEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { defaultFolderSettings } from '#lib/constants/providers.ts';

const store = vi.hoisted(() => ({
	settings: null as null | { backupConfig: { providers: Record<string, unknown> } },
	load: vi.fn(() => Promise.resolve())
}));
const resumeSheetsBackups = vi.hoisted(() => vi.fn((_id: string) => Promise.resolve()));

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
		getSyncStatus: vi.fn(() => Promise.resolve({})),
		backfillProvider: vi.fn()
	}
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: { resumeSheetsBackups: (id: string) => resumeSheetsBackups(id) }
}));
vi.mock('#lib/stores/settings.svelte.ts', () => ({
	settingsStore: {
		get settings() {
			return store.settings;
		},
		load: () => store.load()
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: vi.fn(), showSuccess: vi.fn() }
}));

const ProviderInfoCard = (await import('../ProviderInfoCard.svelte')).default;

const DRIVE: UserProviderInfo = {
	id: 'prov-1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'My Drive',
	status: 'active',
	config: { accountEmail: 'ada@gmail.com' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

function mount() {
	return render(ProviderInfoCard, {
		props: {
			provider: DRIVE,
			categorySettings: defaultFolderSettings('google-drive'),
			sheetsSyncEnabled: true,
			onEdit: vi.fn(),
			onDelete: vi.fn()
		}
	});
}

beforeAll(async () => {
	const { providerCatalog } = await import('#lib/stores/provider-catalog.svelte.ts');
	await providerCatalog.ensureLoaded();
});

beforeEach(() => {
	vi.clearAllMocks();
	store.settings = null;
});

describe('ProviderInfoCard: paused Sheets backups', () => {
	test('explains the pause and resumes on request', async () => {
		store.settings = {
			backupConfig: {
				providers: { 'prov-1': { sheetsAutoPausedAt: '2026-11-23T10:00:00.000Z' } }
			}
		};
		mount();

		expect(
			screen.getByText(/Automatic backups to this spreadsheet are paused/)
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Resume automatic backups' }));

		await waitFor(() => expect(resumeSheetsBackups).toHaveBeenCalledWith('prov-1'));
		await waitFor(() => expect(store.load).toHaveBeenCalled());
	});

	test('shows nothing when the spreadsheet is not paused', () => {
		store.settings = { backupConfig: { providers: { 'prov-1': {} } } };
		mount();

		expect(screen.queryByText(/are paused/)).toBeNull();
		expect(screen.queryByRole('button', { name: 'Resume automatic backups' })).toBeNull();
	});
});
