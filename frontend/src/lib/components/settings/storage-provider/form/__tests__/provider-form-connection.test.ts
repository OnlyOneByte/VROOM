import { beforeEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/settings/providers/new') }
}));

const oauth = vi.hoisted(() => ({ pendingEmail: '', oauthNonce: '' }));
vi.mock('../../use-google-oauth.svelte', () => ({
	useGoogleOAuth: () => ({
		get pendingEmail() {
			return oauth.pendingEmail;
		},
		get oauthNonce() {
			return oauth.oauthNonce;
		},
		startGoogleOAuth: vi.fn(),
		handleOAuthReturn: () => Promise.resolve({}),
		restoreFormState: () => null
	})
}));

interface ProviderPayload {
	providerType?: string;
	config?: Record<string, unknown>;
	credentials?: Record<string, unknown>;
	nonce?: string;
}

const createProvider = vi.fn((data: ProviderPayload) =>
	Promise.resolve({ id: 'new-1', ...data } as unknown as UserProviderInfo)
);
const updateProvider = vi.fn((_id: string, _data: ProviderPayload) =>
	Promise.resolve({} as UserProviderInfo)
);
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).STORAGE_CATALOG,
		createProvider: (data: ProviderPayload) => createProvider(data),
		updateProvider: (id: string, data: ProviderPayload) => updateProvider(id, data),
		deleteProvider: vi.fn()
	}
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => Promise.resolve({ backupConfig: { providers: {} } }),
		updateSettings: () => Promise.resolve({})
	}
}));

const { settingsStore } = await import('#lib/stores/settings.svelte.ts');
const ProviderForm = (await import('../ProviderForm.svelte')).default;

const saveButton = () =>
	screen.getByRole('button', { name: /save provider|update provider/i }) as HTMLButtonElement;
const type = (label: string, value: string) =>
	fireEvent.input(screen.getByLabelText(label), { target: { value } });

async function startCreate(typeName: RegExp) {
	render(ProviderForm, { props: {} });
	await fireEvent.click(screen.getByRole('button', { name: typeName }));
	await type('Name', 'My Provider');
}

beforeAll(async () => {
	const { providerCatalog } = await import('#lib/stores/provider-catalog.svelte.ts');
	await providerCatalog.ensureLoaded();
});

beforeEach(() => {
	vi.clearAllMocks();
	settingsStore.reset();
	oauth.pendingEmail = '';
	oauth.oauthNonce = '';
});

describe('ProviderForm connection contract', () => {
	test('S3 can be saved only with both keys, and sends them with its endpoint, bucket and region', async () => {
		await startCreate(/S3 \/ B2 \/ R2/);
		await type('Endpoint', 'https://s3.example.com');
		await type('Bucket', 'vroom');
		await type('Region', 'us-east-1');
		await type('Access Key ID', 'AKIA');
		expect(saveButton().disabled).toBe(true);

		await type('Secret Access Key', 'secret');
		expect(saveButton().disabled).toBe(false);
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(createProvider).toHaveBeenCalled());

		const sent = createProvider.mock.calls[0]?.[0];
		expect(sent?.credentials).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 'secret' });
		expect(sent?.config).toMatchObject({
			endpoint: 'https://s3.example.com',
			bucket: 'vroom',
			region: 'us-east-1'
		});
		expect(sent?.nonce).toBeUndefined();
	});

	test('switching from a filled-in S3 form to Drive leaves Save off until Google is connected', async () => {
		await startCreate(/S3 \/ B2 \/ R2/);
		await type('Endpoint', 'https://s3.example.com');
		await type('Bucket', 'vroom');
		await type('Access Key ID', 'AKIA');
		await type('Secret Access Key', 'secret');
		expect(saveButton().disabled).toBe(false);

		await fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));
		expect(saveButton().disabled).toBe(true);
	});

	test('a connected Drive account is saved with the OAuth nonce and no S3 data', async () => {
		oauth.pendingEmail = 'me@example.com';
		oauth.oauthNonce = '0f8fad5b-d9cb-469f-a165-70867728950e';
		await startCreate(/S3 \/ B2 \/ R2/);
		await type('Endpoint', 'https://s3.example.com');
		await fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

		expect(saveButton().disabled).toBe(false);
		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(createProvider).toHaveBeenCalled());

		const sent = createProvider.mock.calls[0]?.[0];
		expect(sent?.providerType).toBe('google-drive');
		expect(sent?.nonce).toBe(oauth.oauthNonce);
		expect(sent?.credentials).toEqual({});
		expect(sent?.config).not.toHaveProperty('endpoint');
	});

	test('editing S3 with the key fields left blank keeps the stored keys', async () => {
		render(ProviderForm, {
			props: {
				providerId: 's3-1',
				existingProvider: {
					id: 's3-1',
					domain: 'storage',
					providerType: 's3',
					displayName: 'Bucket',
					status: 'active',
					config: { endpoint: 'https://s3.example.com', bucket: 'vroom', region: 'eu-1' },
					createdAt: '2026-01-01T00:00:00.000Z'
				}
			}
		});
		await vi.waitFor(() =>
			expect((screen.getByLabelText('Endpoint') as HTMLInputElement).value).toBe(
				'https://s3.example.com'
			)
		);
		expect(saveButton().disabled).toBe(false);

		await fireEvent.click(saveButton());
		await vi.waitFor(() => expect(updateProvider).toHaveBeenCalled());

		const sent = updateProvider.mock.calls[0]?.[1];
		expect(sent).not.toHaveProperty('credentials');
		expect(sent?.config).toMatchObject({ endpoint: 'https://s3.example.com', region: 'eu-1' });
	});
});
