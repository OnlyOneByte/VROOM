import type {
	AnalyticsQueryCompare,
	AnalyticsQueryEnergy,
	AnalyticsQueryGroupBy,
	AnalyticsQueryInclude,
	AnalyticsQueryInterval,
	AnalyticsQueryMetric
} from '#lib/types/index.ts';

export const EXPLORE_METRICS = [
	{ value: 'cost', label: 'Total cost', metric: 'cost' },
	{ value: 'costPerDistance', label: 'Cost per mile', metric: 'costPerDistance' },
	{ value: 'distance', label: 'Distance driven', metric: 'distance' },
	{ value: 'fuel', label: 'Fuel bought', metric: 'volume', energy: 'fuel' },
	{ value: 'charge', label: 'Energy charged', metric: 'volume', energy: 'electric' },
	{ value: 'mpg', label: 'Fuel efficiency', metric: 'efficiency', energy: 'fuel' },
	{ value: 'evEfficiency', label: 'Charging efficiency', metric: 'efficiency', energy: 'electric' },
	{ value: 'count', label: 'Number of expenses', metric: 'count' }
] as const satisfies ReadonlyArray<{
	value: string;
	label: string;
	metric: AnalyticsQueryMetric;
	energy?: AnalyticsQueryEnergy;
}>;

export const EXPLORE_INTERVALS = [
	{ value: 'week', label: 'Week' },
	{ value: 'month', label: 'Month' },
	{ value: 'quarter', label: 'Quarter' },
	{ value: 'year', label: 'Year' },
	{ value: 'none', label: 'Whole range' }
] as const satisfies ReadonlyArray<{ value: AnalyticsQueryInterval; label: string }>;

export const EXPLORE_SPLITS = [
	{ value: 'none', label: 'Nothing' },
	{ value: 'category', label: 'Category' },
	{ value: 'vehicle', label: 'Car' },
	{ value: 'fuelType', label: 'Fuel type' },
	{ value: 'tag', label: 'Tag' }
] as const satisfies ReadonlyArray<{ value: AnalyticsQueryGroupBy; label: string }>;

export const EXPLORE_COMPARES = [
	{ value: 'none', label: 'No comparison' },
	{ value: 'prevPeriod', label: 'The period before' },
	{ value: 'prevYear', label: 'The year before' }
] as const satisfies ReadonlyArray<{ value: AnalyticsQueryCompare; label: string }>;

export type ExploreMetric = (typeof EXPLORE_METRICS)[number]['value'];

export interface ExploreQuery {
	metric: ExploreMetric;
	per: AnalyticsQueryInterval;
	split: AnalyticsQueryGroupBy;
	inc: AnalyticsQueryInclude;
	compare: AnalyticsQueryCompare;
	hide: string[];
}

export const DEFAULT_EXPLORE: ExploreQuery = {
	metric: 'cost',
	per: 'month',
	split: 'category',
	inc: 'running',
	compare: 'none',
	hide: []
};

const SPLITS_FOR_METRIC: Record<AnalyticsQueryMetric, readonly AnalyticsQueryGroupBy[]> = {
	cost: ['none', 'category', 'vehicle', 'fuelType', 'tag'],
	count: ['none', 'category', 'vehicle', 'fuelType', 'tag'],
	costPerDistance: ['none', 'vehicle', 'category'],
	distance: ['none', 'vehicle'],
	volume: ['none', 'vehicle', 'fuelType'],
	efficiency: ['none', 'vehicle', 'fuelType']
};

export const EXPLORE_PRESETS = [
	{ id: 'money', label: 'Where the money goes', query: {} },
	{
		id: 'per-distance',
		label: 'Cost per mile',
		query: { metric: 'costPerDistance', split: 'vehicle' }
	},
	{
		id: 'fuel-vs-charging',
		label: 'Fuel vs charging',
		query: { split: 'fuelType' }
	},
	{
		id: 'year-vs-year',
		label: 'This year vs last',
		query: { split: 'none', compare: 'prevYear' }
	},
	{
		id: 'seasons',
		label: 'Seasons',
		query: { metric: 'mpg', per: 'quarter', split: 'vehicle' }
	}
] as const satisfies ReadonlyArray<{ id: string; label: string; query: Partial<ExploreQuery> }>;

const PARAMS = ['metric', 'per', 'split', 'inc', 'compare', 'hide'] as const;

function pick<T extends string>(
	value: string | null,
	options: ReadonlyArray<{ value: T }>,
	fallback: T
): T {
	return options.find(o => o.value === value)?.value ?? fallback;
}

export function metricInfo(metric: ExploreMetric) {
	return EXPLORE_METRICS.find(m => m.value === metric) ?? EXPLORE_METRICS[0];
}

export function metricLabel(metric: ExploreMetric, distance = 'mile'): string {
	return metric === 'costPerDistance' ? `Cost per ${distance}` : metricInfo(metric).label;
}

export function allowedSplits(
	metric: ExploreMetric,
	compare: AnalyticsQueryCompare = 'none'
): readonly AnalyticsQueryGroupBy[] {
	return compare === 'none' ? SPLITS_FOR_METRIC[metricInfo(metric).metric] : ['none'];
}

export function normalizeExplore(query: ExploreQuery): ExploreQuery {
	const splits = allowedSplits(query.metric, query.compare);
	return splits.includes(query.split) ? query : { ...query, split: 'none', hide: [] };
}

export function parseExplore(params: Pick<URLSearchParams, 'get'>): ExploreQuery {
	return normalizeExplore({
		metric: pick(params.get('metric'), EXPLORE_METRICS, DEFAULT_EXPLORE.metric),
		per: pick(params.get('per'), EXPLORE_INTERVALS, DEFAULT_EXPLORE.per),
		split: pick(params.get('split'), EXPLORE_SPLITS, DEFAULT_EXPLORE.split),
		inc: params.get('inc') === 'all' ? 'all' : 'running',
		compare: pick(params.get('compare'), EXPLORE_COMPARES, DEFAULT_EXPLORE.compare),
		hide: (params.get('hide') ?? '')
			.split(',')
			.map(key => key.trim())
			.filter(Boolean)
	});
}

export function writeExplore(url: { href: string }, query: ExploreQuery): URL {
	const next = new URL(url.href);
	for (const key of PARAMS) next.searchParams.delete(key);
	for (const key of PARAMS) {
		const value = key === 'hide' ? query.hide.join(',') : query[key];
		const fallback = key === 'hide' ? '' : DEFAULT_EXPLORE[key];
		if (value && value !== fallback) next.searchParams.set(key, value);
	}
	return next;
}

export function applyPreset(query: Partial<ExploreQuery>): ExploreQuery {
	return normalizeExplore({ ...DEFAULT_EXPLORE, ...query, hide: [] });
}

export function activePreset(query: ExploreQuery): string | null {
	return (
		EXPLORE_PRESETS.find(p => {
			const preset = applyPreset(p.query);
			return (Object.keys(DEFAULT_EXPLORE) as Array<keyof ExploreQuery>).every(key =>
				key === 'hide' ? true : preset[key] === query[key]
			);
		})?.id ?? null
	);
}

export function apiQuery(query: ExploreQuery) {
	const info = metricInfo(query.metric);
	return {
		metric: info.metric,
		energy: 'energy' in info ? info.energy : undefined,
		interval: query.per,
		groupBy: query.split,
		include: query.inc,
		compare: query.compare === 'none' ? 'prevPeriod' : query.compare
	} as const;
}

export type ChartForm = 'stacked' | 'grouped' | 'bars' | 'line' | 'ranking' | 'compare';

export function chartForm(query: ExploreQuery): ChartForm {
	const ratio = ['costPerDistance', 'efficiency'].includes(metricInfo(query.metric).metric);
	if (query.per === 'none') return 'ranking';
	if (query.compare !== 'none') return 'compare';
	if (ratio) return 'line';
	if (query.split === 'tag') return 'grouped';
	return query.split === 'none' ? 'bars' : 'stacked';
}

export function describeQuery(query: ExploreQuery, distance = 'mile'): string {
	const metric = metricLabel(query.metric, distance);
	const per = EXPLORE_INTERVALS.find(i => i.value === query.per)?.label.toLowerCase();
	const split = EXPLORE_SPLITS.find(s => s.value === query.split)?.label.toLowerCase();
	const time = query.per === 'none' ? 'over the whole range' : `per ${per}`;
	const by = query.split === 'none' ? '' : ` by ${split}`;
	const versus =
		query.compare === 'none'
			? ''
			: `, against ${EXPLORE_COMPARES.find(c => c.value === query.compare)?.label.toLowerCase()}`;
	return `${metric} ${time}${by}${versus}`;
}
