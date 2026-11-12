import { dateOnlyToISO } from '$lib/utils/formatters';
import type { ExpenseCategory } from '$lib/types';
import type { ExpenseFormData } from './expense-form-data';

export interface ExpensePayloadContext {
	currency: string;
	sourceType: string | null;
	sourceId: string | null;
}

export function buildExpenseData(form: ExpenseFormData, ctx: ExpensePayloadContext) {
	return {
		vehicleId: form.vehicleId,
		tags: form.tags,
		category: form.category as ExpenseCategory,
		amount: parseFloat(form.amount),
		date: dateOnlyToISO(form.date),
		mileage: form.mileage ? parseInt(form.mileage) : undefined,
		volume: form.volume ? parseFloat(form.volume) : undefined,
		charge: form.charge ? parseFloat(form.charge) : undefined,
		fuelType: form.fuelType || undefined,
		description: form.description || undefined,
		location: form.location || undefined,
		currency: ctx.currency,
		sourceType: ctx.sourceType ?? undefined,
		sourceId: ctx.sourceId ?? undefined,
		missedFillup: form.missedFillup
	};
}

export type ExpensePayload = ReturnType<typeof buildExpenseData>;
