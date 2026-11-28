import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Expense, SplitExpenseGroup, Vehicle } from '#lib/types/index.ts';
import type { ReceiptDraft } from '#lib/services/vlm-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import {
	ApiError,
	NETWORK_FAILURE_MESSAGE,
	NetworkError,
	SERVER_FAILURE_MESSAGE
} from '#lib/utils/error-handling.ts';
import { dateOnlyToISO, toDateInputValue } from '#lib/utils/formatters.ts';

const goto = vi.fn(() => Promise.resolve());
vi.mock('$app/navigation', () => ({
	goto,
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

function makeVehicle(overrides: Partial<Vehicle>): Vehicle {
	return {
		id: 'v1',
		make: 'Toyota',
		model: 'Camry',
		year: 2020,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z',
		...overrides
	};
}

const CAMRY = makeVehicle({});
const LEAF = makeVehicle({
	id: 'v2',
	make: 'Nissan',
	model: 'Leaf',
	year: 2022,
	vehicleType: 'electric',
	trackFuel: false,
	trackCharging: true
});

const getVehicles = vi.fn<() => Promise<Vehicle[]>>();
const getVehicle = vi.fn<(id: string) => Promise<Vehicle>>();
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: { getVehicles, getVehicle }
}));

const createExpense = vi.fn();
const getExpense = vi.fn<(id: string) => Promise<Expense | null>>();
const updateExpense = vi.fn();
const deleteExpense = vi.fn();
const getExpensesByVehicle = vi.fn(() => Promise.resolve({ data: [] as Expense[] }));
const getSplitExpense = vi.fn<(groupId: string) => Promise<SplitExpenseGroup>>();
const getPhotos = vi.fn(() => Promise.resolve({ data: [] }));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		createExpense,
		getExpense,
		getSplitExpense,
		updateExpense,
		deleteExpense,
		getExpensesByVehicle,
		getPhotos,
		getPhotoThumbnailUrl: vi.fn(() => ''),
		uploadPhoto: vi.fn(),
		deletePhoto: vi.fn()
	}
}));

const parseReceipt = vi.fn<(image: File) => Promise<ReceiptDraft>>();
vi.mock('#lib/services/vlm-api.ts', () => ({ vlmApi: { parseReceipt } }));

const syncSoon = vi.fn();
vi.mock('#lib/utils/sync/sync-manager.ts', () => ({
	syncManager: { syncSoon, requestAutoSync: vi.fn(), syncAll: vi.fn(() => Promise.resolve({})) }
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;
const { loadOfflineExpenses } = await import('#lib/utils/offline-storage.ts');
const { isDeleteHidden, resetPendingDeletes } =
	await import('#lib/utils/pending-deletes.svelte.ts');
const { resetPendingEdits, scheduleEdit } = await import('#lib/utils/pending-edits.svelte.ts');
const queued = () => loadOfflineExpenses();
const { FUEL_NEEDS_VEHICLE_MESSAGE } = await import('../expense-form/expense-form-state.svelte.ts');

const EXISTING: Expense = {
	id: 'exp-1',
	vehicleId: 'v1',
	userId: 'u1',
	tags: ['oil'],
	category: 'maintenance',
	amount: 79.99,
	date: dateOnlyToISO('2026-05-10'),
	mileage: 31000,
	description: 'Oil change',
	location: 'Quick Lube',
	createdAt: '2026-05-10T12:00:00.000Z',
	updatedAt: '2026-05-10T12:00:00.000Z'
};

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
	const el = document.getElementById(id);
	if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
		throw new Error(`no field #${id}`);
	}
	return el;
}

async function type(id: string, value: string): Promise<void> {
	await fireEvent.input(field(id), { target: { value } });
}

function errorText(id: string): string | null {
	return document.getElementById(`${id}-error`)?.textContent?.trim() ?? null;
}

function categoryButton(label: string): HTMLElement {
	return screen.getByRole('radio', { name: new RegExp(`^${label}`) });
}

function vehicleTriggerText(): string {
	return (document.getElementById('vehicle')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function notificationMessages(): string[] {
	return appStore.notifications.map(n => n.message);
}

async function chooseVehicle(name: string): Promise<void> {
	const trigger = document.getElementById('vehicle');
	if (!trigger) throw new Error('no vehicle select');
	await fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
	await fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
	const option = await screen.findByRole('option', { name });
	await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
	await fireEvent.click(option);
}

async function renderCreate(props: Record<string, string> = {}): Promise<void> {
	render(ExpenseForm, { props });
	await screen.findByRole('heading', { name: 'New expense' });
	await vi.waitFor(() => expect(getVehicle).toHaveBeenCalled());
}

async function renderEdit(expense: Expense = EXISTING, returnTo = '/expenses'): Promise<void> {
	getExpense.mockResolvedValue(expense);
	render(ExpenseForm, { props: { expenseId: expense.id, returnTo } });
	await screen.findByTestId('expense-edit-header');
}

function save(): Promise<boolean> {
	return fireEvent.click(screen.getByRole('button', { name: /save (expense|changes)/i }));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
	vi.clearAllMocks();
	getVehicles.mockResolvedValue([CAMRY, LEAF]);
	getVehicle.mockImplementation(id => Promise.resolve(id === 'v2' ? LEAF : CAMRY));
	getExpensesByVehicle.mockResolvedValue({ data: [] });
	appStore.clearNotifications();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('ExpenseForm create mode', () => {
	test('preselects the first vehicle and offers only cancel and save actions', async () => {
		await renderCreate();

		expect(vehicleTriggerText()).toBe('2020 Toyota Camry');
		expect(screen.queryByText('Track a new vehicle expense')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(field('amount')));
		expect(screen.getByRole('button', { name: /save expense/i })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /duplicate/i })).toBeNull();
		expect(document.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(0);
	});

	test('saving an empty form flags category and amount and sends nothing', async () => {
		await renderCreate();

		await save();

		expect(errorText('category')).toBe('Please select a category');
		expect(errorText('amount')).toBe('Amount must be greater than 0');
		expect(createExpense).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	test('an invalid amount keeps its error underline while focused', async () => {
		await renderCreate();
		await save();

		const figure = screen.getByTestId('quick-amount-figure');
		expect(figure).toHaveClass('border-destructive');
		expect(figure.className).not.toContain('focus-within:border-needle');
	});

	test('a failed save moves focus from Save to the first invalid field', async () => {
		await renderCreate();

		await save();

		const firstProblem = document.querySelector(
			'form [aria-invalid="true"], form [data-invalid="true"]'
		);
		expect(firstProblem).not.toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(firstProblem));
	});

	test('with an amount but no category, a failed save focuses the category group, described by its error', async () => {
		await renderCreate();
		await type('amount', '20');

		await save();

		const group = screen.getByRole('radiogroup', { name: 'Category *' });
		await vi.waitFor(() => expect(document.activeElement).toBe(group));
		expect(group).toHaveAttribute('aria-describedby', 'category-error');
		expect(document.getElementById('category-error')).toHaveTextContent('Please select a category');
	});

	test.each([
		['an empty state', [] as Vehicle[], 'Add a vehicle first'],
		['the form', [CAMRY], null]
	])(
		'while the vehicle list loads, the page shows its header and a skeleton, then %s',
		async (_label, vehicles, emptyHeading) => {
			let finish: (list: Vehicle[]) => void = () => {};
			getVehicles.mockReturnValue(new Promise(resolve => (finish = resolve)));
			render(ExpenseForm);
			await tick();

			expect(screen.getByRole('heading', { name: 'New expense' })).toBeTruthy();
			const skeleton = screen.getByTestId('expense-form-skeleton');
			expect(skeleton.getAttribute('aria-busy')).toBe('true');
			const figure = skeleton.querySelector('p[aria-hidden="true"]');
			expect(figure).toHaveTextContent(/^\$\s*0\.00$/);
			expect(figure).toHaveClass('font-(family-name:--font-fig)');
			expect(screen.queryByRole('button', { name: /save expense/i })).toBeNull();
			expect(screen.queryByRole('heading', { name: 'Add a vehicle first' })).toBeNull();

			finish(vehicles);
			if (emptyHeading) await screen.findByRole('heading', { name: emptyHeading });
			else await screen.findByRole('button', { name: /save expense/i });
			expect(screen.queryByTestId('expense-form-skeleton')).toBeNull();
		}
	);

	test('with no vehicles the form gives way to an Add vehicle empty state', async () => {
		getVehicles.mockResolvedValue([]);
		render(ExpenseForm, { props: { preselectedCategory: 'misc', preselectedAmount: '5' } });

		await screen.findByRole('heading', { name: 'Add a vehicle first' });

		expect(screen.getByRole('heading', { name: 'New expense' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Add vehicle' }).getAttribute('href')).toBe(
			'/vehicles/new'
		);
		expect(document.getElementById('vehicle')).toBeNull();
		expect(screen.queryByRole('button', { name: /save expense/i })).toBeNull();
		expect(getVehicle).not.toHaveBeenCalled();
	});

	test('rejects an amount over the API cap with the API sentence', async () => {
		await renderCreate({ preselectedCategory: 'misc' });
		await type('amount', '1000001');

		await save();

		expect(errorText('amount')).toBe('Amount must be 1,000,000 or less');
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('rejects an amount with more than 2 decimals before sending it', async () => {
		await renderCreate({ preselectedCategory: 'misc' });
		await type('amount', '12.345');

		await save();

		expect(errorText('amount')).toBe('Amount can have at most 2 decimal places');
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('leaving the amount field before typing in it shows no error', async () => {
		await renderCreate();

		await fireEvent.blur(field('amount'));

		expect(errorText('amount')).toBeNull();
	});

	test('leaving the amount field with zero shows the amount error before saving', async () => {
		await renderCreate();
		await type('amount', '0');

		await fireEvent.blur(field('amount'));

		expect(errorText('amount')).toBe('Amount must be greater than 0');
	});

	test('picking a category checks it and clears the category error', async () => {
		await renderCreate();
		await save();
		expect(errorText('category')).not.toBeNull();

		await fireEvent.click(categoryButton('Maintenance'));

		expect(categoryButton('Maintenance').getAttribute('aria-checked')).toBe('true');
		expect(categoryButton('Fuel').getAttribute('aria-checked')).toBe('false');
		expect(errorText('category')).toBeNull();
	});

	test('the fuel category reveals the fuel fields and makes mileage and volume required', async () => {
		await renderCreate();
		expect(document.getElementById('volume')).toBeNull();

		await fireEvent.click(categoryButton('Fuel'));
		await type('amount', '45');
		await save();

		expect(document.getElementById('volume')).not.toBeNull();
		expect(errorText('mileage')).toBe('Mileage required for fuel expenses');
		expect(errorText('volume')).toMatch(/required for fuel expenses$/);
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('a fuel expense keeps its heading levels in order', async () => {
		await renderCreate();
		await fireEvent.click(categoryButton('Fuel'));

		const levels = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'), h =>
			Number(h.tagName[1])
		);
		expect(levels).toEqual([1, 2, 2]);
	});

	test('switching from fuel to another category hides the fuel fields and keeps the mileage', async () => {
		await renderCreate();
		await fireEvent.click(categoryButton('Fuel'));
		await type('mileage', '12000');
		await type('volume', '11.2');

		await fireEvent.click(categoryButton('Regulatory'));

		expect(document.getElementById('volume')).toBeNull();
		expect(field('mileage').value).toBe('12000');
	});

	test('a mileage of 0 on a non-fuel expense is refused, not dropped', async () => {
		await renderCreate({ preselectedCategory: 'misc', preselectedAmount: '12' });
		await type('mileage', '0');

		await save();

		expect(errorText('mileage')).toBe('Mileage must be greater than 0');
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('the mileage field keeps what the user types instead of rewriting it', async () => {
		await renderCreate({ preselectedCategory: 'misc' });
		const input = field('mileage');
		const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
		const writes: string[] = [];
		Object.defineProperty(input, 'value', {
			configurable: true,
			get: () => native?.get?.call(input),
			set: (v: string) => {
				writes.push(v);
				native?.set?.call(input, v);
			}
		});

		await type('mileage', '007');

		expect(writes).toEqual([]);
		expect(input.value).toBe('007');
	});

	test('a split across vehicles asks for no mileage, since a split saves none', async () => {
		await renderCreate({ preselectedCategory: 'maintenance' });
		expect(document.getElementById('mileage')).not.toBeNull();

		await fireEvent.click(screen.getByLabelText('Split cost across vehicles'));
		await vi.waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
		for (const box of screen.getAllByRole('checkbox', { checked: false })) {
			await fireEvent.click(box);
		}

		await vi.waitFor(() => expect(document.getElementById('mileage')).toBeNull());
		expect(screen.queryByText(/mileage readings/i)).toBeNull();
	});

	test('applies preselected category, amount, description and tags from the query', async () => {
		await renderCreate({
			preselectedCategory: 'enhancement',
			preselectedAmount: '250',
			preselectedDescription: 'Roof rack',
			preselectedTags: 'accessories, roof'
		});

		expect(categoryButton('Enhancement').getAttribute('aria-checked')).toBe('true');
		expect(field('amount').value).toBe('250');
		expect(field('description').value).toBe('Roof rack');
		expect(screen.getByText('accessories')).toBeTruthy();
		expect(screen.getByText('roof')).toBeTruthy();
	});

	test('a valid expense is created with the entered details and the user returns', async () => {
		createExpense.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		await renderCreate({ returnTo: '/vehicles/v1' });
		await fireEvent.click(categoryButton('Maintenance'));
		await type('amount', '120.50');
		await type('description', 'Brake pads');
		await type('location', 'Main St Garage');
		await type('mileage', '30500');

		await save();

		await vi.waitFor(() => expect(queued()).toHaveLength(1));
		expect(queued()[0]).toMatchObject({
			vehicleId: 'v1',
			tags: [],
			category: 'maintenance',
			amount: 120.5,
			date: dateOnlyToISO('2026-06-15'),
			mileage: 30500,
			description: 'Brake pads',
			location: 'Main St Garage',
			missedFillup: false,
			synced: false
		});
		expect(createExpense).not.toHaveBeenCalled();
		expect(syncSoon).toHaveBeenCalledOnce();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
		expect(notificationMessages()).toContainEqual(expect.stringMatching(/^Saved \$120\.50 for /));
	});

	test('choosing another vehicle loads its context and files the expense against it', async () => {
		createExpense.mockResolvedValue({ ...EXISTING, id: 'new-1', vehicleId: 'v2' });
		await renderCreate({ preselectedCategory: 'misc', preselectedAmount: '9.99' });

		await chooseVehicle('2022 Nissan Leaf');

		await vi.waitFor(() => expect(getVehicle).toHaveBeenCalledWith('v2'));
		expect(getExpensesByVehicle).toHaveBeenCalledWith('v2', { limit: 100 });
		expect(vehicleTriggerText()).toBe('2022 Nissan Leaf');
		await save();
		await vi.waitFor(() => expect(queued()).toHaveLength(1));
		expect(queued()[0]).toMatchObject({ vehicleId: 'v2', amount: 9.99 });
	});

	test.each([
		['the first vehicle', undefined, 'v1'],
		['a preselected vehicle', 'v2', 'v2']
	])('opening the form loads the context of %s once', async (_label, preselected, loaded) => {
		await renderCreate(preselected ? { preselectedVehicleId: preselected } : {});
		await vi.waitFor(() => expect(getExpensesByVehicle).toHaveBeenCalledTimes(2));
		await tick();

		expect(getVehicle).toHaveBeenCalledTimes(1);
		expect(getVehicle).toHaveBeenCalledWith(loaded);
		expect(getExpensesByVehicle).toHaveBeenCalledWith(loaded, { limit: 10, category: 'fuel' });
		expect(getExpensesByVehicle).toHaveBeenCalledWith(loaded, { limit: 100 });
	});

	test('Cancel returns to returnTo without saving, and quick add has no separate back button', async () => {
		await renderCreate({ returnTo: '/vehicles/v1' });
		expect(screen.queryByRole('button', { name: 'Go back' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(1));
		expect(goto).toHaveBeenCalledWith('/vehicles/v1');
		expect(createExpense).not.toHaveBeenCalled();
	});
});

describe('ExpenseForm quick add', () => {
	async function saveMisc(vehicle?: string): Promise<void> {
		createExpense.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		await renderCreate();
		if (vehicle) await chooseVehicle(vehicle);
		await fireEvent.click(categoryButton('Misc'));
		await type('amount', '12');
		await save();
		await vi.waitFor(() => expect(goto).toHaveBeenCalled());
		cleanup();
		getVehicle.mockClear();
	}

	test('the next entry opens on the last vehicle and its last category', async () => {
		await saveMisc('2022 Nissan Leaf');

		await renderCreate();

		expect(vehicleTriggerText()).toBe('2022 Nissan Leaf');
		expect(categoryButton('Misc').getAttribute('aria-checked')).toBe('true');
	});

	test('a category in the URL wins over the remembered one', async () => {
		await saveMisc();

		await renderCreate({ preselectedCategory: 'fuel' });

		expect(categoryButton('Fuel').getAttribute('aria-checked')).toBe('true');
		expect(categoryButton('Misc').getAttribute('aria-checked')).toBe('false');
	});

	test('switching vehicle swaps a remembered category for that vehicle\u2019s own', async () => {
		await saveMisc();

		await renderCreate();
		expect(categoryButton('Misc').getAttribute('aria-checked')).toBe('true');
		await chooseVehicle('2022 Nissan Leaf');

		expect(categoryButton('Misc').getAttribute('aria-checked')).toBe('true');
		localStorage.setItem(
			'vroom.expense.quick-add',
			JSON.stringify({ vehicleId: 'v1', categoryByVehicle: { v1: 'misc', v2: 'maintenance' } })
		);
		await chooseVehicle('2020 Toyota Camry');
		await chooseVehicle('2022 Nissan Leaf');

		expect(categoryButton('Maintenance').getAttribute('aria-checked')).toBe('true');
	});

	test('a category the user picked survives a vehicle switch', async () => {
		localStorage.setItem(
			'vroom.expense.quick-add',
			JSON.stringify({ vehicleId: 'v1', categoryByVehicle: { v2: 'maintenance' } })
		);
		await renderCreate();
		await fireEvent.click(categoryButton('Regulatory'));

		await chooseVehicle('2022 Nissan Leaf');

		expect(categoryButton('Regulatory').getAttribute('aria-checked')).toBe('true');
	});

	test('arrowing through the categories keeps a typed fill-up', async () => {
		await renderCreate({ preselectedCategory: 'fuel' });
		await type('amount', '40');
		await vi.waitFor(() => expect(document.getElementById('volume')).not.toBeNull());
		await type('volume', '10.5');

		categoryButton('Fuel').focus();
		await fireEvent.keyDown(categoryButton('Fuel'), { key: 'ArrowRight' });
		expect(categoryButton('Maintenance').getAttribute('aria-checked')).toBe('true');
		await fireEvent.keyDown(categoryButton('Maintenance'), { key: 'ArrowLeft' });

		expect(categoryButton('Fuel').getAttribute('aria-checked')).toBe('true');
		await vi.waitFor(() => expect(field('volume').value).toBe('10.5'));
	});

	test('a split disables Fuel instead of undoing the split', async () => {
		await renderCreate({ preselectedCategory: 'misc' });
		await fireEvent.click(screen.getByRole('button', { name: 'Split cost across vehicles' }));

		expect(categoryButton('Fuel')).toBeDisabled();
		expect(categoryButton('Misc')).not.toBeDisabled();
	});

	test('More details opens when a field inside it is invalid', async () => {
		await renderCreate({ preselectedCategory: 'misc', preselectedAmount: '5' });
		const toggle = screen.getByRole('button', { name: /More details/ });
		expect(toggle).toHaveAttribute('aria-expanded', 'false');

		await fireEvent.click(toggle);
		await type('mileage', '0');
		await fireEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await save();

		expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await vi.waitFor(() => expect(document.activeElement).toBe(field('mileage')));
	});

	test('editing shows every saved value with no More details toggle', async () => {
		await renderEdit();

		expect(screen.queryByRole('button', { name: /More details/ })).toBeNull();
		expect(field('description').value).toBe('Oil change');
	});
});

describe('ExpenseForm edit mode', () => {
	test('titles the page with the expense, links back to Expenses and shows no quick-add figure', async () => {
		await renderEdit();

		expect(screen.getByRole('heading', { level: 1, name: 'Oil change' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Back to Expenses' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'New expense' })).toBeNull();
		expect(field('amount')).not.toHaveClass('text-7xl');
	});

	test('the vehicle and date sit above the title, outside its name', async () => {
		await renderEdit();

		const title = screen.getByRole('heading', { level: 1, name: 'Oil change' });
		const kicker = await screen.findByText(/2020 Toyota Camry/, { selector: 'p' });
		expect(kicker.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(title.contains(kicker)).toBe(false);
	});

	test('the back link names where it goes, and the title falls back to the category', async () => {
		await renderEdit({ ...EXISTING, description: '' }, '/vehicles/v1');

		expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 1, name: 'Maintenance' })).toBeTruthy();
	});

	test('lays out the fields in labelled pairs with category and vehicle as selects', async () => {
		await renderEdit();

		const grid = screen.getByTestId('expense-edit-grid');
		expect(grid).toHaveClass('sm:grid-cols-2');
		expect(within(grid).getByLabelText('Amount *')).toBe(field('amount'));
		expect(within(grid).getByText('Date *')).toBeTruthy();
		expect(within(grid).getByRole('combobox', { name: /Category/ })).toHaveTextContent(
			'Maintenance'
		);
		expect(within(grid).getByRole('combobox', { name: /Vehicle/ })).toBeTruthy();
		expect(screen.queryByRole('radiogroup', { name: 'Category *' })).toBeNull();
	});

	test('prefills the form from the loaded expense and offers delete and duplicate', async () => {
		await renderEdit();

		expect(getExpense).toHaveBeenCalledWith('exp-1');
		await vi.waitFor(() => expect(screen.getByText(/2020 Toyota Camry/, { selector: 'p' })));
		expect(screen.getByRole('combobox', { name: /Category/ })).toHaveTextContent('Maintenance');
		expect(field('amount').value).toBe('79.99');
		expect(field('mileage').value).toBe('31000');
		expect(field('description').value).toBe('Oil change');
		expect(field('location').value).toBe('Quick Lube');
		expect(screen.getByText('oil')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /duplicate/i })).toBeTruthy();
	});

	test('a deleted expense is reported and the user is sent back', async () => {
		getExpense.mockRejectedValue(new ApiError('Expense not found', 404));
		render(ExpenseForm, { props: { expenseId: 'gone', returnTo: '/vehicles/v1' } });

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
		await tick();
		expect(notificationMessages()).toEqual(['That expense no longer exists.']);
		expect(getPhotos).not.toHaveBeenCalled();
	});

	test('a failed load stays on the page with Retry, and Retry loads the expense', async () => {
		getExpense.mockRejectedValueOnce(new ApiError('Internal server error', 500));
		render(ExpenseForm, { props: { expenseId: 'exp-1' } });

		const card = await screen.findByTestId('expense-load-error');
		expect(within(card).getByText("Couldn't load this expense")).toBeTruthy();
		expect(goto).not.toHaveBeenCalled();

		getExpense.mockResolvedValueOnce(EXISTING);
		await fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() => expect(field('amount').value).toBe('79.99'));
		expect(screen.queryByTestId('expense-load-error')).toBeNull();
		expect(goto).not.toHaveBeenCalled();
	});

	test('a failed split group load names the split expense on the card', async () => {
		getExpense.mockResolvedValue({ ...EXISTING, groupId: 'g1' });
		getSplitExpense.mockRejectedValue(new ApiError('Internal server error', 500));
		render(ExpenseForm, { props: { expenseId: 'exp-1' } });

		const card = await screen.findByTestId('expense-load-error');
		expect(within(card).getByText("Couldn't load this split expense")).toBeTruthy();
		expect(notificationMessages()).toEqual([]);
	});

	test("a whole amount opens with the currency's decimals, and saving it unchanged sends the same number", async () => {
		updateExpense.mockResolvedValue({ ...EXISTING, amount: 60 });
		await renderEdit({ ...EXISTING, amount: 60 });

		await vi.waitFor(() => expect(field('amount').value).toBe('60.00'));
		await save();

		await vi.waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
		expect(updateExpense.mock.calls[0]?.[1]).toMatchObject({ amount: 60 });
		resetPendingEdits();
	});

	test('a car whose owner counts in yen opens its amount with no decimals', async () => {
		getVehicles.mockResolvedValue([{ ...CAMRY, ownerCurrency: 'JPY' } as Vehicle, LEAF]);
		await renderEdit({ ...EXISTING, amount: 1200 });

		await vi.waitFor(() => expect(field('amount').value).toBe('1200'));
	});

	test('saving sends the edited expense to updateExpense and returns', async () => {
		updateExpense.mockResolvedValue({ ...EXISTING, amount: 85 });
		await renderEdit(EXISTING, '/vehicles/v1');
		await type('amount', '85');

		await save();

		await vi.waitFor(() => expect(updateExpense).toHaveBeenCalledTimes(1));
		const [id, payload] = updateExpense.mock.calls[0] ?? [];
		expect(id).toBe('exp-1');
		expect(payload).toMatchObject({
			vehicleId: 'v1',
			category: 'maintenance',
			amount: 85,
			tags: ['oil'],
			mileage: 31000,
			description: 'Oil change',
			location: 'Quick Lube',
			date: dateOnlyToISO(toDateInputValue(EXISTING.date))
		});
		expect(createExpense).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
		expect(notificationMessages()).toContainEqual(expect.stringMatching(/^Saved \$85\.00 for /));
	});

	test('reopening an expense while its save is running starts from the new values', async () => {
		updateExpense.mockReturnValue(new Promise(() => {}));
		scheduleEdit(EXISTING, { ...EXISTING, amount: 85 }, {} as never);

		await renderEdit();

		await vi.waitFor(() => expect(field('amount').value).toBe('85.00'));
		resetPendingEdits();
	});

	test('saving returns at once, and a refused update is reported once with its reason and Retry', async () => {
		updateExpense.mockRejectedValue(
			new ApiError('Mileage must be less than 30,500 (from later entry)', 400)
		);
		await renderEdit();

		await save();

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/expenses'));
		await vi.waitFor(() =>
			expect(notificationMessages()).toContain("Your changes to the expense weren't saved")
		);
		const refusal = appStore.notifications.find(n => n.type === 'error');
		expect(refusal?.description).toBe('Mileage must be less than 30,500 (from later entry).');
		expect(refusal?.action?.label).toBe('Retry');
		resetPendingEdits();
	});

	test('validation guards updates too', async () => {
		await renderEdit();
		await type('amount', '');

		await save();

		expect(errorText('amount')).toBe('Amount must be greater than 0');
		expect(updateExpense).not.toHaveBeenCalled();
	});

	test('duplicate opens a new expense prefilled with this one', async () => {
		await renderEdit(EXISTING, '/vehicles/v1');

		await fireEvent.click(screen.getByRole('button', { name: /duplicate/i }));

		expect(goto).toHaveBeenCalledTimes(1);
		const [target] = goto.mock.calls[0] as unknown as [string];
		const url = new URL(target, 'http://localhost');
		expect(url.pathname).toBe('/expenses/new');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			returnTo: '/vehicles/v1',
			vehicleId: 'v1',
			category: 'maintenance',
			amount: '79.99',
			description: 'Oil change',
			tags: 'oil'
		});
	});

	test('delete asks for confirmation, then returns at once and offers Undo before any DELETE', async () => {
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Oil change');

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/expenses'));
		expect(notificationMessages()).toContain('Deleted “Oil change”');
		expect(isDeleteHidden({ id: 'exp-1' })).toBe(true);
		expect(deleteExpense).not.toHaveBeenCalled();
		resetPendingDeletes();
	});
});

async function scanReceipt(draft: ReceiptDraft): Promise<File> {
	localStorage.setItem('vroom.vlm.receipt-scan-disclosed', '1');
	parseReceipt.mockResolvedValue(draft);
	const file = new File(['jpg'], 'receipt.jpg', { type: 'image/jpeg' });
	const picker = screen.getByTestId('receipt-scan-input');
	Object.defineProperty(picker, 'files', { value: [file], configurable: true });
	await fireEvent.change(picker);
	await vi.waitFor(() => expect(parseReceipt).toHaveBeenCalledWith(file));
	return file;
}

function insuranceLeg(id: string, vehicleId: string, amount: number): Expense {
	return {
		...EXISTING,
		id,
		vehicleId,
		amount,
		tags: ['insurance'],
		category: 'financial',
		description: 'Six-month premium',
		mileage: undefined,
		location: undefined,
		groupId: 'g-ins',
		groupTotal: 600,
		splitMethod: 'even'
	};
}

describe('ExpenseForm receipt scanning', () => {
	test('a scanned receipt fills the form, queues the photo and is saved as entered', async () => {
		createExpense.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		await renderCreate();

		await scanReceipt({
			amount: 64.2,
			date: '2026-03-01',
			category: 'maintenance',
			vendor: 'Jiffy Lube'
		});

		await vi.waitFor(() => expect(field('amount').value).toBe('64.20'));
		expect(field('description').value).toBe('Jiffy Lube');
		expect(categoryButton('Maintenance').getAttribute('aria-checked')).toBe('true');
		expect(screen.getByText('1 file queued. Will upload on save.')).toBeTruthy();
		expect(notificationMessages()).toContain('Receipt scanned — review the details and save.');

		await save();
		await vi.waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
		expect(createExpense.mock.calls[0]?.[0]).toMatchObject({
			category: 'maintenance',
			amount: 64.2,
			date: dateOnlyToISO('2026-03-01'),
			description: 'Jiffy Lube'
		});
	});

	test('a scanned fuel receipt keeps its odometer reading as the mileage', async () => {
		await renderCreate();

		await scanReceipt({ amount: 48, odometer: 30210, category: 'fuel' });

		await vi.waitFor(() => expect(field('mileage').value).toBe('30210'));
		expect(categoryButton('Fuel').getAttribute('aria-checked')).toBe('true');
		expect(document.getElementById('volume')).not.toBeNull();
	});

	test('a fuel receipt in litres fills the volume in the vehicle’s gallons', async () => {
		await renderCreate();

		await scanReceipt({ amount: 75.44, category: 'fuel', volume: 42.17, volumeUnit: 'liters' });

		await vi.waitFor(() => expect(field('volume').value).toBe('11.14'));
		expect(field('amount').value).toBe('75.44');
	});

	test('an odometer reading on a receipt with no category fills the mileage', async () => {
		await renderCreate({ preselectedCategory: 'misc' });

		await scanReceipt({ odometer: 30210 });

		await vi.waitFor(() => expect(field('mileage').value).toBe('30210'));
	});

	test('a scanned non-fuel receipt keeps its odometer reading as the mileage', async () => {
		await renderCreate();

		await scanReceipt({ odometer: 30210, category: 'maintenance' });

		await vi.waitFor(() =>
			expect(categoryButton('Maintenance').getAttribute('aria-checked')).toBe('true')
		);
		expect(field('mileage').value).toBe('30210');
	});

	test('a partial draft leaves the fields it has no value for untouched', async () => {
		await renderCreate({
			preselectedCategory: 'misc',
			preselectedAmount: '12',
			preselectedDescription: 'Car wash'
		});

		await scanReceipt({ vendor: 'Shell' });

		await vi.waitFor(() =>
			expect(screen.getByText('1 file queued. Will upload on save.')).toBeTruthy()
		);
		expect(field('amount').value).toBe('12');
		expect(field('description').value).toBe('Car wash');
		expect(field('mileage').value).toBe('');
		expect(categoryButton('Misc').getAttribute('aria-checked')).toBe('true');
	});

	test('the queued receipt photo can be removed before saving', async () => {
		await renderCreate();
		await scanReceipt({ amount: 5 });
		await vi.waitFor(() =>
			expect(screen.getByText('1 file queued. Will upload on save.')).toBeTruthy()
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Remove receipt.jpg' }));

		expect(screen.queryByText(/file queued/)).toBeNull();
	});

	test('editing an expense offers no receipt scan', async () => {
		await renderEdit();

		expect(screen.queryByTestId('receipt-scan-button')).toBeNull();
	});
});

describe('ExpenseForm loading and load failures', () => {
	test('shows a spinner while the expense being edited is still loading', async () => {
		getExpense.mockReturnValue(new Promise(() => {}));
		const { container } = render(ExpenseForm, { props: { expenseId: 'exp-1' } });

		await vi.waitFor(() => expect(getExpense).toHaveBeenCalled());
		expect(container.querySelector('.animate-spin')).not.toBeNull();
		expect(screen.queryByTestId('expense-edit-header')).toBeNull();
	});

	test('a vehicle detail failure names the server reason next to Retry', async () => {
		getVehicle.mockRejectedValue(new ApiError('Internal server error', 500));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });

		await screen.findByTestId('vehicle-load-error');

		expect(document.getElementById('vehicle-load-message')).toHaveTextContent(
			"Couldn't load this vehicle's details. Something went wrong on our side. Try again in a moment."
		);
		expect(screen.getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(
			"Couldn't load this vehicle's details. Something went wrong on our side. Try again in a moment."
		);
	});

	test('an offline vehicle detail failure asks to check the connection', async () => {
		getVehicle.mockRejectedValue(new NetworkError(new TypeError('Failed to fetch')));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });

		await screen.findByTestId('vehicle-load-error');

		expect(document.getElementById('vehicle-load-message')).toHaveTextContent(
			`Couldn't load this vehicle's details. ${NETWORK_FAILURE_MESSAGE}`
		);
	});

	test('a vehicle detail failure on a fill-up names the reason after the fill-up message', async () => {
		getVehicle.mockRejectedValue(new ApiError('Internal server error', 500));
		render(ExpenseForm, { props: { preselectedCategory: 'fuel' } });

		await screen.findByTestId('vehicle-load-error');

		expect(document.getElementById('vehicle-load-message')).toHaveTextContent(
			`${FUEL_NEEDS_VEHICLE_MESSAGE} ${SERVER_FAILURE_MESSAGE}`
		);
		expect(screen.getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(
			`${FUEL_NEEDS_VEHICLE_MESSAGE} ${SERVER_FAILURE_MESSAGE}`
		);
	});

	test('a vehicle detail failure on a non-fuel expense offers a retry that recovers', async () => {
		getVehicle.mockRejectedValue(new Error('offline'));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });

		const alert = await screen.findByTestId('vehicle-load-error');
		expect(
			document.getElementById('vehicle-load-message')?.textContent?.replace(/\s+/g, ' ').trim()
		).toBe("Couldn't load this vehicle's details. Offline.");
		const failedCalls = getVehicle.mock.calls.length;
		getVehicle.mockResolvedValue(CAMRY);
		const retry = within(alert).getByRole('button', { name: 'Retry' });
		retry.focus();

		await fireEvent.click(retry);

		await vi.waitFor(() => expect(screen.queryByTestId('vehicle-load-error')).toBeNull());
		expect(getVehicle).toHaveBeenCalledTimes(failedCalls + 1);
		await vi.waitFor(() => expect(document.activeElement).toBe(document.getElementById('vehicle')));
	});

	test('a vehicle detail retry that fails again keeps the alert and focus on Retry', async () => {
		getVehicle.mockRejectedValue(new Error('offline'));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });
		const alert = await screen.findByTestId('vehicle-load-error');
		const retry = within(alert).getByRole('button', { name: 'Retry' });
		const failedCalls = getVehicle.mock.calls.length;
		retry.focus();

		await fireEvent.click(retry);

		await vi.waitFor(() => expect(getVehicle).toHaveBeenCalledTimes(failedCalls + 1));
		await vi.waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('false'));
		expect(screen.getByTestId('vehicle-load-error')).toBe(alert);
		expect(document.activeElement).toBe(retry);
	});

	test('a vehicle detail retry in progress stays focusable and ignores repeat presses', async () => {
		getVehicle.mockRejectedValue(new Error('offline'));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });
		const alert = await screen.findByTestId('vehicle-load-error');
		const retry = within(alert).getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
		const failedCalls = getVehicle.mock.calls.length;
		getVehicle.mockReturnValue(new Promise(() => {}));

		await fireEvent.click(retry);
		await fireEvent.click(retry);

		expect(retry.getAttribute('aria-disabled')).toBe('true');
		expect(retry.disabled).toBe(false);
		expect(getVehicle).toHaveBeenCalledTimes(failedCalls + 1);
	});

	test('a vehicle detail retry that succeeds leaves focus where the user moved it', async () => {
		getVehicle.mockRejectedValue(new Error('offline'));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });
		const alert = await screen.findByTestId('vehicle-load-error');
		const retry = within(alert).getByRole('button', { name: 'Retry' });
		let finish: (v: Vehicle) => void = () => {};
		getVehicle.mockReturnValue(new Promise<Vehicle>(resolve => (finish = resolve)));
		retry.focus();

		await fireEvent.click(retry);
		field('amount').focus();
		finish(CAMRY);

		await vi.waitFor(() => expect(screen.queryByTestId('vehicle-load-error')).toBeNull());
		await tick();
		expect(document.activeElement).toBe(field('amount'));
	});

	test('a vehicle list failure while editing keeps the edit title and retry loads the form', async () => {
		getVehicles.mockRejectedValueOnce(new Error('offline'));
		getExpense.mockResolvedValue(EXISTING);
		render(ExpenseForm, { props: { expenseId: 'exp-1' } });

		const card = await screen.findByTestId('vehicles-load-error');
		expect(screen.getByRole('heading', { name: 'Edit expense' })).toBeTruthy();
		expect(card).toHaveTextContent("Couldn't load your vehicles");
		expect(card).toHaveTextContent(/offline/i);

		await fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() => expect(screen.queryByTestId('vehicles-load-error')).toBeNull());
		expect(field('amount').value).toBe('79.99');
	});

	test('a vehicle list failure while editing a split keeps the split title', async () => {
		getVehicles.mockRejectedValueOnce(new Error('offline'));
		const legs = [
			{ ...EXISTING, id: 'e1', groupId: 'g1', groupTotal: 100, splitMethod: 'even' as const },
			{
				...EXISTING,
				id: 'e2',
				vehicleId: 'v2',
				groupId: 'g1',
				groupTotal: 100,
				splitMethod: 'even' as const
			}
		];
		getExpense.mockResolvedValue(legs[0]!);
		getSplitExpense.mockResolvedValue({
			groupId: 'g1',
			groupTotal: 100,
			splitMethod: 'even',
			siblings: legs
		});
		render(ExpenseForm, { props: { expenseId: 'e1' } });

		await screen.findByTestId('vehicles-load-error');
		expect(screen.getByRole('heading', { name: 'Edit split expense' })).toBeTruthy();
	});
});

describe('ExpenseForm financing and insurance links', () => {
	test('a new expense opened for a financing payment is marked as one and saved with its source', async () => {
		createExpense.mockResolvedValue({ ...EXISTING, id: 'new-1' });
		await renderCreate({
			preselectedCategory: 'financial',
			preselectedAmount: '373',
			preselectedFinancingId: 'fin-1'
		});

		await vi.waitFor(() => expect(screen.getByText('Financing payment')).toBeTruthy());
		await save();

		await vi.waitFor(() => expect(queued()).toHaveLength(1));
		expect(queued()[0]).toMatchObject({
			sourceType: 'financing',
			sourceId: 'fin-1'
		});
	});

	test('an ordinary new expense is not marked as a financing payment', async () => {
		await renderCreate({ preselectedCategory: 'financial' });

		expect(screen.queryByText('Financing payment')).toBeNull();
	});

	test('an insurance-managed split opens read-only and can still be force deleted', async () => {
		const legs = [insuranceLeg('ins-1', 'v1', 300), insuranceLeg('ins-2', 'v2', 300)];
		getExpense.mockResolvedValue(legs[0]!);
		getSplitExpense.mockResolvedValue({
			groupId: 'g-ins',
			groupTotal: 600,
			splitMethod: 'even',
			siblings: legs
		});
		render(ExpenseForm, { props: { expenseId: 'ins-1', returnTo: '/vehicles/v1' } });

		await screen.findByRole('heading', { name: 'Insurance expense' });
		expect(screen.getByText('Managed by insurance policy')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /Force delete/ }));
		expect(await screen.findByRole('alertdialog')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /Back to Expenses/ }));
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
	});
});
