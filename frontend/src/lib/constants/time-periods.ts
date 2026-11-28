export type TimePeriod = '7d' | '30d' | '90d' | '1y' | 'all';

export const PERIOD_OPTIONS = [
	{ value: '7d' as const, label: 'Last 7 days' },
	{ value: '30d' as const, label: 'Last 30 days' },
	{ value: '90d' as const, label: 'Last 90 days' },
	{ value: '1y' as const, label: 'Last year' },
	{ value: 'all' as const, label: 'All time' }
] as const;

export function isValidPeriod(value: string): value is TimePeriod {
	return ['7d', '30d', '90d', '1y', 'all'].includes(value);
}
