// Centralized formatting utilities
import { get } from 'svelte/store';
import { settingsStore } from '$lib/stores/settings';

// Currency formatting - uses user's currency setting from store
export function formatCurrency(amount: number, currency?: string): string {
	// If currency not provided, get from settings store
	const currencyToUse = currency || get(settingsStore).settings?.currencyUnit || 'USD';

	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currencyToUse
	}).format(amount);
}

// Number formatting
export function formatNumber(value: number, decimals = 2): string {
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
}

// Date formatting
export function formatDate(date: string | Date): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(d);
}

// Relative time formatting
export function formatRelativeTime(date: Date | string | null): string {
	if (!date) return 'Never';

	const dateObj = typeof date === 'string' ? new Date(date) : date;
	const days = Math.max(0, Math.floor((Date.now() - dateObj.getTime()) / (1000 * 60 * 60 * 24)));

	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
	if (days < 365) return `${Math.floor(days / 30)} months ago`;
	return `${Math.floor(days / 365)} years ago`;
}

// Compact relative time (for sync status)
export function formatCompactRelativeTime(date: Date | null): string {
	if (!date) return 'Never';

	const now = new Date();
	const diff = Math.max(0, now.getTime() - date.getTime());
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (minutes < 1) return 'Just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	return `${days}d ago`;
}

// Re-export debounce from canonical location
export { debounce } from './memoize';
