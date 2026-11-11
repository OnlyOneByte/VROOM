import type { Expense, ExpenseFilters } from '$lib/types';

function localDayStart(dateStr: string): Date | null {
	const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
	if (!year || !month || !day) return null;
	return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function filterExpenses(
	expenses: Expense[],
	searchTerm: string,
	filters: ExpenseFilters
): Expense[] {
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

	if (filters.category) {
		filtered = filtered.filter(expense => expense.category === filters.category);
	}

	if (filters.tags && filters.tags.length > 0) {
		filtered = filtered.filter(expense => filters.tags!.some(tag => expense.tags.includes(tag)));
	}

	if (filters.startDate) {
		const start = localDayStart(filters.startDate);
		if (start) filtered = filtered.filter(expense => new Date(expense.date) >= start);
	}
	if (filters.endDate) {
		const end = localDayStart(filters.endDate);
		if (end) {
			const endExclusive = new Date(end);
			endExclusive.setDate(endExclusive.getDate() + 1);
			filtered = filtered.filter(expense => new Date(expense.date) < endExclusive);
		}
	}

	return filtered;
}

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
