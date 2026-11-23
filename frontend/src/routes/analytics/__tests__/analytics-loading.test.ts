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
	test('reserves the four quick-stat tiles with icon-shaped skeletons and holds the tabs', async () => {
		const { container } = render(Page);

		const tiles = [...container.querySelectorAll('[data-slot="card"]')];
		expect(tiles).toHaveLength(4);
		for (const tile of tiles) {
			expect(tile.querySelector('[data-slot="skeleton"].rounded-xl')).not.toBeNull();
		}
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(container.querySelector('.animate-spin')).toBeNull();
	});
});
