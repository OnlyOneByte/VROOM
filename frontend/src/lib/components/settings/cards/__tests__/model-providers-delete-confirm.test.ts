import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

const getProviders = vi.fn((_domain?: string) => Promise.resolve([] as UserProviderInfo[]));
const deleteProvider = vi.fn((_id: string) => Promise.resolve());
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getProviders: (domain?: string) => getProviders(domain),
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

	test('Cancel keeps the provider', async () => {
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Delete Work Claude' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

		await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
		expect(deleteProvider).not.toHaveBeenCalled();
	});
});
