// The three opening reads go out together, rows keep their vehicle, and the search box keeps a name.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Expense, UserSettings, Vehicle } from '$lib/types';

// Mounting needs svelte's client entries; vite.config.ts sets no browser condition for tests.
vi.mock('svelte', () => import('../../../../node_modules/svelte/src/index-client.js' as string));
vi.mock(
	'svelte/reactivity',
	() => import('../../../../node_modules/svelte/src/reactivity/index-client.js' as string)
);

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

// Records the props: they carry live getters, so reads see the page's current state.
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

// Imported eagerly so module transforms happen outside test timeouts.
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

function rowsGivenToTable(): Array<Expense & { vehicle?: Vehicle }> {
	return (tableProps['expenses'] ?? []) as Array<Expense & { vehicle?: Vehicle }>;
}

describe('/expenses initial load', () => {
	test('the expense page is requested WITHOUT waiting for settings or the vehicle list', async () => {
		// The other two reads never resolve here, so a serial load could never reach the expense request.
		getSettings.mockImplementation(() => new Promise<never>(() => {}));
		getVehicles.mockImplementation(() => new Promise<never>(() => {}));

		render(Page);

		await waitFor(() => {
			expect(getAllExpenses).toHaveBeenCalled();
			expect(getExpenseSummary).toHaveBeenCalled();
		});
		// The two slow reads were genuinely in flight together.
		expect(getSettings).toHaveBeenCalled();
		expect(getVehicles).toHaveBeenCalled();
	});

	test('rows handed to the table still carry their vehicle', async () => {
		render(Page);

		await waitFor(() => expect(rowsGivenToTable()).toHaveLength(1));
		expect(rowsGivenToTable()[0]?.vehicle?.id).toBe('v1');
	});

	test('a row whose vehicle is not in the fleet is still rendered, without a vehicle', async () => {
		// A shared or deleted vehicle degrades to undefined rather than dropping the row.
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

		// A placeholder disappears once typed into, so the name must come from the label.
		expect(input).toHaveAccessibleName('Search expenses and vehicles');
		expect(input.getAttribute('aria-label')).not.toBe(input.getAttribute('placeholder'));
	});
});
