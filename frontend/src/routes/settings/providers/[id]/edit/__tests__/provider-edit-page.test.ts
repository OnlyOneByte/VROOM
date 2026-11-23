import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { UserProviderInfo } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const { page, getProviders, getSettings, goto } = vi.hoisted(() => ({
	page: {
		params: { id: 'prov-1' } as Record<string, string>,
		url: new URL('https://app.example/settings/providers/prov-1/edit')
	},
	getProviders: vi.fn<() => Promise<UserProviderInfo[]>>(),
	getSettings: vi.fn(),
	goto: vi.fn(() => Promise.resolve())
}));

vi.mock('$app/state', () => ({ page }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/provider-api.ts', async importOriginal => ({
	...(await importOriginal<typeof import('#lib/services/provider-api.ts')>()),
	providerApi: {
		getProviders: () => getProviders(),
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG
	}
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: { getSettings: () => getSettings() }
}));

const { settingsStore } = await import('#lib/stores/settings.svelte.ts');
const EditPage = (await import('../+page.svelte')).default;

const S3: UserProviderInfo = {
	id: 'prov-1',
	domain: 'storage',
	providerType: 's3',
	displayName: 'Test Bucket',
	status: 'active',
	config: { endpoint: 'https://s3.example', bucket: 'b', region: 'us-east-1' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

beforeEach(() => {
	vi.clearAllMocks();
	settingsStore.reset();
	getSettings.mockResolvedValue({ storageConfig: null, backupConfig: { providers: {} } });
});

describe('storage provider edit page states', () => {
	test('loading keeps the heading and gives the spinner a name', () => {
		getProviders.mockReturnValue(new Promise(() => {}));
		render(EditPage);

		expect(screen.getByRole('heading', { level: 1, name: 'Edit Provider' })).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('Loading provider');
	});

	test('an unknown provider keeps the heading and offers a 40px Back to Settings', async () => {
		getProviders.mockResolvedValue([]);
		render(EditPage);

		expect(await screen.findByText('Provider not found')).toBeInTheDocument();
		expect(screen.getByRole('heading', { level: 1, name: 'Edit Provider' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		const back = screen.getByText('Back to Settings', { selector: 'button' });
		expect(back.className).toMatch(/(^|\s)h-10(\s|$)/);
		await fireEvent.click(back);
		expect(goto).toHaveBeenCalledWith('/settings');
	});

	test('a failed load announces the reason, and a failed Retry keeps focus on Retry', async () => {
		getProviders.mockRejectedValue(new ApiError('boom', 500));
		render(EditPage);

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent("Couldn't load this provider");
		expect(alert).toHaveTextContent(SERVER_FAILURE_MESSAGE);
		expect(screen.getByRole('heading', { level: 1, name: 'Edit Provider' })).toBeInTheDocument();
		expect(screen.queryByText(/boom/)).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus());
		expect(getProviders).toHaveBeenCalledTimes(2);
	});

	test('a Retry that works shows the provider form', async () => {
		getProviders.mockRejectedValueOnce(new ApiError('boom', 500)).mockResolvedValueOnce([S3]);
		render(EditPage);

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		expect(await screen.findByDisplayValue('Test Bucket')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	test('the header is the same while loading and once the form loads, so it does not jump', async () => {
		let resolveProviders: (list: UserProviderInfo[]) => void = () => {};
		getProviders.mockReturnValue(new Promise(r => (resolveProviders = r)));
		render(EditPage);
		const headerText = () => screen.getByRole('heading', { level: 1 }).parentElement?.textContent;
		const loadingHeader = headerText();

		resolveProviders([S3]);
		await screen.findByDisplayValue('Test Bucket');

		expect(loadingHeader).toContain('Update your storage provider configuration');
		expect(headerText()).toBe(loadingHeader);
	});
});
