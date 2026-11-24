import { describe, expect, test } from 'vitest';
import { buildChartA11y, rowAnnouncement } from '../chart-a11y.ts';
import {
	formatCurrencyTooltip,
	formatDayLabel,
	formatMonthLabel
} from '#lib/utils/chart-formatters.ts';

const AMOUNT = [{ key: 'amount', label: 'Amount' }];

function build(
	data: Record<string, unknown>[],
	extra: Partial<Parameters<typeof buildChartA11y>[0]> = {}
) {
	return buildChartA11y({
		title: 'Spending',
		data,
		categoryKey: 'date',
		series: AMOUNT,
		labelFormat: formatMonthLabel,
		valueFormat: formatCurrencyTooltip,
		...extra
	});
}

describe('buildChartA11y', () => {
	test('a flat series says every value once instead of the same highest and lowest', () => {
		const a11y = build([
			{ date: new Date(2026, 0, 1), amount: 350 },
			{ date: new Date(2026, 1, 1), amount: 350 }
		]);
		expect(a11y.summary).toBe('Spending: 2 points, Jan 2026 to Feb 2026. Every value: $350.00.');
	});

	test('one point names it without a range or a lowest', () => {
		const a11y = build([{ date: new Date(2026, 0, 1), amount: 12 }]);
		expect(a11y.summary).toBe('Spending: Jan 2026. Highest: Jan 2026, $12.00.');
	});

	test('the table and the step announcement get what the tooltip shows; the summary stays plain', () => {
		const a11y = build(
			[
				{ date: new Date(2026, 0, 1), amount: 150, before: 100 },
				{ date: new Date(2026, 1, 1), amount: 80, before: null }
			],
			{
				valueFormat: (value, _key, row) =>
					typeof row?.['before'] === 'number' ? `$${value} (vs $${row['before']})` : `$${value}`
			}
		);
		expect(a11y.rows.map(r => r.cells[0])).toEqual(['$150 (vs $100)', '$80']);
		expect(rowAnnouncement(a11y, 0)).toBe('Jan 2026: $150 (vs $100). 1 of 2.');
		expect(a11y.summary).toContain('Highest: Jan 2026, $150.');
	});

	test('missing values show a dash and never count as the lowest', () => {
		const a11y = build([
			{ date: new Date(2026, 0, 1), amount: 5 },
			{ date: new Date(2026, 1, 1), amount: null },
			{ date: new Date(2026, 2, 1), amount: 9 }
		]);
		expect(a11y.rows.map(r => r.cells[0])).toEqual(['$5.00', 'No data', '$9.00']);
		expect(a11y.summary).toContain('Lowest: Jan 2026, $5.00.');
	});

	test('non-date categories are counted, not given a range', () => {
		const a11y = build(
			[
				{ season: 'Winter', amount: 3 },
				{ season: 'Summer', amount: 7 }
			],
			{ categoryKey: 'season' }
		);
		expect(a11y.categoryLabel).toBe('Category');
		expect(a11y.summary).toBe(
			'Spending: 2 categories. Highest: Summer, $7.00. Lowest: Winter, $3.00.'
		);
	});

	test('the category column is Month for monthly labels, Date for daily ones, or the caller name', () => {
		const data = [{ date: new Date(2026, 0, 1), amount: 1 }];
		expect(build(data).categoryLabel).toBe('Month');
		expect(build(data, { labelFormat: formatDayLabel }).categoryLabel).toBe('Date');
		expect(build(data, { categoryLabel: 'Fill-up' }).categoryLabel).toBe('Fill-up');
	});

	test('multi-series announcements name each series', () => {
		const a11y = build([{ date: new Date(2026, 0, 1), fuel: 10, misc: 2 }], {
			series: [
				{ key: 'fuel', label: 'Fuel' },
				{ key: 'misc', label: 'Misc' }
			]
		});
		expect(rowAnnouncement(a11y, 0)).toBe('Jan 2026. Fuel: $10.00. Misc: $2.00. 1 of 1.');
		expect(rowAnnouncement(a11y, 5)).toBe('');
	});
});
