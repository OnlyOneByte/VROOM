import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { UserProviderInfo, UserSettings } from '#lib/types/index.ts';

const getProviders = vi.fn((_domain?: string) => Promise.resolve([] as UserProviderInfo[]));
vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: {
		getProviders: (domain?: string) => getProviders(domain),
		getCatalog: async () =>
			(await import('#lib/stores/__tests__/provider-catalog-fixtures.ts')).PROVIDER_CATALOG,
		testProvider: vi.fn()
	}
}));

const getSettings = vi.fn(() => Promise.resolve({} as UserSettings));
const updateSettings = vi.fn((_updates: Partial<UserSettings>) =>
	Promise.resolve({} as UserSettings)
);
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => getSettings(),
		updateSettings: (updates: Partial<UserSettings>) => updateSettings(updates)
	}
}));

const showSuccess = vi.fn<(message: string) => void>();
vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: { showError: vi.fn(), showSuccess: (message: string) => showSuccess(message) }
}));

const ModelProvidersCard = (await import('../ModelProvidersCard.svelte')).default;

function provider(id: string, displayName: string, createdAt: string, status = 'active') {
	return {
		id,
		domain: 'llm',
		providerType: 'anthropic',
		displayName,
		status,
		config: { model: 'claude-3-5-sonnet-latest' },
		createdAt
	} as UserProviderInfo;
}

const OLDER = provider('llm-old', 'Work Claude', '2026-01-01T00:00:00.000Z');
const NEWER = provider('llm-new', 'Home Claude', '2026-02-01T00:00:00.000Z');

async function mount(domain: 'llm' | 'vlm' = 'llm') {
	render(ModelProvidersCard, { props: { domain } });
	await screen.findByTestId(`${domain}-add-provider`);
}

async function rowWith(name: string, testId = 'llm-provider-row') {
	const rows = await screen.findAllByTestId(testId);
	const row = rows.find(candidate => candidate.textContent?.includes(name));
	if (!row) throw new Error(`no ${testId} contains ${name}`);
	return row;
}

beforeEach(() => {
	vi.clearAllMocks();
	getSettings.mockResolvedValue({} as UserSettings);
});
afterEach(() => cleanup());

describe('choosing which assistant provider is used', () => {
	test('one provider shows no picker', async () => {
		getProviders.mockResolvedValue([OLDER]);
		await mount();
		expect(screen.queryByText(/Used for the assistant/)).toBeNull();
		expect(screen.queryByRole('button', { name: /^Use for/ })).toBeNull();
	});

	test('without a saved choice the oldest provider is the one used', async () => {
		getProviders.mockResolvedValue([NEWER, OLDER]);
		await mount();
		expect(await rowWith('Work Claude')).toHaveTextContent('Used for the assistant');
		expect(screen.getAllByRole('button', { name: 'Use for the Assistant' })).toHaveLength(1);
	});

	test('a saved choice is shown, and picking another one saves it', async () => {
		getProviders.mockResolvedValue([OLDER, NEWER]);
		getSettings.mockResolvedValue({ providerDefaults: { 'ai.llm': 'llm-new' } } as UserSettings);
		await mount();
		expect(await rowWith('Home Claude')).toHaveTextContent('Used for the assistant');

		await fireEvent.click(screen.getByRole('button', { name: 'Use for the Assistant' }));
		await waitFor(() =>
			expect(showSuccess).toHaveBeenCalledWith('The assistant now uses Work Claude.')
		);
		expect(updateSettings).toHaveBeenCalledWith({ providerDefaults: { 'ai.llm': 'llm-old' } });
		await waitFor(async () =>
			expect(await rowWith('Work Claude')).toHaveTextContent('Used for the assistant')
		);
	});

	test('a turned-off provider is never offered or used', async () => {
		getProviders.mockResolvedValue([
			provider('llm-off', 'Old Key', '2025-01-01T00:00:00.000Z', 'disabled'),
			OLDER
		]);
		await mount();
		expect(screen.queryByRole('button', { name: /^Use for/ })).toBeNull();
		expect(screen.queryByText(/Used for the assistant/)).toBeNull();
	});

	test('if the saved choice can’t be loaded, it says so instead of guessing', async () => {
		getProviders.mockResolvedValue([OLDER, NEWER]);
		getSettings.mockRejectedValue(new Error('offline'));
		await mount();
		expect(screen.getAllByText("Couldn't load which provider the assistant uses.")).toHaveLength(2);
		expect(screen.queryByText(/Used for the assistant/)).toBeNull();
	});

	test('a tie on creation time is broken by id, as the server does', async () => {
		getProviders.mockResolvedValue([
			provider('llm-b', 'Second', '2026-01-01T00:00:00.000Z'),
			provider('llm-a', 'First', '2026-01-01T00:00:00.000Z')
		]);
		await mount();
		expect(await rowWith('First')).toHaveTextContent('Used for the assistant');
	});
});

describe('the built-in text reader in receipt scanning', () => {
	const VISION = { ...OLDER, id: 'vlm-1', domain: 'vlm', displayName: 'My GPT' };

	const mountVision = () => mount('vlm');

	test('with no AI provider it is listed and used, with nothing to pick', async () => {
		getProviders.mockResolvedValue([]);
		await mountVision();
		expect(screen.getByTestId('vlm-builtin-row')).toHaveTextContent('Built-in text reader');
		expect(screen.queryByRole('button', { name: /^Use for/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /Delete Built-in/ })).toBeNull();
	});

	test('an AI provider stays the default, and the built-in reader can be picked instead', async () => {
		getProviders.mockResolvedValue([VISION]);
		await mountVision();
		expect(screen.getByTestId('vlm-provider-row')).toHaveTextContent('Used for receipt scanning');
		await fireEvent.click(screen.getByRole('button', { name: 'Use for Receipt Scanning' }));
		await waitFor(() =>
			expect(screen.getByTestId('vlm-builtin-row')).toHaveTextContent('Used for receipt scanning')
		);
		expect(updateSettings).toHaveBeenCalledWith({
			providerDefaults: { 'ai.vision': 'builtin:local-ocr' }
		});
	});

	test('a saved built-in choice is shown as the one used', async () => {
		getProviders.mockResolvedValue([VISION]);
		getSettings.mockResolvedValue({
			providerDefaults: { 'ai.vision': 'builtin:local-ocr' }
		} as UserSettings);
		await mountVision();
		expect(screen.getByTestId('vlm-builtin-row')).toHaveTextContent('Used for receipt scanning');
		expect(screen.getByTestId('vlm-provider-row')).toHaveTextContent('Use for Receipt Scanning');
	});

	test('the add dialog offers only AI providers, not the built-in reader', async () => {
		getProviders.mockResolvedValue([]);
		await mountVision();
		await fireEvent.click(screen.getByTestId('vlm-add-provider'));
		await fireEvent.click(await screen.findByTestId('vlm-type-trigger'));
		expect(await screen.findByRole('option', { name: 'OpenAI-compatible' })).toBeInTheDocument();
		expect(screen.queryByRole('option', { name: 'Built-in text reader' })).toBeNull();
	});
});
