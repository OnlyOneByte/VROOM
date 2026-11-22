import { describe, expect, test } from 'vitest';
import { scaleTime } from 'd3-scale';
import {
	formatCentsAxis,
	formatCountTooltip,
	formatCurrencyAxis,
	formatCurrencyTooltip,
	formatDateTick,
	formatDayLabel,
	formatMonthLabel,
	unitTooltip,
	formatDecimalAxis,
	getTrendLineProps,
	insetTimeTicks,
	isolatedValueRows,
	getXTickCount,
	monthlyXAxisProps,
	parseMonthToDate,
	TIME_X_PADDING
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
	test('wires a 4-tick budget and clamps to data length', () => {
		expect(monthlyXAxisProps(13).ticks).toBe(4);
		expect(monthlyXAxisProps(3).ticks).toBe(3);
		expect(typeof monthlyXAxisProps(3).format).toBe('function');
	});

	test.each([10, 11, 12, 13])(
		'%i months of points draw at most 5 month labels on a time scale',
		months => {
			const scale = scaleTime().domain([new Date(2025, 0, 1), new Date(2025, months - 1, 1)]);
			expect(scale.ticks(monthlyXAxisProps(months).ticks).length).toBeLessThanOrEqual(5);
		}
	);

	test.each([13, 25, 36, 48])('%i months of points never repeat a label back to back', months => {
		const { ticks, format } = monthlyXAxisProps(months);
		const scale = scaleTime().domain([new Date(2022, 0, 1), new Date(2022, months - 1, 1)]);
		const labels = scale.ticks(ticks).map(format);
		expect(labels.length).toBeGreaterThan(1);
		labels.slice(1).forEach((label, i) => expect(label).not.toBe(labels[i]));
	});

	test('a January tick shows its year', () => {
		expect(monthlyXAxisProps(6).format(new Date(2025, 0, 1))).toBe('2025');
	});

	test('a caller can set its own tick budget', () => {
		expect(monthlyXAxisProps(24, 12).ticks).toBe(12);
		expect(monthlyXAxisProps(4, 12).ticks).toBe(4);
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

describe('isolatedValueRows (which values need a marker)', () => {
	const months = (...cells: (number | null | undefined)[]) =>
		cells.map((v, i) => (v === undefined ? { month: i } : { month: i, a: v }));
	const marked = (rows: Record<string, unknown>[]) =>
		isolatedValueRows(rows, ['a'])[0]?.rows.map(r => r['month']) ?? [];

	test('marks values with no value on either side, and leaves connected runs to the line', () => {
		expect(marked(months(5, null, 7, 8, undefined, 9))).toEqual([0, 5]);
	});

	test('a series with values two months apart gets both marked', () => {
		expect(marked(months(undefined, 30, undefined, 32))).toEqual([1, 3]);
	});

	test('a single value among many rows, and a one-row chart, are marked', () => {
		expect(marked(months(null, null, 4, null))).toEqual([2]);
		expect(marked(months(4))).toEqual([0]);
	});

	test('treats 0 as a value, and returns only series that have something to mark', () => {
		expect(marked(months(0, null, 0))).toEqual([0, 2]);
		const rows = [
			{ civic: 40, tesla: null },
			{ civic: 42, tesla: 12 },
			{ civic: 41, tesla: null }
		];
		expect(isolatedValueRows(rows, ['civic', 'tesla']).map(s => s.key)).toEqual(['tesla']);
		expect(isolatedValueRows([], ['a'])).toEqual([]);
	});
});

describe('chart tooltip formatters (full precision, in the axis unit)', () => {
	test('currency tooltips keep the symbol and cents the axis rounds away', () => {
		expect(formatCurrencyTooltip(591.27)).toBe('$591.27');
		expect(formatCurrencyTooltip(337.092)).toBe('$337.09');
		expect(formatCurrencyTooltip(11336.56)).toBe('$11,336.56');
	});

	test('unit tooltips round to the requested decimals and name the unit', () => {
		expect(unitTooltip('mi/gal')(39.416, 'avgEfficiency')).toBe('39.4 mi/gal');
		expect(unitTooltip('mi', 0)(45210.6, 'odometer')).toBe('45,211 mi');
	});

	test('count tooltips are whole numbers', () => {
		expect(formatCountTooltip(3)).toBe('3');
		expect(formatCountTooltip(1200)).toBe('1,200');
	});

	test('month and day labels name the point in local time', () => {
		expect(formatMonthLabel(parseMonthToDate('2025-11'))).toBe('Nov 2025');
		expect(formatDayLabel(new Date(2025, 10, 21))).toBe('Nov 21, 2025');
	});

	test('category labels pass through and missing labels render empty', () => {
		expect(formatMonthLabel('Civic')).toBe('Civic');
		expect(formatDayLabel('Winter')).toBe('Winter');
		expect(formatMonthLabel(undefined)).toBe('');
		expect(formatDayLabel(new Date('nope'))).toBe('');
	});
});

describe('insetTimeTicks (no x label inside the inset under the y labels)', () => {
	const scale = scaleTime()
		.domain([new Date(2024, 11, 28), new Date(2025, 3, 5)])
		.range([0, 241]);

	test('drops a tick the inset pulled under the y axis and keeps the rest', () => {
		const ticks = insetTimeTicks(4) as (s: typeof scale) => Date[];
		expect(scale(new Date(2025, 0, 1))).toBeLessThan(TIME_X_PADDING[0]);
		const kept = ticks(scale);
		expect(kept.map(t => t.getMonth())).toEqual([1, 2, 3]);
		expect(kept.every(t => scale(t) >= TIME_X_PADDING[0])).toBe(true);
	});

	test('explicit tick lists and missing counts pass through unchanged', () => {
		const list = [new Date(2025, 0, 1)];
		expect(insetTimeTicks(list)).toBe(list);
		expect(insetTimeTicks(undefined)).toBeUndefined();
	});
});
