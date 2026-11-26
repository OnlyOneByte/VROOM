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
import {
	bucketBounds,
	bucketDate,
	bucketLabel,
	carPanels,
	emptyBuckets,
	exploreAnnotations,
	expensesNote,
	expensesQuery,
	kpis,
	percentChange,
	seriesFor
} from '../explore-data';

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
		expect(allowedSplits('cost')).toEqual([
			'none',
			'category',
			'vehicle',
			'fuelType',
			'tag',
			'driver'
		]);
		expect(allowedSplits('distance')).not.toContain('driver');
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

	test('a vehicle missing from the colour map falls back to the vehicle palette', () => {
		const byVehicle = { ...response, groupBy: 'vehicle' } as AnalyticsQueryResponse;
		const series = seriesFor(byVehicle, { fuel: 'var(--chart-1)' });
		expect(series.map(s => s.color)).toEqual(['var(--chart-1)', 'var(--chart-3)']);
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

	test('a month with no data is empty, and the averages skip it', () => {
		const gappy = {
			...response,
			buckets: ['2025-01', '2025-02', '2025-03'],
			series: [
				{ key: 'fuel', label: 'Fuel', values: [100, 0, 50] },
				{ key: 'misc', label: 'Misc', values: [20, null, 0] }
			],
			compare: {
				...response.compare,
				buckets: ['2024-01', '2024-02', '2024-03'],
				series: [{ key: 'fuel', label: 'Fuel', values: [0, 0, 60] }]
			}
		} as AnalyticsQueryResponse;
		expect(emptyBuckets(gappy.series, 3)).toEqual([false, true, false]);
		expect(emptyBuckets([{ values: [0, null] }], 2, false)).toEqual([false, true]);
		expect(kpis(DEFAULT_EXPLORE, gappy, new Set(['fuel']))).toMatchObject({
			total: 150,
			perBucket: 75,
			previousPerBucket: 60
		});
		expect(kpis(DEFAULT_EXPLORE, gappy, new Set(['misc'])).perBucket).toBe(20);
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

	test('Whole range shows every series, so hidden series are cleared', () => {
		const byCar = { ...applyPreset({ split: 'vehicle' }), hide: ['camry'] };
		expect(normalizeExplore({ ...byCar, per: 'none' }).hide).toEqual([]);
		expect(normalizeExplore(byCar).hide).toEqual(['camry']);
		expect(parseExplore(params('per=none&split=vehicle&hide=camry')).hide).toEqual([]);
	});
});

describe('drill-down selection', () => {
	test('the selected bucket and segment round-trip through the URL', () => {
		const query = { ...applyPreset({ split: 'vehicle' }), sel: '2025-03', seg: 'camry' };
		const url = writeExplore(new URL('https://x.test/analytics'), query);
		expect(url.searchParams.get('sel')).toBe('2025-03');
		expect(url.searchParams.get('seg')).toBe('camry');
		expect(parseExplore(url.searchParams)).toMatchObject({ sel: '2025-03', seg: 'camry' });
		const cleared = writeExplore(url, { ...query, sel: undefined, seg: undefined });
		expect(cleared.searchParams.has('sel')).toBe(false);
		expect(cleared.searchParams.has('seg')).toBe(false);
	});

	test('bucket bounds follow the interval and stay inside the range', () => {
		const range = {
			start: Math.floor(new Date(2025, 0, 15).getTime() / 1000),
			end: Math.floor(new Date(2025, 5, 1).getTime() / 1000)
		};
		const s = (d: Date) => Math.floor(d.getTime() / 1000);
		expect(bucketBounds('2025-01', 'month', range)).toEqual({
			start: range.start,
			end: s(new Date(2025, 1, 1))
		});
		expect(bucketBounds('2025-Q2', 'quarter', range)).toEqual({
			start: s(new Date(2025, 3, 1)),
			end: range.end
		});
		expect(bucketBounds('2025-03-03', 'week', range)).toEqual({
			start: s(new Date(2025, 2, 3)),
			end: s(new Date(2025, 2, 10))
		});
		expect(bucketBounds('total', 'none', range)).toEqual(range);
	});

	test('the Expenses link carries the car, category and the bucket days', () => {
		const start = Math.floor(new Date(2025, 2, 1).getTime() / 1000);
		const end = Math.floor(new Date(2025, 3, 1).getTime() / 1000);
		expect(expensesQuery({ start, end, vehicleId: 'camry', categories: ['fuel'] })).toBe(
			'?vehicleId=camry&category=fuel&startDate=2025-03-01&endDate=2025-03-31'
		);
		expect(expensesQuery({ start, end })).toBe('?startDate=2025-03-01&endDate=2025-03-31');
		expect(expensesQuery({ start, end, tag: 'road trip' })).toBe(
			'?tags=road+trip&startDate=2025-03-01&endDate=2025-03-31'
		);
	});

	test('the Expenses link carries a list of categories', () => {
		const start = Math.floor(new Date(2025, 2, 1).getTime() / 1000);
		const end = Math.floor(new Date(2025, 3, 1).getTime() / 1000);
		expect(expensesQuery({ start, end, categories: ['fuel', 'misc'] })).toBe(
			'?category=fuel%2Cmisc&startDate=2025-03-01&endDate=2025-03-31'
		);
	});

	test('the Expenses note names what the link cannot narrow to', () => {
		expect(expensesNote({ split: 'none', cars: 0, energy: false })).toBeUndefined();
		expect(
			expensesNote({ split: 'category', keys: ['fuel'], cars: 1, energy: false })
		).toBeUndefined();
		expect(expensesNote({ split: 'vehicle', keys: ['a', 'b'], cars: 2, energy: false })).toBe(
			'Expenses also lists your other cars for these dates.'
		);
		expect(expensesNote({ split: 'fuelType', keys: ['Regular'], cars: 2, energy: false })).toBe(
			'Expenses also lists your other cars and other fuel types for these dates.'
		);
		expect(expensesNote({ split: 'none', cars: 0, energy: true })).toBe(
			'Expenses also lists other fuel types for these dates.'
		);
		expect(expensesNote({ split: 'tag', keys: [''], cars: 3, energy: false })).toBe(
			'Expenses also lists your other cars and tagged expenses for these dates.'
		);
	});
});

describe('each car on its own', () => {
	test('splits by car, asks for the period before, and draws panels', () => {
		const query = parseExplore(new URLSearchParams('metric=costPerDistance&compare=cars'));
		expect(query.split).toBe('vehicle');
		expect(allowedSplits('cost', 'cars')).toEqual(['vehicle']);
		expect(apiQuery(query)).toMatchObject({ groupBy: 'vehicle', compare: 'prevPeriod' });
		expect(chartForm(query)).toBe('panels');
		expect(chartForm({ ...query, per: 'none' })).toBe('ranking');
		expect(describeQuery(query)).toBe('Cost per mile per month by car, each car on its own');
	});

	test('panels share one scale, and the fleet average is over every car', () => {
		const series = (key: string, values: Array<number | null>) => ({
			key,
			sourceKey: key,
			label: key,
			color: 'red',
			values
		});
		const { yDomain, fleetMean, panels } = carPanels([
			series('a', [10, 30, null]),
			series('b', [20, null, null])
		]);
		expect(yDomain).toEqual([0, 30]);
		expect(fleetMean).toBe(20);
		expect(panels.map(p => p.mean)).toEqual([20, 20]);
		expect(carPanels([series('empty', [null])]).yDomain).toEqual([0, 1]);
	});

	test('a month no car has data for is left out of every average', () => {
		const series = (key: string, values: Array<number | null>) => ({
			key,
			sourceKey: key,
			label: key,
			color: 'red',
			values
		});
		const cars = [series('a', [100, 0, 50]), series('b', [20, 0, 0])];
		const empty = emptyBuckets(cars, 3);
		expect(empty).toEqual([false, true, false]);
		const { fleetMean, panels } = carPanels(cars, undefined, empty);
		expect(panels.map(p => p.mean)).toEqual([75, 10]);
		expect(fleetMean).toBe(42.5);
	});

	test('ratio panels use each car pooled over the range, and the scale fits the fleet line', () => {
		const series = (key: string, values: Array<number | null>) => ({
			key,
			sourceKey: key,
			label: key,
			color: 'red',
			values
		});
		const pooled = carPanels([series('a', [0.1, 0.78]), series('b', [0.2, 0.2])], {
			fleet: 0.9,
			cars: { a: 0.15, b: 0.2 }
		});
		expect(pooled.panels.map(p => p.mean)).toEqual([0.15, 0.2]);
		expect(pooled.fleetMean).toBe(0.9);
		expect(pooled.yDomain).toEqual([0, 0.9]);
	});

	test('switching to each car clears hidden cars, and the whole range reads plainly', () => {
		const query = parseExplore(new URLSearchParams('split=vehicle&hide=camry&compare=cars'));
		expect(query.hide).toEqual([]);
		expect(describeQuery({ ...query, per: 'none' })).toBe('Total cost over the whole range by car');
	});
});

describe('services and trips on the time charts', () => {
	const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
	const service = (iso: string, vehicleName: string, label: string, amount: number) => ({
		t: at(iso),
		kind: 'service' as const,
		vehicleId: vehicleName,
		vehicleName,
		label,
		amount
	});
	const response = {
		buckets: ['2026-01', '2026-02', '2026-03'],
		range: { start: at('2026-01-01T00:00:00'), end: at('2026-04-01T00:00:00') },
		annotations: [
			service('2026-01-10T12:00:00', 'Camry', 'Oil change', 75),
			service('2026-03-02T12:00:00', 'Camry', 'Brakes', 300),
			service('2026-03-20T12:00:00', 'Civic', 'Tires', 640)
		],
		trips: { count: [0, 2, 0], distance: [0, 41.6, 0] }
	};
	const options = {
		atFor: (i: number) => response.buckets[i],
		money: (n: number) => `$${n}`,
		distanceUnit: 'mi'
	};

	test('one marker per month that had service, and a trip strip', () => {
		const result = exploreAnnotations(response, 'month', options);
		expect(result?.markers).toEqual([
			{ at: '2026-01', label: 'Oil change', detail: 'Camry, $75' },
			{
				at: '2026-03',
				label: '2 services',
				detail: 'Brakes, Camry, $300; Tires, Civic, $640',
				rows: ['Brakes: Camry, $300', 'Tires: Civic, $640']
			}
		]);
		expect(result?.note).toBeUndefined();
		expect(
			exploreAnnotations({ ...response, annotationsTruncated: true }, 'month', options)?.note
		).toMatch(/Only the latest services/);
		expect(result?.density?.map(d => d.label)).toEqual(['No trips', '2 trips, 42 mi', 'No trips']);
		expect(result?.formatAt('2026-03')).toBe(bucketLabel('2026-03', 'month'));
	});

	test('nothing for the whole range, or when there is nothing to show', () => {
		expect(exploreAnnotations(response, 'none', options)).toBeUndefined();
		const quiet = {
			...response,
			annotations: [],
			trips: { count: [0, 0, 0], distance: [0, 0, 0] }
		};
		expect(exploreAnnotations(quiet, 'month', options)).toBeUndefined();
	});
});
