import { describe, expect, test, vi } from 'vitest';
import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import { render, screen } from '@testing-library/svelte';
import type { Expense, SplitExpenseGroup, Vehicle } from '#lib/types/index.ts';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(() => Promise.resolve()),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	refreshAll: vi.fn()
}));

function makeVehicle(id: string, model: string): Vehicle {
	return {
		id,
		make: 'Toyota',
		model,
		year: 2020,
		vehicleType: 'gas',
		trackFuel: true,
		trackCharging: false,
		createdAt: '2024-01-01T00:00:00.000Z',
		updatedAt: '2024-01-01T00:00:00.000Z'
	};
}

function makeLeg(id: string, vehicleId: string, amount: number): Expense {
	return {
		id,
		vehicleId,
		userId: 'u1',
		tags: ['parking'],
		category: 'misc',
		amount,
		date: dateOnlyToISO('2026-05-10'),
		description: 'Garage pass',
		groupId: 'g1',
		groupTotal: 100,
		splitMethod: 'even',
		createdAt: '2026-05-10T12:00:00.000Z',
		updatedAt: '2026-05-10T12:00:00.000Z'
	};
}

const vehicles = [makeVehicle('v1', 'Camry'), makeVehicle('v2', 'Corolla')];
const legs = [makeLeg('e1', 'v1', 50), makeLeg('e2', 'v2', 50)];
const group: SplitExpenseGroup = {
	groupId: 'g1',
	groupTotal: 100,
	splitMethod: 'even',
	siblings: legs
};

vi.mock('#lib/services/vehicle-api.ts', () => ({
	vehicleApi: {
		getVehicles: vi.fn(() => Promise.resolve(vehicles)),
		getVehicle: vi.fn((id: string) => Promise.resolve(vehicles.find(v => v.id === id)))
	}
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		getExpense: vi.fn(() => Promise.resolve(legs[0])),
		getSplitExpense: vi.fn(() => Promise.resolve(group)),
		getExpensesByVehicle: vi.fn(() => Promise.resolve({ data: [] })),
		updateSplitExpense: vi.fn(),
		getPhotos: vi.fn(() => Promise.resolve({ data: [] })),
		getPhotoThumbnailUrl: vi.fn(() => ''),
		uploadPhoto: vi.fn(),
		deletePhoto: vi.fn()
	}
}));

const ExpenseForm = (await import('../ExpenseForm.svelte')).default;

describe('split group edit locks the fields the split API does not save', () => {
	test('date, category and notes are disabled with a note; the amount stays editable', async () => {
		render(ExpenseForm, { props: { expenseId: 'e1', returnTo: '/expenses' } });
		await screen.findByRole('heading', { name: 'Edit Split Expense' });

		expect(screen.getByTestId('split-edit-note').textContent).toContain(
			'delete the split and add it again'
		);
		expect(screen.getByRole('button', { name: /Misc/ })).toBeDisabled();
		expect(screen.getByRole('button', { name: /May 10, 2026/ })).toBeDisabled();
		expect(document.getElementById('description')).toBeDisabled();
		expect(document.getElementById('amount')).toBeEnabled();
	});
});
