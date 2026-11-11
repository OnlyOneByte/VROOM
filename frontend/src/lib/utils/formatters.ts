// Centralized formatting utilities
import { settingsStore } from '$lib/stores/settings.svelte';

// Currency formatting - uses user's currency setting from store.
// `fractionDigits` overrides the default 2 decimals (e.g. fuel price-per-unit
// is conventionally shown at 3 decimals like €3.499/L).
export function formatCurrency(amount: number, currency?: string, fractionDigits?: number): string {
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
	return parts.find(p => p.type === 'currency')?.value ?? currencyToUse;
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

/** A bare `YYYY-MM-DD` date-picker value: a calendar DAY, carrying no instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a date-only value as NOON LOCAL on that calendar day; null when it isn't three numbers.
 * Noon is the anchor because no real UTC offset (±14h) can push it across LOCAL midnight, so the
 * calendar day is stable in every timezone.
 */
function dateOnlyToLocalNoon(dateOnly: string): Date | null {
	const [year, month, day] = dateOnly.split('-').map(Number);
	if (!year || !month || !day) return null;
	return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * A date STRING for display. A date-only `YYYY-MM-DD` value is a calendar DAY, so it is read on
 * the LOCAL calendar: `new Date('2024-03-15')` is midnight UTC, which every local read then
 * renders as the PREVIOUS day for a negative-offset (Americas) user. Anything else (a full ISO
 * timestamp) is a real instant and keeps parsing as one.
 */
function parseDateString(value: string): Date {
	const localDay = DATE_ONLY.test(value) ? dateOnlyToLocalNoon(value) : null;
	return localDay ?? new Date(value);
}

// Date formatting. Renders the LOCAL calendar day of an instant, and the day itself for a
// date-only picker value — so a 'YYYY-MM-DD' string shows the day the user picked everywhere.
export function formatDate(date: string | Date): string {
	const d = typeof date === 'string' ? parseDateString(date) : date;
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
	return (dateOnlyToLocalNoon(dateOnly) ?? new Date()).toISOString();
}

/**
 * Format a date as the `YYYY-MM-DD` string an `<input type="date">` binds to, using the LOCAL
 * calendar date (not UTC) — the forward partner to `dateOnlyToISO`'s reverse (parse) direction.
 *
 * Collapses the `new Date(x).toISOString().split('T')[0]` / `.slice(0, 10)` idiom that was
 * hand-repeated across the date-input forms (expense / reminder / vehicle / odometer) + the CSV
 * download filename (extraction).
 *
 * WHY LOCAL, NOT UTC: the old `.toISOString().slice(0,10)` read the UTC
 * calendar date, so it (a) showed TOMORROW for a negative-offset (Americas) user editing late in the
 * day, and (b) BROKE THE ROUND-TRIP for stored dates — `dateOnlyToISO` writes them anchored at NOON
 * LOCAL, and noon-local in a positive offset (e.g. +14) is the PREVIOUS day in UTC, so a vehicle's
 * stored purchaseDate would reload one day earlier in the form. Reading the LOCAL components fixes
 * both: noon ± any real offset (±14h) never crosses LOCAL midnight, so a dateOnlyToISO→toDateInputValue
 * round-trip is exact in every timezone. No default — callers pass an explicit argument.
 */
export function toDateInputValue(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

// Relative time formatting
export function formatRelativeTime(date: Date | string | null): string {
	if (!date) return 'Never';

	const dateObj = typeof date === 'string' ? new Date(date) : date;
	const days = Math.max(0, Math.floor((Date.now() - dateObj.getTime()) / (1000 * 60 * 60 * 24)));

	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	// Pluralize each bucket — Math.floor can land on 1 (e.g. 7-13d → 1 week, 365-729d → 1 year),
	// so a bare "1 weeks/months/years ago" would render. Use the n>1 idiom (cf. reminder-helpers,
	// sync-status). days<7 always yields ≥2 so its plural is unconditional.
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
