import type { ExpenseCategory, Expense } from '$lib/types';
import { Fuel, Wrench, CreditCard, DollarSign } from 'lucide-svelte';

// Constants for validation
export const MAX_REASONABLE_MILES_BETWEEN_FILLUPS = 1000;
export const MIN_VALID_MPG = 5;
export const MAX_VALID_MPG = 100;
export const MIN_VALID_MI_KWH = 1;
export const MAX_VALID_MI_KWH = 10;

// Category labels
export const categoryLabels: Record<ExpenseCategory, string> = {
	fuel: 'Fuel',
	maintenance: 'Maintenance',
	financial: 'Financial',
	regulatory: 'Regulatory',
	enhancement: 'Enhancement',
	misc: 'Misc'
};

// Get icon for expense category
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCategoryIcon(category: ExpenseCategory): any {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const icons: Record<ExpenseCategory, any> = {
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
		fuel: 'text-blue-600 bg-blue-100',
		maintenance: 'text-orange-600 bg-orange-100',
		financial: 'text-green-600 bg-green-100',
		regulatory: 'text-purple-600 bg-purple-100',
		enhancement: 'text-pink-600 bg-pink-100',
		misc: 'text-gray-600 bg-gray-100'
	};
	return colors[category] || 'text-gray-600 bg-gray-100';
}

// Expense trend data interface
export interface ExpenseTrendData {
	date: Date;
	amount: number;
	count: number;
}

/**
 * Prepare expense trend data for charting
 * Filters expenses by period and groups by week or month
 */
export function prepareExpenseTrendData(
	expenses: Expense[],
	period: '7d' | '30d' | '90d' | '1y' | 'all'
): ExpenseTrendData[] {
	// Filter expenses by period
	const filteredExpenses = filterExpensesByPeriod(expenses, period);

	if (filteredExpenses.length === 0) {
		return [];
	}

	// Determine grouping strategy based on period
	const grouping = period === '7d' || period === '30d' ? 'week' : 'month';

	// Group expenses by period
	const grouped = groupExpensesByPeriod(filteredExpenses, grouping);

	return grouped;
}

/**
 * Filter expenses by time period
 */
export function filterExpensesByPeriod(
	expenses: Expense[],
	period: '7d' | '30d' | '90d' | '1y' | 'all'
): Expense[] {
	if (period === 'all') {
		return expenses;
	}

	const now = new Date();
	const cutoffDate = new Date();

	switch (period) {
		case '7d':
			cutoffDate.setDate(now.getDate() - 7);
			break;
		case '30d':
			cutoffDate.setDate(now.getDate() - 30);
			break;
		case '90d':
			cutoffDate.setDate(now.getDate() - 90);
			break;
		case '1y':
			cutoffDate.setFullYear(now.getFullYear() - 1);
			break;
	}

	return expenses.filter(expense => {
		const expenseDate = new Date(expense.date);
		return expenseDate >= cutoffDate;
	});
}

/**
 * Group expenses by week or month
 */
function groupExpensesByPeriod(
	expenses: Expense[],
	grouping: 'week' | 'month'
): ExpenseTrendData[] {
	// Sort expenses by date
	const sortedExpenses = [...expenses].sort(
		(a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
	);

	// Group expenses by period key
	const groups = new Map<string, { expenses: Expense[]; date: Date }>();

	for (const expense of sortedExpenses) {
		const expenseDate = new Date(expense.date);
		const key = getPeriodKey(expenseDate, grouping);

		if (!groups.has(key)) {
			groups.set(key, {
				expenses: [],
				date: getPeriodStartDate(expenseDate, grouping)
			});
		}

		groups.get(key)!.expenses.push(expense);
	}

	// Convert groups to trend data
	const trendData: ExpenseTrendData[] = [];

	for (const [, group] of groups) {
		const amount = group.expenses.reduce((sum, expense) => sum + expense.amount, 0);
		const count = group.expenses.length;

		trendData.push({
			date: group.date,
			amount,
			count
		});
	}

	return trendData.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Get period key for grouping (e.g., "2024-W01" for week, "2024-01" for month)
 */
function getPeriodKey(date: Date, grouping: 'week' | 'month'): string {
	if (grouping === 'month') {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		return `${year}-${month}`;
	} else {
		// Week grouping - use ISO week number
		const year = date.getFullYear();
		const weekNumber = getWeekNumber(date);
		return `${year}-W${String(weekNumber).padStart(2, '0')}`;
	}
}

/**
 * Get the start date for a period (first day of month or week)
 */
function getPeriodStartDate(date: Date, grouping: 'week' | 'month'): Date {
	if (grouping === 'month') {
		return new Date(date.getFullYear(), date.getMonth(), 1);
	} else {
		// Get Monday of the week
		const day = date.getDay();
		const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
		return new Date(date.getFullYear(), date.getMonth(), diff);
	}
}

/**
 * Get ISO week number for a date
 */
function getWeekNumber(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Fuel efficiency data interface
export interface FuelEfficiencyData {
	date: Date;
	efficiency: number;
	mileage: number;
}

/**
 * Prepare fuel efficiency data for charting
 * Calculates efficiency between consecutive fuel entries
 * Handles both volume (MPG) and charge (mi/kWh)
 */
export function prepareFuelEfficiencyData(expenses: Expense[]): FuelEfficiencyData[] {
	// Filter fuel expenses that have mileage data
	const fuelExpenses = expenses
		.filter(expense => {
			// Must be fuel category and have mileage
			if (expense.category !== 'fuel' || !expense.mileage) {
				return false;
			}
			// Must have either volume (gas/diesel) or charge (electric)
			return expense.volume !== undefined || expense.charge !== undefined;
		})
		.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

	// Need at least 2 entries to calculate efficiency
	if (fuelExpenses.length < 2) {
		return [];
	}

	const efficiencyData: FuelEfficiencyData[] = [];

	// Calculate efficiency between consecutive entries
	for (let i = 1; i < fuelExpenses.length; i++) {
		const current = fuelExpenses[i];
		const previous = fuelExpenses[i - 1];

		// Safety check - should never happen but TypeScript requires it
		if (!current || !previous) {
			continue;
		}

		// Both must have mileage
		if (!current.mileage || !previous.mileage) {
			continue;
		}

		// Calculate miles driven
		const milesDriven = current.mileage - previous.mileage;

		// Skip if mileage didn't increase or increased unreasonably
		if (milesDriven <= 0 || milesDriven > MAX_REASONABLE_MILES_BETWEEN_FILLUPS) {
			continue;
		}

		let efficiency: number;

		// Calculate efficiency based on fuel type
		if (current.volume !== undefined && current.volume > 0) {
			// Gas/Diesel: MPG = miles / gallons
			efficiency = milesDriven / current.volume;
		} else if (current.charge !== undefined && current.charge > 0) {
			// Electric: mi/kWh = miles / kWh
			efficiency = milesDriven / current.charge;
		} else {
			// No valid fuel data
			continue;
		}

		// Filter out invalid efficiency values
		const isValidMpg =
			current.volume !== undefined && efficiency >= MIN_VALID_MPG && efficiency <= MAX_VALID_MPG;
		const isValidMiKwh =
			current.charge !== undefined &&
			efficiency >= MIN_VALID_MI_KWH &&
			efficiency <= MAX_VALID_MI_KWH;

		if (isValidMpg || isValidMiKwh) {
			efficiencyData.push({
				date: new Date(current.date),
				efficiency,
				mileage: current.mileage
			});
		}
	}

	return efficiencyData;
}

// Category chart data interface
export interface CategoryChartData {
	category: ExpenseCategory;
	name: string;
	amount: number;
	percentage: number;
	color: string;
}

/**
 * Get color hex value for category (for charts)
 */
function getCategoryColorHex(category: ExpenseCategory): string {
	const colors: Record<ExpenseCategory, string> = {
		fuel: '#2563eb', // blue-600
		maintenance: '#ea580c', // orange-600
		financial: '#16a34a', // green-600
		regulatory: '#9333ea', // purple-600
		enhancement: '#db2777', // pink-600
		misc: '#4b5563' // gray-600
	};
	return colors[category] || '#4b5563';
}

/**
 * Group expenses by category and calculate totals
 */
export function groupExpensesByCategory(expenses: Expense[]): Record<string, number> {
	return expenses.reduce(
		(acc, expense) => {
			acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
			return acc;
		},
		{} as Record<string, number>
	);
}

/**
 * Prepare category chart data for pie chart visualization
 * Calculates totals and percentages for each category
 */
export function prepareCategoryChartData(
	expensesByCategory: Record<string, number>
): CategoryChartData[] {
	// Calculate total
	const total = Object.values(expensesByCategory).reduce((sum, amount) => sum + amount, 0);

	// If no expenses, return empty array
	if (total === 0) {
		return [];
	}

	// Convert to array format with percentages and colors
	return Object.entries(expensesByCategory)
		.map(([category, amount]) => ({
			category: category as ExpenseCategory,
			name: categoryLabels[category as ExpenseCategory] || category,
			amount,
			percentage: (amount / total) * 100,
			color: getCategoryColorHex(category as ExpenseCategory)
		}))
		.sort((a, b) => b.amount - a.amount); // Sort by amount descending
}
