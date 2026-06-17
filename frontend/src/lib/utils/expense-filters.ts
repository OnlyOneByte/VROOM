import type { Expense, ExpenseFilters } from '$lib/types';

/**
 * Parse a date-range bound to the LOCAL start-of-day instant. The DateRangePicker binds a date-only
 * 'YYYY-MM-DD' (CalendarDate.toString()); `new Date('2024-03-15')` would parse that as midnight UTC,
 * which for a negative-offset (Americas) user is the PREVIOUS calendar day — so the old
 * `new Date(expense.date) <= new Date(endDate)` EXCLUDED expenses on the chosen end day (#106, the
 * #87/#39 off-by-one class on the list filter). Reading the date PARTS into a local Date fixes the
 * zone; slicing the first 10 chars also tolerates a full-ISO bound. Returns null on a malformed bound.
 */
function localDayStart(dateStr: string): Date | null {
	const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
	if (!year || !month || !day) return null;
	return new Date(year, month - 1, day, 0, 0, 0, 0);
}

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

	// Apply date range filter. Bounds are LOCAL calendar days (the picker's intent): start = local
	// midnight of startDate (inclusive); end = local midnight of the day AFTER endDate (exclusive), so
	// the WHOLE end day is included regardless of the expense's time-of-day (#106).
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
