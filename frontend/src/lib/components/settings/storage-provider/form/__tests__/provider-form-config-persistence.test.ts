/**
 * Storage-provider config is the app's photo + backup destination, so a save that quietly drops
 * part of it is data loss with a success toast on top. Five contracts, all driven through the
 * MOUNTED form because every one of them only exists in the wiring:
 *
 *  - a save never un-sets config the form does not manage (`accountEmail` is written server-side at
 *    connect time and is the only record of WHICH Google account a provider belongs to);
 *  - the photo root path the user can see and type is the one that is stored and saved — it is a real
 *    path segment server-side, so resetting it makes new uploads land away from the existing ones;
 *  - typing in one field never rewrites another;
 *  - the settings payload names only what this form edits, and invents nothing;
 *  - a follow-up settings save that FAILS is said out loud, because the folder/backup toggles the
 *    user just set are what decides whether photos and backups go anywhere at all.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { UserProviderInfo } from '$lib/types';

/**
 * Mounting needs svelte's CLIENT entry, and this suite resolves the package's `default` (server)
 * one because vite.config.ts sets no `browser` resolve condition for tests — `mount()` from a bare
 * `svelte` import throws "not available on the server". Written `as string` so TypeScript does not
 * try to type svelte's internals (which ship no declarations) while Vite still resolves the path.
 */
vi.mock(
	'svelte',
	() => import('../../../../../../../node_modules/svelte/src/index-client.js' as string)
);

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/settings/providers/drive-1/edit') }
}));

/** The provider payloads the form sends — the subject of most assertions below. */
interface ProviderPayload {
	displayName?: string;
	config?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
}

const updateProvider = vi.fn((_id: string, _data: ProviderPayload) =>
	Promise.resolve({} as UserProviderInfo)
);
const createProvider = vi.fn((data: ProviderPayload) =>
	Promise.resolve({ id: 'drive-new', ...data } as unknown as UserProviderInfo)
);
vi.mock('$lib/services/provider-api', () => ({
	providerApi: {
		updateProvider: (id: string, data: ProviderPayload) => updateProvider(id, data),
		createProvider: (data: ProviderPayload) => createProvider(data),
		deleteProvider: vi.fn()
	}
}));

const getSettings = vi.fn(() => Promise.resolve({} as Record<string, unknown>));
const updateSettings = vi.fn((_updates: Record<string, unknown>) =>
	Promise.resolve({} as Record<string, unknown>)
);
vi.mock('$lib/services/settings-api', () => ({
	settingsApi: {
		getSettings: () => getSettings(),
		updateSettings: (updates: Record<string, unknown>) => updateSettings(updates)
	}
}));

const { appStore } = await import('$lib/stores/app.svelte');
const ProviderForm = (await import('../ProviderForm.svelte')).default;

/** A connected Google Drive provider as GET /providers returns it. */
const STORED_PROVIDER: UserProviderInfo = {
	id: 'drive-1',
	domain: 'storage',
	providerType: 'google-drive',
	displayName: 'My Drive',
	status: 'active',
	config: {
		providerRootPath: 'VROOM',
		photoRootPath: 'Receipts',
		accountEmail: 'owner@example.com'
	},
	createdAt: '2026-01-01T00:00:00.000Z'
};

const STORED_FOLDER_SETTINGS = {
	vehicle_photos: { enabled: true, folderPath: 'Vehicle' },
	expense_receipts: { enabled: true, folderPath: 'Receipts' },
	insurance_docs: { enabled: true, folderPath: 'Insurance' },
	odometer_readings: { enabled: true, folderPath: 'Odometer' }
};

const SETTINGS_RESPONSE = {
	storageConfig: {
		defaults: {
			vehicle_photos: 'drive-1',
			expense_receipts: null,
			insurance_docs: null,
			odometer_readings: null
		},
		providerCategories: { 'drive-1': STORED_FOLDER_SETTINGS }
	},
	backupConfig: { providers: {} }
};

function renderEdit() {
	return render(ProviderForm, {
		props: {
			providerId: 'drive-1',
			existingProvider: STORED_PROVIDER,
			existingFolderSettings: STORED_FOLDER_SETTINGS
		}
	});
}

const rootPathInput = () => screen.getByLabelText('Root Path') as HTMLInputElement;
const displayNameInput = () => screen.getByLabelText('Name') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /update provider|save provider/i });

/** Wait for the form's own state to be seeded from the provider props. */
async function awaitLoaded() {
	await vi.waitFor(() => expect(displayNameInput().value).toBe('My Drive'));
}

/** The config body of the nth updateProvider call. */
function sentConfig(call = 0): Record<string, unknown> {
	return updateProvider.mock.calls[call]?.[1]?.config ?? {};
}

function toasts(): { type: string; message: string }[] {
	return appStore.notifications.map(n => ({ type: n.type, message: n.message }));
}

describe('ProviderForm — an edit-save preserves config the form does not manage', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appStore.clearNotifications();
		getSettings.mockResolvedValue(SETTINGS_RESPONSE);
		updateSettings.mockResolvedValue({});
		updateProvider.mockResolvedValue({} as UserProviderInfo);
	});

	test('renaming a Google Drive provider keeps its accountEmail', async () => {
		renderEdit();
		await awaitLoaded();

		await fireEvent.input(displayNameInput(), { target: { value: 'My Drive 2' } });
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateProvider).toHaveBeenCalled());

		// accountEmail is written once, server-side, when the account is connected. Dropping it
		// un-names the provider everywhere it is shown and blinds the duplicate-account check.
		expect(sentConfig()['accountEmail']).toBe('owner@example.com');
	});

	test('the stored photo root path is shown, and saved back unchanged', async () => {
		renderEdit();
		await awaitLoaded();

		expect(rootPathInput().value).toBe('Receipts');

		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateProvider).toHaveBeenCalled());

		expect(sentConfig()['photoRootPath']).toBe('Receipts');
	});

	test('an edited photo root path is saved by the form’s own Save', async () => {
		renderEdit();
		await awaitLoaded();

		await fireEvent.input(rootPathInput(), { target: { value: 'Scans' } });
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateProvider).toHaveBeenCalled());

		expect(sentConfig()['photoRootPath']).toBe('Scans');
	});

	test('typing in a sibling field does not rewrite the photo root path', async () => {
		renderEdit();
		await awaitLoaded();

		await fireEvent.input(rootPathInput(), { target: { value: 'Scans' } });
		await fireEvent.input(displayNameInput(), { target: { value: 'My Drive 2' } });

		expect(rootPathInput().value).toBe('Scans');
	});

	test('the folder-settings save names this provider and invents no category defaults', async () => {
		renderEdit();
		await awaitLoaded();
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());

		const sent = updateSettings.mock.calls[0]?.[0] as {
			storageConfig?: { defaults: unknown; providerCategories: Record<string, unknown> };
		};
		// The server merges storageConfig per key, and this form edits no defaults — so it sends back
		// exactly what it loaded. Fabricating entries here (nulls for the categories it knows nothing
		// about) would clear the default providers the user picked on the settings page.
		expect(sent.storageConfig?.defaults).toEqual(SETTINGS_RESPONSE.storageConfig.defaults);
		expect(Object.keys(sent.storageConfig?.providerCategories ?? {})).toEqual(['drive-1']);
	});
});

describe('ProviderForm — a new provider stores the photo root path the user typed', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appStore.clearNotifications();
		getSettings.mockResolvedValue({ storageConfig: undefined, backupConfig: { providers: {} } });
		updateSettings.mockResolvedValue({});
	});

	test('picking a type seeds its default path, and an edit of that path is what gets saved', async () => {
		render(ProviderForm, { props: {} });

		await fireEvent.click(screen.getByRole('button', { name: /S3 \/ B2 \/ R2/i }));
		// Choosing a provider type is the one explicit action that re-seeds the field.
		expect(rootPathInput().value).toBe('vroom/photos');

		await fireEvent.input(rootPathInput(), { target: { value: 'vroom/scans' } });
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My Bucket' } });
		await fireEvent.input(screen.getByLabelText('Endpoint'), {
			target: { value: 'https://s3.example.com' }
		});
		await fireEvent.input(screen.getByLabelText('Bucket'), { target: { value: 'vroom' } });
		await fireEvent.input(screen.getByLabelText('Access Key ID'), { target: { value: 'AKIA' } });
		await fireEvent.input(screen.getByLabelText('Secret Access Key'), {
			target: { value: 'secret' }
		});

		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(createProvider).toHaveBeenCalled());

		const config = createProvider.mock.calls[0]?.[0]?.config ?? {};
		expect(config['photoRootPath']).toBe('vroom/scans');
		expect(rootPathInput().value).toBe('vroom/scans');
	});
});

describe('ProviderForm — a settings save that fails is reported, not announced as success', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appStore.clearNotifications();
		getSettings.mockResolvedValue(SETTINGS_RESPONSE);
		updateProvider.mockResolvedValue({} as UserProviderInfo);
	});

	test('a rejected folder-settings save warns instead of claiming success', async () => {
		updateSettings.mockRejectedValue(new Error('400'));

		renderEdit();
		await awaitLoaded();
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateSettings).toHaveBeenCalled());

		await vi.waitFor(() => {
			const warning = toasts().find(t => t.type === 'warning');
			expect(warning?.message).toMatch(/folder settings/i);
		});
		expect(toasts().some(t => t.type === 'success')).toBe(false);
	});

	test('a rejected backup-settings save warns instead of claiming success', async () => {
		// Only the backup PUT fails: the folder-settings PUT lands first and succeeds.
		updateSettings
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(new Error('503'))
			.mockResolvedValue({});

		renderEdit();
		await awaitLoaded();
		// Tick the backup toggle so the form has backup settings to persist.
		await fireEvent.click(screen.getByLabelText(/zip backup/i));
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(2));

		await vi.waitFor(() => {
			const warning = toasts().find(t => t.type === 'warning');
			expect(warning?.message).toMatch(/backup settings/i);
		});
		expect(toasts().some(t => t.type === 'success')).toBe(false);
	});
});
