import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

type TabProps = { hiddenFinancials?: Set<string> };
const seen = vi.hoisted(() => ({ perVehicle: [] as TabProps[], crossVehicle: [] as TabProps[] }));

vi.mock('#lib/components/analytics/PerVehicleTab.svelte', () => ({
	default: (_: unknown, props: TabProps) => {
		seen.perVehicle.push(props);
	}
}));
vi.mock('#lib/components/analytics/CrossVehicleTab.svelte', () => ({
	default: (_: unknown, props: TabProps) => {
		seen.crossVehicle.push(props);
	}
}));
vi.mock('#lib/components/analytics/explore/ExploreTab.svelte', () => ({ default: () => {} }));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: {
		query: () => new Promise(() => {}),
		getSummary: () => Promise.reject(new Error('offline')),
		getInsights: () => new Promise(() => {})
	},
	getDefaultDateRange: () => ({})
}));

const OWN = { id: 'own', year: 2019, make: 'Honda', model: 'Civic' };
const SHARED = {
	id: 'shared',
	year: 2021,
	make: 'Ford',
	model: 'F-150',
	sharedAccess: { seesFinancials: false }
};
const OPEN = {
	id: 'open',
	year: 2018,
	make: 'Mazda',
	model: 'CX-5',
	sharedAccess: { seesFinancials: true }
};
const getVehicles = vi.hoisted(() => vi.fn());
vi.mock('#lib/services/vehicle-api.ts', () => ({ vehicleApi: { getVehicles } }));
getVehicles.mockImplementation((opts?: { includeShared?: boolean }) =>
	Promise.resolve(opts?.includeShared ? [OWN, SHARED, OPEN] : [OWN])
);

const { default: Page } = await import('../+page.svelte');

describe('the analytics page with cars shared with you', () => {
	test('loads shared cars and tells each tab which of them hide their financial figures', async () => {
		render(Page);
		await waitFor(() => expect(getVehicles).toHaveBeenCalledWith({ includeShared: true }));

		for (const [tab, props] of [
			['Per-vehicle', seen.perVehicle],
			['Cross-vehicle', seen.crossVehicle]
		] as const) {
			await fireEvent.click(await screen.findByRole('tab', { name: tab }));
			await waitFor(() => expect(props.at(-1)?.hiddenFinancials?.has('shared')).toBe(true));
			const hidden = props.at(-1)?.hiddenFinancials;
			expect([...(hidden ?? [])], tab).toEqual(['shared']);
		}
	});
});
