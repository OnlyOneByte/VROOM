import { settingsStore } from '#lib/stores/settings.svelte.ts';

export function currentLocale(): string {
	return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}

function userCurrency(currency?: string): string {
	return currency || settingsStore.settings?.currencyUnit || 'USD';
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

export function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
	const locale = currentLocale();
	const key = `${locale}|${JSON.stringify(options)}`;
	let format = numberFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat(locale, options);
		numberFormats.set(key, format);
	}
	return format;
}

function timeZoneKey(): string {
	const year = new Date().getFullYear();
	return `${new Date(year, 0, 1).getTimezoneOffset()}/${new Date(year, 6, 1).getTimezoneOffset()}`;
}

function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const locale = currentLocale();
	const key = `${locale}|${timeZoneKey()}|${JSON.stringify(options)}`;
	let format = dateTimeFormats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(locale, options);
		dateTimeFormats.set(key, format);
	}
	return format;
}

export function currencyFractionDigits(currency?: string): number {
	return (
		numberFormat({ style: 'currency', currency: userCurrency(currency) }).resolvedOptions()
			.maximumFractionDigits ?? 2
	);
}

export function amountStep(currency?: string): string {
	const digits = currencyFractionDigits(currency);
	return digits > 0 ? (1 / 10 ** digits).toFixed(digits) : '1';
}

export function toAmountInput(amount: number, currency?: string): string {
	return amount.toFixed(currencyFractionDigits(currency));
}

export function amountPlaceholder(currency?: string): string {
	const digits = currencyFractionDigits(currency);
	return digits > 0 ? `0.${'0'.repeat(digits)}` : '0';
}

export function minorUnitScale(_currency?: string): number {
	return 100;
}

export function toMinor(amount: number, currency?: string): number {
	return Math.round(amount * minorUnitScale(currency));
}

export function fromMinor(minor: number, currency?: string): number {
	return minor / minorUnitScale(currency);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${formatNumber(bytes, 0)} B`;
	if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
	return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

export function formatDateWith(date: Date, options: Intl.DateTimeFormatOptions): string {
	return dateTimeFormat(options).format(date);
}

export function formatCurrency(amount: number, currency?: string, fractionDigits?: number): string {
	const currencyToUse = userCurrency(currency);

	return numberFormat({
		style: 'currency',
		currency: currencyToUse,
		...(fractionDigits != null && {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits
		})
	}).format(amount);
}

export function getCurrencySymbol(currency?: string): string {
	const currencyToUse = userCurrency(currency);
	const parts = numberFormat({ style: 'currency', currency: currencyToUse }).formatToParts(0);
	return parts.find(p => p.type === 'currency')?.value ?? currencyToUse;
}

const currencyNames = new Map<string, Intl.DisplayNames>();

export function currencyLabel(code: string): string {
	const locale = currentLocale();
	let names = currencyNames.get(locale);
	if (!names) {
		names = new Intl.DisplayNames(locale, { type: 'currency' });
		currencyNames.set(locale, names);
	}
	const name = names.of(code);
	const symbol = getCurrencySymbol(code);
	const named = name && name !== code ? `${code} – ${name}` : code;
	return symbol === code ? named : `${named} (${symbol})`;
}

export function formatNumber(value: number, decimals = 2): string {
	return numberFormat({
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(value);
}

export function formatNumberUpTo(value: number, maxDecimals: number): string {
	return numberFormat({ maximumFractionDigits: maxDecimals }).format(value);
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
	return formatDateWith(d, { year: 'numeric', month: 'short', day: 'numeric' });
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
