import type { Expense, ExpenseFilters } from '$lib/types';

/**
 * Filter expenses based on search term and filters
 */
export function filterExpenses(
	expenses: Expense[],
	searchTerm: string,
	filters: ExpenseFilters
): Expense[] {
	// Early return if no filters applied (performance optimization)
	if (
		!searchTerm &&
		!filters.category &&
		!filters.tags?.length &&
		!filters.startDate &&
		!filters.endDate
	) {
		return expenses;
	}

	let filtered = [...expenses];

	// Apply search filter
	if (searchTerm.trim()) {
		const term = searchTerm.toLowerCase();
		filtered = filtered.filter(
			expense =>
				expense.description?.toLowerCase().includes(term) ||
				expense.tags?.some(tag => tag.toLowerCase().includes(term)) ||
				expense.category.toLowerCase().includes(term) ||
				expense.amount.toString().includes(term)
		);
	}

	// Apply category filter
	if (filters.category) {
		filtered = filtered.filter(expense => expense.category === filters.category);
	}

	// Apply tags filter
	if (filters.tags && filters.tags.length > 0) {
		filtered = filtered.filter(expense => filters.tags!.some(tag => expense.tags.includes(tag)));
	}

	// Apply date range filter
	if (filters.startDate) {
		filtered = filtered.filter(expense => new Date(expense.date) >= new Date(filters.startDate!));
	}
	if (filters.endDate) {
		filtered = filtered.filter(expense => new Date(expense.date) <= new Date(filters.endDate!));
	}

	return filtered;
}

/**
 * Check if any filters are active
 */
export function hasActiveFilters(searchTerm: string, filters: ExpenseFilters): boolean {
	return (
		searchTerm.trim() !== '' ||
		!!filters.category ||
		(filters.tags?.length ?? 0) > 0 ||
		!!filters.startDate ||
		!!filters.endDate
	);
}

/**
 * Get all unique tags from expenses
 */
export function extractUniqueTags(expenses: Expense[]): string[] {
	return Array.from(new Set(expenses.flatMap(e => e.tags || []))).sort();
}
