import type { ExpenseCategory, SplitConfig } from '$lib/types';
import { Coffee, CreditCard, DollarSign, FileText, Fuel, Sparkles, Wrench } from '@lucide/svelte';
import {
	CATEGORY_LABELS,
	mapCategoryColorTokens,
	type CategoryColorToken
} from '$lib/utils/chart-colors';

type LucideIcon = typeof Fuel;

export type ExpenseSortField = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';

export interface SortableRow {
	id: string;
	date: string;
	amount: number;
}

export function compareExpenseRows(
	a: SortableRow,
	b: SortableRow,
	sortBy: ExpenseSortField,
	sortOrder: SortDirection
): number {
	let comparison: number;
	if (sortBy === 'amount') {
		comparison = a.amount - b.amount;
	} else {
		comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
	}
	if (comparison === 0) {
		comparison = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	}
	return sortOrder === 'asc' ? comparison : -comparison;
}

export type SplitAllocationDraft = { vehicleId: string; amount?: number; percentage?: number };

export function resetSplitAllocations(
	method: 'even' | 'absolute' | 'percentage',
	vehicleIds: string[]
): SplitAllocationDraft[] {
	if (method === 'even') return [];
	if (method === 'absolute') return vehicleIds.map(id => ({ vehicleId: id, amount: 0 }));
	const pct = vehicleIds.length > 0 ? 100 / vehicleIds.length : 0;
	return vehicleIds.map(id => ({ vehicleId: id, percentage: Math.round(pct * 10) / 10 }));
}

export function buildSplitConfig(
	method: 'even' | 'absolute' | 'percentage',
	vehicleIds: string[],
	allocations: SplitAllocationDraft[]
): SplitConfig {
	if (method === 'even') return { method: 'even', vehicleIds };
	if (method === 'absolute') {
		return {
			method: 'absolute',
			allocations: allocations.map(a => ({ vehicleId: a.vehicleId, amount: a.amount ?? 0 }))
		};
	}
	return {
		method: 'percentage',
		allocations: allocations.map(a => ({ vehicleId: a.vehicleId, percentage: a.percentage ?? 0 }))
	};
}

export const categoryLabels: Record<ExpenseCategory, string> = CATEGORY_LABELS;

export const CATEGORY_ICONS: Record<ExpenseCategory, LucideIcon> = {
	fuel: Fuel,
	maintenance: Wrench,
	financial: CreditCard,
	regulatory: FileText,
	enhancement: Sparkles,
	misc: Coffee
};

export function getCategoryIcon(category: ExpenseCategory): LucideIcon {
	return CATEGORY_ICONS[category] || DollarSign;
}

const BADGE_CLASSES_BY_TOKEN: Record<CategoryColorToken, string> = {
	'chart-1': 'text-chart-1 bg-chart-1/10',
	'chart-2': 'text-chart-2 bg-chart-2/10',
	'chart-3': 'text-chart-3 bg-chart-3/10',
	'chart-4': 'text-chart-4 bg-chart-4/10',
	'chart-5': 'text-chart-5 bg-chart-5/10',
	neutral: 'text-muted-foreground bg-muted'
};

const CATEGORY_BADGE_CLASSES = mapCategoryColorTokens(token => BADGE_CLASSES_BY_TOKEN[token]);

const UNKNOWN_CATEGORY_BADGE_CLASSES = BADGE_CLASSES_BY_TOKEN.neutral;

export function getCategoryBadgeClasses(category: ExpenseCategory): string {
	return CATEGORY_BADGE_CLASSES[category] || UNKNOWN_CATEGORY_BADGE_CLASSES;
}
