import { analyticsApi } from '#lib/services/analytics-api.ts';
import type {
	AnalyticsQueryCompare,
	AnalyticsQueryEnergy,
	AnalyticsQueryGroupBy,
	AnalyticsQueryInclude,
	AnalyticsQueryInterval,
	AnalyticsQueryMetric,
	AnalyticsQueryResponse
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
	{ value: 'tag', label: 'Tag' },
	{ value: 'driver', label: 'Who paid' }
] as const satisfies ReadonlyArray<{ value: AnalyticsQueryGroupBy; label: string }>;

export const EXPLORE_COMPARES = [
	{ value: 'none', label: 'No comparison' },
	{ value: 'prevPeriod', label: 'The period before' },
	{ value: 'prevYear', label: 'The year before' },
	{ value: 'cars', label: 'Each car on its own' }
] as const satisfies ReadonlyArray<{ value: ExploreCompare; label: string }>;

export type ExploreCompare = AnalyticsQueryCompare | 'cars';

export type ExploreMetric = (typeof EXPLORE_METRICS)[number]['value'];

export interface ExploreQuery {
	metric: ExploreMetric;
	per: AnalyticsQueryInterval;
	split: AnalyticsQueryGroupBy;
	inc: AnalyticsQueryInclude;
	compare: ExploreCompare;
	hide: string[];
	sel?: string;
	seg?: string;
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
	cost: ['none', 'category', 'vehicle', 'fuelType', 'tag', 'driver'],
	count: ['none', 'category', 'vehicle', 'fuelType', 'tag', 'driver'],
	costPerDistance: ['none', 'vehicle', 'category'],
	distance: ['none', 'vehicle'],
	volume: ['none', 'vehicle', 'fuelType'],
	efficiency: ['none', 'vehicle', 'fuelType']
};

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
	compare: ExploreCompare = 'none'
): readonly AnalyticsQueryGroupBy[] {
	if (compare === 'cars') return ['vehicle'];
	return compare === 'none' ? SPLITS_FOR_METRIC[metricInfo(metric).metric] : ['none'];
}

export function normalizeExplore(query: ExploreQuery): ExploreQuery {
	const splits = allowedSplits(query.metric, query.compare);
	const next: ExploreQuery = splits.includes(query.split)
		? query
		: { ...query, split: splits[0] ?? 'none', hide: [] };
	const clear = ['ranking', 'panels'].includes(chartForm(next));
	return clear && next.hide.length > 0 ? { ...next, hide: [] } : next;
}

export function parseExplore(params: Pick<URLSearchParams, 'get'>): ExploreQuery {
	return normalizeExplore({
		metric: pick(params.get('metric'), EXPLORE_METRICS, DEFAULT_EXPLORE.metric),
		per: pick(params.get('per'), EXPLORE_INTERVALS, DEFAULT_EXPLORE.per),
		split: pick(params.get('split'), EXPLORE_SPLITS, DEFAULT_EXPLORE.split),
		inc: params.get('inc') === 'all' ? 'all' : 'running',
		compare: pick(params.get('compare'), EXPLORE_COMPARES, DEFAULT_EXPLORE.compare),
		sel: params.get('sel')?.trim() || undefined,
		seg: params.get('seg') ?? undefined,
		hide: (params.get('hide') ?? '')
			.split(',')
			.map(key => key.trim())
			.filter(Boolean)
	});
}

export function writeExplore(url: { href: string }, query: ExploreQuery): URL {
	const next = new URL(url.href);
	for (const key of [...PARAMS, 'sel', 'seg']) next.searchParams.delete(key);
	for (const key of PARAMS) {
		const value = key === 'hide' ? query.hide.join(',') : query[key];
		const fallback = key === 'hide' ? '' : DEFAULT_EXPLORE[key];
		if (value && value !== fallback) next.searchParams.set(key, value);
	}
	if (query.sel) {
		next.searchParams.set('sel', query.sel);
		if (query.seg !== undefined) next.searchParams.set('seg', query.seg);
	}
	return next;
}

export function applyPreset(query: Partial<ExploreQuery>): ExploreQuery {
	return normalizeExplore({ ...DEFAULT_EXPLORE, ...query, hide: [] });
}

export function apiQuery(query: ExploreQuery) {
	const info = metricInfo(query.metric);
	return {
		metric: info.metric,
		energy: 'energy' in info ? info.energy : undefined,
		interval: query.per,
		groupBy: query.split,
		include: query.inc,
		compare: query.compare === 'none' || query.compare === 'cars' ? 'prevPeriod' : query.compare
	} as const;
}

export function exploreRequest(
	query: ExploreQuery,
	range: { startDate: number; endDate: number },
	vehicleIds?: string[]
) {
	return {
		...apiQuery(query),
		start: range.startDate,
		end: range.endDate,
		vehicleIds,
		...(['bars', 'stacked', 'grouped', 'line'].includes(chartForm(query)) && {
			annotations: ['services', 'trips'] as Array<'services' | 'trips'>
		})
	};
}

const prefetched = new Map<string, Promise<AnalyticsQueryResponse>>();

export function prefetchExplore(params: ReturnType<typeof exploreRequest>): void {
	const key = JSON.stringify(params);
	if (prefetched.has(key)) return;
	const pending = analyticsApi.query(params);
	pending.catch(() => {});
	prefetched.set(key, pending);
}

export function takePrefetched(key: string): Promise<AnalyticsQueryResponse> | undefined {
	const pending = prefetched.get(key);
	prefetched.delete(key);
	return pending;
}

export type ChartForm = 'stacked' | 'grouped' | 'bars' | 'line' | 'ranking' | 'compare' | 'panels';

export function chartForm(query: ExploreQuery): ChartForm {
	const ratio = ['costPerDistance', 'efficiency'].includes(metricInfo(query.metric).metric);
	if (query.per === 'none') return 'ranking';
	if (query.compare === 'cars') return 'panels';
	if (query.compare !== 'none') return 'compare';
	if (ratio) return 'line';
	if (query.split === 'vehicle') return 'panels';
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
			: query.compare === 'cars'
				? query.per === 'none'
					? ''
					: ', each car on its own'
				: `, against ${EXPLORE_COMPARES.find(c => c.value === query.compare)?.label.toLowerCase()}`;
	return `${metric} ${time}${by}${versus}`;
}
