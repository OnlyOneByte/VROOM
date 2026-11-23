import { describe, expect, test } from 'vitest';
import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
import {
	DEFAULT_EXPLORE,
	EXPLORE_METRICS,
	EXPLORE_PRESETS,
	EXPLORE_SPLITS,
	activePreset,
	allowedSplits,
	apiQuery,
	applyPreset,
	chartForm,
	describeQuery,
	metricLabel,
	normalizeExplore,
	parseExplore,
	writeExplore
} from '../query-state';
import { bucketDate, bucketLabel, kpis, percentChange, seriesFor } from '../explore-data';

const params = (query: string) => new URLSearchParams(query);

describe('Explore query in the URL', () => {
	test('no params is "where the money goes"', () => {
		expect(parseExplore(params(''))).toEqual(DEFAULT_EXPLORE);
		expect(activePreset(DEFAULT_EXPLORE)).toBe('money');
	});

	test('every preset round-trips through the URL and is recognised', () => {
		for (const preset of EXPLORE_PRESETS) {
			const query = applyPreset(preset.query);
			const url = writeExplore(new URL('https://x.test/analytics?range=3m'), query);
			expect(url.searchParams.get('range')).toBe('3m');
			expect(parseExplore(url.searchParams)).toEqual(query);
			expect(activePreset(query)).toBe(preset.id);
		}
	});

	test('defaults stay out of the URL and hidden series are kept', () => {
		const url = writeExplore(new URL('https://x.test/analytics?metric=count'), {
			...DEFAULT_EXPLORE,
			hide: ['misc', 'fuel']
		});
		expect(url.search).toBe('?hide=misc%2Cfuel');
		expect(parseExplore(url.searchParams).hide).toEqual(['misc', 'fuel']);
	});

	test('unknown values fall back, and a split the metric cannot take becomes none', () => {
		expect(parseExplore(params('metric=speed&per=decade&split=colour'))).toEqual({
			...DEFAULT_EXPLORE
		});
		const query = parseExplore(params('metric=mpg&split=category&hide=x'));
		expect(query.split).toBe('none');
		expect(query.hide).toEqual([]);
	});

	test('at least six measures and four splits are on offer', () => {
		expect(EXPLORE_METRICS.length).toBeGreaterThanOrEqual(6);
		expect(EXPLORE_SPLITS.filter(s => s.value !== 'none').length).toBeGreaterThanOrEqual(4);
		expect(allowedSplits('cost')).toEqual(['none', 'category', 'vehicle', 'fuelType', 'tag']);
	});

	test('the API request maps the measure and always asks for a comparison', () => {
		expect(apiQuery(applyPreset({ metric: 'evEfficiency', split: 'vehicle' }))).toEqual({
			metric: 'efficiency',
			energy: 'electric',
			interval: 'month',
			groupBy: 'vehicle',
			include: 'running',
			compare: 'prevPeriod'
		});
		expect(apiQuery(applyPreset({ compare: 'prevYear', inc: 'all' }))).toMatchObject({
			compare: 'prevYear',
			include: 'all',
			energy: undefined
		});
	});

	test('the chart form follows the query', () => {
		expect(chartForm(DEFAULT_EXPLORE)).toBe('stacked');
		expect(chartForm(applyPreset({ split: 'none' }))).toBe('bars');
		expect(chartForm(applyPreset({ metric: 'costPerDistance', split: 'vehicle' }))).toBe('line');
		expect(chartForm(applyPreset({ per: 'none' }))).toBe('ranking');
		expect(chartForm(applyPreset({ compare: 'prevYear' }))).toBe('compare');
	});

	test('the query reads as a sentence', () => {
		expect(describeQuery(DEFAULT_EXPLORE)).toBe('Total cost per month by category');
		expect(describeQuery(applyPreset({ per: 'none', split: 'vehicle' }))).toBe(
			'Total cost over the whole range by car'
		);
		expect(describeQuery(applyPreset({ split: 'none', compare: 'prevYear' }))).toBe(
			'Total cost per month, against the year before'
		);
	});
});

describe('Explore chart data', () => {
	test('bucket keys become dates and short labels', () => {
		expect(bucketDate('2025-03')).toEqual(new Date(2025, 2, 1));
		expect(bucketDate('2025-Q3')).toEqual(new Date(2025, 6, 1));
		expect(bucketDate('2025-03-10')).toEqual(new Date(2025, 2, 10));
		expect(bucketLabel('2025-Q3', 'quarter')).toBe('Q3 2025');
		expect(bucketLabel('2025', 'year')).toBe('2025');
		expect(bucketLabel('total', 'none')).toBe('Whole range');
	});

	const response = {
		metric: 'cost',
		unit: 'USD',
		interval: 'month',
		groupBy: 'category',
		range: { start: 0, end: 1 },
		buckets: ['2025-01', '2025-02'],
		series: [
			{ key: 'fuel', label: 'Fuel', values: [100, 50] },
			{ key: 'misc', label: 'Misc', values: [20, 30] }
		],
		totals: { value: 200, perBucket: 100, perDistance: 0.5, distance: 400 },
		compare: {
			range: { start: 0, end: 1 },
			buckets: ['2024-11', '2024-12'],
			series: [{ key: 'fuel', label: 'Fuel', values: [40, 40] }],
			totals: { value: 80, perBucket: 40, perDistance: null, distance: 0 }
		}
	} as AnalyticsQueryResponse;

	test('series get safe keys, category labels and colours', () => {
		const series = seriesFor(response);
		expect(series.map(s => s.key)).toEqual(['s0', 's1']);
		expect(series[0]?.label).toBe('Fuel & Charging');
		expect(series[0]?.color).toMatch(/^var\(--/);
	});

	test('hiding a series updates the additive KPIs', () => {
		const all = kpis(DEFAULT_EXPLORE, response, new Set(['fuel', 'misc']));
		expect(all).toEqual({ total: 200, perBucket: 100, previousPerBucket: 40, perDistance: 0.5 });
		const fuelOnly = kpis(DEFAULT_EXPLORE, response, new Set(['fuel']));
		expect(fuelOnly).toEqual({
			total: 150,
			perBucket: 75,
			previousPerBucket: 40,
			perDistance: 150 / 400
		});
		const ratio = kpis(applyPreset({ metric: 'mpg' }), response, new Set(['fuel']));
		expect(ratio.total).toBe(200);
	});

	test('percent change needs a non-zero previous value', () => {
		expect(percentChange(75, 50)).toBe(50);
		expect(percentChange(25, 50)).toBe(-50);
		expect(percentChange(25, 0)).toBeNull();
		expect(percentChange(null, 10)).toBeNull();
	});

	test('a comparison draws one total line, so ratios are never added up', () => {
		const seasons = normalizeExplore({
			...applyPreset({ metric: 'mpg', split: 'vehicle' }),
			compare: 'prevYear'
		});
		expect(seasons.split).toBe('none');
		expect(allowedSplits('cost', 'prevPeriod')).toEqual(['none']);
		expect(
			parseExplore(params('metric=costPerDistance&split=vehicle&compare=prevYear')).split
		).toBe('none');
	});

	test('tags draw as grouped bars and their KPIs stay the server totals', () => {
		const tags = applyPreset({ split: 'tag' });
		expect(chartForm(tags)).toBe('grouped');
		const tagResponse = { ...response, groupBy: 'tag' } as AnalyticsQueryResponse;
		expect(kpis(tags, tagResponse, new Set(['fuel'])).total).toBe(200);
	});

	test('per distance is dropped when a car is hidden from a car split', () => {
		const byCar = applyPreset({ split: 'vehicle' });
		expect(kpis(byCar, response, new Set(['fuel'])).perDistance).toBeNull();
	});

	test('the cost-per-distance measure names the user unit', () => {
		expect(metricLabel('costPerDistance')).toBe('Cost per mile');
		expect(metricLabel('costPerDistance', 'km')).toBe('Cost per km');
		expect(describeQuery(applyPreset({ metric: 'costPerDistance', split: 'vehicle' }), 'km')).toBe(
			'Cost per km per month by car'
		);
	});
});
