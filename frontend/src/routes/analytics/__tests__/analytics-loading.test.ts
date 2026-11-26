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
	test('reserves the tab strip with one skeleton, names the page, and holds the tabs', async () => {
		const { container } = render(Page);

		expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument();
		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1);
		expect(container.querySelector('[data-slot="card"]')).toBeNull();
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(container.querySelector('.animate-spin')).toBeNull();
	});
});
