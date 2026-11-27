import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

const summaryCall = vi.hoisted(() => vi.fn());

vi.mock('#lib/components/analytics/fuel/FuelStatsTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		query: () => new Promise(() => {}),
		getSummary: () => summaryCall()
	},
	getDefaultDateRange: () => ({})
}));

import Page from '../+page.svelte';

beforeEach(() => {
	summaryCall.mockReset();
	summaryCall.mockImplementation(() => Promise.reject(new ApiError('boom', 500)));
});

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

	test('keeps the tabs in place while Retry runs', async () => {
		render(Page);
		await screen.findByText("Couldn't load analytics");
		summaryCall.mockImplementation(() => new Promise(() => {}));

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(summaryCall).toHaveBeenCalledTimes(2);
		expect(screen.getByRole('tablist')).toBeInTheDocument();
	});
});
