import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { Expense, SplitExpenseGroup, Vehicle } from '#lib/types/index.ts';
import type { ReceiptDraft } from '#lib/services/vlm-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { ApiError } from '#lib/utils/error-handling.ts';
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
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		createExpense,
		getExpense,
		getSplitExpense,
		updateExpense,
		deleteExpense,
		getExpensesByVehicle,
		getPhotos: vi.fn(() => Promise.resolve({ data: [] })),
		getPhotoThumbnailUrl: vi.fn(() => ''),
		uploadPhoto: vi.fn(),
		deletePhoto: vi.fn()
	}
}));

const parseReceipt = vi.fn<(image: File) => Promise<ReceiptDraft>>();
vi.mock('#lib/services/vlm-api.ts', () => ({ vlmApi: { parseReceipt } }));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

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
	return screen.getByRole('button', { name: new RegExp(`^${label}`) });
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
	await screen.findByRole('heading', { name: 'Add Expense' });
	await vi.waitFor(() => expect(getVehicle).toHaveBeenCalled());
}

async function renderEdit(expense: Expense = EXISTING, returnTo = '/expenses'): Promise<void> {
	getExpense.mockResolvedValue(expense);
	render(ExpenseForm, { props: { expenseId: expense.id, returnTo } });
	await screen.findByRole('heading', { name: 'Edit Expense' });
}

function save(): Promise<boolean> {
	return fireEvent.click(screen.getByRole('button', { name: /(save|update) expense/i }));
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
		expect(screen.getByText('Track a new vehicle expense')).toBeTruthy();
		expect(screen.getByRole('button', { name: /save expense/i })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /duplicate/i })).toBeNull();
		expect(document.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
	});

	test('saving an empty form flags category and amount and sends nothing', async () => {
		await renderCreate();

		await save();

		expect(errorText('category')).toBe('Please select a category');
		expect(errorText('amount')).toBe('Amount must be greater than 0');
		expect(createExpense).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	test('with no vehicles the vehicle field is flagged on save', async () => {
		getVehicles.mockResolvedValue([]);
		render(ExpenseForm, { props: { preselectedCategory: 'misc', preselectedAmount: '5' } });
		await screen.findByRole('heading', { name: 'Add Expense' });

		await save();

		expect(vehicleTriggerText()).toBe('Select a vehicle');
		expect(errorText('vehicleId')).toBe('Please select a vehicle');
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('rejects an implausibly large amount', async () => {
		await renderCreate({ preselectedCategory: 'misc' });
		await type('amount', '1000000');

		await save();

		expect(errorText('amount')).toBe('Amount seems too large');
		expect(createExpense).not.toHaveBeenCalled();
	});

	test('leaving the amount field with zero shows the amount error before saving', async () => {
		await renderCreate();
		await type('amount', '0');

		await fireEvent.blur(field('amount'));

		expect(errorText('amount')).toBe('Amount must be greater than 0');
	});

	test('picking a category marks it pressed and clears the category error', async () => {
		await renderCreate();
		await save();
		expect(errorText('category')).not.toBeNull();

		await fireEvent.click(categoryButton('Maintenance'));

		expect(categoryButton('Maintenance').getAttribute('aria-pressed')).toBe('true');
		expect(categoryButton('Fuel').getAttribute('aria-pressed')).toBe('false');
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

	test('switching from fuel to another category hides the fuel fields and drops the mileage', async () => {
		await renderCreate();
		await fireEvent.click(categoryButton('Fuel'));
		await type('mileage', '12000');
		await type('volume', '11.2');

		await fireEvent.click(categoryButton('Regulatory'));

		expect(document.getElementById('volume')).toBeNull();
		expect(field('mileage').value).toBe('');
	});

	test('applies preselected category, amount, description and tags from the query', async () => {
		await renderCreate({
			preselectedCategory: 'enhancement',
			preselectedAmount: '250',
			preselectedDescription: 'Roof rack',
			preselectedTags: 'accessories, roof'
		});

		expect(categoryButton('Enhancement').getAttribute('aria-pressed')).toBe('true');
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

		await vi.waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
		expect(createExpense.mock.calls[0]?.[0]).toEqual({
			vehicleId: 'v1',
			tags: [],
			category: 'maintenance',
			amount: 120.5,
			date: dateOnlyToISO('2026-06-15'),
			mileage: 30500,
			volume: undefined,
			charge: undefined,
			fuelType: undefined,
			description: 'Brake pads',
			location: 'Main St Garage',
			currency: 'USD',
			sourceType: undefined,
			sourceId: undefined,
			missedFillup: false
		});
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
		expect(notificationMessages()).toContain('Expense added successfully');
	});

	test('choosing another vehicle loads its context and files the expense against it', async () => {
		createExpense.mockResolvedValue({ ...EXISTING, id: 'new-1', vehicleId: 'v2' });
		await renderCreate({ preselectedCategory: 'misc', preselectedAmount: '9.99' });

		await chooseVehicle('2022 Nissan Leaf');

		await vi.waitFor(() => expect(getVehicle).toHaveBeenCalledWith('v2'));
		expect(getExpensesByVehicle).toHaveBeenCalledWith('v2', { limit: 100 });
		expect(vehicleTriggerText()).toBe('2022 Nissan Leaf');
		await save();
		await vi.waitFor(() => expect(createExpense).toHaveBeenCalled());
		expect(createExpense.mock.calls[0]?.[0]).toMatchObject({ vehicleId: 'v2', amount: 9.99 });
	});

	test('cancel and the back button return to returnTo without saving', async () => {
		await renderCreate({ returnTo: '/vehicles/v1' });

		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		await fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledTimes(2));
		expect(goto).toHaveBeenNthCalledWith(1, '/vehicles/v1');
		expect(goto).toHaveBeenNthCalledWith(2, '/vehicles/v1');
		expect(createExpense).not.toHaveBeenCalled();
	});
});

describe('ExpenseForm edit mode', () => {
	test('prefills the form from the loaded expense and offers delete and duplicate', async () => {
		await renderEdit();

		expect(getExpense).toHaveBeenCalledWith('exp-1');
		await vi.waitFor(() => expect(screen.getByText('2020 Toyota Camry', { selector: 'p' })));
		expect(categoryButton('Maintenance').getAttribute('aria-pressed')).toBe('true');
		expect(field('amount').value).toBe('79.99');
		expect(field('mileage').value).toBe('31000');
		expect(field('description').value).toBe('Oil change');
		expect(field('location').value).toBe('Quick Lube');
		expect(screen.getByText('oil')).toBeTruthy();
		expect(screen.getByRole('button', { name: /update expense/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^delete$/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /duplicate/i })).toBeTruthy();
	});

	test('a deleted expense is reported and the user is sent back', async () => {
		getExpense.mockRejectedValue(new ApiError('Expense not found', 404));
		render(ExpenseForm, { props: { expenseId: 'gone', returnTo: '/vehicles/v1' } });

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
		expect(notificationMessages()).toContain('That expense no longer exists.');
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
		expect(notificationMessages()).toContain('Expense updated successfully');
	});

	test('a rejected update shows the server message on the form and stays put', async () => {
		updateExpense.mockRejectedValue(new ApiError('Amount exceeds the allowed maximum', 400));
		await renderEdit();

		await save();

		await vi.waitFor(() =>
			expect(document.querySelector('[data-testid="submit-error"]')?.textContent?.trim()).toBe(
				"Couldn't save this expense. Amount exceeds the allowed maximum."
			)
		);
		expect(goto).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: /update expense/i }).hasAttribute('disabled')).toBe(
			false
		);
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

	test('delete asks for confirmation, then deletes the expense and returns', async () => {
		deleteExpense.mockResolvedValue(undefined);
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		const dialog = await screen.findByRole('alertdialog');
		expect(dialog.textContent).toContain('Oil change');
		expect(deleteExpense).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: /delete expense/i }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/expenses'));
		expect(deleteExpense).toHaveBeenCalledWith('exp-1');
		expect(notificationMessages()).toContain('Expense deleted successfully');
	});

	test('a failed delete is reported and the user stays on the form', async () => {
		deleteExpense.mockRejectedValue(new Error('server down'));
		await renderEdit();

		await fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
		await screen.findByRole('alertdialog');
		await fireEvent.click(screen.getByRole('button', { name: /delete expense/i }));

		await vi.waitFor(() =>
			expect(notificationMessages()).toContain('Failed to delete expense. Please try again.')
		);
		expect(goto).not.toHaveBeenCalled();
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

		await vi.waitFor(() => expect(field('amount').value).toBe('64.2'));
		expect(field('description').value).toBe('Jiffy Lube');
		expect(categoryButton('Maintenance').getAttribute('aria-pressed')).toBe('true');
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
		expect(categoryButton('Fuel').getAttribute('aria-pressed')).toBe('true');
		expect(document.getElementById('volume')).not.toBeNull();
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
			expect(categoryButton('Maintenance').getAttribute('aria-pressed')).toBe('true')
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
		expect(categoryButton('Misc').getAttribute('aria-pressed')).toBe('true');
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
		expect(screen.queryByRole('heading', { name: 'Edit Expense' })).toBeNull();
	});

	test('a vehicle detail failure on a non-fuel expense offers a retry that recovers', async () => {
		getVehicle.mockRejectedValue(new Error('offline'));
		render(ExpenseForm, { props: { preselectedCategory: 'misc' } });

		const alert = await screen.findByTestId('vehicle-load-error');
		expect(document.getElementById('vehicle-load-message')?.textContent?.trim()).toBe(
			"Couldn't load this vehicle's details."
		);
		const failedCalls = getVehicle.mock.calls.length;
		getVehicle.mockResolvedValue(CAMRY);

		await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() => expect(screen.queryByTestId('vehicle-load-error')).toBeNull());
		expect(getVehicle).toHaveBeenCalledTimes(failedCalls + 1);
	});

	test('a vehicle list failure while editing keeps the edit title and retry loads the form', async () => {
		getVehicles.mockRejectedValueOnce(new Error('offline'));
		getExpense.mockResolvedValue(EXISTING);
		render(ExpenseForm, { props: { expenseId: 'exp-1' } });

		const card = await screen.findByTestId('vehicles-load-error');
		expect(screen.getByRole('heading', { name: 'Edit Expense' })).toBeTruthy();
		expect(card).toHaveTextContent('Failed to load vehicles');
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
		expect(screen.getByRole('heading', { name: 'Edit Split Expense' })).toBeTruthy();
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

		await vi.waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
		expect(createExpense.mock.calls[0]?.[0]).toMatchObject({
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

		await screen.findByRole('heading', { name: 'Insurance Expense' });
		expect(screen.getByText('Managed by insurance policy')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /update expense/i })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /Force Delete/ }));
		expect(await screen.findByRole('alertdialog')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: /Back to Expenses/ }));
		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
	});
});
