/**
 * Consolidated category color/label maps and series color assignment utilities.
 * Single source of truth for chart colors across the app — replaces duplicated
 * maps in AdvancedCharts, CrossVehicleTab, PerVehicleTab, YearEndTab, etc.
 */

/** The six expense categories used throughout the app. */
export type ExpenseCategory =
	| 'fuel'
	| 'maintenance'
	| 'financial'
	| 'regulatory'
	| 'enhancement'
	| 'misc';

/** Semantic chart color CSS custom properties (var(--chart-1) through var(--chart-5)). */
export const CHART_COLORS = [
	'var(--chart-1)',
	'var(--chart-2)',
	'var(--chart-3)',
	'var(--chart-4)',
	'var(--chart-5)'
] as const;

/**
 * Category → chart color mapping for pie charts, heatmaps, and legends.
 * Typed against ExpenseCategory to catch stale/missing keys at compile time.
 * Also widened to `Record<string, string>` so callers can pass arbitrary keys
 * through the fallback functions without casting.
 */
export const CATEGORY_COLORS: Record<ExpenseCategory, string> & Record<string, string> = {
	fuel: 'var(--chart-1)',
	maintenance: 'var(--chart-2)',
	financial: 'var(--chart-3)',
	regulatory: 'var(--chart-4)',
	enhancement: 'var(--chart-5)',
	misc: 'var(--primary)'
};

/** Category → display label mapping. */
export const CATEGORY_LABELS: Record<ExpenseCategory, string> & Record<string, string> = {
	fuel: 'Fuel',
	maintenance: 'Maintenance',
	financial: 'Financial',
	regulatory: 'Regulatory',
	enhancement: 'Enhancement',
	misc: 'Misc'
};

/**
 * Look up the chart color for a category key, falling back to `var(--primary)`
 * for unknown keys.
 */
export function getCategoryColor(key: string): string {
	return Object.hasOwn(CATEGORY_COLORS, key) ? (CATEGORY_COLORS[key] as string) : 'var(--primary)';
}

/**
 * Look up the display label for a category key, falling back to the raw key
 * for unknown keys.
 */
export function getCategoryLabel(key: string): string {
	return Object.hasOwn(CATEGORY_LABELS, key) ? (CATEGORY_LABELS[key] as string) : key;
}

/** Assign colors from CHART_COLORS to a dynamic list of series keys, cycling via modular indexing. */
export function assignSeriesColors(keys: string[]): Array<{ key: string; color: string }> {
	return keys.map((key, i) => ({
		key,
		color: CHART_COLORS[i % CHART_COLORS.length] as string
	}));
}

/** Build a ChartConfig record from a series array (key → { label, color }). */
export function buildChartConfig(
	series: Array<{ key: string; label: string; color: string }>
): Record<string, { label: string; color: string }> {
	const config: Record<string, { label: string; color: string }> = Object.create(null);
	for (const s of series) {
		config[s.key] = { label: s.label, color: s.color };
	}
	return config;
}

/**
 * Transform a category breakdown into pie chart data with colors, labels, and percentages.
 * Excludes zero-amount items. Computes total from the breakdown if not provided.
 */
export function buildCategoryPieData(
	breakdown: Array<{ category: string; amount: number }>,
	total?: number
): Array<{ key: string; label: string; value: number; color: string; percentage: number }> {
	const nonZero = breakdown.filter(item => item.amount > 0);
	const computedTotal = total ?? nonZero.reduce((sum, item) => sum + item.amount, 0);

	if (computedTotal === 0) return [];

	return nonZero.map(item => ({
		key: item.category,
		label: getCategoryLabel(item.category),
		value: item.amount,
		color: getCategoryColor(item.category),
		percentage: (item.amount / computedTotal) * 100
	}));
}
