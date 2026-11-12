export type TimePeriod = '7d' | '30d' | '90d' | '1y' | 'all';

export const PERIOD_OPTIONS = [
	{ value: '7d' as const, label: 'Last 7 Days' },
	{ value: '30d' as const, label: 'Last 30 Days' },
	{ value: '90d' as const, label: 'Last 90 Days' },
	{ value: '1y' as const, label: 'Last Year' },
	{ value: 'all' as const, label: 'All Time' }
] as const;

export function isValidPeriod(value: string): value is TimePeriod {
	return ['7d', '30d', '90d', '1y', 'all'].includes(value);
}
