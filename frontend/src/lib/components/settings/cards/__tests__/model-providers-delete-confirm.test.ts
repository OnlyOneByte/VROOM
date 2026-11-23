import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

const getProviders = vi.fn((_domain?: string) => Promise.resolve([] as UserProviderInfo[]));
const deleteProvider = vi.fn((_id: string) => Promise.resolve());
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getProviders: (domain?: string) => getProviders(domain),
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
		createProvider: vi.fn(),
		updateProvider: vi.fn(),
		deleteProvider: (id: string) => deleteProvider(id)
	}
}));

const ModelProvidersCard = (await import('../ModelProvidersCard.svelte')).default;

const WORK_CLAUDE: UserProviderInfo = {
	id: 'llm-1',
	domain: 'llm',
	providerType: 'anthropic',
	displayName: 'Work Claude',
	status: 'active',
	config: { model: 'claude-3-5-sonnet-latest' },
	createdAt: '2026-01-01T00:00:00.000Z'
};

beforeEach(() => {
	getProviders.mockReset();
	getProviders.mockResolvedValue([WORK_CLAUDE]);
	deleteProvider.mockClear();
});

describe('ModelProvidersCard delete', () => {
	test('asks before deleting and names what is lost', async () => {
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Work Claude' }));

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent('Delete assistant provider?');
		expect(dialog).toHaveTextContent(
			'"Work Claude" and its saved API key will be permanently deleted'
		);
		expect(deleteProvider).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(deleteProvider).toHaveBeenCalledWith('llm-1'));
	});

	test('a keyless provider is not said to lose an API key', async () => {
		getProviders.mockResolvedValue([
			{ ...WORK_CLAUDE, id: 'llm-2', providerType: 'ollama', displayName: 'Home Ollama' }
		]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Home Ollama' }));

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent('"Home Ollama" will be permanently deleted');
		expect(dialog).not.toHaveTextContent('API key');
	});

	test('a failed delete keeps the dialog open so the user can retry', async () => {
		deleteProvider.mockRejectedValueOnce(new Error('boom'));
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Work Claude' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

		await waitFor(() => expect(deleteProvider).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
		await new Promise(resolve => setTimeout(resolve, 300));
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
	});

	test('Cancel keeps the provider', async () => {
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Work Claude' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
		expect(deleteProvider).not.toHaveBeenCalled();
	});
});
