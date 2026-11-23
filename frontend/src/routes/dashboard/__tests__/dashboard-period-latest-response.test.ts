import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { ExpenseSummary, Vehicle } from '#lib/types/index.ts';
import type { TimePeriod } from '#lib/constants/time-periods.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let heroProps: Record<string, unknown> = {};
vi.mock('#lib/components/charts/index.ts', () => ({ AppBarChart: () => {} }));
vi.mock('#lib/components/dashboard/DashboardHero.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		heroProps = props;
	}
}));
vi.mock('#lib/components/dashboard/SharedWithMeCard.svelte', () => ({ default: () => {} }));

const getExpenseSummary = vi.fn();

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () =>
			Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 } as Vehicle])
	}
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		getAllExpenses: () =>
			Promise.resolve({ data: [], pagination: { totalCount: 0, limit: 4, offset: 0 } })
	}
}));
vi.mock('#lib/services/reminder-api.ts', () => ({
	reminderApi: {
		list: () => Promise.resolve([]),
		getRecurringCost: () => Promise.resolve({ count: 0, monthlyTotal: 0 })
	}
}));
vi.mock('#lib/services/insurance-api.ts', () => ({
	insuranceApi: { getAllPolicies: () => Promise.resolve([]) }
}));
vi.mock('#lib/services/analytics-api.ts', () => ({
	analyticsApi: { query: () => Promise.resolve(null) }
}));

import Page from '../+page.svelte';

function summaryOf(total: number): ExpenseSummary {
	return {
		totalAmount: total,
		expenseCount: 1,
		recentAmount: total,
		monthlyAverage: total,
		categoryBreakdown: [{ category: 'misc', amount: total, count: 1 }],
		monthlyTrend: [],
		costBuckets: { ownershipTotal: 0, runningTotal: total, previous: null, byVehicle: [] }
	};
}

const TOTALS: Record<TimePeriod, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: 999 };

function changePeriod(period: TimePeriod) {
	(heroProps['onPeriodChange'] as (p: TimePeriod) => void)(period);
}

beforeEach(() => {
	heroProps = {};
	getExpenseSummary.mockReset();
});

describe('dashboard period switch', () => {
	test('the hero opens on the last 30 days', async () => {
		getExpenseSummary.mockImplementation(({ period }: { period: TimePeriod }) =>
			Promise.resolve(summaryOf(TOTALS[period]))
		);
		render(Page);

		await waitFor(() => expect(heroProps['total']).toBe(30));
		expect(heroProps['period']).toBe('30d');
	});

	test('an older period response that arrives last does not overwrite the newer one', async () => {
		let resolveSlow: (s: ExpenseSummary) => void = () => {};
		getExpenseSummary.mockImplementation(({ period }: { period: TimePeriod }) => {
			if (period === '7d') return new Promise<ExpenseSummary>(resolve => (resolveSlow = resolve));
			return Promise.resolve(summaryOf(TOTALS[period]));
		});
		render(Page);
		await waitFor(() => expect(heroProps['total']).toBe(30));

		changePeriod('7d');
		changePeriod('1y');
		await waitFor(() => expect(heroProps['total']).toBe(365));

		resolveSlow(summaryOf(7));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(heroProps['period']).toBe('1y');
		expect(heroProps['total']).toBe(365);
	});

	test('a failed switch puts the chip back on the period whose numbers are shown', async () => {
		getExpenseSummary.mockImplementation(({ period }: { period: TimePeriod }) => {
			if (period === '7d') return Promise.reject(new Error('offline'));
			return Promise.resolve(summaryOf(TOTALS[period]));
		});
		render(Page);
		await waitFor(() => expect(heroProps['total']).toBe(30));
		changePeriod('1y');
		await waitFor(() => expect(heroProps['total']).toBe(365));

		changePeriod('7d');

		await waitFor(() => expect(heroProps['period']).toBe('1y'));
		expect(heroProps['total']).toBe(365);
	});

	test('when a pending switch is overtaken by one that fails, the chip returns to the shown period', async () => {
		getExpenseSummary.mockImplementation(({ period }: { period: TimePeriod }) => {
			if (period === '7d') return new Promise<ExpenseSummary>(() => {});
			if (period === '90d') return Promise.reject(new Error('offline'));
			return Promise.resolve(summaryOf(TOTALS[period]));
		});
		render(Page);
		await waitFor(() => expect(heroProps['total']).toBe(30));

		changePeriod('7d');
		changePeriod('90d');

		await waitFor(() => expect(heroProps['period']).toBe('30d'));
		expect(heroProps['total']).toBe(30);
	});
});
