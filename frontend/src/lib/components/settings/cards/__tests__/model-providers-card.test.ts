import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { hasPendingSave } from '#lib/utils/pending-saves.ts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo } from '#lib/types/index.ts';
import {
	ApiError,
	SERVER_FAILURE_MESSAGE,
	UNEXPECTED_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';

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
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
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
	test('the Assistant page link scrolls to the assistant card once its providers load', async () => {
		const scrollIntoView = vi.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		history.replaceState(null, '', '#assistant-providers');
		render(ModelProvidersCard, { props: { domain: 'vlm' } });
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();

		expect(scrollIntoView).toHaveBeenCalledTimes(1);
		expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('assistant-providers'));
		history.replaceState(null, '', '#');
	});

	test.each([
		['vlm', 'Receipt Scanning', 'Built-in text reader'],
		['llm', 'Assistant (AI)', 'No assistant provider connected']
	] as const)(
		'%s domain loads its own providers and shows its copy',
		async (domain, title, empty) => {
			getProviders.mockResolvedValue([]);
			render(ModelProvidersCard, { props: { domain } });

			expect(await screen.findByText(empty)).toBeInTheDocument();
			expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
			expect(getProviders).toHaveBeenCalledWith(domain);
			expect(document.querySelector(`[data-testid="${domain}-add-provider"]`)).not.toBeNull();
		}
	);

	test('the card leads with one line and keeps the privacy details behind How it works', async () => {
		getProviders.mockResolvedValue([]);
		const { container } = render(ModelProvidersCard, { props: { domain: 'vlm' } });
		await screen.findByText('Built-in text reader');

		expect(
			screen.getByText('Scan receipts into expense drafts, built in or with your own AI key.')
		).toBeInTheDocument();
		const details = container.querySelector('details');
		expect(details?.open).toBe(false);
		expect(details?.querySelector('summary')).toHaveTextContent('How it works');
		expect(details).toHaveTextContent(/self-host with Ollama/);
	});

	test('an empty card has one add button, named for the card and 40px tall on phones', async () => {
		getProviders.mockResolvedValue([]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await screen.findByText('No assistant provider connected');
		const addButtons = screen.getAllByRole('button', { name: /^Add / });
		expect(addButtons).toHaveLength(1);
		expect(addButtons[0]).toHaveAccessibleName('Add Assistant Provider');
		expect(addButtons[0]?.className).toMatch(/(^|\s)h-10(\s|$)/);
	});

	test('with a provider, the one add button moves to the Providers row', async () => {
		getProviders.mockResolvedValue([provider('vlm', 'Receipt Bot')]);
		render(ModelProvidersCard, { props: { domain: 'vlm' } });

		await screen.findByText('Receipt Bot');
		const addButtons = screen.getAllByRole('button', { name: /^Add / });
		expect(addButtons).toHaveLength(1);
		expect(addButtons[0]).toHaveAccessibleName('Add AI Provider');
		expect(screen.queryByText('No receipt-scanning provider connected')).toBeNull();
	});

	test('lists the providers returned for the domain', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await waitFor(() =>
			expect(document.querySelectorAll('[data-testid="llm-provider-row"]')).toHaveLength(1)
		);
		expect(screen.getByText('Work Claude')).toBeInTheDocument();
		expect(screen.getByText(/Anthropic \(Claude\)/)).toBeInTheDocument();
	});

	test('a provider’s edit and delete icons are 40px tap targets on phones, 8px apart', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		const edit = await screen.findByRole('button', { name: 'Edit Work Claude' });
		const del = screen.getByRole('button', { name: 'Delete Work Claude' });
		for (const button of [edit, del]) expect(button.className).toMatch(/(^|\s)size-10(\s|$)/);
		expect(edit.parentElement?.className).toMatch(/(^|\s)gap-2(\s|$)/);
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

		expect(
			await screen.findByText(
				`Couldn't load your receipt-scanning providers. ${UNEXPECTED_FAILURE_MESSAGE}`
			)
		).toBeInTheDocument();
	});

	test('a load failure offers a 40px Retry that reloads the list', async () => {
		getProviders
			.mockRejectedValueOnce(new ApiError('boom', 500))
			.mockResolvedValueOnce([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		const retry = await screen.findByRole('button', { name: 'Retry' });
		expect(retry.className).toMatch(/(^|\s)h-10(\s|$)/);
		await fireEvent.click(retry);

		expect(await screen.findByText('Work Claude')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
		expect(getProviders).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(screen.getByTestId('llm-add-provider')).toHaveFocus());
	});

	test('a failed Retry announces the error and keeps focus on the new Retry', async () => {
		getProviders.mockRejectedValue(new ApiError('boom', 500));
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus());
		expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your assistant providers.");
		expect(getProviders).toHaveBeenCalledTimes(2);
	});

	test('a server failure on load shows a plain sentence, not the raw server message', async () => {
		getProviders.mockRejectedValue(new ApiError('boom', 500));
		render(ModelProvidersCard, { props: { domain: 'llm' } });

		expect(
			await screen.findByText(`Couldn't load your assistant providers. ${SERVER_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
		expect(screen.queryByText(/boom/)).toBeNull();
	});
});

describe('ModelProvidersCard add provider', () => {
	test('opens with OpenAI-compatible defaults and requires name and key', async () => {
		await openCreate('llm');
		expect(screen.getByRole('heading', { name: 'Add assistant provider' })).toBeInTheDocument();
		expect(screen.getByTestId('llm-type-trigger')).toHaveTextContent('OpenAI-compatible');
		expect(input('llm-model')).toHaveValue('gpt-4o-mini');
		expect(input('llm-baseUrl')).toHaveValue('https://api.openai.com/v1');
		expect(input('llm-apiKey')).toHaveAttribute('placeholder', 'Enter API key');
		expect(saveButton('llm')).toBeDisabled();

		await type('llm-name', 'My GPT');
		expect(saveButton('llm')).toBeDisabled();
		await type('llm-apiKey', 'sk-123');
		expect(saveButton('llm')).not.toBeDisabled();
	});

	test('a blank base URL or model blocks saving', async () => {
		await openCreate('llm');
		await type('llm-name', 'My GPT');
		await type('llm-apiKey', 'sk-123');
		await type('llm-baseUrl', '  ');
		expect(saveButton('llm')).toBeDisabled();
		await type('llm-baseUrl', 'https://proxy.example/v1');
		await type('llm-model', ' ');
		expect(saveButton('llm')).toBeDisabled();
	});

	test('saving posts the trimmed provider, confirms and reloads', async () => {
		await openCreate('vlm');
		await type('vlm-name', '  Receipts GPT ');
		await type('vlm-apiKey', ' sk-abc ');
		await type('vlm-model', ' gpt-4o ');
		await type('vlm-baseUrl', ' https://proxy.example/v1 ');
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
		await waitFor(() =>
			expect(screen.queryByRole('heading', { name: 'Add receipt-scanning provider' })).toBeNull()
		);
	});

	test('a create failure reports the error and keeps the dialog open', async () => {
		createProvider.mockRejectedValueOnce(new ApiError('Invalid API key', 400));
		await openCreate('llm');
		await type('llm-name', 'Bad');
		await type('llm-apiKey', 'sk-bad');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(showError).toHaveBeenCalledWith("Couldn't save the provider. Invalid API key.");
		expect(screen.getByRole('heading', { name: 'Add assistant provider' })).toBeInTheDocument();
		expect(saveButton('llm')).not.toBeDisabled();
	});

	test('a field the backend refuses gets the message and the focus', async () => {
		createProvider.mockRejectedValueOnce(
			new ApiError('LLM base URL must use https', 400, {
				issues: [{ path: ['baseUrl'], message: 'LLM base URL must use https' }]
			})
		);
		await openCreate('llm');
		await type('llm-name', 'Bad');
		await type('llm-apiKey', 'sk-bad');
		await fireEvent.click(saveButton('llm'));
		await settle();
		const baseUrl = input('llm-baseUrl');
		expect(baseUrl).toHaveAttribute('aria-invalid', 'true');
		expect(document.activeElement).toBe(baseUrl);
	});

	test('a non-Error create failure reports a generic message', async () => {
		createProvider.mockRejectedValueOnce('nope');
		await openCreate('llm');
		await type('llm-name', 'Bad');
		await type('llm-apiKey', 'sk-bad');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't save the provider. ${UNEXPECTED_FAILURE_MESSAGE}`
		);
	});

	test('the save button shows a saving state while the request is pending', async () => {
		createProvider.mockReturnValueOnce(new Promise(() => {}));
		await openCreate('llm');
		await type('llm-name', 'Slow');
		await type('llm-apiKey', 'sk-slow');
		await fireEvent.click(saveButton('llm'));
		await settle();
		expect(saveButton('llm')).toHaveTextContent('Saving...');
		expect(saveButton('llm')).toBeDisabled();
	});

	test('a provider save in flight counts as unsaved changes until the card closes', async () => {
		createProvider.mockReturnValueOnce(new Promise(() => {}));
		await openCreate('llm');
		await type('llm-name', 'Slow');
		await type('llm-apiKey', 'sk-slow');
		expect(hasPendingSave()).toBe(false);

		await fireEvent.click(saveButton('llm'));
		await settle();

		expect(hasPendingSave()).toBe(true);
		cleanup();
		expect(hasPendingSave()).toBe(false);
	});

	test('cancel closes the dialog without saving', async () => {
		await openCreate('llm');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() =>
			expect(screen.queryByRole('heading', { name: 'Add assistant provider' })).toBeNull()
		);
		expect(createProvider).not.toHaveBeenCalled();
	});

	test('the empty-state button also opens the add dialog', async () => {
		render(ModelProvidersCard, { props: { domain: 'vlm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Add AI Provider' }));
		expect(
			await screen.findByRole('heading', { name: 'Add receipt-scanning provider' })
		).toBeInTheDocument();
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
		expect(document.getElementById('llm-baseUrl')).toBeNull();
		expect(input('llm-apiKey')).toHaveAttribute('placeholder', 'Saved, leave blank to keep');

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
		await type('llm-apiKey', ' sk-new ');
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
		expect(input('vlm-baseUrl')).toHaveValue('http://nas:11434/v1');
		expect(document.getElementById('vlm-apiKey')).toBeNull();
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
		expect(input('llm-baseUrl')).toHaveValue('');
		expect(saveButton('llm')).toBeDisabled();
	});

	test('deleting removes the provider, confirms and reloads', async () => {
		getProviders.mockResolvedValueOnce([provider('llm', 'Work Claude')]);
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Work Claude' }));
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		);
		await settle();
		expect(deleteProvider).toHaveBeenCalledWith('llm-1');
		expect(showSuccess).toHaveBeenCalledWith('Work Claude removed');
		expect(await screen.findByText('No assistant provider connected')).toBeInTheDocument();
	});

	test('a delete failure reports an error and keeps the provider', async () => {
		getProviders.mockResolvedValue([provider('llm', 'Work Claude')]);
		deleteProvider.mockRejectedValueOnce(new ApiError('SQLITE_BUSY', 500));
		render(ModelProvidersCard, { props: { domain: 'llm' } });
		await settle();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete Work Claude' }));
		await fireEvent.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' })
		);
		await settle();
		expect(showError).toHaveBeenCalledWith(
			`Couldn't delete the provider. ${SERVER_FAILURE_MESSAGE}`
		);
		expect(screen.getByText('Work Claude')).toBeInTheDocument();
	});
});
