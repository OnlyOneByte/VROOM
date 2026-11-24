import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

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
	test.each([
		['Explore', 'Explore'],
		['Fuel & Stats', 'Fuel & Stats'],
		['Cross-Vehicle', 'Cross-Vehicle'],
		['Per-Vehicle', 'Per-Vehicle'],
		['Year-End', 'Year-End']
	])('%s says so and offers a reload', async (tab, name) => {
		render(Page);
		await fireEvent.click(await screen.findByRole('tab', { name: tab }));
		const title = await screen.findByText(`Couldn't load ${name}`);
		expect(screen.getByText('Check your connection, then reload the page.')).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2);
		expect(title).toBeVisible();
	});
});
