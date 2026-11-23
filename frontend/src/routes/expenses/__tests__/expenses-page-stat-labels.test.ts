import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { UserSettings } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

let overviewProps: Record<string, unknown> = {};
vi.mock('#lib/components/expenses/ExpenseOverviewSection.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		overviewProps = props;
	}
}));
vi.mock('#lib/components/expenses/ExpensesTable.svelte', () => ({ default: () => {} }));
vi.mock('#lib/components/expenses/ImportFromPhotosDialog.svelte', () => ({ default: () => {} }));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: () =>
			Promise.resolve({
				data: [],
				pagination: { totalCount: 0, limit: 20, offset: 0, hasMore: false }
			}),
		getExpenseSummary: () =>
			Promise.resolve({
				totalAmount: 900,
				expenseCount: 9,
				recentAmount: 123.45,
				monthlyAverage: 75,
				categoryBreakdown: [],
				monthlyTrend: []
			}),
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

type StatCard = { label: string; value: string };

function statCards(): StatCard[] {
	return (overviewProps['statCards'] ?? []) as StatCard[];
}

beforeEach(() => {
	overviewProps = {};
});

describe('/expenses stat cards', () => {
	test('the 30-day total is labelled as a 30-day total, not as the last expense', async () => {
		render(Page);

		await waitFor(() => expect(statCards().length).toBeGreaterThan(0));
		const recent = statCards().find(card => card.value.includes('123.45'));
		expect(recent?.label).toBe('Last 30 Days');
		expect(statCards().map(card => card.label)).not.toContain('Last Expense');
	});
});
