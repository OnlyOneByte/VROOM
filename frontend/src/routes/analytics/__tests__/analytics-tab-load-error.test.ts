import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';

const failedChunk = vi.hoisted(() => () => {
	throw new Error('Failed to fetch dynamically imported module');
});

vi.mock('#lib/components/analytics/explore/ExploreTab.svelte', failedChunk);
vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', failedChunk);
vi.mock('#lib/components/analytics/CrossVehicleTab.svelte', failedChunk);
vi.mock('#lib/components/analytics/PerVehicleTab.svelte', failedChunk);
vi.mock('#lib/components/analytics/YearEndTab.svelte', failedChunk);
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { getSummary: () => Promise.reject(new Error('offline')) },
	getDefaultDateRange: () => ({})
}));

const { default: Page } = await import('../+page.svelte');

describe('a tab whose code fails to load', () => {
	test.each(['Explore', 'Fuel & charging', 'Cross-vehicle', 'Per-vehicle', 'Year in review'])(
		'%s says so and offers a reload',
		async tab => {
			render(Page);
			await fireEvent.click(await screen.findByRole('tab', { name: tab }));
			const panel = await screen.findByRole('tabpanel');
			const card = within(panel);
			expect(await card.findByText(`Couldn't load ${tab}`)).toBeVisible();
			expect(card.getByText('Check your connection, then reload the page.')).toBeInTheDocument();
			expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		}
	);
});
