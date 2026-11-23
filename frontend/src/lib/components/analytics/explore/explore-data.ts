import type {
	AnalyticsQueryInterval,
	AnalyticsQueryPeriod,
	AnalyticsQueryResponse,
	UnitPreferences
} from '#lib/types/index.ts';
import { CHART_COLORS, getCategoryChartColor, getCategoryLabel } from '#lib/utils/chart-colors.ts';
import { formatCurrency, formatDateWith, formatNumber } from '#lib/utils/formatters.ts';
import {
	getChargeUnitLabel,
	getDistanceUnitLabel,
	getElectricEfficiencyLabel,
	getFuelEfficiencyLabel,
	getVolumeUnitLabel
} from '#lib/utils/units.ts';
import { metricInfo, type ExploreQuery } from './query-state';

export const queryCache = new Map<string, AnalyticsQueryResponse>();

export interface ExploreSeries {
	key: string;
	sourceKey: string;
	label: string;
	color: string;
	values: Array<number | null>;
}

export function bucketDate(key: string): Date {
	const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
	if (quarter) return new Date(Number(quarter[1]), (Number(quarter[2]) - 1) * 3, 1);
	const [y, m = 1, d = 1] = key.split('-').map(Number) as [number, number?, number?];
	return new Date(y, m - 1, d);
}

export function bucketLabel(key: string, per: AnalyticsQueryInterval): string {
	if (per === 'none') return 'Whole range';
	if (per === 'year') return key;
	if (per === 'quarter') return key.replace(/^(\d{4})-Q(\d)$/, 'Q$2 $1');
	const date = bucketDate(key);
	if (per === 'week') return formatDateWith(date, { month: 'short', day: 'numeric' });
	return `${formatDateWith(date, { month: 'short' })} ’${String(date.getFullYear()).slice(2)}`;
}

export function seriesFor(
	response: Pick<AnalyticsQueryResponse, 'series' | 'groupBy'>,
	vehicleColors: Record<string, string> = {}
): ExploreSeries[] {
	return response.series.map((s, i) => {
		const fallback = CHART_COLORS[i % CHART_COLORS.length] as string;
		const color =
			response.groupBy === 'category'
				? getCategoryChartColor(s.key)
				: response.groupBy === 'vehicle'
					? (vehicleColors[s.key] ?? fallback)
					: fallback;
		const label = response.groupBy === 'category' ? getCategoryLabel(s.key) : s.label;
		return { key: `s${i}`, sourceKey: s.key, label, color, values: s.values };
	});
}

export function isAdditive(query: ExploreQuery): boolean {
	const { metric } = metricInfo(query.metric);
	return metric === 'cost' || metric === 'count' || metric === 'volume' || metric === 'distance';
}

function sum(values: Array<number | null>): number {
	return values.reduce<number>((total, v) => total + (v ?? 0), 0);
}

export function bucketTotals(series: Array<{ values: Array<number | null> }>, length: number) {
	return Array.from({ length }, (_, i) => sum(series.map(s => s.values[i] ?? null)));
}

export interface ExploreKpis {
	total: number | null;
	perBucket: number | null;
	previousPerBucket: number | null;
	perDistance: number | null;
}

export function kpis(
	query: ExploreQuery,
	response: AnalyticsQueryResponse,
	visible: Set<string>
): ExploreKpis {
	const allVisible = response.series.every(s => visible.has(s.key));
	const visibleTotal = (period: AnalyticsQueryPeriod) =>
		sum(period.series.filter(s => visible.has(s.key)).flatMap(s => s.values));
	if (!isAdditive(query) || allVisible || query.split === 'tag') {
		return {
			total: response.totals.value,
			perBucket: response.totals.perBucket,
			previousPerBucket: response.compare?.totals.perBucket ?? null,
			perDistance: response.totals.perDistance
		};
	}
	const total = visibleTotal(response);
	const buckets = response.buckets.length || 1;
	const previous = response.compare ? visibleTotal(response.compare) : null;
	return {
		total,
		perBucket: total / buckets,
		previousPerBucket: previous == null ? null : previous / buckets,
		perDistance:
			query.split !== 'vehicle' &&
			response.totals.perDistance != null &&
			response.totals.distance > 0
				? total / response.totals.distance
				: null
	};
}

export function percentChange(current: number | null, previous: number | null): number | null {
	if (current == null || previous == null || previous === 0) return null;
	return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

export function valueFormatter(
	query: ExploreQuery,
	units: UnitPreferences
): { axis: (_v: number) => string; full: (_v: number) => string } {
	const { metric } = metricInfo(query.metric);
	const electric = query.metric === 'charge' || query.metric === 'evEfficiency';
	const dist = getDistanceUnitLabel(units.distanceUnit, true);
	switch (metric) {
		case 'cost':
			return { axis: v => formatCurrency(v, undefined, 0), full: v => formatCurrency(v) };
		case 'costPerDistance':
			return {
				axis: v => formatCurrency(v),
				full: v => `${formatCurrency(v)}/${dist}`
			};
		case 'distance':
			return { axis: v => formatNumber(v, 0), full: v => `${formatNumber(v, 0)} ${dist}` };
		case 'volume': {
			const unit = electric
				? getChargeUnitLabel(units.chargeUnit, true)
				: getVolumeUnitLabel(units.volumeUnit, true);
			return { axis: v => formatNumber(v, 0), full: v => `${formatNumber(v, 1)} ${unit}` };
		}
		case 'efficiency': {
			const unit = electric
				? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
				: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit);
			return { axis: v => formatNumber(v, 1), full: v => `${formatNumber(v, 1)} ${unit}` };
		}
		default:
			return { axis: v => formatNumber(v, 0), full: v => formatNumber(v, 0) };
	}
}

export function hasData(response: AnalyticsQueryResponse): boolean {
	return response.series.some(s => s.values.some(v => v != null && v !== 0));
}

function nextBucketStart(start: Date, per: AnalyticsQueryInterval): Date {
	const y = start.getFullYear();
	const m = start.getMonth();
	if (per === 'week') return new Date(y, m, start.getDate() + 7);
	if (per === 'quarter') return new Date(y, m + 3, 1);
	if (per === 'year') return new Date(y + 1, 0, 1);
	return new Date(y, m + 1, 1);
}

export function bucketBounds(
	key: string,
	per: AnalyticsQueryInterval,
	range: { start: number; end: number }
): { start: number; end: number } {
	if (per === 'none') return range;
	const start = bucketDate(key);
	const startSec = Math.floor(start.getTime() / 1000);
	const endSec = Math.floor(nextBucketStart(start, per).getTime() / 1000);
	return { start: Math.max(startSec, range.start), end: Math.min(endSec, range.end) };
}

function plainDay(seconds: number): string {
	const d = new Date(seconds * 1000);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function expensesQuery(filters: {
	start: number;
	end: number;
	vehicleId?: string;
	categories?: readonly string[];
	tag?: string;
}): string {
	const params = new URLSearchParams();
	if (filters.vehicleId) params.set('vehicleId', filters.vehicleId);
	if (filters.categories?.length) params.set('category', filters.categories.join(','));
	if (filters.tag) params.set('tags', filters.tag);
	params.set('startDate', plainDay(filters.start));
	params.set('endDate', plainDay(filters.end - 1));
	return `?${params.toString()}`;
}

export function expensesNote(selection: {
	split: ExploreQuery['split'];
	keys?: string[];
	cars: number;
	energy: boolean;
}): string | undefined {
	const extra: string[] = [];
	if (selection.cars > 1) extra.push('your other cars');
	if (selection.energy || (selection.split === 'fuelType' && selection.keys)) {
		extra.push('other fuel types');
	}
	if (selection.split === 'tag' && selection.keys) {
		if (selection.keys.includes('')) extra.push('tagged expenses');
		else if (selection.keys.length > 1) extra.push('expenses with other tags');
	}
	if (extra.length === 0) return undefined;
	const list =
		extra.length === 1 ? extra[0] : `${extra.slice(0, -1).join(', ')} and ${extra.at(-1)}`;
	return `Expenses also lists ${list} for these dates.`;
}
