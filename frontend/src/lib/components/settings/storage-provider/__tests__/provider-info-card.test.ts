import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { defaultFolderSettings } from '#lib/constants/providers.ts';

const getSyncStatus = vi.fn<(id: string) => Promise<Record<string, never>>>();
const testProvider =
	vi.fn<(id: string) => Promise<{ ok: boolean; message: string; code?: string }>>();
const getProviders = vi.fn<(domain?: string) => Promise<UserProviderInfo[]>>();
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
		getSyncStatus: (id: string) => getSyncStatus(id),
		testProvider: (id: string) => testProvider(id),
		getProviders: (domain?: string) => getProviders(domain),
		backfillProvider: vi.fn()
	}
}));
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: vi.fn(), showSuccess: vi.fn() }
}));

const ProviderInfoCard = (await import('../ProviderInfoCard.svelte')).default;

beforeAll(async () => {
	const { providerCatalog } = await import('#lib/stores/provider-catalog.svelte.ts');
	await providerCatalog.ensureLoaded();
});

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
		['needs_reauth', 'Needs reconnecting'],
		['error', 'Not working'],
		['disabled', 'Turned off']
	] as const)('status %s is labelled %s', async (status, label) => {
		await mount({ provider: provider({ status, lastCheckedAt: '2026-05-10T11:55:00.000Z' }) });
		expect(screen.getByText(label)).toBeInTheDocument();
	});

	test.each([
		['Connected', '2026-05-10T11:55:00.000Z'],
		['Added', null]
	] as const)(
		'the %s and last-backup badges sit on their own line, outside the inline action row',
		async (label, lastCheckedAt) => {
			await mount({
				provider: provider({ lastCheckedAt }),
				lastBackupAt: '2026-05-10T00:00:00.000Z'
			});
			const actionRow = screen.getByRole('button', { name: 'Edit My Drive' }).parentElement
				?.parentElement as HTMLElement;
			const backup = screen.getByText('Last backup 12 hours ago');
			const status = screen.getByText(label);
			expect(actionRow).toHaveTextContent('My Drive');
			expect(actionRow).not.toContainElement(backup);
			expect(actionRow).not.toContainElement(status);
			expect(backup.parentElement).toBe(status.parentElement);
			expect(backup.parentElement?.className).toMatch(/(^|\s)flex-wrap(\s|$)/);
		}
	);

	test('an active provider never checked reads Added, not Connected, next to not checked yet', async () => {
		await mount({ provider: provider({ status: 'active', lastCheckedAt: null }) });
		expect(screen.getByText('Added')).toBeInTheDocument();
		expect(screen.queryByText('Connected')).toBeNull();
		expect(screen.getByText('Connection not checked yet')).toBeInTheDocument();
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

	test('a healthy provider shows when it was last checked and a Test connection button', async () => {
		await mount({ provider: provider({ lastCheckedAt: '2026-05-10T11:55:00.000Z' }) });
		expect(screen.getByText('Connection checked 5m ago')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Test connection to My Drive' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
	});

	test('a provider that needs reconnecting says why and offers Reconnect, which opens the edit flow', async () => {
		await mount({ provider: provider({ status: 'needs_reauth', lastErrorCode: 'auth' }) });
		expect(
			screen.getByText("The saved sign-in or key isn't accepted anymore.")
		).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
		expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'prov-1' }));
	});

	test('a provider that is not working says what to check and offers Edit settings', async () => {
		await mount({ provider: provider({ status: 'error', lastErrorCode: 'unreachable' }) });
		expect(screen.getByText("Couldn't connect.")).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Edit settings' })).toBeInTheDocument();
	});

	test('Test connection checks the provider and hands back its refreshed status', async () => {
		const onUpdated = vi.fn<(p: UserProviderInfo) => void>();
		testProvider.mockResolvedValue({ ok: false, code: 'auth', message: 'Reconnect it.' });
		getProviders.mockResolvedValue([provider({ status: 'needs_reauth', lastErrorCode: 'auth' })]);
		await mount({ onUpdated });
		await fireEvent.click(screen.getByRole('button', { name: 'Test connection to My Drive' }));
		await settle();
		expect(testProvider).toHaveBeenCalledWith('prov-1');
		expect(getProviders).toHaveBeenCalledWith('storage');
		expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_reauth' }));
		expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Reconnect it.');
	});

	test('focus stays on Test connection when the result moves it into the alert', async () => {
		testProvider.mockResolvedValue({ ok: false, code: 'auth', message: 'Reconnect it.' });
		getProviders.mockResolvedValue([provider({ status: 'needs_reauth', lastErrorCode: 'auth' })]);
		const view = await mount({
			onUpdated: (p: UserProviderInfo) => view.rerender({ provider: p })
		});
		const button = screen.getByRole('button', { name: 'Test connection to My Drive' });
		button.focus();
		await fireEvent.click(button);
		await settle();
		expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Test connection to My Drive' })
		);
	});

	test('a failed check on a provider that is still active shows the failure on screen', async () => {
		testProvider.mockResolvedValue({
			ok: false,
			code: 'unreachable',
			message: "Couldn't reach the provider."
		});
		getProviders.mockResolvedValue([
			provider({
				status: 'active',
				lastErrorCode: 'unreachable',
				lastCheckedAt: '2026-05-10T11:59:00.000Z'
			})
		]);
		const view = await mount({
			onUpdated: (p: UserProviderInfo) => view.rerender({ provider: p })
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Test connection to My Drive' }));
		await settle();
		const shown = screen
			.getAllByText("Couldn't reach the provider.")
			.filter(el => !el.classList.contains('sr-only'));
		expect(shown).toHaveLength(1);
		expect(screen.getByText('Check failed')).toBeInTheDocument();
		expect(screen.queryByText('Connected')).toBeNull();
	});

	test('a new provider whose first check fails goes from Added to Check failed, never Connected', async () => {
		testProvider.mockResolvedValue({ ok: false, code: 'unreachable', message: 'Offline.' });
		getProviders.mockResolvedValue([
			provider({
				status: 'active',
				lastErrorCode: 'unreachable',
				lastCheckedAt: '2026-05-10T11:59:00.000Z'
			})
		]);
		const view = await mount({
			provider: provider({ status: 'active', lastCheckedAt: null }),
			onUpdated: (p: UserProviderInfo) => view.rerender({ provider: p })
		});
		expect(screen.getByText('Added')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Test connection to My Drive' }));
		await settle();
		expect(screen.getByText('Check failed')).toBeInTheDocument();
		expect(screen.queryByText('Connected')).toBeNull();
	});

	test('an active provider whose last check passed reads Connected', async () => {
		await mount({
			provider: provider({
				status: 'active',
				lastErrorCode: null,
				lastCheckedAt: '2026-05-10T11:55:00.000Z'
			})
		});
		expect(screen.getByText('Connected')).toBeInTheDocument();
	});

	test('a test that fails to run says so on screen and still refreshes the card', async () => {
		testProvider.mockRejectedValue(new Error('offline'));
		getProviders.mockResolvedValue([provider({ status: 'error', lastErrorCode: 'config' })]);
		const onUpdated = vi.fn<(p: UserProviderInfo) => void>();
		await mount({ onUpdated });
		await fireEvent.click(screen.getByRole('button', { name: 'Test connection to My Drive' }));
		await settle();
		const shown = screen
			.getAllByText(/^Couldn't test the connection\./)
			.filter(el => !el.classList.contains('sr-only'));
		expect(shown).toHaveLength(1);
		expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
	});

	test('Reconnect uses onReconnect when the card has one, and Edit settings always edits', async () => {
		const onReconnect = vi.fn<(p: UserProviderInfo) => void>();
		await mount({ provider: provider({ status: 'needs_reauth' }), onReconnect });
		await fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
		expect(onReconnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'prov-1' }));
		expect(onEdit).not.toHaveBeenCalled();
	});

	test('a turned-off provider shows no test row', async () => {
		await mount({ provider: provider({ status: 'disabled' }) });
		expect(screen.queryByRole('button', { name: /Test connection/ })).toBeNull();
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

describe('ProviderInfoCard backup cleanup warning', () => {
	const warning =
		"Old backups couldn't be removed. VROOM needs permission to list and delete files there.";

	test('a stored warning shows a badge next to the last backup and the reason under ZIP backup', async () => {
		await mount({
			lastBackupAt: '2026-05-10T00:00:00.000Z',
			backupEnabled: true,
			backupWarning: warning
		});
		const badge = screen.getByText("Couldn't remove old backups");
		expect(badge.parentElement).toBe(screen.getByText('Last backup 12 hours ago').parentElement);
		expect(screen.getByTestId('backup-warning')).toHaveTextContent(warning);
		expect(screen.getByRole('switch', { name: 'ZIP backup' })).toHaveAccessibleDescription(warning);
	});

	test('with ZIP backup off, a stored warning is not shown', async () => {
		await mount({
			lastBackupAt: '2026-05-10T00:00:00.000Z',
			backupEnabled: false,
			backupWarning: warning
		});
		expect(screen.queryByText("Couldn't remove old backups")).not.toBeInTheDocument();
		expect(screen.queryByTestId('backup-warning')).not.toBeInTheDocument();
	});

	test('no warning, no badge and no message', async () => {
		await mount({ lastBackupAt: '2026-05-10T00:00:00.000Z' });
		expect(screen.queryByText("Couldn't remove old backups")).not.toBeInTheDocument();
		expect(screen.queryByTestId('backup-warning')).not.toBeInTheDocument();
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
		expect(screen.getByText(`Last backup ${text}`)).toBeInTheDocument();
	});

	test('no last backup hides the pill', async () => {
		await mount();
		expect(screen.queryByText(/Last backup/)).toBeNull();
	});
});

describe('ProviderInfoCard icon square', () => {
	test('has a hairline edge so it does not blend into the card', async () => {
		const { container } = await mount();
		const square = container.querySelector('[aria-hidden="true"].size-11');
		expect(square).toHaveClass('bg-sunk', 'border', 'border-border');
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
		const toggle = screen.getByRole('button', { name: 'Expand storage details' });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await fireEvent.click(toggle);

		expect(screen.getByText('https://s3.example')).toBeInTheDocument();
		expect(screen.getByText('vroom')).toBeInTheDocument();
		expect(screen.getByText('us-west-2')).toBeInTheDocument();

		const collapse = screen.getByRole('button', { name: 'Collapse storage details' });
		expect(collapse).toHaveAttribute('aria-expanded', 'true');
		await fireEvent.click(collapse);
		expect(screen.queryByText('https://s3.example')).toBeNull();
	});

	test('missing s3 settings show a dash placeholder', async () => {
		await mount({ provider: provider({ providerType: 's3', config: {} }) });
		await fireEvent.click(screen.getByRole('button', { name: 'Expand storage details' }));
		expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
	});

	test('non-s3 providers show no endpoint settings when expanded', async () => {
		await mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Expand storage details' }));
		expect(screen.getByText('Storage settings')).toBeInTheDocument();
		expect(screen.queryByText('Endpoint:')).toBeNull();
	});
});
