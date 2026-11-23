import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		getSummary: () => Promise.reject(new ApiError('boom', 500))
	},
	getDefaultDateRange: () => ({})
}));

import Page from '../+page.svelte';

describe('analytics load failure', () => {
	test('says what failed in a plain sentence, not the server text', async () => {
		render(Page);

		expect(await screen.findByText("Couldn't load analytics")).toBeInTheDocument();
		expect(screen.getByText(SERVER_FAILURE_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByText('boom')).toBeNull();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	test('still shows the tabs under the error card', async () => {
		render(Page);

		await screen.findByText("Couldn't load analytics");
		expect(screen.getByRole('tablist')).toBeInTheDocument();
	});
});
