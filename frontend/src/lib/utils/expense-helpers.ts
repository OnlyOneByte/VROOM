import type { ExpenseCategory } from '$lib/types';
import { Fuel, Wrench, CreditCard, DollarSign } from '@lucide/svelte';

type LucideIcon = typeof Fuel;

export type ExpenseSortField = 'date' | 'amount';
export type SortDirection = 'asc' | 'desc';

/** The minimal shape the sort comparator reads — works for a standalone expense
 *  row OR a collapsed split-group row (which supplies its own representative
 *  date/amount + the first child's id as the stable group key). */
export interface SortableRow {
	id: string;
	date: string;
	amount: number;
}

/**
 * Stable comparator for the expenses table, matching the SERVER's order exactly.
 *
 * The backend query orders by `dir(sortColumn), dir(id)` (expenses/repository.ts:287)
 * — i.e. the id tiebreaker inherits the SAME direction as the primary sort. Without a
 * tiebreaker the client sort returned 0 for equal date/amount rows, so ties fell back to
 * JS engine ordering / array-build order (the standalone-then-group concatenation in the
 * table actually reorders same-key rows vs. the server), causing a visible reshuffle on
 * pagination/refresh (bug #4).
 *
 * The id is folded into the raw comparison BEFORE the asc/desc flip, so a single
 * negation carries the tiebreak in the same direction as the server (a naive
 * `|| a.id.localeCompare(b.id)` applied AFTER the flip would always break ascending and
 * diverge from the server on a desc sort).
 */
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
	// Stable tiebreaker on id (same field + direction the server uses), so equal
	// date/amount rows keep a deterministic, server-consistent order.
	if (comparison === 0) {
		comparison = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	}
	return sortOrder === 'asc' ? comparison : -comparison;
}

// Category labels
export const categoryLabels: Record<ExpenseCategory, string> = {
	fuel: 'Fuel & Charging',
	maintenance: 'Maintenance',
	financial: 'Financial',
	regulatory: 'Regulatory',
	enhancement: 'Enhancement',
	misc: 'Misc'
};

/**
 * Get icon component for expense category
 * @param category - The expense category
 * @returns Lucide icon component
 */
export function getCategoryIcon(category: ExpenseCategory): LucideIcon {
	const icons: Record<ExpenseCategory, LucideIcon> = {
		fuel: Fuel,
		maintenance: Wrench,
		financial: CreditCard,
		regulatory: DollarSign,
		enhancement: DollarSign,
		misc: DollarSign
	};
	return icons[category] || DollarSign;
}

// Get color classes for expense category
export function getCategoryColor(category: ExpenseCategory): string {
	const colors: Record<ExpenseCategory, string> = {
		fuel: 'text-chart-1 bg-chart-1/10',
		maintenance: 'text-chart-5 bg-chart-5/10',
		financial: 'text-chart-2 bg-chart-2/10',
		regulatory: 'text-chart-4 bg-chart-4/10',
		enhancement: 'text-chart-3 bg-chart-3/10',
		misc: 'text-muted-foreground bg-muted'
	};
	return colors[category] || 'text-muted-foreground bg-muted';
}
