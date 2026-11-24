import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
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

async function settle() {
	for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
}

async function mount() {
	render(ModelProvidersCard, { props: { domain: 'llm' } });
	await settle();
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
		const rows = screen.getAllByTestId('llm-provider-row');
		const used = rows.find(row => row.textContent?.includes('Work Claude'));
		expect(used?.textContent).toContain('Used for the assistant');
		expect(screen.getAllByRole('button', { name: 'Use for the Assistant' })).toHaveLength(1);
	});

	test('a saved choice is shown, and picking another one saves it', async () => {
		getProviders.mockResolvedValue([OLDER, NEWER]);
		getSettings.mockResolvedValue({ providerDefaults: { 'ai.llm': 'llm-new' } } as UserSettings);
		await mount();
		const rows = screen.getAllByTestId('llm-provider-row');
		expect(rows.find(row => row.textContent?.includes('Home Claude'))?.textContent).toContain(
			'Used for the assistant'
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Use for the Assistant' }));
		await settle();
		expect(updateSettings).toHaveBeenCalledWith({ providerDefaults: { 'ai.llm': 'llm-old' } });
		expect(showSuccess).toHaveBeenCalledWith('The assistant now uses Work Claude.');
		const after = screen.getAllByTestId('llm-provider-row');
		expect(after.find(row => row.textContent?.includes('Work Claude'))?.textContent).toContain(
			'Used for the assistant'
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
		const rows = screen.getAllByTestId('llm-provider-row');
		expect(rows.find(row => row.textContent?.includes('First'))?.textContent).toContain(
			'Used for the assistant'
		);
	});
});
