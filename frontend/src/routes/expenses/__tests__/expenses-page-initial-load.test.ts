import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Expense, UserSettings, Vehicle } from '#lib/types/index.ts';
import { ApiError, SERVER_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';

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
const getExpenseSummary = vi.fn();
const getVehicles = vi.fn();
const getSettings = vi.fn();

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getAllExpenses: (...args: unknown[]) => getAllExpenses(...args),
		getExpenseSummary: (...args: unknown[]) => getExpenseSummary(...args),
		downloadExpensesCsv: () => Promise.resolve()
	}
}));
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles: (...args: unknown[]) => getVehicles(...args) }
}));
vi.mock('#lib/services/settings-api.ts', () => ({
	settingsApi: {
		getSettings: (...args: unknown[]) => getSettings(...args),
		updateSettings: () => Promise.resolve({})
	}
}));

import Page from '../+page.svelte';
import { settingsStore } from '#lib/stores/settings.svelte.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { offlineExpenseQueue, onlineStatus } from '#lib/stores/offline.svelte.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';

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

const QUEUED: OfflineExpense = {
	id: 'queued-1',
	clientId: 'queued-1',
	vehicleId: 'v1',
	tags: [],
	category: 'misc',
	amount: 12.34,
	date: '2024-03-20',
	description: 'Queued oil top-up',
	timestamp: 1,
	synced: false
};

beforeEach(() => {
	settingsStore.reset();
	vi.clearAllMocks();
	tableProps = {};
	onlineStatus.current = true;
	offlineExpenseQueue.current = [];
	appStore.clearNotifications();
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
	test('a failed load says what failed without the raw error text', async () => {
		getVehicles.mockRejectedValue(new ApiError('SQLITE_BUSY: database is locked', 500));

		render(Page);

		const heading = await screen.findByText("Couldn't load expenses");
		const card = heading.closest('div.rounded-lg') as HTMLElement;
		expect(card).toHaveTextContent(SERVER_FAILURE_MESSAGE);
		expect(card).not.toHaveTextContent('SQLITE_BUSY');
	});

	test('the expense page is requested WITHOUT waiting for settings or the vehicle list', async () => {
		getSettings.mockImplementation(() => new Promise<never>(() => {}));
		getVehicles.mockImplementation(() => new Promise<never>(() => {}));

		render(Page);

		await waitFor(() => {
			expect(getAllExpenses).toHaveBeenCalled();
			expect(getExpenseSummary).toHaveBeenCalled();
		});
		expect(getSettings).toHaveBeenCalled();
		expect(getVehicles).toHaveBeenCalled();
	});

	test('rows handed to the table still carry their vehicle', async () => {
		render(Page);

		await waitFor(() => expect(rowsGivenToTable()).toHaveLength(1));
		expect(rowsGivenToTable()[0]?.vehicle?.id).toBe('v1');
	});

	test('a row whose vehicle is not in the fleet is still rendered, without a vehicle', async () => {
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

	test('a failed load toasts once even when the list fails after the vehicles', async () => {
		getVehicles.mockRejectedValue(new ApiError('boom', 500));
		let failList: (reason: unknown) => void = () => {};
		getAllExpenses.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					failList = reject;
				})
		);

		render(Page);
		await screen.findByText("Couldn't load expenses");
		failList(new ApiError('boom', 500));
		await new Promise(resolve => setTimeout(resolve, 0));

		const errors = appStore.notifications.filter(n => n.type === 'error');
		expect(errors).toHaveLength(1);
	});

	test('offline, a failed load shows the offline notice and the queued expenses without error toasts', async () => {
		onlineStatus.current = false;
		offlineExpenseQueue.current = [QUEUED];
		const offline = new TypeError('Failed to fetch');
		getVehicles.mockRejectedValue(offline);
		getAllExpenses.mockRejectedValue(offline);
		getExpenseSummary.mockRejectedValue(offline);

		render(Page);

		expect(await screen.findByText("You're offline")).toBeInTheDocument();
		expect(screen.queryByText("Couldn't load expenses")).not.toBeInTheDocument();
		expect(screen.getByText(/Queued oil top-up/)).toBeInTheDocument();
		const addExpense = screen.getAllByRole('link', { name: /Add Expense/ });
		expect(addExpense.map(link => link.classList.contains('lg:hidden'))).toEqual([false, true]);
		for (const link of addExpense) expect(link).toHaveAttribute('href', '/expenses/new');
		expect(appStore.notifications.filter(n => n.type === 'error')).toHaveLength(0);
	});

	test('coming back online reloads the list', async () => {
		onlineStatus.current = false;
		getVehicles.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		render(Page);
		await screen.findByText("You're offline");
		onlineStatus.current = true;

		await waitFor(() => expect(rowsGivenToTable()).toHaveLength(1));
		expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
	});

	test('the search box keeps its accessible name once the user has typed', async () => {
		const screen = render(Page);

		const input = await waitFor(() =>
			screen.getByRole('textbox', { name: 'Search expenses and vehicles' })
		);
		await fireEvent.input(input, { target: { value: 'cost' } });

		expect(input).toHaveAccessibleName('Search expenses and vehicles');
		expect(input.getAttribute('aria-label')).not.toBe(input.getAttribute('placeholder'));
	});

	test('the first-load Retry keeps focus while it loads and after a repeat failure', async () => {
		let failRetry: (reason: unknown) => void = () => {};
		getAllExpenses
			.mockImplementationOnce(() => Promise.reject(new ApiError('down', 503)))
			.mockImplementationOnce(() => new Promise((_resolve, reject) => (failRetry = reject)));
		render(Page);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		const firstAlert = within(screen.getByTestId('expenses-load-error')).getByRole('alert');
		const firstReason = firstAlert.querySelector('p.text-sm');
		retry.focus();
		await fireEvent.click(retry);

		const retrying = await screen.findByRole('button', { name: 'Retrying…' });
		expect(retrying).toBe(retry);
		expect(retrying).toHaveAttribute('aria-disabled', 'true');
		expect(retrying).toHaveFocus();
		await fireEvent.click(retrying);
		expect(getAllExpenses).toHaveBeenCalledTimes(2);

		failRetry(new ApiError('down', 503));

		await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBe(retry));
		expect(retry).toHaveFocus();
		const alert = within(screen.getByTestId('expenses-load-error')).getByRole('alert');
		expect(alert).toHaveTextContent("Couldn't load expenses");
		expect(alert.querySelector('p.text-sm')).not.toBe(firstReason);
	});

	test('a successful first-load Retry moves focus from the Retry to the expenses heading', async () => {
		getAllExpenses.mockImplementationOnce(() => Promise.reject(new ApiError('down', 503)));
		render(Page);

		const retry = await screen.findByRole('button', { name: 'Retry' });
		retry.focus();
		await fireEvent.click(retry);

		await waitFor(() => expect(screen.queryByTestId('expenses-load-error')).toBeNull());
		await waitFor(() => expect(screen.getByText('Expenses (1)')).toHaveFocus());
	});
});
