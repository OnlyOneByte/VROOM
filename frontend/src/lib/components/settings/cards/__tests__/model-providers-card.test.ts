import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';

const getProviders = vi.fn((_domain?: string) => Promise.resolve([] as UserProviderInfo[]));
const createProvider = vi.fn((_data: Record<string, unknown>) =>
	Promise.resolve({} as UserProviderInfo)
);
const updateProvider = vi.fn((_id: string, _data: Record<string, unknown>) =>
	Promise.resolve({} as UserProviderInfo)
);
const deleteProvider = vi.fn((_id: string) => Promise.resolve());
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getProviders: (domain?: string) => getProviders(domain),
		createProvider: (data: Record<string, unknown>) => createProvider(data),
		updateProvider: (id: string, data: Record<string, unknown>) => updateProvider(id, data),
		deleteProvider: (id: string) => deleteProvider(id)
	}
}));

const showError = vi.fn<(message: string) => void>();
const showSuccess = vi.fn<(message: string) => void>();
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		showError: (message: string) => showError(message),
		showSuccess: (message: string) => showSuccess(message)
	}
}));

const ModelProvidersCard = (await import('../ModelProvidersCard.svelte')).default;

function provider(
	domain: string,
	displayName: string,
	overrides: Partial<UserProviderInfo> = {}
): UserProviderInfo {
	return {
		id: `${domain}-1`,
		domain,
		providerType: 'anthropic',
		displayName,
		status: 'active',
		config: { model: 'claude-3-5-sonnet-latest' },
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

function input(id: string): HTMLInputElement {
	const el = document.getElementById(id);
	if (!el) throw new Error(`missing #${id}`);
	return el as HTMLInputElement;
}

async function type(id: string, value: string) {
	await fireEvent.input(input(id), { target: { value } });
}

function saveButton(domain: string): HTMLButtonElement {
	const el = document.querySelector<HTMLButtonElement>(`[data-testid="${domain}-save-provider"]`);
	if (!el) throw new Error('save button missing');
	return el;
}

async function openCreate(domain: 'vlm' | 'llm') {
	render(ModelProvidersCard, { props: { domain } });
	await settle();
	const add = document.querySelector<HTMLButtonElement>(`[data-testid="${domain}-add-provider"]`);
	if (!add) throw new Error('add button missing');
	await fireEvent.click(add);
	await settle();
}

beforeEach(() => {
	vi.clearAllMocks();
	getProviders.mockResolvedValue([]);
});

afterEach(() => {
	cleanup();
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

	test('a provider with an unknown type and no model shows the raw type id', async () => {
		getProviders.mockResolvedValue([
			provider('llm', 'Custom', { providerType: 'mystery', config: {} })
		]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		const row = document.querySelector('[data-testid="llm-provider-row"]');
		expect(row).toHaveTextContent('mystery');
		expect(row).not.toHaveTextContent('·');
	});

	test('a load failure surfaces the domain-specific error', async () => {
		getProviders.mockRejectedValue('boom');
		render(ModelProvidersCard, { props: { domain: 'vlm' } });

		expect(await screen.findByText('Failed to load receipt-parsing providers')).toBeInTheDocument();
	});

	test('a load failure with an Error shows its message', async () => {
		getProviders.mockRejectedValue(new Error('Server unavailable'));
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
	});
});

describe('ModelProvidersCard add provider', () => {
	test('opens with OpenAI-compatible defaults and requires name and key', async () => {
		await openCreate('llm');
		expect(screen.getByText('Add assistant provider')).toBeInTheDocument();
		expect(screen.getByTestId('llm-type-trigger')).toHaveTextContent('OpenAI-compatible');
		expect(input('llm-model')).toHaveValue('gpt-4o-mini');
		expect(input('llm-baseurl')).toHaveValue('https://api.openai.com/v1');
		expect(input('llm-key')).toHaveAttribute('placeholder', 'sk-…');
		expect(saveButton('llm')).toBeDisabled();

		await type('llm-name', 'My GPT');
		expect(saveButton('llm')).toBeDisabled();
		await type('llm-key', 'sk-123');
		expect(saveButton('llm')).not.toBeDisabled();
	});

	test('a blank base URL or model blocks saving', async () => {
		await openCreate('llm');
		await type('llm-name', 'My GPT');
		await type('llm-key', 'sk-123');
		await type('llm-baseurl', '  ');
		expect(saveButton('llm')).toBeDisabled();
		await type('llm-baseurl', 'https://proxy.example/v1');
		await type('llm-model', ' ');
		expect(saveButton('llm')).toBeDisabled();
	});

	test('saving posts the trimmed provider, confirms and reloads', async () => {
		await openCreate('vlm');
		await type('vlm-name', '  Receipts GPT ');
		await type('vlm-key', ' sk-abc ');
		await type('vlm-model', ' gpt-4o ');
		await type('vlm-baseurl', ' https://proxy.example/v1 ');
		await fireEvent.click(saveButton('vlm'));
		await settle();

		expect(createProvider).toHaveBeenCalledWith({
			domain: 'vlm',
			providerType: 'openai-compatible',
			displayName: 'Receipts GPT',
			credentials: { apiKey: 'sk-abc' },
			config: { model: 'gpt-4o', baseUrl: 'https://proxy.example/v1' }
		});
		expect(showSuccess).toHaveBeenCalledWith('Receipts GPT added');
		expect(getProviders).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(screen.queryByText('Add receipt-parsing provider')).toBeNull());
	});

	test('a create failure reports the error and keeps the dialog open', async () => {
		createProvider.mockRejectedValueOnce(new Error('Invalid API key'));
		await openCreate('llm');
		await type('llm-name', 'Bad');
		await type('llm-key', 'sk-bad');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(showError).toHaveBeenCalledWith('Invalid API key');
		expect(screen.getByText('Add assistant provider')).toBeInTheDocument();
		expect(saveButton('llm')).not.toBeDisabled();
	});

	test('a non-Error create failure reports a generic message', async () => {
		createProvider.mockRejectedValueOnce('nope');
		await openCreate('llm');
		await type('llm-name', 'Bad');
		await type('llm-key', 'sk-bad');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(showError).toHaveBeenCalledWith('Failed to save provider');
	});

	test('the save button shows a saving state while the request is pending', async () => {
		createProvider.mockReturnValueOnce(new Promise(() => {}));
		await openCreate('llm');
		await type('llm-name', 'Slow');
		await type('llm-key', 'sk-slow');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(saveButton('llm')).toHaveTextContent('Saving...');
		expect(saveButton('llm')).toBeDisabled();
	});

	test('cancel closes the dialog without saving', async () => {
		await openCreate('llm');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(screen.queryByText('Add assistant provider')).toBeNull());
		expect(createProvider).not.toHaveBeenCalled();
	});

	test('the empty-state button also opens the add dialog', async () => {
		render(ModelProvidersCard, { props: { domain: 'vlm' } });
		await settle();
		const buttons = screen.getAllByRole('button', { name: /Add Provider/ });
		await fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
		expect(await screen.findByText('Add receipt-parsing provider')).toBeInTheDocument();
	});
});

describe('ModelProvidersCard edit and delete', () => {
	test('editing prefills the provider and saves without requiring a new key', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Work Claude' }));
		await settle();

		expect(screen.getByText('Edit assistant provider')).toBeInTheDocument();
		expect(screen.getByTestId('llm-type-trigger')).toHaveTextContent('Anthropic (Claude)');
		expect(screen.getByTestId('llm-type-trigger')).toBeDisabled();
		expect(input('llm-name')).toHaveValue('Work Claude');
		expect(input('llm-model')).toHaveValue('claude-3-5-sonnet-latest');
		expect(document.getElementById('llm-baseurl')).toBeNull();
		expect(input('llm-key')).toHaveAttribute('placeholder', 'Leave blank to keep current key');

		await type('llm-name', 'Home Claude');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(updateProvider).toHaveBeenCalledWith('llm-1', {
			displayName: 'Home Claude',
			config: { model: 'claude-3-5-sonnet-latest' }
		});
		expect(showSuccess).toHaveBeenCalledWith('Home Claude updated');
	});

	test('editing with a new key sends the replacement credentials', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Work Claude' }));
		await settle();
		await type('llm-key', ' sk-new ');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(updateProvider).toHaveBeenCalledWith('llm-1', {
			displayName: 'Work Claude',
			config: { model: 'claude-3-5-sonnet-latest' },
			credentials: { apiKey: 'sk-new' }
		});
	});

	test('editing a keyless self-hosted provider shows base URL but no key field', async () => {
		getProviders.mockResolvedValue([
			provider('vlm', 'Local Llava', {
				providerType: 'ollama',
				config: { model: 'llava', baseUrl: 'http://nas:11434/v1' }
			})
		]);
		render(ModelProvidersCard, { props: { domain: 'vlm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Local Llava' }));
		await settle();
		expect(input('vlm-baseurl')).toHaveValue('http://nas:11434/v1');
		expect(document.getElementById('vlm-key')).toBeNull();
		await fireEvent.click(saveButton('vlm'));
		await settle();
		expect(updateProvider).toHaveBeenCalledWith('vlm-1', {
			displayName: 'Local Llava',
			config: { model: 'llava', baseUrl: 'http://nas:11434/v1' }
		});
	});

	test('editing a provider with non-string config leaves model and URL blank', async () => {
		getProviders.mockResolvedValue([
			provider('llm', 'Odd', { providerType: 'openai-compatible', config: { model: 7 } })
		]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Odd' }));
		await settle();
		expect(input('llm-model')).toHaveValue('');
		expect(input('llm-baseurl')).toHaveValue('');
		expect(saveButton('llm')).toBeDisabled();
	});

	test('deleting removes the provider, confirms and reloads', async () => {
		getProviders.mockResolvedValueOnce([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Work Claude' }));
		await settle();
		expect(deleteProvider).toHaveBeenCalledWith('llm-1');
		expect(showSuccess).toHaveBeenCalledWith('Work Claude removed');
		expect(await screen.findByText('No assistant provider configured')).toBeInTheDocument();
	});

	test('a delete failure reports an error and keeps the provider', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		deleteProvider.mockRejectedValueOnce(new Error('x'));
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Work Claude' }));
		await settle();
		expect(showError).toHaveBeenCalledWith('Failed to delete provider');
		expect(screen.getByText('Work Claude')).toBeInTheDocument();
	});
});
