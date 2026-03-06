/**
 * Shared chart axis formatters and utilities for LayerChart components.
 * Centralizes formatting logic to avoid duplication across chart components.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 0,
	maximumFractionDigits: 0
});

/** Format a date as "Jan 2025" */
export function formatMonthYear(date: Date): string {
	return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Format a date as "Jan 15" */
export function formatMonthDay(date: Date): string {
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a number as compact currency for Y-axis labels (e.g. "$1,200") */
export function formatCurrencyAxis(value: number): string {
	return currencyFormatter.format(value);
}

/** Format a number with fixed decimal places for Y-axis labels */
export function formatDecimalAxis(value: number, decimals = 1): string {
	return value.toFixed(decimals);
}

/**
 * Calculate the optimal tick count for a time-based X-axis.
 * Prevents duplicate labels when there are few data points
 * (e.g. d3 generating 7 ticks for 2 monthly data points).
 */
export function getXTickCount(dataLength: number, maxTicks = 6): number {
	return Math.min(dataLength, maxTicks);
}
