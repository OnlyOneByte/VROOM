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
		expect(
			screen.getByText('This server only lets providers reach public https:// addresses.')
		).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Edit Provider' })).toBeTruthy();
	});

	test('a settings problem keeps its own message', () => {
		render(ProviderHealth, {
			props: { provider: provider('config'), onFix: vi.fn(), onUpdated: vi.fn() }
		});
		expect(
			screen.getByText('The settings for this provider are incomplete or invalid.')
		).toBeTruthy();
	});
});
