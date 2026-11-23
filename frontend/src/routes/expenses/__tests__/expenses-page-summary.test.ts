import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { ExpenseSummary, UserSettings } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()), replaceState: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let tableProps: Record<string, unknown> = {};
let overviewProps: Record<string, unknown> = {};
let tagFilterProps: Record<string, unknown> = {};
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tableProps = props;
	}
}));
vi.mock('#lib/components/expenses/ExpenseOverviewSection.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		overviewProps = props;
	}
}));
vi.mock('#lib/components/expenses/ExpenseTagFilter.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tagFilterProps = props;
	}
}));
vi.mock('#lib/components/expenses/ImportFromPhotosDialog.svelte', () => ({ default: () => {} }));

const notify = vi.fn();
const logged = vi.fn();
vi.mock('#lib/utils/error-handling.ts', () => ({
	handleErrorWithNotification: (...args: unknown[]) => notify(...args),
	logLoadFailure: (...args: unknown[]) => logged(...args),
	userFacingErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Failed')
}));

const getExpenseSummary = vi.fn();
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: (params: { offset: number }) =>
			Promise.resolve({
				data: [],
				pagination: { totalCount: 0, limit: 20, offset: params.offset, hasMore: false }
			}),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		downloadExpensesCsv: () => Promise.resolve()
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: () => Promise.resolve([{ id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 }])
	}
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => Promise.resolve({ currencyUnit: 'USD' } as unknown as UserSettings),
		updateSettings: () => Promise.resolve({})
	}
}));

import Page from '../+page.svelte';

function summary(totalAmount: number): ExpenseSummary {
	return {
		totalAmount,
		expenseCount: 1,
		recentAmount: 0,
		monthlyAverage: 0,
		categoryBreakdown: [],
		monthlyTrend: []
	} as unknown as ExpenseSummary;
}

function shownTotal(): number | undefined {
	return (overviewProps['summary'] as ExpenseSummary | null)?.totalAmount;
}

function changeTags(tags: string[]) {
	(tagFilterProps['onTagsChange'] as (t: string[]) => void)(tags);
}

function sortByAmount() {
	(tableProps['onSortChange'] as (by: string, dir: string) => void)('amount', 'desc');
}

let pendingSummary: { resolve: (s: ExpenseSummary) => void; reject: (e: Error) => void };

beforeEach(() => {
	tableProps = {};
	overviewProps = {};
	tagFilterProps = {};
	notify.mockReset();
	logged.mockReset();
	getExpenseSummary.mockReset();
	getExpenseSummary.mockImplementationOnce(() => Promise.resolve(summary(1)));
	getExpenseSummary.mockImplementation(
		() =>
			new Promise<ExpenseSummary>((resolve, reject) => {
				pendingSummary = { resolve, reject };
			})
	);
});

describe('/expenses summary during a later list change', () => {
	test('a sort change while a filter reload is in flight still applies that reload’s summary', async () => {
		render(Page);
		await waitFor(() => expect(shownTotal()).toBe(1));

		changeTags(['fuel']);
		sortByAmount();
		pendingSummary.resolve(summary(2));

		await waitFor(() => expect(shownTotal()).toBe(2));
	});

	test('a failed summary is shown in the overview even when a later sort change owns the list', async () => {
		render(Page);
		await waitFor(() => expect(shownTotal()).toBe(1));

		changeTags(['fuel']);
		sortByAmount();
		pendingSummary.reject(new Error('Summary down'));

		await waitFor(() => expect(overviewProps['error']).toBe('Summary down'));
		expect(logged).toHaveBeenCalledWith(expect.any(Error), "Couldn't load the expense summary");
		expect(notify).not.toHaveBeenCalled();
		expect(shownTotal()).toBe(1);
	});
});
