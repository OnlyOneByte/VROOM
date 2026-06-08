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
	formatCurrency,
	formatDate,
	dateOnlyToISO,
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
