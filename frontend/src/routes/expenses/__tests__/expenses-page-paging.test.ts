import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Expense, UserSettings } from '#lib/types/index.ts';
import { ApiError } from '#lib/utils/error-handling.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let tableProps: Record<string, unknown> = {};
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tableProps = props;
	}
}));
vi.mock('#lib/components/expenses/ImportFromPhotosDialog.svelte', () => ({ default: () => {} }));

const getAllExpenses = vi.fn();

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 0,
				expenseCount: 0,
				recentAmount: 0,
				monthlyAverage: 0,
				categoryBreakdown: [],
				monthlyTrend: []
			}),
		downloadExpensesCsv: () => Promise.resolve()
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: () => Promise.resolve([]) }
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: () => Promise.resolve({ currencyUnit: 'USD' } as unknown as UserSettings),
		updateSettings: () => Promise.resolve({})
	}
}));

import Page from '../+page.svelte';

function pageAt(offset: number) {
	return {
		data: [
			{
				id: `e${offset}`,
				vehicleId: 'v1',
				category: 'fuel',
				amount: 1,
				tags: []
			} as unknown as Expense
		],
		pagination: { totalCount: 100, limit: 20, offset, hasMore: true }
	};
}

function shownIds(): string[] {
	return ((tableProps['expenses'] ?? []) as Expense[]).map(expense => expense.id);
}

function goToPage(offset: number) {
	(tableProps['onPageChange'] as (o: number) => void)(offset);
}

function offsetOf(call: unknown[]): number {
	return (call[0] as { offset: number }).offset;
}

beforeEach(() => {
	tableProps = {};
	getAllExpenses.mockReset();
});

describe('/expenses paging', () => {
	test('a slower earlier page that resolves last does not replace the page the user moved to', async () => {
		let resolveSlow: (v: ReturnType<typeof pageAt>) => void = () => {};
		getAllExpenses.mockImplementation((params: { offset: number }) => {
			if (params.offset === 20) return new Promise(resolve => (resolveSlow = resolve));
			return Promise.resolve(pageAt(params.offset));
		});
		render(Page);
		await waitFor(() => expect(shownIds()).toEqual(['e0']));

		goToPage(20);
		goToPage(40);
		await waitFor(() => expect(shownIds()).toEqual(['e40']));

		resolveSlow(pageAt(20));
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(shownIds()).toEqual(['e40']);
		expect(tableProps['currentOffset']).toBe(40);
		expect(tableProps['isLoadingPage']).toBe(false);
	});

	test('a failed page shows an inline error, and Retry loads that page', async () => {
		getAllExpenses.mockImplementation((params: { offset: number }) => {
			if (
				params.offset === 20 &&
				getAllExpenses.mock.calls.filter(c => offsetOf(c) === 20).length === 1
			)
				return Promise.reject(new ApiError('SQLITE_BUSY: database is locked', 500));
			return Promise.resolve(pageAt(params.offset));
		});
		render(Page);
		await waitFor(() => expect(shownIds()).toEqual(['e0']));

		goToPage(20);
		const error = await screen.findByTestId('expenses-page-error');
		expect(error).toHaveTextContent("Couldn't load expenses");
		expect(error).toHaveTextContent('Something went wrong on our side.');
		expect(error).not.toHaveTextContent('SQLITE_BUSY');

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

		await waitFor(() => expect(screen.queryByTestId('expenses-page-error')).toBeNull());
		expect(shownIds()).toEqual(['e20']);
		expect(tableProps['currentOffset']).toBe(20);
	});

	test('Retry shows progress, keeps focus and ignores a second press while in flight', async () => {
		let resolveRetry: (v: ReturnType<typeof pageAt>) => void = () => {};
		getAllExpenses.mockImplementation((params: { offset: number }) => {
			const attempts = getAllExpenses.mock.calls.filter(c => offsetOf(c) === 20).length;
			if (params.offset === 20 && attempts === 1) return Promise.reject(new Error('Network down'));
			if (params.offset === 20) return new Promise(resolve => (resolveRetry = resolve));
			return Promise.resolve(pageAt(params.offset));
		});
		render(Page);
		await waitFor(() => expect(shownIds()).toEqual(['e0']));

		goToPage(20);
		await screen.findByTestId('expenses-page-error');
		const retry = screen.getByRole('button', { name: 'Retry' });
		retry.focus();
		await fireEvent.click(retry);

		const retrying = await screen.findByRole('button', { name: 'Retrying…' });
		expect(retrying).toBe(retry);
		expect(retrying).toBeEnabled();
		expect(retrying).toHaveAttribute('aria-disabled', 'true');
		expect(retrying).toHaveFocus();
		expect(retrying.querySelector('.animate-spin')).not.toBeNull();

		await fireEvent.click(retrying);
		expect(getAllExpenses.mock.calls.filter(c => offsetOf(c) === 20)).toHaveLength(2);

		resolveRetry(pageAt(20));
		await waitFor(() => expect(screen.queryByTestId('expenses-page-error')).toBeNull());
		expect(shownIds()).toEqual(['e20']);
	});
});
