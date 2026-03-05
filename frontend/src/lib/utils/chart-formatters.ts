/**
 * Shared chart axis formatters and utilities for LayerChart components.
 * Centralizes formatting logic to avoid duplication across chart components.
 */

import { curveMonotoneX } from 'd3-shape';

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

/** Format a date as 3-letter month abbreviation (e.g. "Jan", "Feb", "Mar") */
export function formatMonthShort(date: Date): string {
	return date.toLocaleDateString('en-US', { month: 'short' });
}

/** Format a date as "Jan 15" */
export function formatMonthDay(date: Date): string {
	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a number as compact currency for Y-axis labels (e.g. "$1,200") */
export function formatCurrencyAxis(value: number): string {
	return currencyFormatter.format(value);
}

const centsCurrencyFormatter = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});

/** Format small currency values (e.g. cost per mile: $0.05) with 2 decimal places */
export function formatCentsAxis(value: number): string {
	return centsCurrencyFormatter.format(value);
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

// ---------------------------------------------------------------------------
// Shared chart style presets
// ---------------------------------------------------------------------------

/** Standard chart padding used across all chart types. */
export const CHART_PADDING = { top: 4, left: 48, bottom: 20, right: 4 } as const;

/** Wider left padding for charts with long y-axis labels (e.g. odometer "35,000"). */
export const CHART_PADDING_WIDE = { top: 4, left: 56, bottom: 20, right: 4 } as const;

/** Smooth curve for line/area charts — gives a natural, curvy appearance. */
export const SMOOTH_CURVE = curveMonotoneX;

/**
 * Format a Date value as 3-letter month for x-axis ticks.
 * Handles unknown input from layerchart axis callbacks.
 */
export function formatMonthTick(value: unknown): string {
	if (!(value instanceof Date) || isNaN(value.getTime())) return '';
	return value.toLocaleDateString('en-US', { month: 'short' });
}

/**
 * Format a Date value as "Mon D" for x-axis ticks on date-level charts.
 * Handles unknown input from layerchart axis callbacks.
 */
export function formatDateTick(value: unknown): string {
	if (!(value instanceof Date) || isNaN(value.getTime())) return '';
	return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Build standard x-axis props for monthly time series charts.
 * Shows 3-letter month labels, auto-limits tick count to avoid crowding.
 */
export function monthlyXAxisProps(dataLength: number) {
	return {
		ticks: getXTickCount(dataLength, 12),
		format: formatMonthTick
	};
}

/**
 * Shared spline (line) props for smooth trend lines with dots.
 * Apply via `props: { ...TREND_LINE_PROPS }` on LineChart components.
 */
export const TREND_LINE_PROPS = {
	spline: {
		curve: SMOOTH_CURVE
	},
	points: {
		r: 4,
		class: 'fill-background stroke-2'
	}
} as const;

/** Parse a "YYYY-MM" month string into a Date (1st of that month). */
export function parseMonthToDate(month: string): Date {
	const [y, m] = month.split('-');
	return new Date(Number(y), Number(m) - 1, 1);
}
