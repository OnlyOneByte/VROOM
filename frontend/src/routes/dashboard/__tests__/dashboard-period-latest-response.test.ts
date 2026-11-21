import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { ExpenseSummary, Vehicle } from '#lib/types/index.ts';
import type { TimePeriod } from '#lib/constants/time-periods.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let pieProps: Record<string, unknown> = {};
let periodSelectorProps: Record<string, unknown> = {};
vi.mock('#lib/components/charts/index.ts', () => ({
	AppPieChart: (_anchor: unknown, props: Record<string, unknown>) => {
		pieProps = props;
	}
}));
vi.mock('#lib/components/charts/ExpenseTrendChart.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/common/period-selector.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		periodSelectorProps = props;
	}
}));
vi.mock('#lib/components/dashboard/VehicleCarousel.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/dashboard/SharedWithMeCard.svelte', () => ({ default: () => {} }));

const getExpenseSummary = vi.fn();

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle]),
		getAllVehiclePhotos: () => Promise.resolve({}),
		getPhotoThumbnailUrl: () => ''
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getVehicleStats: () => Promise.resolve([]),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		getAllExpenses: () =>
			Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 5, offset: 0 } })
	}
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () => Promise.resolve([]),
		getRecurringCost: () => Promise.resolve({ count: 0, monthlyTotal: 0 })
	}
}));

import Page from '../+page.svelte';

function summaryWith(category: string): ExpenseSummary {
	return {
		totalAmount: 10,
		expenseCount: 1,
		recentAmount: 10,
		monthlyAverage: 10,
		categoryBreakdown: [{ category, amount: 10, count: 1 }],
		monthlyTrend: []
	} as unknown as ExpenseSummary;
}

function pieCategories(): string[] {
	return ((pieProps['data'] ?? []) as Array<{ key: string }>).map(slice => slice.key);
}

function changePeriod(period: TimePeriod) {
	(periodSelectorProps['onPeriodChange'] as (p: TimePeriod) => void)(period);
}

beforeEach(() => {
	pieProps = {};
	periodSelectorProps = {};
	getExpenseSummary.mockReset();
});

describe('dashboard period switch', () => {
	test('an older period response that arrives last does not overwrite the newer one', async () => {
		let resolveSlow: (s: ExpenseSummary) => void = () => {};
		getExpenseSummary.mockImplementation(({ period }: { period: TimePeriod }) => {
			if (period === 'all') return Promise.resolve(summaryWith('misc'));
			if (period === '7d') return new Promise<ExpenseSummary>(resolve => (resolveSlow = resolve));
			return Promise.resolve(summaryWith('fuel'));
		});
		render(Page);
		await waitFor(() => expect(pieCategories()).toEqual(['misc']));

		changePeriod('7d');
		changePeriod('1y');
		await waitFor(() => expect(pieCategories()).toEqual(['fuel']));

		resolveSlow(summaryWith('maintenance'));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(periodSelectorProps['selectedPeriod']).toBe('1y');
		expect(pieCategories()).toEqual(['fuel']);
	});

	test('switching back to All Time wins over a slower request still in flight', async () => {
		let resolveSlow: (s: ExpenseSummary) => void = () => {};
		getExpenseSummary.mockImplementation(({ period }: { period: TimePeriod }) => {
			if (period === 'all') return Promise.resolve(summaryWith('misc'));
			return new Promise<ExpenseSummary>(resolve => (resolveSlow = resolve));
		});
		render(Page);
		await waitFor(() => expect(pieCategories()).toEqual(['misc']));

		changePeriod('30d');
		changePeriod('all');
		resolveSlow(summaryWith('fuel'));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(pieCategories()).toEqual(['misc']);
	});
});
