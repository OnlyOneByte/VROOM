import type { AnalyticsQueryParams, AnalyticsQueryResponse } from '#lib/types/index.ts';

export function yearRange(year: number, now: Date = new Date()) {
	const start = Math.floor(new Date(year, 0, 1).getTime() / 1000);
	const yearEnd = Math.floor(new Date(year + 1, 0, 1).getTime() / 1000);
	const today = Math.floor(
		new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000
	);
	return { start, end: Math.min(yearEnd, today), soFar: today < yearEnd };
}

export const YEAR_QUERIES = [
	'monthly',
	'categories',
	'counts',
	'running',
	'fills',
	'efficiency',
	'previous'
] as const;
export type YearQuery = (typeof YEAR_QUERIES)[number];

export function yearRequests(
	year: number,
	now: Date = new Date()
): Record<YearQuery, AnalyticsQueryParams> {
	const { start, end, soFar } = yearRange(year, now);
	const whole = { interval: 'none' as const, start, end };
	const lastDay = new Date(year - 1, now.getMonth() + 1, 0).getDate();
	const sameDay = Math.min(now.getDate(), lastDay);
	const before = {
		start: Math.floor(new Date(year - 1, 0, 1).getTime() / 1000),
		end: soFar
			? Math.floor(new Date(year - 1, now.getMonth(), sameDay + 1).getTime() / 1000)
			: start
	};
	return {
		monthly: { metric: 'cost', interval: 'month', include: 'all', start, end },
		categories: { ...whole, metric: 'cost', groupBy: 'category', include: 'all' },
		counts: { ...whole, metric: 'count', groupBy: 'category', include: 'all' },
		running: { ...whole, metric: 'costPerDistance', groupBy: 'vehicle', include: 'running' },
		fills: { ...whole, metric: 'count', groupBy: 'vehicle', categories: ['fuel'], include: 'all' },
		efficiency: { metric: 'efficiency', interval: 'month', start, end },
		previous: {
			metric: 'cost',
			interval: 'none',
			include: 'all',
			start: before.start,
			end: before.end
		}
	};
}

export function coveredCars(response: AnalyticsQueryResponse | null) {
	const coverage = response?.coverage;
	return {
		count: coverage?.vehicleIds.length ?? 0,
		otherCurrencies: [...new Set((coverage?.otherCurrency ?? []).map(c => c.currency))]
	};
}

export function percentChange(current: number, previous: number | null | undefined) {
	if (previous == null || previous <= 0) return null;
	return ((current - previous) / previous) * 100;
}

export function yearCounts(response: AnalyticsQueryResponse | null) {
	let expenses = 0;
	let fills = 0;
	for (const s of response?.series ?? []) {
		const n = s.values[0] ?? 0;
		expenses += n;
		if (s.key === 'fuel') fills = n;
	}
	return { expenses, fills };
}

export interface CarValue {
	label: string;
	value: number;
}

function carValues(response: AnalyticsQueryResponse | null): CarValue[] {
	return (response?.series ?? []).flatMap(s => {
		const value = s.values[0];
		return value == null || value <= 0 ? [] : [{ label: s.label, value }];
	});
}

export function cheapestToRun(response: AnalyticsQueryResponse | null): CarValue | null {
	const cars = carValues(response);
	if (cars.length < 2) return null;
	return cars.reduce((a, b) => (b.value < a.value ? b : a));
}

export function mostFills(response: AnalyticsQueryResponse | null): CarValue | null {
	const cars = carValues(response);
	if (cars.length === 0) return null;
	return cars.reduce((a, b) => (b.value > a.value ? b : a));
}

export function biggestMonth(response: AnalyticsQueryResponse | null) {
	const values = response?.series[0]?.values ?? [];
	let best: { bucket: string; value: number } | null = null;
	(response?.buckets ?? []).forEach((bucket, i) => {
		const value = values[i] ?? 0;
		if (value > 0 && (!best || value > best.value)) best = { bucket, value };
	});
	return best as { bucket: string; value: number } | null;
}
