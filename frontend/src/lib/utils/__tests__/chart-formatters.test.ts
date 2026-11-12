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
} from '#lib/utils/chart-formatters.ts';

describe('chart money axis formatters', () => {
	test('formatCurrencyAxis renders compact currency with no decimals', () => {
		expect(formatCurrencyAxis(1200)).toBe('$1,200');
		expect(formatCurrencyAxis(1200.4)).toBe('$1,200');
	});

	test('formatCentsAxis renders small currency values with 2 decimals', () => {
		expect(formatCentsAxis(0.05)).toBe('$0.05');
		expect(formatCentsAxis(3.5)).toBe('$3.50');
	});
});

describe('parseMonthToDate (local-time month bucket parser)', () => {
	test('returns the 1st of the requested month in LOCAL time', () => {
		const d = parseMonthToDate('2024-03');
		expect(d.getFullYear()).toBe(2024);
		expect(d.getMonth()).toBe(2);
		expect(d.getDate()).toBe(1);
		expect(d.getHours()).toBe(0);
	});

	test('the rendered local month matches the input', () => {
		expect(parseMonthToDate('2024-03').toLocaleDateString('en-US', { month: 'short' })).toBe('Mar');
		expect(parseMonthToDate('2024-01').getMonth()).toBe(0);
		expect(parseMonthToDate('2024-12').getMonth()).toBe(11);
	});
});

describe('formatDecimalAxis (Y-axis fixed-decimal label)', () => {
	test('defaults to ONE decimal place (the bare-call contract for efficiency-trend Y ticks)', () => {
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
		expect(getXTickCount(2)).toBe(2);
		expect(getXTickCount(0)).toBe(0);
	});

	test('caps at the max when data exceeds it (default max = 6)', () => {
		expect(getXTickCount(20)).toBe(6);
		expect(getXTickCount(20, 12)).toBe(12);
	});
});

describe('formatDateTick (date X-axis label with unknown-input guard)', () => {
	test('formats a real Date as "Mon D"', () => {
		expect(formatDateTick(new Date(2024, 2, 15))).toBe('Mar 15');
	});

	test('returns empty string for non-Date / Invalid-Date input (the layerchart-callback guard)', () => {
		expect(formatDateTick(new Date('garbage'))).toBe('');
		expect(formatDateTick(42)).toBe('');
		expect(formatDateTick(null)).toBe('');
		expect(formatDateTick(undefined)).toBe('');
	});
});

describe('monthlyXAxisProps (monthly time-series axis wiring)', () => {
	test('wires a 12-tick budget (not the 6 default) and clamps to data length', () => {
		expect(monthlyXAxisProps(24).ticks).toBe(12);
		expect(monthlyXAxisProps(3).ticks).toBe(3);
		expect(typeof monthlyXAxisProps(3).format).toBe('function');
	});

	test('the wired format callback renders a 3-letter month and guards unknown input', () => {
		const format = monthlyXAxisProps(6).format;
		expect(format(new Date(2024, 2, 15))).toBe('Mar');
		expect(format(new Date('garbage'))).toBe('');
		expect(format(42)).toBe('');
		expect(format(null)).toBe('');
		expect(format(undefined)).toBe('');
	});
});

describe('getTrendLineProps (single-point visibility branch)', () => {
	test('a single (or zero) data point gets an enlarged filled dot so the lone value is visible', () => {
		expect(getTrendLineProps(1).points.r).toBe(6);
		expect(getTrendLineProps(0).points.r).toBe(6);
	});

	test('two or more points use the standard trend dot (r:4)', () => {
		expect(getTrendLineProps(2).points.r).toBe(4);
		expect(getTrendLineProps(12).points.r).toBe(4);
	});
});
