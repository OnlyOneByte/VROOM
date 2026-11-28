import { render, screen } from '@testing-library/svelte';
import { describe, expect, test, vi } from 'vitest';
import type { ProviderHealthCode, UserProviderInfo } from '#lib/types/index.ts';

vi.mock('#lib/services/provider-api.ts', () => ({
	providerApi: { getProviders: vi.fn(), testProvider: vi.fn() }
}));

const ProviderHealth = (await import('../ProviderHealth.svelte')).default;

function provider(lastErrorCode: ProviderHealthCode): UserProviderInfo {
	return {
		id: 'prov-1',
		domain: 'storage',
		providerType: 's3',
		displayName: 'Home MinIO',
		status: 'error',
		config: {},
		lastErrorCode,
		createdAt: '2026-01-01T00:00:00Z'
	};
}

describe('ProviderHealth', () => {
	test('a provider refused for its address says the server needs a public https:// one', () => {
		render(ProviderHealth, {
			props: { provider: provider('endpoint'), onFix: vi.fn(), onUpdated: vi.fn() }
		});
		expect(screen.getByText('This server only allows public https:// addresses.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Edit settings' })).toBeTruthy();
	});

	test('a settings problem keeps its own message', () => {
		render(ProviderHealth, {
			props: { provider: provider('config'), onFix: vi.fn(), onUpdated: vi.fn() }
		});
		expect(screen.getByText('These settings are incomplete or invalid.')).toBeTruthy();
	});

	test('a busy or rate-limited provider says to wait, not that it could not connect', () => {
		render(ProviderHealth, {
			props: { provider: provider('busy'), onFix: vi.fn(), onUpdated: vi.fn() }
		});
		expect(screen.getByText('The provider is busy or limiting requests right now.')).toBeTruthy();
		expect(screen.queryByText("Couldn't connect.")).toBeNull();
		expect(screen.queryByRole('button', { name: 'Edit settings' })).toBeNull();
	});
});
