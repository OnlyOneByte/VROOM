import type { Expense, SplitExpenseGroup, Vehicle } from '#lib/types/index.ts';

export function makeVehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
	return {
		id,
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

export function makeExpense(id: string, overrides: Partial<Expense> = {}): Expense {
	return {
		id,
		vehicleId: 'v1',
		userId: 'u1',
		tags: [],
		category: 'fuel',
		amount: 42.5,
		date: '2025-03-10T12:00:00.000Z',
		createdAt: '2025-03-10T12:00:00.000Z',
		updatedAt: '2025-03-10T12:00:00.000Z',
		...overrides
	};
}

export function makeSplitGroup(
	siblings: Expense[],
	overrides: Partial<SplitExpenseGroup> = {}
): SplitExpenseGroup {
	return {
		siblings,
		groupId: 'g1',
		groupTotal: siblings.reduce((sum, s) => sum + s.amount, 0),
		splitMethod: 'even',
		...overrides
	};
}
