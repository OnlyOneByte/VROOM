import { settingsStore } from '#lib/stores/settings.svelte.ts';

export function formatCurrency(amount: number, currency?: string, fractionDigits?: number): string {
	const currencyToUse = currency || settingsStore.settings?.currencyUnit || 'USD';

	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currencyToUse,
		...(fractionDigits != null && {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits
		})
	}).format(amount);
}

export function getCurrencySymbol(currency?: string): string {
	const currencyToUse = currency || settingsStore.settings?.currencyUnit || 'USD';
	const parts = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currencyToUse
	}).formatToParts(0);
	return parts.find(p => p.type === 'currency')?.value ?? currencyToUse;
}

export function formatNumber(value: number, decimals = 2): string {
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
}

export function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dateOnlyToLocalNoon(dateOnly: string): Date | null {
	const [year, month, day] = dateOnly.split('-').map(Number);
	if (!year || !month || !day) return null;
	return new Date(year, month - 1, day, 12, 0, 0);
}

function parseDateString(value: string): Date {
	const localDay = DATE_ONLY.test(value) ? dateOnlyToLocalNoon(value) : null;
	return localDay ?? new Date(value);
}

export function formatDate(date: string | Date): string {
	const d = typeof date === 'string' ? parseDateString(date) : date;
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}).format(d);
}

// Noon local keeps the calendar day stable under every real UTC offset.
export function dateOnlyToISO(dateOnly: string | undefined | null): string {
	if (!dateOnly) return new Date().toISOString();
	return (dateOnlyToLocalNoon(dateOnly) ?? new Date()).toISOString();
}

export function toDateInputValue(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function formatRelativeTime(date: Date | string | null): string {
	if (!date) return 'Never';

	const dateObj = typeof date === 'string' ? new Date(date) : date;
	const days = Math.max(0, Math.floor((Date.now() - dateObj.getTime()) / (1000 * 60 * 60 * 24)));

	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 30) {
		const weeks = Math.floor(days / 7);
		return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
	}
	if (days < 365) {
		const months = Math.floor(days / 30);
		return `${months} month${months > 1 ? 's' : ''} ago`;
	}
	const years = Math.floor(days / 365);
	return `${years} year${years > 1 ? 's' : ''} ago`;
}

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
