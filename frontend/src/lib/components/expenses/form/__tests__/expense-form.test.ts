import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Expense, Vehicle } from '#lib/types/index.ts';
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
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		createExpense,
		getExpense,
		updateExpense,
		deleteExpense,
		getExpensesByVehicle,
		getPhotos: vi.fn(() => Promise.resolve({ data: [] })),
		getPhotoThumbnailUrl: vi.fn(() => ''),
		uploadPhoto: vi.fn(),
		deletePhoto: vi.fn()
	}
}));

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

	test('a missing expense is reported and the user is sent back', async () => {
		getExpense.mockResolvedValue(null);
		render(ExpenseForm, { props: { expenseId: 'gone', returnTo: '/vehicles/v1' } });

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/vehicles/v1'));
		expect(notificationMessages()).toContain('Expense not found');
	});

	test('a failed load is reported and the user is sent back', async () => {
		getExpense.mockRejectedValue(new Error('network'));
		render(ExpenseForm, { props: { expenseId: 'exp-1' } });

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/expenses'));
		expect(notificationMessages()).toContain('Error loading expense');
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
				'Amount exceeds the allowed maximum'
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
