import type { Expense, ExpenseFilters } from '#lib/types/index.ts';

export function hasActiveFilters(searchTerm: string, filters: ExpenseFilters): boolean {
	return (
		searchTerm.trim() !== '' ||
		!!filters.category ||
		(filters.tags?.length ?? 0) > 0 ||
		!!filters.startDate ||
		!!filters.endDate
	);
}

export function extractUniqueTags(expenses: Expense[]): string[] {
	return Array.from(new Set(expenses.flatMap(e => e.tags || []))).sort();
}
