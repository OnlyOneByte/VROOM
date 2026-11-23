import { beforeEach, describe, expect, test, vi } from 'vitest';
import { UNEXPECTED_FAILURE_MESSAGE } from '#lib/utils/error-handling.ts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Expense, Vehicle } from '#lib/types/index.ts';
import { appStore } from '#lib/stores/app.svelte.ts';

const { deleteExpense, deleteSplitExpense } = vi.hoisted(() => ({
	deleteExpense: vi.fn<(id: string) => Promise<void>>(),
	deleteSplitExpense: vi.fn<(groupId: string) => Promise<void>>()
}));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		deleteExpense: (id: string) => deleteExpense(id),
		deleteSplitExpense: (groupId: string) => deleteSplitExpense(groupId)
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
	test('a confirmed delete removes the expense and reports success', async () => {
		const onDelete = vi.fn(async () => {});
		mountTable({ onDelete });

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]!);
		await confirmDeleteIn();

		await waitFor(() => expect(onDelete).toHaveBeenCalledWith(NEW_MEDIUM));
		expect(deleteExpense).toHaveBeenCalledWith('new');
		expect(deleteSplitExpense).not.toHaveBeenCalled();
		expect(notificationMessages()).toContain('Expense deleted successfully');
		await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
	});

	test('deleting a split group removes the whole group', async () => {
		const onDelete = vi.fn(async () => {});
		mountTable({ expenses: SPLIT, onDelete });

		await fireEvent.click(screen.getByRole('button', { name: 'Delete expense' }));
		await confirmDeleteIn();

		await waitFor(() => expect(deleteSplitExpense).toHaveBeenCalledWith('g1'));
		expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'g1' }));
		expect(deleteExpense).not.toHaveBeenCalled();
	});

	test('a failed delete reports the server reason as a sentence and does not notify the parent', async () => {
		deleteExpense.mockRejectedValue(new Error('Expense is locked'));
		const onDelete = vi.fn(async () => {});
		mountTable({ onDelete });

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]!);
		await confirmDeleteIn();

		await waitFor(() =>
			expect(notificationMessages()).toContain("Couldn't delete the expense. Expense is locked.")
		);
		expect(onDelete).not.toHaveBeenCalled();
	});

	test('a failed delete keeps the dialog open with focus on Delete so the user can retry', async () => {
		let reject: (reason: unknown) => void = () => {};
		deleteExpense.mockReturnValue(new Promise((_, r) => (reject = r)));
		mountTable();

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]!);
		const dialog = await screen.findByRole('alertdialog');
		const confirm = within(dialog).getByRole('button', { name: 'Delete' });
		confirm.focus();
		await fireEvent.click(confirm);
		expect(confirm).toHaveAttribute('aria-disabled', 'true');
		expect(confirm).not.toBeDisabled();
		reject(new Error('Expense is locked'));

		await waitFor(() =>
			expect(notificationMessages()).toContain("Couldn't delete the expense. Expense is locked.")
		);
		expect(screen.getByRole('alertdialog')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Delete' })).toBe(confirm);
		expect(document.activeElement).toBe(confirm);
	});

	test('a failed delete with a non-Error reason shows the generic message', async () => {
		deleteExpense.mockRejectedValue('offline');
		mountTable();

		await fireEvent.click(screen.getAllByRole('button', { name: 'Delete expense' })[0]!);
		await confirmDeleteIn();

		await waitFor(() =>
			expect(notificationMessages()).toContain(
				`Couldn't delete the expense. ${UNEXPECTED_FAILURE_MESSAGE}`
			)
		);
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

	test('a split group delete from the compact list removes the whole group', async () => {
		mountTable({ expenses: SPLIT });

		await fireEvent.click(screen.getByRole('button', { name: /Maintenance/ }));
		await fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
		await confirmDeleteIn();

		await waitFor(() => expect(deleteSplitExpense).toHaveBeenCalledWith('g1'));
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
		expect(named).toHaveTextContent(/Fuel\s*·\s*Mar 21, 2024\s*·\s*Daily Driver/);

		const unnamed = screen.getByText('Maintenance').closest('button') as HTMLElement;
		expect(unnamed.querySelector('p')).toHaveTextContent('Maintenance');

		const split = screen.getByText('Car wash').closest('button') as HTMLElement;
		expect(split).toHaveTextContent(/Split/);
		expect(split).toHaveTextContent(/Split\s*·\s*Fuel\s*·/);
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
