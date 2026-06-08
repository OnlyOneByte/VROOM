/**
 * Unit tests for the money-valued chart axis formatters.
 *
 * Regression guard for the cycle-95 extension of the currency bug class: these
 * two helpers previously held their own module-level Intl.NumberFormat with a
 * hardcoded currency:'USD', so every money chart axis showed '$' regardless of
 * the user's currencyUnit. They now delegate to formatCurrency, which resolves
 * the user's currency. With no settings loaded (test env) the currency falls
 * back to USD, so these pin the decimal-precision contract + the delegation:
 *   - formatCurrencyAxis: compact, 0 decimals ($1,200)
 *   - formatCentsAxis: 2 decimals ($0.05)
 * The currency-symbol resolution itself is covered in formatters.test.ts.
 */

import { describe, expect, test } from 'vitest';
import {
	formatCurrencyAxis,
	formatCentsAxis,
	parseMonthToDate
} from '$lib/utils/chart-formatters';

describe('chart money axis formatters', () => {
	test('formatCurrencyAxis renders compact currency with no decimals', () => {
		expect(formatCurrencyAxis(1200)).toBe('$1,200');
		// Rounds rather than showing cents (axis labels stay compact).
		expect(formatCurrencyAxis(1200.4)).toBe('$1,200');
	});

	test('formatCentsAxis renders small currency values with 2 decimals', () => {
		expect(formatCentsAxis(0.05)).toBe('$0.05');
		expect(formatCentsAxis(3.5)).toBe('$3.50');
	});
});

/**
 * parseMonthToDate is the sanctioned LOCAL-time parser for a "YYYY-MM" trend bucket.
 * The bug it exists to prevent (cycle 211): `new Date('2024-03-01')` parses as midnight
 * UTC, so a negative-offset user (e.g. UTC-8) sees the Date as 2024-02-29 *local* and the
 * chart x-axis renders the month one back ("Feb" for a March bucket). These pin that the
 * helper builds a date in LOCAL time, on the 1st, with the requested month — so the month
 * label is correct in every timezone. Constructing via (year, monthIndex, 1) is the fix.
 */
describe('parseMonthToDate (local-time month bucket parser)', () => {
	test('returns the 1st of the requested month in LOCAL time', () => {
		const d = parseMonthToDate('2024-03');
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(2); // 0-indexed March
		expect(d.getDate()).toBe(1);
		// Local midnight, not a UTC instant: the local hours are 0 regardless of offset.
		expect(d.getHours()).toBe(0);
	});

	test('the rendered local month matches the input (no UTC-shift regression)', () => {
		// The whole point: toLocaleDateString in any zone shows the month we asked for.
		// `new Date('2024-03-01')` would render "Feb" west of UTC — this must not.
		expect(parseMonthToDate('2024-03').toLocaleDateString('en-US', { month: 'short' })).toBe(
			'Mar'
		);
		expect(parseMonthToDate('2024-01').getMonth()).toBe(0);
		expect(parseMonthToDate('2024-12').getMonth()).toBe(11);
	});
});
