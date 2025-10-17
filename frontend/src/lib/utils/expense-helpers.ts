import type { ExpenseCategory } from '$lib/types';
import { Fuel, Wrench, CreditCard, DollarSign } from 'lucide-svelte';
import type { ComponentType } from 'svelte';

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
export function getCategoryIcon(category: ExpenseCategory): ComponentType {
	const icons: Record<ExpenseCategory, ComponentType> = {
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
