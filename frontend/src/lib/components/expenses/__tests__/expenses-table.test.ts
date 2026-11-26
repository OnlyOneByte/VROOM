import { beforeEach, describe, expect, test, vi } from 'vitest';
import { UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Expense, Vehicle } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import {
	UNDO_WINDOW_MS,
	resetPendingDeletes,
	scheduleDelete
} from '#lib/utils/pending-deletes.svelte.ts';

import { resetPendingEdits, scheduleEdit } from '#lib/utils/pending-edits.svelte.ts';

const { deleteExpense, deleteSplitExpense, updateExpense } = vi.hoisted(() => ({
	deleteExpense: vi.fn<(id: string) => Promise<void>>(),
	deleteSplitExpense: vi.fn<(groupId: string) => Promise<void>>(),
	updateExpense: vi.fn<(id: string, payload: unknown) => Promise<unknown>>()
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		deleteExpense: (id: string) => deleteExpense(id),
		deleteSplitExpense: (groupId: string) => deleteSplitExpense(groupId),
		updateExpense: (id: string, payload: unknown) => updateExpense(id, payload)
	}
}));

const ExpensesTable = (await import('../ExpensesTable.svelte')).default;

const VEHICLE: Vehicle = {
	id: 'v1',
	make: 'Toyota',
	model: 'Camry',
	year: 2020,
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	nickname: 'Daily Driver',
	createdAt: '2024-01-01T00:00:00.000Z',
	updatedAt: '2024-01-01T00:00:00.000Z'
};

function localNoonISO(year: number, monthIndex: number, day: number): string {
	return new Date(year, monthIndex, day, 12).toISOString();
}

function expense(overrides: Partial<Expense> & Pick<Expense, 'id'>): Expense {
	return {
		vehicleId: VEHICLE.id,
		userId: 'u1',
		tags: [],
		category: 'fuel',
		amount: 10,
		date: localNoonISO(2024, 2, 1),
		createdAt: '2024-03-01T00:00:00.000Z',
		updatedAt: '2024-03-01T00:00:00.000Z',
		...overrides
	};
}

const OLD_SMALL = expense({ id: 'old', amount: 15, date: localNoonISO(2024, 0, 5) });
const MID_LARGE = expense({
	id: 'mid',
	amount: 300,
	category: 'maintenance',
	date: localNoonISO(2024, 1, 10)
});
const NEW_MEDIUM = expense({ id: 'new', amount: 75, date: localNoonISO(2024, 2, 20) });
const STANDALONE = [OLD_SMALL, MID_LARGE, NEW_MEDIUM];

const SPLIT = [
	expense({ id: 'split-a', amount: 60, category: 'maintenance', groupId: 'g1' }),
	expense({ id: 'split-b', amount: 40, category: 'maintenance', groupId: 'g1' })
];

function useLayout(layout: 'compact' | 'wide') {
	vi.mocked(window.matchMedia).mockReturnValue({
		matches: layout === 'compact',
		addEventListener: vi.fn(),
		removeEventListener: vi.fn()
	} as unknown as MediaQueryList);
}

function mountTable(props: Record<string, unknown> = {}) {
	return render(ExpensesTable, {
		expenses: STANDALONE,
		vehicles: [VEHICLE],
		onDelete: vi.fn(async () => {}),
		...props
	});
}

function desktopAmounts(container: HTMLElement): string[] {
	return [...container.querySelectorAll('tbody tr')].map(
		tr => tr.textContent?.match(/\$[\d,]+\.\d\d/)?.[0] ?? ''
	);
}

async function clickSort(name: 'Date' | 'Amount') {
	await fireEvent.click(screen.getByRole('button', { name }));
}

async function chooseCategory(name: string) {
	const trigger = screen.getByRole('combobox', { name: 'Category filter' });
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

async function confirmDeleteIn() {
	const dialog = await screen.findByRole('alertdialog');
	await fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }));
}

function notificationMessages(): string[] {
	return appStore.notifications.map(n => n.message);
}

beforeEach(() => {
	vi.clearAllMocks();
	resetPendingDeletes();
	resetPendingEdits();
	appStore.clearNotifications();
	deleteExpense.mockResolvedValue();
	deleteSplitExpense.mockResolvedValue();
	useLayout('wide');
});

describe('ExpensesTable empty state', () => {
	test('with no expenses shows the given empty copy and a link to add one', () => {
		mountTable({
			expenses: [],
			emptyTitle: 'Nothing logged',
			emptyDescription: 'Log your first fill-up.',
			emptyActionLabel: 'Log Expense',
			emptyActionHref: '/expenses/new?vehicleId=v1'
		});

		expect(screen.getByText('Nothing logged')).toBeTruthy();
		expect(screen.getByText('Log your first fill-up.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Log Expense' }).getAttribute('href')).toBe(
			'/expenses/new?vehicleId=v1'
		);
		expect(document.querySelector('table')).toBeNull();
	});

	test('with active filters offers to clear them instead', async () => {
		const onClearFilters = vi.fn();
		mountTable({ expenses: [], hasActiveFilters: true, onClearFilters });

		expect(screen.getByText('No matching expenses')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Add First Expense' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
		expect(onClearFilters).toHaveBeenCalledTimes(1);
	});

	test('active filters without a clear handler still link to adding an expense', () => {
		mountTable({ expenses: [], hasActiveFilters: true });

		expect(screen.getByText('No matching expenses')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Add First Expense' })).toBeTruthy();
	});
});

describe('ExpensesTable local sorting', () => {
	test('defaults to newest first', () => {
		const { container } = mountTable();

		expect(desktopAmounts(container)).toEqual(['$75.00', '$300.00', '$15.00']);
	});

	test('sorting by amount goes largest first, then flips on a second click', async () => {
		const { container } = mountTable();

		await clickSort('Amount');
		expect(desktopAmounts(container)).toEqual(['$300.00', '$75.00', '$15.00']);

		await clickSort('Amount');
		expect(desktopAmounts(container)).toEqual(['$15.00', '$75.00', '$300.00']);
	});

	test('clicking Date while sorted by date flips to oldest first', async () => {
		const { container } = mountTable();

		await clickSort('Date');

		expect(desktopAmounts(container)).toEqual(['$15.00', '$300.00', '$75.00']);
	});

	test('the compact list sorts the same way', async () => {
		useLayout('compact');
		mountTable();

		await clickSort('Amount');

		const amounts = screen.getAllByText(/^\$[\d,]+\.\d\d$/).map(el => el.textContent);
		expect(amounts).toEqual(['$300.00', '$75.00', '$15.00']);
	});
});

describe('ExpensesTable server-controlled sorting', () => {
	test('reports the next sort instead of reordering rows itself', async () => {
		const onSortChange = vi.fn();
		const { container } = mountTable({ onSortChange });
		const before = desktopAmounts(container);

		await clickSort('Amount');

		expect(onSortChange).toHaveBeenCalledWith('amount', 'desc');
		expect(desktopAmounts(container)).toEqual(before);
	});

	test('with no active sort given it treats the list as newest first', async () => {
		const onSortChange = vi.fn();
		mountTable({ onSortChange });

		await clickSort('Date');

		expect(onSortChange).toHaveBeenCalledWith('date', 'asc');
	});

	test.each([
		['desc', 'asc'],
		['asc', 'desc']
	] as const)('clicking the active %s column asks for %s', async (activeSortDir, expected) => {
		const onSortChange = vi.fn();
		mountTable({ onSortChange, activeSortBy: 'amount', activeSortDir });

		await clickSort('Amount');

		expect(onSortChange).toHaveBeenCalledWith('amount', expected);
	});
});

describe('ExpensesTable category filter', () => {
	test('filters rows locally when the parent does not own the filter', async () => {
		const { container } = mountTable();

		await chooseCategory('Maintenance');

		expect(desktopAmounts(container)).toEqual(['$300.00']);
	});

	test('reports the choice and keeps every row when the parent owns the filter', async () => {
		const onCategoryChange = vi.fn();
		const { container } = mountTable({ onCategoryChange, activeCategory: 'fuel' });

		expect(screen.getByRole('combobox', { name: 'Category filter' }).textContent?.trim()).toContain(
			'Fuel'
		);
		await chooseCategory('Maintenance');

		expect(onCategoryChange).toHaveBeenCalledWith('maintenance');
		expect(desktopAmounts(container)).toHaveLength(3);
	});
});

describe('ExpensesTable paging', () => {
	test('shows page controls when there is a total and a page handler', async () => {
		const onPageChange = vi.fn();
		mountTable({ totalCount: 45, currentOffset: 20, pageSize: 20, onPageChange });

		await fireEvent.click(screen.getByRole('button', { name: /Next/ }));
		await fireEvent.click(screen.getByRole('button', { name: /Previous/ }));

		expect(onPageChange).toHaveBeenNthCalledWith(1, 40);
		expect(onPageChange).toHaveBeenNthCalledWith(2, 0);
	});

	test.each([
		['a zero total', { totalCount: 0, onPageChange: vi.fn() }],
		['no page handler', { totalCount: 45 }],
		['no total', { onPageChange: vi.fn() }]
	])('hides page controls with %s', (_label, props) => {
		mountTable(props);

		expect(screen.queryByRole('button', { name: /Next/ })).toBeNull();
	});
});

describe('ExpensesTable deleting', () => {
	test('a confirmed delete hides the row at once and offers Undo, with no DELETE sent yet', async () => {
		const onDelete = vi.fn(async () => {});
		const { container } = mountTable({ onDelete });

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]!);
		await confirmDeleteIn();

		await waitFor(() => expect(desktopAmounts(container)).toEqual(['$300.00', '$15.00']));
		expect(notificationMessages()).toEqual(['Expense deleted']);
		expect(deleteExpense).not.toHaveBeenCalled();
		expect(onDelete).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('Undo puts the row back and no DELETE is ever sent', async () => {
		const { container } = mountTable();
		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]!);
		await confirmDeleteIn();
		await waitFor(() => expect(desktopAmounts(container)).toHaveLength(2));

		appStore.notifications.at(-1)?.action?.onClick();

		await waitFor(() => expect(desktopAmounts(container)).toHaveLength(3));
		expect(deleteExpense).not.toHaveBeenCalled();
	});

	test('deleting a split group hides every portion of it', async () => {
		const { container } = mountTable({ expenses: [...SPLIT, NEW_MEDIUM] });

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' }).at(-1)!);
		await confirmDeleteIn();

		await waitFor(() => expect(desktopAmounts(container)).toEqual(['$75.00']));
	});

	test('a failed split delete shows the group row again with its reason and Retry', async () => {
		deleteSplitExpense.mockRejectedValue('offline');
		vi.useFakeTimers();
		scheduleDelete(SPLIT[0]!);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		vi.useRealTimers();

		mountTable({ expenses: SPLIT });

		expect(screen.getByText(`Not deleted: ${UNEXPECTED_FAILURE_MESSAGE}`)).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /^Retry deleting/ }));
		await waitFor(() => expect(deleteSplitExpense).toHaveBeenCalledTimes(2));
		expect(deleteSplitExpense).toHaveBeenLastCalledWith('g1');
	});

	test('an edit shows its new values while the PUT is still running', () => {
		updateExpense.mockReturnValue(new Promise(() => {}));
		scheduleEdit(NEW_MEDIUM, { ...NEW_MEDIUM, amount: 99 }, {} as never);

		const { container } = mountTable();

		expect(desktopAmounts(container)).toEqual(['$99.00', '$300.00', '$15.00']);
	});

	test('a failed edit shows the saved values with its reason, Retry and Edit', async () => {
		updateExpense.mockRejectedValueOnce('offline').mockResolvedValueOnce({});
		scheduleEdit(NEW_MEDIUM, { ...NEW_MEDIUM, amount: 99 }, {} as never);
		await waitFor(() => expect(appStore.notifications).toHaveLength(1));

		const { container } = mountTable();

		expect(desktopAmounts(container)).toEqual(['$75.00', '$300.00', '$15.00']);
		expect(
			screen.getByText(`Changes not saved: ${UNEXPECTED_FAILURE_MESSAGE}`)
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /^Edit \$75\.00/ })).toHaveAttribute(
			'href',
			'/expenses/new/edit?returnTo=/expenses'
		);
		await fireEvent.click(screen.getByRole('button', { name: /^Retry saving changes/ }));
		await waitFor(() => expect(desktopAmounts(container)[0]).toBe('$99.00'));
		expect(updateExpense).toHaveBeenCalledTimes(2);
	});

	test('a failed delete shows the row again with its reason and Retry', async () => {
		deleteExpense.mockRejectedValue('offline');
		vi.useFakeTimers();
		scheduleDelete(NEW_MEDIUM);
		await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
		vi.useRealTimers();

		const { container } = mountTable();

		expect(desktopAmounts(container)).toHaveLength(3);
		expect(screen.getByText(`Not deleted: ${UNEXPECTED_FAILURE_MESSAGE}`)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /^Retry deleting/ })).toBeInTheDocument();
	});

	test('read-only viewers get no delete controls even when a handler is passed', () => {
		mountTable({ canWrite: false });

		expect(screen.queryByRole('button', { name: 'Delete expense' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Edit expense' })).toBeNull();
	});
});

describe('ExpensesTable compact rows', () => {
	beforeEach(() => useLayout('compact'));

	test('tapping a row reveals its actions and tapping it again hides them', async () => {
		mountTable();
		const row = screen.getByRole('button', { name: /Maintenance/ });

		await fireEvent.click(row);
		expect(row.getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByRole('link', { name: /Edit/ })).toBeTruthy();

		await fireEvent.click(row);
		expect(row.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('link', { name: /Edit/ })).toBeNull();
	});

	test('a split group delete from the compact list hides the whole group', async () => {
		mountTable({ expenses: SPLIT });

		await fireEvent.click(screen.getByRole('button', { name: /Maintenance/ }));
		await fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
		await confirmDeleteIn();

		await waitFor(() => expect(screen.queryByRole('button', { name: /Maintenance/ })).toBeNull());
	});
});

describe('ExpensesTable rows lead with what the user would call the expense', () => {
	const NAMED = expense({
		id: 'named',
		description: 'Arco',
		location: 'Main St',
		amount: 42.5,
		date: localNoonISO(2024, 2, 21)
	});
	const UNNAMED = expense({ id: 'unnamed', category: 'maintenance', amount: 80 });
	const NAMED_SPLIT = [
		expense({ id: 'ns-a', amount: 30, description: 'Car wash', groupId: 'g2' }),
		expense({ id: 'ns-b', amount: 30, description: 'Car wash', groupId: 'g2' })
	];

	test('compact rows put the description first and the category in the meta line', () => {
		useLayout('compact');
		mountTable({ expenses: [NAMED, UNNAMED, ...NAMED_SPLIT], showVehicleColumn: true });

		const named = screen.getByText('Arco').closest('button') as HTMLElement;
		expect(named.querySelector('p')).toHaveTextContent('Arco');
		expect(named).toHaveTextContent(/Fuel · Daily Driver · Mar 21, 2024/);

		const unnamed = screen.getByText('Maintenance').closest('button') as HTMLElement;
		expect(unnamed.querySelector('p')).toHaveTextContent('Maintenance');
		expect(unnamed).not.toHaveTextContent(/Maintenance ·/);

		const split = screen.getByText('Car wash').closest('button') as HTMLElement;
		expect(split.querySelector('div div')).toHaveTextContent(/^Car wash\s*Split$/);
		expect(split).toHaveTextContent(/Fuel · .* · /);
	});

	test('the desktop table opens each row with the description, falling back to the category', () => {
		useLayout('wide');
		const { container } = mountTable({ expenses: [NAMED, UNNAMED, ...NAMED_SPLIT] });

		expect(container.querySelector('thead th')).toHaveTextContent('Description');
		const firstCells = [...container.querySelectorAll('tbody tr')].map(
			tr => tr.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
		);
		expect(firstCells).toEqual(['Arco Main St', 'Maintenance', 'Car wash']);
	});
});

describe('ExpensesTable month groups', () => {
	const TOTALS = new Map([
		['2024-03', 1234.5],
		['2024-02', 300]
	]);

	test.each(['compact', 'wide'] as const)(
		'%s: a date-sorted list gets one month heading per month, with the total for the whole filter',
		layout => {
			useLayout(layout);
			mountTable({ monthTotals: TOTALS });

			const headings = screen.getAllByRole('heading', { level: 2 });
			expect(headings.map(h => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
				'March 2024 total $1,234.50',
				'February 2024 total $300.00',
				'January 2024'
			]);
		}
	);

	test('ledger: a wide screen gets the row list and month headings, with no table or toolbar', () => {
		useLayout('wide');
		mountTable({ monthTotals: TOTALS, ledger: true });

		expect(screen.queryByRole('table')).toBeNull();
		expect(screen.queryByRole('combobox', { name: /Category/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Amount/ })).toBeNull();
		expect(screen.getByTestId('expense-ledger')).toBeTruthy();
		const headings = screen.getAllByRole('heading', { level: 2 });
		expect(headings[0]?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'March 2024 total $1,234.50'
		);
	});

	test.each(['compact', 'wide'] as const)(
		'%s: sorting by amount drops the month headings',
		async layout => {
			useLayout(layout);
			mountTable({ monthTotals: TOTALS });

			await clickSort('Amount');

			expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
		}
	);

	test('without month totals the list stays ungrouped', () => {
		useLayout('compact');
		mountTable();

		expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
	});
});
