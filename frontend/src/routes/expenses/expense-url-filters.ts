import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';

const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_MAX_LENGTH = 100;

export interface ExpenseUrlFilters {
	vehicleId?: string;
	category?: string;
	startDate?: string;
	endDate?: string;
	tags: string[];
	q: string;
}

function plainDay(value: string | null): string | undefined {
	if (!value || !PLAIN_DAY.test(value)) return undefined;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year!, month! - 1, day!));
	return date.getUTCMonth() === month! - 1 && date.getUTCDate() === day ? value : undefined;
}

export function parseExpenseUrlFilters(params: Pick<URLSearchParams, 'get'>): ExpenseUrlFilters {
	const vehicleId = params.get('vehicleId')?.trim() || undefined;
	const category = params.get('category') ?? '';
	let startDate = plainDay(params.get('startDate'));
	let endDate = plainDay(params.get('endDate'));
	if (startDate && endDate && startDate > endDate) {
		startDate = undefined;
		endDate = undefined;
	}
	const tags = [
		...new Set(
			(params.get('tags') ?? '')
				.split(',')
				.map(tag => tag.trim())
				.filter(Boolean)
		)
	];
	return {
		vehicleId,
		category: (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? category : undefined,
		startDate,
		endDate,
		tags,
		q: (params.get('q') ?? '').trim().slice(0, SEARCH_MAX_LENGTH)
	};
}

const FILTER_KEYS = ['vehicleId', 'category', 'startDate', 'endDate', 'tags', 'q'];

export function expenseUrlFiltersQuery(
	filters: ExpenseUrlFilters,
	current?: Pick<URLSearchParams, 'toString'>
): string {
	const params = new URLSearchParams(current?.toString());
	for (const key of FILTER_KEYS) params.delete(key);
	if (filters.vehicleId) params.set('vehicleId', filters.vehicleId);
	if (filters.category) params.set('category', filters.category);
	if (filters.startDate) params.set('startDate', filters.startDate);
	if (filters.endDate) params.set('endDate', filters.endDate);
	if (filters.tags.length > 0) params.set('tags', filters.tags.join(','));
	const q = filters.q.trim().slice(0, SEARCH_MAX_LENGTH);
	if (q) params.set('q', q);
	const query = params.toString();
	return query ? `?${query}` : '';
}
