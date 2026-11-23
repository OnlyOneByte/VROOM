import type { AnyScale, TicksConfig } from 'layerchart';
import { curveMonotoneX } from 'd3-shape';
import { currencyFractionDigits, formatCurrency, formatDateWith, formatNumber } from './formatters';

export type TooltipValueFormat = (value: number, seriesKey: string) => string;

export function formatCurrencyTooltip(value: number): string {
	return formatCurrency(value);
}

export function formatCountTooltip(value: number): string {
	return formatNumber(value, 0);
}

export function unitTooltip(unit: string, decimals = 1): TooltipValueFormat {
	return value => `${formatNumber(value, decimals)} ${unit}`;
}

export function formatMonthLabel(value: unknown): string {
	if (!(value instanceof Date)) return value == null ? '' : String(value);
	if (isNaN(value.getTime())) return '';
	return formatDateWith(value, { month: 'short', year: 'numeric' });
}

export function formatDayLabel(value: unknown): string {
	if (!(value instanceof Date)) return value == null ? '' : String(value);
	if (isNaN(value.getTime())) return '';
	return formatDateWith(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatCurrencyAxis(value: number): string {
	return formatCurrency(value, undefined, 0);
}

export function formatCentsAxis(value: number): string {
	return formatCurrency(value, undefined, currencyFractionDigits());
}

export function formatDecimalAxis(value: number, decimals = 1): string {
	return formatNumber(value, decimals);
}

const TICK_CHAR_WIDTH = 7;
const TICK_LABEL_GAP = 8;
const BAR_CHART_BAND_PADDING = 0.4;

export function fitBandTickLabel(label: string, plotWidth: number, bandCount: number): string {
	if (plotWidth <= 0 || bandCount <= 0) return label;
	const step = plotWidth / (bandCount + BAR_CHART_BAND_PADDING);
	const maxChars = Math.floor((step - TICK_LABEL_GAP) / TICK_CHAR_WIDTH);
	if (label.length <= maxChars) return label;
	return `${label.slice(0, Math.max(maxChars - 1, 1)).trimEnd()}…`;
}

export function getXTickCount(dataLength: number, maxTicks = 6): number {
	return Math.min(dataLength, maxTicks);
}

export const CHART_PADDING = { top: 4, left: 48, bottom: 20, right: 4 } as const;

export const TIME_X_PADDING: [number, number] = [16, 0];

export function insetTimeTicks(ticks: unknown): TicksConfig | undefined {
	if (typeof ticks !== 'number') return ticks as TicksConfig | undefined;
	return (scale: AnyScale) =>
		scale.ticks?.(ticks).filter((tick: Date) => scale(tick) >= TIME_X_PADDING[0]);
}

export const SMOOTH_CURVE = curveMonotoneX;

const Y_TICK_SPACING = 50;

export function distinctYTicks(format: (_v: number) => string, plotHeight: number) {
	return (scale: AnyScale): number[] => {
		for (let count = Math.max(2, Math.round(plotHeight / Y_TICK_SPACING)); count >= 2; count--) {
			const ticks: number[] = scale.ticks?.(count) ?? [];
			if (new Set(ticks.map(format)).size === ticks.length) return ticks;
		}
		const kept: number[] = [];
		for (const tick of (scale.ticks?.(2) ?? []) as number[]) {
			const last = kept.at(-1);
			if (last === undefined || format(last) !== format(tick)) kept.push(tick);
			else if (decimalPlaces(tick) < decimalPlaces(last)) kept[kept.length - 1] = tick;
		}
		return kept;
	};
}

function decimalPlaces(value: number): number {
	return (String(value).split('.')[1] ?? '').length;
}

function formatMonthTick(value: unknown): string {
	if (!(value instanceof Date) || isNaN(value.getTime())) return '';
	if (value.getMonth() === 0) return String(value.getFullYear());
	return formatDateWith(value, { month: 'short' });
}

export function formatDateTick(value: unknown): string {
	if (!(value instanceof Date) || isNaN(value.getTime())) return '';
	return formatDateWith(value, { month: 'short', day: 'numeric' });
}

const TICK_WIDE_CHAR_WIDTH = 12;

function tickLabelWidth(label: string): number {
	let width = 0;
	for (const char of label) {
		width += char.charCodeAt(0) > 0x2e7f ? TICK_WIDE_CHAR_WIDTH : TICK_CHAR_WIDTH;
	}
	return width;
}

function labelsFit(ticks: Date[], scale: AnyScale, format: (_v: unknown) => string): boolean {
	const widths = ticks.map(tick => tickLabelWidth(format(tick)));
	return ticks.every((tick, i) => {
		if (i === 0) return true;
		const space = scale(tick) - scale(ticks[i - 1]);
		return space >= ((widths[i] ?? 0) + (widths[i - 1] ?? 0)) / 2 + TICK_LABEL_GAP;
	});
}

export function fittedTimeTicks(maxTicks: number, format: (_v: unknown) => string) {
	return (scale: AnyScale): Date[] => {
		const all: Date[] = (scale.ticks?.(maxTicks) ?? []).filter(
			(tick: Date) => scale(tick) >= TIME_X_PADDING[0]
		);
		for (let stride = 1; stride < all.length; stride++) {
			const ticks = all.filter((_tick, i) => i % stride === 0);
			if (labelsFit(ticks, scale, format)) return ticks;
		}
		return all.slice(0, 1);
	};
}

export function dayXAxisProps(dataLength: number, maxTicks = 6) {
	return {
		ticks: fittedTimeTicks(getXTickCount(dataLength, maxTicks), formatDateTick),
		format: formatDateTick
	};
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

export function byVehicleMonth<T extends { month: string; vehicleId: string }>(
	rows: readonly T[],
	value: (row: T) => number
): Record<string, number | string | Date>[] {
	const byMonth = new Map<string, Record<string, number | string | Date>>();
	for (const row of rows) {
		let entry = byMonth.get(row.month);
		if (!entry) {
			entry = { month: row.month, date: parseMonthToDate(row.month) };
			byMonth.set(row.month, entry);
		}
		entry[row.vehicleId] = value(row);
	}
	return [...byMonth.values()].sort((a, b) => String(a['month']).localeCompare(String(b['month'])));
}
