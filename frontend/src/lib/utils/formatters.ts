// Centralized formatting utilities
import { settingsStore } from '$lib/stores/settings.svelte';

// Currency formatting - uses user's currency setting from store.
// `fractionDigits` overrides the default 2 decimals (e.g. fuel price-per-unit
// is conventionally shown at 3 decimals like €3.499/L).
export function formatCurrency(
	amount: number,
	currency?: string,
	fractionDigits?: number
): string {
	// If currency not provided, get from settings store
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

/**
 * The user's currency SYMBOL alone (e.g. "$", "€", "£") — for field labels and
 * axis titles where we want the symbol, not a formatted amount. Resolves the
 * unit from the settings store exactly like formatCurrency, then extracts the
 * `currency` part via Intl so EUR/GBP users never see a hardcoded "$".
 * Falls back to the raw code (e.g. "CHF") when there's no distinct symbol.
 */
export function getCurrencySymbol(currency?: string): string {
	const currencyToUse = currency || settingsStore.settings?.currencyUnit || 'USD';
	const parts = new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currencyToUse
	}).formatToParts(0);
	return parts.find((p) => p.type === 'currency')?.value ?? currencyToUse;
}

// Number formatting
export function formatNumber(value: number, decimals = 2): string {
	return new Intl.NumberFormat('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
}

/** Upper-case the first character, leaving the rest unchanged (e.g. 'loan' → 'Loan'). */
export function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
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

/**
 * Convert a date-only string ("YYYY-MM-DD" from a date picker) to an ISO
 * timestamp anchored at NOON LOCAL time.
 *
 * `new Date("2024-03-15").toISOString()` parses as midnight UTC, which renders
 * as the PREVIOUS calendar day once formatDate() (local time) displays it for
 * any negative-offset (Americas) user. Anchoring at noon local keeps the
 * calendar date stable across every real timezone offset (±14h never crosses
 * midnight from noon). Empty/invalid input falls back to now.
 */
export function dateOnlyToISO(dateOnly: string | undefined | null): string {
	if (!dateOnly) return new Date().toISOString();
	const [year, month, day] = dateOnly.split('-').map(Number);
	if (!year || !month || !day) return new Date().toISOString();
	return new Date(year, month - 1, day, 12, 0, 0).toISOString();
}

/**
 * Format a date as the `YYYY-MM-DD` string an `<input type="date">` binds to.
 *
 * Collapses the `new Date(x).toISOString().split('T')[0]` / `.slice(0, 10)` idiom that was
 * hand-repeated across the date-input forms (expense / reminder / vehicle / odometer) + the CSV
 * download filename. `.split('T')[0]` and `.slice(0, 10)` are identical for an ISO string; this is
 * the single spelling.
 *
 * BEHAVIOR NOTE (preserved deliberately): this uses the UTC calendar date (toISOString), matching
 * every prior call site exactly — so for a negative-offset (Americas) user late in the day the input
 * can show TOMORROW's date. That is the same latent off-by-one `dateOnlyToISO` guards on the reverse
 * (parse) direction; converging the writers here means a future local-date fix is one edit, not nine.
 * No default — an explicit argument is always passed (callers default to `new Date()` themselves).
 */
export function toDateInputValue(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	return d.toISOString().slice(0, 10);
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
