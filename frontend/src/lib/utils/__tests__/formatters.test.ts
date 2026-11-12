import { describe, expect, test } from 'vitest';
import {
	capitalize,
	dateOnlyToISO,
	formatCompactRelativeTime,
	formatCurrency,
	formatDate,
	formatNumber,
	formatRelativeTime,
	getCurrencySymbol,
	toDateInputValue
} from '#lib/utils/formatters.ts';

describe('formatCurrency', () => {
	test('defaults to USD with 2 decimals', () => {
		expect(formatCurrency(50)).toBe('$50.00');
	});

	test('renders the EUR symbol, not a dollar sign', () => {
		const out = formatCurrency(50, 'EUR');
		expect(out).toContain('€');
		expect(out).not.toContain('$');
	});

	test('renders the GBP symbol, not a dollar sign', () => {
		const out = formatCurrency(50, 'GBP');
		expect(out).toContain('£');
		expect(out).not.toContain('$');
	});

	test('honors a custom fraction-digit count (fuel price-per-unit)', () => {
		expect(formatCurrency(3.499, 'USD', 3)).toBe('$3.499');
		expect(formatCurrency(3.5, 'EUR', 3)).toContain('3.500');
	});

	test('still defaults to 2 decimals when fractionDigits is omitted', () => {
		expect(formatCurrency(3.499)).toBe('$3.50');
	});
});

describe('getCurrencySymbol', () => {
	test('returns the bare symbol, not a formatted amount', () => {
		expect(getCurrencySymbol('USD')).toBe('$');
	});

	test('follows the requested currency (€ / £, never $ for non-USD)', () => {
		expect(getCurrencySymbol('EUR')).toBe('€');
		expect(getCurrencySymbol('GBP')).toBe('£');
		expect(getCurrencySymbol('EUR')).not.toContain('$');
	});

	test('falls back to the raw code when there is no distinct symbol', () => {
		expect(getCurrencySymbol('CHF')).toBe('CHF');
	});
});

describe('dateOnlyToISO', () => {
	test('preserves the calendar day through a formatDate round-trip', () => {
		expect(formatDate(dateOnlyToISO('2024-03-15'))).toBe('Mar 15, 2024');
		expect(formatDate(dateOnlyToISO('2024-01-01'))).toBe('Jan 1, 2024');
		expect(formatDate(dateOnlyToISO('2024-12-31'))).toBe('Dec 31, 2024');
	});

	test('anchors at noon local time (not midnight)', () => {
		const d = new Date(dateOnlyToISO('2024-06-15'));
		expect(d.getHours()).toBe(12);
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(5);
		expect(d.getDate()).toBe(15);
	});

	test('falls back to now for empty/invalid input', () => {
		expect(() => new Date(dateOnlyToISO('')).toISOString()).not.toThrow();
		expect(Number.isNaN(new Date(dateOnlyToISO(undefined)).getTime())).toBe(false);
	});
});

describe('toDateInputValue — LOCAL date → YYYY-MM-DD input value', () => {
	test('formats a Date to its LOCAL calendar date (zero-padded)', () => {
		expect(toDateInputValue(new Date(2024, 2, 5, 8, 30))).toBe('2024-03-05');
		expect(toDateInputValue(new Date(2024, 0, 1, 0, 0))).toBe('2024-01-01');
		expect(toDateInputValue(new Date(2024, 11, 31, 23, 59))).toBe('2024-12-31');
	});

	test('zero-pads single-digit month and day', () => {
		expect(toDateInputValue(new Date(2025, 6, 9, 12))).toBe('2025-07-09');
	});

	test('round-trips with dateOnlyToISO in EVERY timezone (the noon-local anchor)', () => {
		for (const dateOnly of ['2024-03-15', '2024-01-01', '2024-12-31', '2024-02-29']) {
			expect(toDateInputValue(dateOnlyToISO(dateOnly))).toBe(dateOnly);
		}
	});

	test('accepts an ISO string input (the stored-date call sites pass strings)', () => {
		const stored = new Date(2024, 5, 15, 12, 0, 0).toISOString();
		expect(toDateInputValue(stored)).toBe('2024-06-15');
	});
});

describe('capitalize — extracted from 5 hand-rolled sites', () => {
	test('upper-cases the first character, leaving the rest unchanged', () => {
		expect(capitalize('loan')).toBe('Loan');
		expect(capitalize('monthly')).toBe('Monthly');
		expect(capitalize('lease')).toBe('Lease');
	});

	test('is a no-op on an empty string and leaves an already-capitalized word', () => {
		expect(capitalize('')).toBe('');
		expect(capitalize('Owned')).toBe('Owned');
	});

	test('only touches the first character (does not lower-case the rest)', () => {
		expect(capitalize('mDY')).toBe('MDY');
	});
});

describe('formatNumber', () => {
	test('formats with the default 2 decimals', () => {
		expect(formatNumber(1234.5)).toBe('1,234.50');
	});

	test('honors a custom decimal count (0 → integer, 3 → fuel-price style)', () => {
		expect(formatNumber(1234.567, 0)).toBe('1,235');
		expect(formatNumber(3.4, 3)).toBe('3.400');
	});
});

describe('formatDate', () => {
	const SHORT_MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	test('renders a Date as "Mon D, YYYY" (en-US short month)', () => {
		expect(formatDate(new Date(2024, 2, 15, 12))).toBe('Mar 15, 2024');
	});

	test('accepts an ISO string carrying an explicit instant', () => {
		expect(formatDate(new Date(2024, 2, 15, 12).toISOString())).toBe('Mar 15, 2024');
	});

	test('renders the LOCAL calendar day of an instant, not the UTC one', () => {
		for (const iso of ['2024-03-15T00:30:00.000Z', '2024-03-15T23:30:00.000Z']) {
			const local = new Date(iso);
			expect(formatDate(iso)).toBe(
				`${SHORT_MONTHS[local.getMonth()]} ${local.getDate()}, ${local.getFullYear()}`
			);
		}
	});
});

describe('formatRelativeTime — branches driven relative to now, host-independent', () => {
	const DAY = 1000 * 60 * 60 * 24;
	const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

	test('null → "Never"', () => {
		expect(formatRelativeTime(null)).toBe('Never');
	});

	test('the day/week/month/year buckets', () => {
		expect(formatRelativeTime(daysAgo(0))).toBe('Today');
		expect(formatRelativeTime(daysAgo(1))).toBe('Yesterday');
		expect(formatRelativeTime(daysAgo(3))).toBe('3 days ago');
		expect(formatRelativeTime(daysAgo(14))).toBe('2 weeks ago');
		expect(formatRelativeTime(daysAgo(60))).toBe('2 months ago');
		expect(formatRelativeTime(daysAgo(400))).toBe('1 year ago');
	});

	test('singular grammar at each bucket boundary', () => {
		expect(formatRelativeTime(daysAgo(7))).toBe('1 week ago');
		expect(formatRelativeTime(daysAgo(13))).toBe('1 week ago');
		expect(formatRelativeTime(daysAgo(30))).toBe('1 month ago');
		expect(formatRelativeTime(daysAgo(59))).toBe('1 month ago');
		expect(formatRelativeTime(daysAgo(365))).toBe('1 year ago');
	});

	test('a future date clamps to "Today" (the Math.max(0, …) guard, not a negative bucket)', () => {
		expect(formatRelativeTime(new Date(Date.now() + 5 * DAY))).toBe('Today');
	});

	test('accepts an ISO string as well as a Date', () => {
		expect(formatRelativeTime(daysAgo(1).toISOString())).toBe('Yesterday');
	});
});

describe('formatCompactRelativeTime', () => {
	const MIN = 60000;

	test('null → "Never"', () => {
		expect(formatCompactRelativeTime(null)).toBe('Never');
	});

	test('the minute/hour/day buckets', () => {
		expect(formatCompactRelativeTime(new Date(Date.now() - 30 * 1000))).toBe('Just now');
		expect(formatCompactRelativeTime(new Date(Date.now() - 5 * MIN))).toBe('5m ago');
		expect(formatCompactRelativeTime(new Date(Date.now() - 3 * 60 * MIN))).toBe('3h ago');
		expect(formatCompactRelativeTime(new Date(Date.now() - 2 * 24 * 60 * MIN))).toBe('2d ago');
	});

	test('a future date clamps to "Just now" (the Math.max(0, …) guard)', () => {
		expect(formatCompactRelativeTime(new Date(Date.now() + 10 * MIN))).toBe('Just now');
	});
});
