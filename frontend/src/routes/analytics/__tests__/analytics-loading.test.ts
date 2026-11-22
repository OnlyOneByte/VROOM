import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		getSummary: () => new Promise(() => {})
	},
	getDefaultDateRange: () => ({})
}));

import Page from '../+page.svelte';

describe('analytics while the summary loads', () => {
	test('reserves the four quick-stat tiles above the tabs with skeletons', async () => {
		const { container } = render(Page);

		const tabs = await screen.findByRole('tablist');
		const tiles = [...container.querySelectorAll('[data-slot="card"]')];
		expect(tiles).toHaveLength(4);
		for (const tile of tiles) {
			expect(tile.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
			expect(tile.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
		expect(container.querySelector('.animate-spin')).toBeNull();
	});
});
