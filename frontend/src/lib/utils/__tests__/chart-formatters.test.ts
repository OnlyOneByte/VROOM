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
import { formatCurrencyAxis, formatCentsAxis } from '$lib/utils/chart-formatters';

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
