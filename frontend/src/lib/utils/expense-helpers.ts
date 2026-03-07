import type { ExpenseCategory } from '$lib/types';
import { Fuel, Wrench, CreditCard, DollarSign } from '@lucide/svelte';

type LucideIcon = typeof Fuel;

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
