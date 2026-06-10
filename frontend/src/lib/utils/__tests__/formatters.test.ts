/**
 * Unit tests for formatCurrency — the central money-formatting seam.
 *
 * Regression guard for the cycle-94 bug class: several components hardcoded a
 * '$' (or rendered a bare number) instead of routing through formatCurrency,
 * so a user whose currencyUnit is EUR/GBP saw the wrong symbol. All those sites
 * now call formatCurrency; these tests pin the behavior it must provide:
 *   - the symbol follows the requested currency (€ / £, never $ for non-USD)
 *   - the optional fractionDigits arg supports fuel price-per-unit (3 decimals)
 *
 * currency is passed explicitly here, so these tests don't depend on the
 * settings store / DOM.
 */

import { describe, expect, test } from 'vitest';
import {
	capitalize,
	dateOnlyToISO,
	formatCompactRelativeTime,
	formatCurrency,
	formatDate,
	formatNumber,
	formatRelativeTime,
	getCurrencySymbol
} from '$lib/utils/formatters';

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
		// 3 decimals is the conventional fuel-price precision (e.g. €3.499/L).
		expect(formatCurrency(3.499, 'USD', 3)).toBe('$3.499');
		expect(formatCurrency(3.5, 'EUR', 3)).toContain('3.500');
	});

	test('still defaults to 2 decimals when fractionDigits is omitted', () => {
		expect(formatCurrency(3.499)).toBe('$3.50');
	});
});

/**
 * Regression guard for the cycle-202 bug class: money-FIELD LABELS and chart axis
 * TITLES (insurance forms, financing amortization chart) hardcoded a literal "($)",
 * so a EUR/GBP user saw "Deductible ($)" while the inputs/ticks were in their own
 * currency. Those sites now read `({getCurrencySymbol()})`; this pins that the
 * helper returns the SYMBOL alone (not a formatted amount) and follows the unit.
 *
 * currency is passed explicitly so these don't depend on the settings store / DOM.
 */
describe('getCurrencySymbol', () => {
	test('returns the bare symbol, not a formatted amount', () => {
		// Symbol only — no digits, no grouping. (Distinguishes it from formatCurrency.)
		expect(getCurrencySymbol('USD')).toBe('$');
	});

	test('follows the requested currency (€ / £, never $ for non-USD)', () => {
		expect(getCurrencySymbol('EUR')).toBe('€');
		expect(getCurrencySymbol('GBP')).toBe('£');
		expect(getCurrencySymbol('EUR')).not.toContain('$');
	});

	test('falls back to the raw code when there is no distinct symbol', () => {
		// CHF has no single-glyph symbol in this locale → Intl yields the code itself.
		expect(getCurrencySymbol('CHF')).toBe('CHF');
	});
});

/**
 * Regression guard for the cycle-98 timezone bug: date-only picker strings
 * ("YYYY-MM-DD") were serialized with `new Date(str).toISOString()`, which
 * parses as midnight UTC and renders as the PREVIOUS calendar day via
 * formatDate (local time) for any negative-offset user. dateOnlyToISO anchors
 * at noon local so the calendar date survives the round-trip.
 *
 * This suite bites hardest under a negative-offset TZ — the regress harness can
 * run it with TZ=America/New_York; it also holds in UTC (noon stays same-day).
 */
describe('dateOnlyToISO', () => {
	test('preserves the calendar day through a formatDate round-trip', () => {
		// The user-visible contract: pick Mar 15 → see Mar 15, not Mar 14.
		expect(formatDate(dateOnlyToISO('2024-03-15'))).toBe('Mar 15, 2024');
		expect(formatDate(dateOnlyToISO('2024-01-01'))).toBe('Jan 1, 2024');
		expect(formatDate(dateOnlyToISO('2024-12-31'))).toBe('Dec 31, 2024');
	});

	test('anchors at noon local time (not midnight)', () => {
		// Noon local ± any real offset never crosses midnight, which is the whole
		// point — assert the local hour is 12, regardless of the runner's TZ.
		const d = new Date(dateOnlyToISO('2024-06-15'));
		expect(d.getHours()).toBe(12);
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(5); // June (0-indexed)
		expect(d.getDate()).toBe(15);
	});

	test('falls back to now for empty/invalid input', () => {
		// Empty string / undefined → a valid ISO timestamp (no throw, no NaN).
		expect(() => new Date(dateOnlyToISO('')).toISOString()).not.toThrow();
		expect(Number.isNaN(new Date(dateOnlyToISO(undefined)).getTime())).toBe(false);
	});
});

describe('capitalize (C119 — extracted from 5 hand-rolled sites)', () => {
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

describe('formatNumber (C130 — coverage ratchet)', () => {
	test('formats with the default 2 decimals', () => {
		expect(formatNumber(1234.5)).toBe('1,234.50');
	});

	test('honors a custom decimal count (0 → integer, 3 → fuel-price style)', () => {
		expect(formatNumber(1234.567, 0)).toBe('1,235');
		expect(formatNumber(3.4, 3)).toBe('3.400');
	});
});

describe('formatDate (C130)', () => {
	test('renders a Date as "Mon D, YYYY" (en-US short month)', () => {
		// Construct at noon local so the calendar day is offset-stable for the assertion.
		expect(formatDate(new Date(2024, 2, 15, 12))).toBe('Mar 15, 2024');
	});

	test('accepts an ISO string carrying an explicit instant', () => {
		// A timezone-qualified instant formats to its local calendar day; assert the parts are present.
		const out = formatDate('2024-03-15T18:00:00.000Z');
		expect(out).toMatch(/Mar 1[45], 2024/); // 14th or 15th depending on host offset — both valid
	});
});

describe('formatRelativeTime (C130 — branches driven relative to now, host-independent)', () => {
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
		expect(formatRelativeTime(daysAgo(400))).toBe('1 years ago');
	});

	test('a future date clamps to "Today" (the Math.max(0, …) guard, not a negative bucket)', () => {
		expect(formatRelativeTime(new Date(Date.now() + 5 * DAY))).toBe('Today');
	});

	test('accepts an ISO string as well as a Date', () => {
		expect(formatRelativeTime(daysAgo(1).toISOString())).toBe('Yesterday');
	});
});

describe('formatCompactRelativeTime (C130)', () => {
	const MIN = 60000;

	test('null → "Never"', () => {
		expect(formatCompactRelativeTime(null)).toBe('Never');
	});

	test('the minute/hour/day buckets', () => {
		expect(formatCompactRelativeTime(new Date(Date.now() - 30 * 1000))).toBe('Just now'); // <1 min
		expect(formatCompactRelativeTime(new Date(Date.now() - 5 * MIN))).toBe('5m ago');
		expect(formatCompactRelativeTime(new Date(Date.now() - 3 * 60 * MIN))).toBe('3h ago');
		expect(formatCompactRelativeTime(new Date(Date.now() - 2 * 24 * 60 * MIN))).toBe('2d ago');
	});

	test('a future date clamps to "Just now" (the Math.max(0, …) guard)', () => {
		expect(formatCompactRelativeTime(new Date(Date.now() + 10 * MIN))).toBe('Just now');
	});
});
