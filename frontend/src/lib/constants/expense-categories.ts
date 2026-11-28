import { Coffee, CreditCard, FileText, Fuel, Sparkles, Wrench } from '@lucide/svelte';

export const EXPENSE_CATEGORIES = [
	'fuel',
	'maintenance',
	'financial',
	'regulatory',
	'enhancement',
	'misc'
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type CategoryColorToken =
	'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'neutral';

interface ExpenseCategoryInfo {
	label: string;
	shortLabel: string;
	description: string;
	colorToken: CategoryColorToken;
	icon: typeof Fuel;
}

export const EXPENSE_CATEGORY_INFO: Record<ExpenseCategory, ExpenseCategoryInfo> = {
	fuel: {
		label: 'Fuel & charging',
		shortLabel: 'Fuel',
		description: 'Gas, diesel, and EV charging',
		colorToken: 'chart-1',
		icon: Fuel
	},
	maintenance: {
		label: 'Maintenance',
		shortLabel: 'Maintenance',
		description: 'Keeping the car running',
		colorToken: 'chart-2',
		icon: Wrench
	},
	financial: {
		label: 'Financial',
		shortLabel: 'Financial',
		description: 'Insurance, loan payment, lease payment, etc',
		colorToken: 'chart-3',
		icon: CreditCard
	},
	regulatory: {
		label: 'Regulatory',
		shortLabel: 'Regulatory',
		description: 'Registration, tickets, inspections, etc',
		colorToken: 'chart-4',
		icon: FileText
	},
	enhancement: {
		label: 'Enhancement',
		shortLabel: 'Enhancement',
		description: 'Optional improvements',
		colorToken: 'chart-5',
		icon: Sparkles
	},
	misc: {
		label: 'Misc',
		shortLabel: 'Misc',
		description: 'Tolls, parking, etc.',
		colorToken: 'neutral',
		icon: Coffee
	}
};

export function mapExpenseCategories<T>(
	pick: (info: ExpenseCategoryInfo, category: ExpenseCategory) => T
): Record<ExpenseCategory, T> {
	return Object.fromEntries(
		EXPENSE_CATEGORIES.map(category => [category, pick(EXPENSE_CATEGORY_INFO[category], category)])
	) as Record<ExpenseCategory, T>;
}
