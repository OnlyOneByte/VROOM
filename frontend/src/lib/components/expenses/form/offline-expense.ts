import type { OfflineExpense } from '$lib/utils/offline-storage';

export type QueuedExpenseInput = Omit<
	OfflineExpense,
	'id' | 'clientId' | 'timestamp' | 'synced' | 'version'
>;

export interface ParsedExpenseForm {
	vehicleId: string;
	tags: string[];
	category: string;
	amount: number;
	date: string;
	mileage?: number | undefined;
	volume?: number | undefined;
	charge?: number | undefined;
	fuelType?: string | undefined;
	description?: string | undefined;
	location?: string | undefined;
	missedFillup?: boolean | undefined;
}

/**
 * The outbox payload for an expense that could not reach the server. fuelType must ride along
 * because the sync transform routes charge vs volume on it, and missedFillup because dropping it
 * makes MPG pairing span the unlogged gap.
 */
export function toOfflineExpense(expense: ParsedExpenseForm): QueuedExpenseInput {
	return {
		vehicleId: expense.vehicleId,
		tags: expense.tags,
		category: expense.category,
		amount: expense.amount,
		date: expense.date,
		description: expense.description ?? '',
		...(expense.mileage !== undefined && { mileage: expense.mileage }),
		...(expense.volume !== undefined && { volume: expense.volume }),
		...(expense.charge !== undefined && { charge: expense.charge }),
		...(expense.fuelType !== undefined && { fuelType: expense.fuelType }),
		...(expense.location !== undefined && { location: expense.location }),
		...(expense.missedFillup !== undefined && { missedFillup: expense.missedFillup })
	};
}
