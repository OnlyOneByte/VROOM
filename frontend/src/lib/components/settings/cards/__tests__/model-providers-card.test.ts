import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

const getProviders = vi.fn((_domain?: string) => Promise.resolve([] as UserProviderInfo[]));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getProviders: (domain?: string) => getProviders(domain),
		createProvider: vi.fn(),
		updateProvider: vi.fn(),
		deleteProvider: vi.fn()
	}
}));

const ModelProvidersCard = (await import('../ModelProvidersCard.svelte')).default;

function provider(domain: string, displayName: string): UserProviderInfo {
	return {
		id: `${domain}-1`,
		domain,
		providerType: 'anthropic',
		displayName,
		status: 'active',
		config: { model: 'claude-3-5-sonnet-latest' },
		createdAt: '2026-01-01T00:00:00.000Z'
	};
}

beforeEach(() => {
	getProviders.mockReset();
});

describe('ModelProvidersCard', () => {
	test.each([
		['vlm', 'Receipt Parsing (AI)', 'No receipt-parsing provider configured'],
		['llm', 'Assistant (AI)', 'No assistant provider configured']
	] as const)(
		'%s domain loads its own providers and shows its copy',
		async (domain, title, empty) => {
			getProviders.mockResolvedValue([]);
			render(ModelProvidersCard, { props: { domain } });

			expect(await screen.findByText(empty)).toBeInTheDocument();
			expect(screen.getByText(title)).toBeInTheDocument();
			expect(getProviders).toHaveBeenCalledWith(domain);
			expect(document.querySelector(`[data-testid="${domain}-add-provider"]`)).not.toBeNull();
		}
	);

	test('lists the providers returned for the domain', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await waitFor(() =>
			expect(document.querySelectorAll('[data-testid="llm-provider-row"]')).toHaveLength(1)
		);
		expect(screen.getByText('Work Claude')).toBeInTheDocument();
		expect(screen.getByText(/Anthropic \(Claude\)/)).toBeInTheDocument();
	});

	test('a load failure surfaces the domain-specific error', async () => {
		getProviders.mockRejectedValue('boom');
		render(ModelProvidersCard, { props: { domain: 'vlm' } });

		expect(await screen.findByText('Failed to load receipt-parsing providers')).toBeInTheDocument();
	});
});
