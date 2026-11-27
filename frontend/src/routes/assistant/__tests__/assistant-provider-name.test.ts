import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const { getProviders, getSettings } = vi.hoisted(() => ({
	getProviders: vi.fn<(domain?: string) => Promise<unknown[]>>(),
	getSettings: vi.fn<() => Promise<unknown>>()
}));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: (domain?: string) => getProviders(domain) }
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: { getSettings: () => getSettings() }
}));

const Page = (await import('../+page.svelte')).default;

const provider = (id: string, displayName: string, createdAt: string, status = 'active') => ({
	id,
	displayName,
	createdAt,
	status
});

beforeEach(() => {
	getProviders
		.mockReset()
		.mockResolvedValue([
			provider('new', 'Work Claude', '2026-02-01T00:00:00Z'),
			provider('old', 'Home OpenAI', '2026-01-01T00:00:00Z'),
			provider('off', 'Old Ollama', '2025-01-01T00:00:00Z', 'disabled')
		]);
	getSettings.mockReset().mockResolvedValue({ providerDefaults: {} });
});

afterEach(cleanup);

describe('assistant page names its provider', () => {
	test('names the oldest working provider when none is chosen, with a link to change it', async () => {
		render(Page);

		const line = await screen.findByTestId('assistant-provider');
		expect(line).toHaveTextContent('Using Home OpenAI · Change');
		expect(screen.getByRole('link', { name: 'Change the assistant provider' })).toHaveAttribute(
			'href',
			'/settings/ai#assistant-providers'
		);
	});

	test('names the provider chosen in Settings', async () => {
		getSettings.mockResolvedValue({ providerDefaults: { 'ai.llm': 'new' } });
		render(Page);

		expect(await screen.findByTestId('assistant-provider')).toHaveTextContent('Using Work Claude');
	});

	test('names no provider when Settings fail to load, since the chosen one is unknown', async () => {
		getSettings.mockRejectedValue(new Error('offline'));
		render(Page);

		expect(await screen.findByTestId('assistant-chat')).toBeInTheDocument();
		expect(screen.queryByTestId('assistant-provider')).not.toBeInTheDocument();
	});

	test('a turned-off provider does not count as connected', async () => {
		getProviders.mockResolvedValue([
			provider('off', 'Old Ollama', '2025-01-01T00:00:00Z', 'disabled')
		]);
		render(Page);

		expect(await screen.findByText('No assistant provider connected')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Set up the assistant' })).toHaveAttribute(
			'href',
			'/settings/ai#assistant-providers'
		);
	});
});
