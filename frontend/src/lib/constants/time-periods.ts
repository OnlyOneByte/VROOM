/**
 * Time period constants for date calculations
 */

// Days in recent expense period (for "Last 30 Days" stat)
export const DAYS_IN_RECENT_PERIOD = 30;

// Months for calculating average expenses
export const MONTHS_IN_AVERAGE_PERIOD = 12;

// Period type definition
export type TimePeriod = '7d' | '30d' | '90d' | '1y' | 'all';

// Period options for selectors
export const PERIOD_OPTIONS = [
	{ value: '7d' as const, label: 'Last 7 Days' },
	{ value: '30d' as const, label: 'Last 30 Days' },
	{ value: '90d' as const, label: 'Last 90 Days' },
	{ value: '1y' as const, label: 'Last Year' },
	{ value: 'all' as const, label: 'All Time' }
] as const;

// Type guard for period validation
export function isValidPeriod(value: string): value is TimePeriod {
	return ['7d', '30d', '90d', '1y', 'all'].includes(value);
}
