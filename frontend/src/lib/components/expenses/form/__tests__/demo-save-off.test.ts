import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { authStore } from '#lib/stores/auth.svelte.ts';
import { loadOfflineExpenses } from '#lib/utils/offline-storage.ts';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

const VEHICLE = { id: 'v1', make: 'Toyota', model: 'Camry', year: 2020 };
vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve([VEHICLE])),
		getVehicle: vi.fn(() => Promise.resolve(VEHICLE))
	}
}));

const createExpense = vi.fn(() => Promise.resolve({ id: 'e1' }));
const deletePhoto = vi.fn();
const updateExpense = vi.fn(() => Promise.resolve({ id: 'x1' }));
vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		createExpense,
		updateExpense,
		deletePhoto,
		getExpense: vi.fn(() =>
			Promise.resolve({
				id: 'x1',
				vehicleId: 'v1',
				userId: 'user-1',
				tags: [],
				category: 'misc',
				amount: 12,
				date: '2026-01-02T12:00:00.000Z',
				description: 'Car wash',
				createdAt: '2026-01-02T12:00:00.000Z',
				updatedAt: '2026-01-02T12:00:00.000Z'
			})
		),
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] })),
		getPhotos: vi.fn(() =>
			Promise.resolve({ data: [{ id: 'p1', fileName: 'r.pdf', mimeType: 'application/pdf' }] })
		),
		getPhotoThumbnailUrl: vi.fn(() => '')
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;
const ExpensePhotoSection = (await import('../ExpensePhotoSection.svelte')).default;
const InsuranceManagedView = (await import('../expense-form/InsuranceManagedView.svelte')).default;

const NOTE = 'Saving is off in the demo garage.';
const user = {
	id: 'user-1',
	email: 'a@example.com',
	displayName: 'A',
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};

async function renderForm(): Promise<HTMLElement> {
	render(ExpenseForm, {
		props: { preselectedVehicleId: 'v1', preselectedCategory: 'misc', preselectedAmount: '42.50' }
	});
	await vi.waitFor(() => expect(screen.getByDisplayValue('42.50')).toBeTruthy());
	return screen.getByRole('button', { name: /save expense/i });
}

const sent = () => createExpense.mock.calls.length + loadOfflineExpenses().length;

beforeEach(() => {
	vi.clearAllMocks();
	window.localStorage.clear();
});

afterEach(() => {
	cleanup();
	authStore.clearUser();
});

describe('expense form in the demo garage', () => {
	test('Save stays focusable, says why it is off, and neither a click nor a submit sends anything', async () => {
		authStore.setUser({ ...user, demo: true });
		const save = await renderForm();
		expect(save).toHaveAttribute('aria-disabled', 'true');
		expect(save).toHaveAccessibleDescription(NOTE);
		save.focus();
		expect(document.activeElement).toBe(save);
		await fireEvent.click(save);
		await fireEvent.submit(save.closest('form') as HTMLFormElement);
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(sent()).toBe(0);
	});

	test('a real user saves as before, with no demo note', async () => {
		authStore.setUser(user);
		const save = await renderForm();
		expect(save).not.toHaveAttribute('aria-disabled');
		expect(screen.queryByText(NOTE)).toBeNull();
		await fireEvent.click(save);
		await vi.waitFor(() => expect(sent()).toBe(1));
	});

	test('when editing, Delete is off and Save is marked off, while Duplicate and Cancel still work', async () => {
		authStore.setUser({ ...user, demo: true });
		render(ExpenseForm, { props: { expenseId: 'x1', returnTo: '/expenses' } });
		await screen.findByTestId('expense-edit-header');

		expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
		const save = screen.getByRole('button', { name: 'Save changes' });
		expect(save).toHaveAttribute('aria-disabled', 'true');
		expect(save).toHaveAccessibleDescription(NOTE);
		expect(screen.getByRole('button', { name: 'Duplicate' })).toBeEnabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

		await fireEvent.click(save);
		await fireEvent.submit(save.closest('form') as HTMLFormElement);
		await new Promise(resolve => setTimeout(resolve, 50));
		expect(updateExpense).not.toHaveBeenCalled();
	});

	test.each([
		[true, 'disabled'],
		[false, 'enabled']
	])('with demo=%s, photo Upload and delete are %s', async (demo, state) => {
		authStore.setUser({ ...user, demo });
		render(ExpensePhotoSection, { props: { entityType: 'expense', entityId: 'e1' } });
		const remove = await screen.findByRole('button', { name: 'Delete r.pdf' });
		const upload = screen.getByRole('button', { name: 'Upload' });
		for (const button of [remove, upload]) {
			if (state === 'disabled') expect(button).toBeDisabled();
			else expect(button).toBeEnabled();
		}
	});

	test.each([
		[true, 'disabled'],
		[false, 'enabled']
	])('Force Delete on an insurance-managed expense in demo=%s is %s', (demo, state) => {
		authStore.setUser({ ...user, demo });
		const onForceDelete = vi.fn();
		render(InsuranceManagedView, {
			props: {
				category: 'financial',
				amount: '100',
				date: '2026-01-01',
				description: '',
				tags: [],
				photoEntityId: null,
				isDeleting: false,
				onBack: vi.fn(),
				onForceDelete
			}
		});
		const force = screen.getByRole('button', { name: 'Force Delete' });
		if (state === 'disabled') expect(force).toBeDisabled();
		else expect(force).toBeEnabled();
	});
});
