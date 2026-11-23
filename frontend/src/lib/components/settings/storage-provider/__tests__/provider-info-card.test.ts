import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { defaultFolderSettings } from '#lib/constants/providers.ts';

const getSyncStatus = vi.fn<(id: string) => Promise<Record<string, never>>>();
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
		getSyncStatus: (id: string) => getSyncStatus(id),
		backfillProvider: vi.fn()
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: vi.fn(), showSuccess: vi.fn() }
}));

const ProviderInfoCard = (await import('../ProviderInfoCard.svelte')).default;

const NOW = new Date('2026-05-10T12:00:00.000Z');

function provider(overrides: Partial<UserProviderInfo> = {}): UserProviderInfo {
	return {
		id: 'prov-1',
		domain: 'storage',
		providerType: 'google-drive',
		displayName: 'My Drive',
		status: 'active',
		config: { accountEmail: 'ada@gmail.com' },
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

const onEdit = vi.fn<(p: UserProviderInfo) => void>();
const onDelete = vi.fn<(p: UserProviderInfo) => void>();
const onBackupToggle = vi.fn<(id: string, enabled: boolean) => void>();
const onSheetsSyncToggle = vi.fn<(id: string, enabled: boolean) => void>();

async function mount(props: Record<string, unknown> = {}) {
	const result = render(ProviderInfoCard, {
		props: {
			provider: provider(),
			categorySettings: defaultFolderSettings('google-drive'),
			onEdit,
			onDelete,
			onBackupToggle,
			onSheetsSyncToggle,
			...props
		}
	});
	await settle();
	return result;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	getSyncStatus.mockResolvedValue({});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('ProviderInfoCard header', () => {
	test.each([
		['active', 'Connected'],
		['error', 'Error'],
		['disconnected', 'Disconnected']
	] as const)('status %s is labelled %s', async (status, label) => {
		await mount({ provider: provider({ status }) });
		expect(screen.getByText(label)).toBeInTheDocument();
	});

	test('an unexpected status is shown verbatim', async () => {
		await mount({ provider: provider({ status: 'pending' as UserProviderInfo['status'] }) });
		expect(screen.getByText('pending')).toBeInTheDocument();
	});

	test.each([
		['google-drive', 'Google Drive'],
		['google-photos', 'Google Photos'],
		['s3', 'S3 Compatible'],
		['webdav', 'webdav']
	])('provider type %s is labelled %s', async (providerType, label) => {
		await mount({ provider: provider({ providerType, config: {} }) });
		expect(screen.getByText(label)).toBeInTheDocument();
	});

	test('shows the connected account email next to the type', async () => {
		await mount();
		expect(screen.getByText(/ada@gmail\.com ·/)).toBeInTheDocument();
		expect(screen.getByText('My Drive')).toBeInTheDocument();
	});

	test('edit and delete hand the provider to their callbacks', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit My Drive' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete My Drive' }));
		expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'prov-1' }));
		expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'prov-1' }));
	});

	test('loads the provider sync status on mount', async () => {
		await mount();
		expect(getSyncStatus).toHaveBeenCalledWith('prov-1');
	});
});

describe('ProviderInfoCard toggles', () => {
	test('google drive offers ZIP backup and sheets sync toggles', async () => {
		await mount();
		expect(screen.getByRole('switch', { name: 'ZIP backup' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		expect(screen.getByRole('switch', { name: 'Sheets sync' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	test('switching ZIP backup on reports the provider and new state', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('switch', { name: 'ZIP backup' }));
		expect(onBackupToggle).toHaveBeenCalledWith('prov-1', true);
	});

	test('switching sheets sync off reports the provider and new state', async () => {
		await mount({ sheetsSyncEnabled: true });
		await fireEvent.click(screen.getByRole('switch', { name: 'Sheets sync' }));
		expect(onSheetsSyncToggle).toHaveBeenCalledWith('prov-1', false);
	});

	test('an enabled backup notes that photos are excluded', async () => {
		await mount({ backupEnabled: true });
		expect(screen.getByRole('switch', { name: 'ZIP backup' })).toHaveAttribute(
			'aria-checked',
			'true'
		);
		expect(
			screen.getByText('Backups include your data only — images and photos are not included.')
		).toBeInTheDocument();
	});

	test('google photos explains it cannot hold ZIP backups and has no toggles', async () => {
		await mount({ provider: provider({ providerType: 'google-photos' }) });
		expect(screen.getByText(/Google Photos stores your photos only/)).toBeInTheDocument();
		expect(screen.queryByRole('switch')).toBeNull();
	});

	test('s3 offers ZIP backup but not sheets sync', async () => {
		await mount({ provider: provider({ providerType: 's3' }) });
		expect(screen.getByRole('switch', { name: 'ZIP backup' })).toBeInTheDocument();
		expect(screen.queryByRole('switch', { name: 'Sheets sync' })).toBeNull();
	});

	test('toggling without callbacks does not throw', async () => {
		await mount({ onBackupToggle: undefined, onSheetsSyncToggle: undefined });
		await fireEvent.click(screen.getByRole('switch', { name: 'ZIP backup' }));
		await fireEvent.click(screen.getByRole('switch', { name: 'Sheets sync' }));
		expect(onBackupToggle).not.toHaveBeenCalled();
	});
});

describe('ProviderInfoCard last backup time', () => {
	test.each([
		['2026-05-10T11:59:30.000Z', 'Just now'],
		['2026-05-10T11:15:00.000Z', '45 min ago'],
		['2026-05-10T11:00:00.000Z', '1 hour ago'],
		['2026-05-10T07:00:00.000Z', '5 hours ago'],
		['2026-05-09T11:00:00.000Z', '1 day ago'],
		['2026-05-01T12:00:00.000Z', '9 days ago']
	])('a backup at %s reads %s', async (lastBackupAt, text) => {
		await mount({ lastBackupAt });
		expect(screen.getByText(`Last backup: ${text}`)).toBeInTheDocument();
	});

	test('no last backup hides the line', async () => {
		await mount();
		expect(screen.queryByText(/Last backup:/)).toBeNull();
	});
});

describe('ProviderInfoCard details', () => {
	test('expanding s3 shows endpoint, bucket and region, and collapsing hides them', async () => {
		await mount({
			provider: provider({
				providerType: 's3',
				config: { endpoint: 'https://s3.example', bucket: 'vroom', region: 'us-west-2' }
			})
		});
		const toggle = screen.getByRole('button', { name: 'Expand provider details' });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(toggle);

		expect(screen.getByText('https://s3.example')).toBeInTheDocument();
		expect(screen.getByText('vroom')).toBeInTheDocument();
		expect(screen.getByText('us-west-2')).toBeInTheDocument();

		const collapse = screen.getByRole('button', { name: 'Collapse provider details' });
		expect(collapse).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(collapse);
		expect(screen.queryByText('https://s3.example')).toBeNull();
	});

	test('missing s3 settings show a dash placeholder', async () => {
		await mount({ provider: provider({ providerType: 's3', config: {} }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Expand provider details' }));
		expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
	});

	test('non-s3 providers show no endpoint settings when expanded', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Expand provider details' }));
		expect(screen.getByText('Provider Settings')).toBeInTheDocument();
		expect(screen.queryByText('Endpoint:')).toBeNull();
	});
});
