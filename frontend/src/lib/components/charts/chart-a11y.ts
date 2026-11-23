import { formatMonthLabel, type TooltipValueFormat } from '#lib/utils/chart-formatters.ts';

export type ChartSelectHandler = (_row: Record<string, unknown>, _seriesKey: string | null) => void;

export interface ChartA11yColumn {
	key: string;
	label: string;
}

export interface ChartA11yRow {
	label: string;
	values: (number | null)[];
	cells: string[];
	datum: unknown;
}

export interface ChartA11y {
	caption: string;
	categoryLabel: string;
	columns: ChartA11yColumn[];
	rows: ChartA11yRow[];
	summary: string;
}

interface BuildOptions {
	title: string;
	description?: string | undefined;
	data: Record<string, unknown>[];
	categoryKey: string;
	categoryLabel?: string | undefined;
	series: ChartA11yColumn[];
	labelFormat: (_v: unknown) => string;
	valueFormat: TooltipValueFormat;
}

const MISSING = '—';

function numeric(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function chartSummary(
	title: string,
	columns: ChartA11yColumn[],
	rows: ChartA11yRow[],
	overTime = true
): string {
	if (rows.length === 0) return `${title}: no data.`;
	type Pick = { row: ChartA11yRow; col: number; value: number };
	let high: Pick | null = null;
	let low: Pick | null = null;
	for (const row of rows) {
		for (let col = 0; col < row.values.length; col++) {
			const value = row.values[col];
			if (value == null) continue;
			if (!high || value > high.value) high = { row, col, value };
			if (!low || value < low.value) low = { row, col, value };
		}
	}
	const first = rows[0]!.label;
	const last = rows[rows.length - 1]!.label;
	const parts = overTime
		? [`${title}: ${rows.length === 1 ? first : `${rows.length} points, ${first} to ${last}`}.`]
		: [`${title}: ${rows.length === 1 ? '1 category' : `${rows.length} categories`}.`];
	const describe = (pick: Pick) => {
		const column = columns[pick.col]!;
		const who = columns.length > 1 ? `${column.label}, ` : '';
		return `${who}${pick.row.label}, ${pick.row.cells[pick.col]}`;
	};
	if (high) parts.push(`Highest: ${describe(high)}.`);
	if (low && rows.length > 1) parts.push(`Lowest: ${describe(low)}.`);
	return parts.join(' ');
}

export function buildChartA11y(options: BuildOptions): ChartA11y {
	const { title, description, data, categoryKey, series, labelFormat, valueFormat } = options;
	const rows = data.map(datum => {
		const values = series.map(s => numeric(datum[s.key]));
		return {
			label: labelFormat(datum[categoryKey]),
			values,
			cells: values.map((v, i) => (v === null ? MISSING : valueFormat(v, series[i]!.key))),
			datum
		};
	});
	const isDate = data[0]?.[categoryKey] instanceof Date;
	const fallbackLabel = isDate ? (labelFormat === formatMonthLabel ? 'Month' : 'Date') : 'Category';
	return {
		caption: description ? `${title}. ${description}` : title,
		categoryLabel: options.categoryLabel ?? fallbackLabel,
		columns: series,
		rows,
		summary: chartSummary(title, series, rows, isDate)
	};
}

export function rowAnnouncement(a11y: ChartA11y, index: number): string {
	const row = a11y.rows[index];
	if (!row) return '';
	const position = `${index + 1} of ${a11y.rows.length}.`;
	if (a11y.columns.length === 1) return `${row.label}: ${row.cells[0]}. ${position}`;
	const parts = a11y.columns.map((column, i) => `${column.label}: ${row.cells[i]}`);
	return `${row.label}. ${parts.join('. ')}. ${position}`;
}
