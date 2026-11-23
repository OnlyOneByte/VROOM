export const RANGE_PRESETS = [
	{ value: '3m', label: 'Last 3 months', short: '3 months' },
	{ value: '12m', label: 'Last 12 months', short: '12 months' },
	{ value: 'ytd', label: 'Year to date', short: 'This year' },
	{ value: '24m', label: 'Last 24 months', short: '24 months' },
	{ value: 'all', label: 'All time', short: 'All time' }
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]['value'];
export type AnalyticsRange = RangePreset | 'custom';
export type FilterMenu = 'range' | 'cars';

export interface AnalyticsFilters {
	range: AnalyticsRange;
	from?: string;
	to?: string;
	cars: string[];
}

export interface AnalyticsDateRange {
	startDate: number;
	endDate: number;
	ytdStart: number;
}

export const DEFAULT_RANGE: RangePreset = '12m';

const PRESET_MONTHS: Record<'3m' | '12m' | '24m', number> = { '3m': 3, '12m': 12, '24m': 24 };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILTER_PARAMS = ['range', 'from', 'to', 'cars'] as const;

function isPreset(value: string | null): value is RangePreset {
	return RANGE_PRESETS.some(p => p.value === value);
}

function parseDay(value: string | null | undefined): Date | null {
	if (!value || !ISO_DAY.test(value)) return null;
	const [y, m, d] = value.split('-').map(Number) as [number, number, number];
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
		? date
		: null;
}

export function toDayString(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseAnalyticsFilters(params: Pick<URLSearchParams, 'get'>): AnalyticsFilters {
	const cars = (params.get('cars') ?? '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean);
	const range = params.get('range');
	const from = params.get('from');
	const to = params.get('to');
	const fromDay = parseDay(from);
	const toDay = parseDay(to);
	if (range === 'custom' && fromDay && toDay && fromDay <= toDay) {
		return { range: 'custom', from: from ?? undefined, to: to ?? undefined, cars };
	}
	return { range: isPreset(range) ? range : DEFAULT_RANGE, cars };
}

export function writeAnalyticsFilters(url: { href: string }, filters: AnalyticsFilters): URL {
	const next = new URL(url.href);
	for (const key of FILTER_PARAMS) next.searchParams.delete(key);
	if (filters.range === 'custom' && filters.from && filters.to) {
		next.searchParams.set('range', 'custom');
		next.searchParams.set('from', filters.from);
		next.searchParams.set('to', filters.to);
	} else if (filters.range !== DEFAULT_RANGE && filters.range !== 'custom') {
		next.searchParams.set('range', filters.range);
	}
	if (filters.cars.length > 0) next.searchParams.set('cars', filters.cars.join(','));
	return next;
}

function seconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

export function filterDateRange(
	filters: AnalyticsFilters,
	now: Date = new Date()
): AnalyticsDateRange {
	const year = now.getFullYear();
	const month = now.getMonth();
	const day = now.getDate();
	const tomorrow = new Date(year, month, day + 1);
	const ytdStart = seconds(new Date(year, 0, 1));
	const from = parseDay(filters.from);
	const to = parseDay(filters.to);
	if (filters.range === 'custom' && from && to) {
		const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
		return { startDate: seconds(from), endDate: seconds(end), ytdStart };
	}
	const range = filters.range === 'custom' ? DEFAULT_RANGE : filters.range;
	const endDate = seconds(tomorrow);
	if (range === 'ytd') return { startDate: ytdStart, endDate, ytdStart };
	if (range === 'all') return { startDate: 1, endDate, ytdStart };
	const start = new Date(year, month - PRESET_MONTHS[range], day);
	return { startDate: seconds(start), endDate, ytdStart };
}

export function isDefaultFilters(filters: AnalyticsFilters): boolean {
	return filters.range === DEFAULT_RANGE && filters.cars.length === 0;
}

export function rangeLabel(
	filters: AnalyticsFilters,
	formatDay: (d: Date) => string,
	short = false
): string {
	const from = parseDay(filters.from);
	const to = parseDay(filters.to);
	if (filters.range === 'custom' && from && to) return `${formatDay(from)} – ${formatDay(to)}`;
	const preset = RANGE_PRESETS.find(p => p.value === filters.range);
	return (short ? preset?.short : preset?.label) ?? 'Last 12 months';
}

export function carsLabel(cars: string[], names: Map<string, string>): string {
	const picked = cars.filter(id => names.has(id));
	if (picked.length === 0) return 'All cars';
	if (picked.length === 1) return names.get(picked[0] as string) ?? '1 car';
	return `${picked.length} cars`;
}

export function previousPeriodLabel(filters: AnalyticsFilters): string {
	if (filters.range === '3m' || filters.range === '12m' || filters.range === '24m') {
		return `vs the ${PRESET_MONTHS[filters.range]} months before`;
	}
	return 'vs the same length of time before';
}
