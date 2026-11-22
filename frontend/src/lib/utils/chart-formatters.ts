import { curveMonotoneX } from 'd3-shape';
import { formatCurrency } from './formatters';

export function formatCurrencyAxis(value: number): string {
	return formatCurrency(value, undefined, 0);
}

export function formatCentsAxis(value: number): string {
	return formatCurrency(value, undefined, 2);
}

export function formatDecimalAxis(value: number, decimals = 1): string {
	return value.toFixed(decimals);
}

export function getXTickCount(dataLength: number, maxTicks = 6): number {
	return Math.min(dataLength, maxTicks);
}

export const CHART_PADDING = { top: 4, left: 48, bottom: 20, right: 4 } as const;

export const SMOOTH_CURVE = curveMonotoneX;

function formatMonthTick(value: unknown): string {
	if (!(value instanceof Date) || isNaN(value.getTime())) return '';
	if (value.getMonth() === 0) return String(value.getFullYear());
	return value.toLocaleDateString('en-US', { month: 'short' });
}

export function formatDateTick(value: unknown): string {
	if (!(value instanceof Date) || isNaN(value.getTime())) return '';
	return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function monthlyXAxisProps(dataLength: number, maxTicks = 4) {
	return {
		ticks: getXTickCount(dataLength, maxTicks),
		format: formatMonthTick
	};
}

const TREND_LINE_PROPS = {
	spline: {
		curve: SMOOTH_CURVE
	},
	points: {
		r: 4,
		class: 'fill-background stroke-2'
	}
} as const;

export const SINGLE_POINT_PROPS = { r: 6, class: 'stroke-2' } as const;

export function getTrendLineProps(dataLength: number) {
	if (dataLength <= 1) {
		return {
			spline: { curve: SMOOTH_CURVE },
			points: SINGLE_POINT_PROPS
		};
	}
	return TREND_LINE_PROPS;
}

export function isolatedValueRows(
	data: Record<string, unknown>[],
	keys: string[]
): { key: string; rows: Record<string, unknown>[] }[] {
	return keys
		.map(key => ({
			key,
			rows: data.filter(
				(row, i) => row[key] != null && data[i - 1]?.[key] == null && data[i + 1]?.[key] == null
			)
		}))
		.filter(series => series.rows.length > 0);
}

export function parseMonthToDate(month: string): Date {
	const parts = month.split('-');
	return new Date(Number(parts[0] ?? '0'), Number(parts[1] ?? '1') - 1, 1);
}
