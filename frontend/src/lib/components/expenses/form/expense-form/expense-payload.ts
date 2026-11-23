import { dateOnlyToISO } from '#lib/utils/formatters.ts';
import type { ExpenseCategory } from '#lib/types/index.ts';
import { hasMileageEntry } from '../expense-form-validation';
import type { ExpenseFormData } from './expense-form-data';

interface ExpensePayloadContext {
	currency: string;
	sourceType: string | null;
	sourceId: string | null;
}

export function buildExpenseData(form: ExpenseFormData, ctx: ExpensePayloadContext) {
	const isFuel = form.category === 'fuel';
	const dropsFinancingLink = ctx.sourceType === 'financing' && form.category !== 'financial';
	return {
		vehicleId: form.vehicleId,
		tags: form.tags,
		category: form.category as ExpenseCategory,
		amount: parseFloat(form.amount),
		date: dateOnlyToISO(form.date),
		mileage: hasMileageEntry(form.mileage) ? parseInt(form.mileage) : undefined,
		volume: isFuel && form.volume ? parseFloat(form.volume) : undefined,
		charge: isFuel && form.charge ? parseFloat(form.charge) : undefined,
		fuelType: (isFuel && form.fuelType) || undefined,
		description: form.description || undefined,
		location: form.location || undefined,
		currency: ctx.currency,
		sourceType: dropsFinancingLink ? undefined : (ctx.sourceType ?? undefined),
		sourceId: dropsFinancingLink ? undefined : (ctx.sourceId ?? undefined),
		missedFillup: isFuel && form.missedFillup
	};
}
