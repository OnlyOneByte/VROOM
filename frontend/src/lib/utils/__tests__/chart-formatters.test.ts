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
	formatCentsAxis,
	formatCurrencyAxis,
	formatDateTick,
	formatDecimalAxis,
	getTrendLineProps,
	getXTickCount,
	monthlyXAxisProps,
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

/**
 * The remaining chart-axis helpers (C436 guard). These five exports were ZERO-test despite each
 * being a LayerChart axis/series callback rendered on real charts (fuel-efficiency trend, year-end,
 * fuel charts, every monthly time series). They are display-shape contracts — lower-stakes than money
 * math — but reachable + load-bearing, so a silent regression (a flipped default, a dropped clamp, a
 * lost NaN guard) would change a rendered axis with nothing to catch it. Pinned firsthand against the
 * REAL exports (not a re-implementation — the C181/C229 trap).
 */
describe('formatDecimalAxis (Y-axis fixed-decimal label)', () => {
	test('defaults to ONE decimal place (the bare-call contract for efficiency-trend Y ticks)', () => {
		// FuelEfficiencyTrendChart/YearEndTab/FuelCharts pass it as yAxis.format with NO decimals arg,
		// so the default IS what renders. A regression to decimals=0 / String(value) breaks both.
		expect(formatDecimalAxis(28.5)).toBe('28.5');
		expect(formatDecimalAxis(28)).toBe('28.0');
	});

	test('honors an explicit decimals argument', () => {
		expect(formatDecimalAxis(3.14159, 2)).toBe('3.14');
		expect(formatDecimalAxis(3.14159, 0)).toBe('3');
	});
});

describe('getXTickCount (X-axis tick-budget clamp)', () => {
	test('clamps to the data length when below the max (the few-points dedup case)', () => {
		// The reason it exists: d3 would emit ~7 ticks for 2 monthly points → duplicate labels.
		expect(getXTickCount(2)).toBe(2);
		expect(getXTickCount(0)).toBe(0);
	});

	test('caps at the max when data exceeds it (default max = 6)', () => {
		expect(getXTickCount(20)).toBe(6); // default cap
		expect(getXTickCount(20, 12)).toBe(12); // explicit cap (the monthlyXAxisProps budget)
	});
});

describe('formatDateTick (date X-axis label with unknown-input guard)', () => {
	test('formats a real Date as "Mon D"', () => {
		expect(formatDateTick(new Date(2024, 2, 15))).toBe('Mar 15');
	});

	test('returns empty string for non-Date / Invalid-Date input (the layerchart-callback guard)', () => {
		// layerchart hands the axis callback raw scale values — a non-Date or Invalid Date must render
		// '' not the literal "Invalid Date". A dropped guard would surface garbage tick labels.
		expect(formatDateTick(new Date('garbage'))).toBe('');
		expect(formatDateTick(42)).toBe('');
		expect(formatDateTick(null)).toBe('');
		expect(formatDateTick(undefined)).toBe('');
	});
});

describe('monthlyXAxisProps (monthly time-series axis wiring)', () => {
	test('wires a 12-tick budget (not the 6 default) and clamps to data length', () => {
		// The composite seam used by every monthly chart: it caps at 12, distinct from getXTickCount's
		// 6 default — a regression to the bare default would crowd a long series differently.
		expect(monthlyXAxisProps(24).ticks).toBe(12); // capped at 12
		expect(monthlyXAxisProps(3).ticks).toBe(3); // clamped to data
		expect(typeof monthlyXAxisProps(3).format).toBe('function');
	});
});

describe('getTrendLineProps (single-point visibility branch)', () => {
	test('a single (or zero) data point gets an enlarged filled dot so the lone value is visible', () => {
		// A new vehicle with one fillup/expense hits this branch; without the larger r:6 fill-primary
		// dot the single value is invisible until hover.
		expect(getTrendLineProps(1).points.r).toBe(6);
		expect(getTrendLineProps(0).points.r).toBe(6);
	});

	test('two or more points use the standard trend dot (r:4)', () => {
		expect(getTrendLineProps(2).points.r).toBe(4);
		expect(getTrendLineProps(12).points.r).toBe(4);
	});
});
