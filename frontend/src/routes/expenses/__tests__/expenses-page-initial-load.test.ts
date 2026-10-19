/**
 * /expenses opens with three independent reads — settings, the vehicle list, and the first page of
 * expenses plus its summary.
 *
 * They used to be three sequential `await`s, so the table waited for two round trips it did not
 * depend on; the only reason the order mattered was that the vehicle shown on each row was joined
 * inside the fetch, from whatever `vehicles` happened to hold at that moment. Moving that join to a
 * derived is what makes the three safe to issue together — and is the part that could silently
 * regress, by leaving every row's vehicle column blank with nothing going red.
 *
 * So this pins both halves: the reads go out in ONE round, and the rows handed to the table still
 * carry their vehicle. It also pins the search box's accessible name, which used to come from its
 * placeholder alone and therefore vanished the moment the user typed.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Expense, UserSettings, Vehicle } from '$lib/types';

/** Mounting needs svelte's CLIENT entries (vite.config.ts sets no `browser` condition for tests). */
vi.mock('svelte', () => import('../../../../node_modules/svelte/src/index-client.js' as string));
vi.mock(
	'svelte/reactivity',
	() => import('../../../../node_modules/svelte/src/reactivity/index-client.js' as string)
);

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

/**
 * Stand in for the table and record its props: a Svelte 5 component is a `(anchor, props)`
 * function, and the props object carries live getters, so reading it later reads the page's
 * CURRENT state. What the page passes down is exactly what is under test here.
 */
let tableProps: Record<string, unknown> = {};
vi.mock('$lib/components/expenses/ExpensesTable.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => {
		tableProps = props;
	}
}));
vi.mock('$lib/components/expenses/ImportFromPhotosDialog.svelte', () => ({ default: () => {} }));

const getAllExpenses = vi.fn();
const getExpenseSummary = vi.fn();
const getVehicles = vi.fn();
const getSettings = vi.fn();

vi.mock('$lib/services/expense-api', () => ({
	expenseApi: {
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		downloadExpensesCsv: () => Promise.resolve()
	}
}));
vi.mock('$lib/services/vehicle-api', () => ({
	vehicleApi: { getVehicles: (...args: unknown[]) => getVehicles(...args) }
}));
vi.mock('$lib/services/settings-api', () => ({
	settingsApi: {
		getSettings: (...args: unknown[]) => getSettings(...args),
		updateSettings: () => Promise.resolve({})
	}
}));

// Statically imported so the route's module graph is transformed at file load, outside any test's
// timeout (the same reason the other component suites import their subject at the top).
import Page from '../+page.svelte';

const VEHICLE: Vehicle = {
	id: 'v1',
	userId: 'u1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'car',
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
} as unknown as Vehicle;

const SERVER_PAGE: Expense[] = [
	{
		id: 'e1',
		vehicleId: 'v1',
		userId: 'u1',
		category: 'fuel',
		amount: 45.5,
		date: '2024-03-15T12:00:00.000Z',
		description: 'Shell',
		tags: [],
		createdAt: '2024-03-15T12:00:00.000Z',
		updatedAt: '2024-03-15T12:00:00.000Z'
	}
] as unknown as Expense[];

const SETTINGS = {
	currencyUnit: 'USD',
	unitPreferences: { distanceUnit: 'miles', volumeUnit: 'gallons_us', chargeUnit: 'kwh' }
} as unknown as UserSettings;

beforeEach(() => {
	vi.clearAllMocks();
	tableProps = {};
	getSettings.mockImplementation(() => Promise.resolve(SETTINGS));
	getVehicles.mockImplementation(() => Promise.resolve([VEHICLE]));
	getAllExpenses.mockImplementation(() =>
		Promise.resolve({
			data: SERVER_PAGE,
			pagination: { totalCount: 1, limit: 20, offset: 0, hasMore: false }
		})
	);
	getExpenseSummary.mockImplementation(() =>
		Promise.resolve({
			totalAmount: 45.5,
			expenseCount: 1,
			recentAmount: 45.5,
			monthlyAverage: 45.5,
			categoryBreakdown: [],
			monthlyTrend: []
		})
	);
});

/** The expense rows currently handed to the table. */
function rowsGivenToTable(): Array<Expense & { vehicle?: Vehicle }> {
	return (tableProps['expenses'] ?? []) as Array<Expense & { vehicle?: Vehicle }>;
}

describe('/expenses initial load', () => {
	test('the expense page is requested WITHOUT waiting for settings or the vehicle list', async () => {
		// Both of the legs the fetch used to queue behind never resolve here, so a serial load
		// could not possibly get as far as requesting a page of expenses.
		getSettings.mockImplementation(() => new Promise<never>(() => {}));
		getVehicles.mockImplementation(() => new Promise<never>(() => {}));

		render(Page);

		await waitFor(() => {
			expect(getAllExpenses).toHaveBeenCalled();
			expect(getExpenseSummary).toHaveBeenCalled();
		});
		// ...and the two slow legs really were in flight at the same time, not skipped.
		expect(getSettings).toHaveBeenCalled();
		expect(getVehicles).toHaveBeenCalled();
	});

	test('rows handed to the table still carry their vehicle', async () => {
		render(Page);

		await waitFor(() => expect(rowsGivenToTable()).toHaveLength(1));
		expect(rowsGivenToTable()[0]?.vehicle?.id).toBe('v1');
	});

	test('a row whose vehicle is not in the fleet is still rendered, without a vehicle', async () => {
		// Shared/deleted vehicle: the join must degrade to `undefined`, never drop the row.
		getAllExpenses.mockImplementation(() =>
			Promise.resolve({
				data: [{ ...SERVER_PAGE[0], id: 'orphan', vehicleId: 'gone' }],
				pagination: { totalCount: 1, limit: 20, offset: 0, hasMore: false }
			})
		);

		render(Page);

		await waitFor(() => expect(rowsGivenToTable()).toHaveLength(1));
		expect(rowsGivenToTable()[0]?.id).toBe('orphan');
		expect(rowsGivenToTable()[0]?.vehicle).toBeUndefined();
	});

	test('the search box keeps its accessible name once the user has typed', async () => {
		const screen = render(Page);

		const input = await waitFor(() =>
			screen.getByRole('textbox', { name: 'Search expenses and vehicles' })
		);
		await fireEvent.input(input, { target: { value: 'cost' } });

		// A placeholder is not a name: it is gone as soon as there is a value, so the name has to
		// come from the label instead.
		expect(input).toHaveAccessibleName('Search expenses and vehicles');
		expect(input.getAttribute('aria-label')).not.toBe(input.getAttribute('placeholder'));
	});
});
