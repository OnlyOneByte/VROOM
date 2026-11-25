import type { Expense, ExpenseCategory, ExpenseSummary } from '#lib/types/index.ts';
import type { OfflineExpense } from '#lib/utils/offline-storage.ts';
import { toDateInputValue } from '#lib/utils/formatters.ts';

export interface PendingRowState {
	status: 'saving' | 'failed';
	kind?: 'delete' | 'edit';
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
	now = Date.now(),
	sign: 1 | -1 = 1
): ExpenseSummary | null {
	if (!summary || rows.length === 0) return summary;
	const recentSince = now - 30 * 24 * 60 * 60 * 1000;
	const total = rows.reduce((sum, row) => sum + row.amount, 0);
	const recent = rows
		.filter(row => new Date(row.date).getTime() >= recentSince)
		.reduce((sum, row) => sum + row.amount, 0);
	return {
		...summary,
		totalAmount: summary.totalAmount + sign * total,
		expenseCount: summary.expenseCount + sign * rows.length,
		recentAmount: summary.recentAmount + sign * recent
	};
}

export function withPendingByMonth(
	totals: ReadonlyMap<string, number>,
	rows: readonly Expense[],
	sign: 1 | -1 = 1
): ReadonlyMap<string, number> {
	if (totals.size === 0 || rows.length === 0) return totals;
	const merged = new Map(totals);
	for (const [month, amount] of pendingAmountsByMonth(rows)) {
		merged.set(month, (merged.get(month) ?? 0) + sign * amount);
	}
	return merged;
}

export function withoutRowsInBreakdowns(
	summary: ExpenseSummary | null,
	rows: readonly Expense[]
): ExpenseSummary | null {
	if (!summary || rows.length === 0) return summary;
	const byMonth = totalsBy(rows, row => monthKey(row.date));
	const byCategory = totalsBy(rows, row => row.category);
	const less = <T extends { amount: number; count: number }>(
		item: T,
		taken = { amount: 0, count: 0 }
	) => ({
		...item,
		amount: item.amount - taken.amount,
		count: item.count - taken.count
	});
	return {
		...summary,
		monthlyTrend: summary.monthlyTrend.map(item => less(item, byMonth.get(item.period))),
		categoryBreakdown: summary.categoryBreakdown
			.map(item => less(item, byCategory.get(item.category)))
			.filter(item => item.count > 0)
	};
}

export function withRowsInBreakdowns(
	summary: ExpenseSummary | null,
	rows: readonly Expense[]
): ExpenseSummary | null {
	if (!summary || rows.length === 0) return summary;
	const byMonth = totalsBy(rows, row => monthKey(row.date));
	const byCategory = totalsBy(rows, row => row.category);
	const more = <T extends { amount: number; count: number }>(
		item: T,
		added = { amount: 0, count: 0 }
	) => ({ ...item, amount: item.amount + added.amount, count: item.count + added.count });
	const listed = new Set(summary.categoryBreakdown.map(item => item.category));
	const newCategories = [...byCategory]
		.filter(([category]) => !listed.has(category))
		.map(([category, totals]) => ({ category, ...totals }));
	const listedMonths = new Set(summary.monthlyTrend.map(item => item.period));
	const newMonths = [...byMonth]
		.filter(([period]) => !listedMonths.has(period))
		.map(([period, totals]) => ({ period, ...totals }));
	return {
		...summary,
		monthlyTrend: [
			...summary.monthlyTrend.map(item => more(item, byMonth.get(item.period))),
			...newMonths
		].sort((a, b) => a.period.localeCompare(b.period)),
		categoryBreakdown: [
			...summary.categoryBreakdown.map(item => more(item, byCategory.get(item.category))),
			...newCategories
		]
	};
}

function totalsBy(
	rows: readonly Expense[],
	keyOf: (row: Expense) => string
): Map<string, { amount: number; count: number }> {
	const totals = new Map<string, { amount: number; count: number }>();
	for (const row of rows) {
		const seen = totals.get(keyOf(row)) ?? { amount: 0, count: 0 };
		totals.set(keyOf(row), { amount: seen.amount + row.amount, count: seen.count + 1 });
	}
	return totals;
}

function monthKey(value: string): string {
	const date = new Date(value);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function pendingAmountsByMonth(rows: readonly Expense[]): Map<string, number> {
	const months = new Map<string, number>();
	for (const row of rows) {
		const month = monthKey(row.date);
		months.set(month, (months.get(month) ?? 0) + row.amount);
	}
	return months;
}

export interface PendingItem {
	row: Expense;
	state: PendingRowState;
	serverId?: string | undefined;
}

export function rowsLeft(previousIds: readonly string[], current: readonly PendingItem[]): boolean {
	const ids = new Set(current.map(({ row }) => row.id));
	return previousIds.some(id => !ids.has(id));
}

export function keepLeftRows(
	shown: readonly PendingItem[],
	current: readonly PendingItem[],
	syncedServerIds: ReadonlyArray<readonly [string, string]> = []
): PendingItem[] {
	const byId = new Map(current.map(item => [item.row.id, item]));
	const serverIdOf = new Map(syncedServerIds);
	const shownIds = new Set(shown.map(({ row }) => row.id));
	return [
		...current.filter(({ row }) => !shownIds.has(row.id)),
		...shown.map(
			item =>
				byId.get(item.row.id) ?? {
					...item,
					serverId: item.serverId ?? serverIdOf.get(item.row.id)
				}
		)
	];
}

export function withoutListed(
	items: readonly PendingItem[],
	listedIds: ReadonlySet<string>
): PendingItem[] {
	return items.filter(item => !item.serverId || !listedIds.has(item.serverId));
}

export function rowStates(items: readonly PendingItem[]): ReadonlyMap<string, PendingRowState> {
	return new Map(items.map(({ row, state }) => [row.id, state]));
}
