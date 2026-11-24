import type { Expense, ExpenseCategory, ExpenseSummary } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { toDateInputValue } from '#lib/utils/formatters.ts';

export interface PendingRowState {
	status: 'saving' | 'failed';
	error?: string;
	editable?: boolean;
	reachedServer?: boolean;
}

export function pendingExpenseRow(entry: OfflineExpense): Expense {
	const created = new Date(entry.timestamp).toISOString();
	return {
		id: entry.id,
		vehicleId: entry.vehicleId,
		userId: '',
		tags: entry.tags,
		category: entry.category as ExpenseCategory,
		amount: entry.amount,
		date: entry.date,
		...(entry.currency !== undefined && { currency: entry.currency }),
		...(entry.mileage !== undefined && { mileage: entry.mileage }),
		...(entry.volume !== undefined && { volume: entry.volume }),
		...(entry.charge !== undefined && { charge: entry.charge }),
		...(entry.fuelType !== undefined && { fuelType: entry.fuelType }),
		...(entry.description && { description: entry.description }),
		...(entry.location !== undefined && { location: entry.location }),
		...(entry.missedFillup !== undefined && { missedFillup: entry.missedFillup }),
		createdAt: created,
		updatedAt: created
	};
}

export function pendingRowState(entry: OfflineExpense): PendingRowState {
	const error = entry.needsAttention
		? (entry.attentionReason ?? 'Needs attention')
		: entry.lastError;
	return error
		? {
				status: 'failed',
				error,
				editable: !!entry.needsAttention && !entry.serverId,
				reachedServer: !!entry.serverId
			}
		: { status: 'saving' };
}

export interface PendingRowFilters {
	vehicleId?: string | undefined;
	categories?: readonly string[];
	startDate?: string | undefined;
	endDate?: string | undefined;
	search?: string;
	tags?: readonly string[];
}

export function matchesFilters(expense: Expense, filters: PendingRowFilters): boolean {
	const day = toDateInputValue(expense.date);
	const search = filters.search?.trim().toLowerCase();
	return (
		(!filters.vehicleId || expense.vehicleId === filters.vehicleId) &&
		(!filters.categories?.length || filters.categories.includes(expense.category)) &&
		(!filters.startDate || day >= filters.startDate) &&
		(!filters.endDate || day <= filters.endDate) &&
		(!filters.tags?.length || filters.tags.every(tag => expense.tags.includes(tag))) &&
		(!search ||
			[expense.description, expense.location, ...expense.tags].some(text =>
				text?.toLowerCase().includes(search)
			))
	);
}

export function withPendingInSummary(
	summary: ExpenseSummary | null,
	rows: readonly Expense[],
	now = Date.now()
): ExpenseSummary | null {
	if (!summary || rows.length === 0) return summary;
	const recentSince = now - 30 * 24 * 60 * 60 * 1000;
	const total = rows.reduce((sum, row) => sum + row.amount, 0);
	const recent = rows
		.filter(row => new Date(row.date).getTime() >= recentSince)
		.reduce((sum, row) => sum + row.amount, 0);
	return {
		...summary,
		totalAmount: summary.totalAmount + total,
		expenseCount: summary.expenseCount + rows.length,
		recentAmount: summary.recentAmount + recent
	};
}

export function withPendingByMonth(
	totals: ReadonlyMap<string, number>,
	rows: readonly Expense[]
): ReadonlyMap<string, number> {
	if (totals.size === 0 || rows.length === 0) return totals;
	const merged = new Map(totals);
	for (const [month, amount] of pendingAmountsByMonth(rows)) {
		merged.set(month, (merged.get(month) ?? 0) + amount);
	}
	return merged;
}

export function pendingAmountsByMonth(rows: readonly Expense[]): Map<string, number> {
	const months = new Map<string, number>();
	for (const row of rows) {
		const date = new Date(row.date);
		const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
		months.set(month, (months.get(month) ?? 0) + row.amount);
	}
	return months;
}

export interface PendingItem {
	row: Expense;
	state: PendingRowState;
}

export function rowsLeft(previousIds: readonly string[], current: readonly PendingItem[]): boolean {
	const ids = new Set(current.map(({ row }) => row.id));
	return previousIds.some(id => !ids.has(id));
}

export function keepLeftRows(
	shown: readonly PendingItem[],
	current: readonly PendingItem[]
): PendingItem[] {
	const byId = new Map(current.map(item => [item.row.id, item]));
	const shownIds = new Set(shown.map(({ row }) => row.id));
	return [
		...current.filter(({ row }) => !shownIds.has(row.id)),
		...shown.map(item => byId.get(item.row.id) ?? item)
	];
}

export function rowStates(items: readonly PendingItem[]): ReadonlyMap<string, PendingRowState> {
	return new Map(items.map(({ row, state }) => [row.id, state]));
}
