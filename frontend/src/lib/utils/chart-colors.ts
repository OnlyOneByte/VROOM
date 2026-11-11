/**
 * The one category → color/label assignment, plus the series-color helpers every chart shares.
 */

import type { ExpenseCategory } from '$lib/types';

/**
 * Semantic chart series colors (`var(--chart-1)` … `var(--chart-8)`). Eight entries so a fleet of
 * ≥6 vehicles gets distinct, WCAG-AA-graphical (3:1 vs card) series colors instead of wrapping
 * back onto --chart-1. Every built-in theme defines all eight (theme-registry.ts); the contrast
 * guard (theme-contrast.test.ts) pins each at ≥3:1 vs card for every non-default theme.
 */
export const CHART_COLORS = [
	'var(--chart-1)',
	'var(--chart-2)',
	'var(--chart-3)',
	'var(--chart-4)',
	'var(--chart-5)',
	'var(--chart-6)',
	'var(--chart-7)',
	'var(--chart-8)'
] as const;

/**
 * Category → design-system color token. This is the ONLY place a category is assigned a color;
 * every surface derives its own rendering from it — chart fills and legend swatches via
 * `CATEGORY_COLORS` below, list/table badges via `getCategoryBadgeClasses` in expense-helpers.ts.
 *
 * Categories take `--chart-1` … `--chart-5` in the order the `ExpenseCategory` union declares
 * them. `misc` is the catch-all bucket and takes `neutral`, which each surface renders with the
 * neutral its own contrast budget allows (a pie slice needs to read against the card; a badge
 * tint sits behind small text and has to stay quiet).
 *
 * Two independently hand-written category → color maps is what this replaced: the badge map and
 * the chart map disagreed on maintenance, financial, and enhancement, so a single expense showed
 * two different colors on one screen (the dashboard renders the activity-feed badges directly
 * beside the category pie). Assign a category here and nowhere else.
 */
export const CATEGORY_COLOR_TOKENS = {
	fuel: 'chart-1',
	maintenance: 'chart-2',
	financial: 'chart-3',
	regulatory: 'chart-4',
	enhancement: 'chart-5',
	misc: 'neutral'
} as const satisfies Record<ExpenseCategory, string>;

/**
 * The tokens `CATEGORY_COLOR_TOKENS` actually uses. Every renderer keys a `Record` off this, so
 * pointing a category at a token no renderer handles is a compile error rather than a blank color.
 */
export type CategoryColorToken = (typeof CATEGORY_COLOR_TOKENS)[ExpenseCategory];

/**
 * Build a per-category record by rendering each category's color token. The cast adds the string
 * index signature callers rely on for arbitrary keys; the loop guarantees the six real keys.
 */
export function mapCategoryColorTokens<T>(
	render: (token: CategoryColorToken) => T
): Record<ExpenseCategory, T> & Record<string, T> {
	const rendered: Record<string, T> = {};
	for (const category of Object.keys(CATEGORY_COLOR_TOKENS) as ExpenseCategory[]) {
		rendered[category] = render(CATEGORY_COLOR_TOKENS[category]);
	}
	return rendered as Record<ExpenseCategory, T> & Record<string, T>;
}

/**
 * A chart slice, bar, line, or legend swatch has to read against the card, so `neutral` renders as
 * the high-contrast `--primary` here rather than the de-emphasized `--muted-foreground` the
 * badges use.
 */
function chartFillForToken(token: CategoryColorToken): string {
	return token === 'neutral' ? 'var(--primary)' : `var(--${token})`;
}

/**
 * Category → chart color for pie charts, heatmaps, and legends, derived from
 * `CATEGORY_COLOR_TOKENS`. Widened to `Record<string, string>` so callers can pass an arbitrary
 * key through the fallback lookups without casting.
 */
export const CATEGORY_COLORS: Record<ExpenseCategory, string> & Record<string, string> =
	mapCategoryColorTokens(chartFillForToken);

/**
 * Category → display label, for every surface that names a category: table badges, filter and
 * form dropdowns, chart legends. `fuel` is "Fuel & Charging" because that bucket also holds EV
 * charge sessions, which are logged with kWh rather than gallons.
 *
 * expense-helpers.ts re-exports this object as `categoryLabels` (the name the table/form call
 * sites use) rather than keeping a second copy — the two used to disagree on `fuel`, so the
 * analytics pies said "Fuel" while the dashboard pie beside them said "Fuel & Charging".
 */
export const CATEGORY_LABELS: Record<ExpenseCategory, string> & Record<string, string> = {
	fuel: 'Fuel & Charging',
	maintenance: 'Maintenance',
	financial: 'Financial',
	regulatory: 'Regulatory',
	enhancement: 'Enhancement',
	misc: 'Misc'
};

/**
 * The CSS color a chart paints a category with — a pie slice, bar, line, or legend swatch.
 * Unknown keys fall back to `var(--primary)`.
 *
 * For a category BADGE use `getCategoryBadgeClasses` from expense-helpers.ts: same tokens,
 * rendered as a Tailwind `text-*`/`bg-*` pair instead of a CSS color value.
 */
export function getCategoryChartColor(key: string): string {
	return Object.hasOwn(CATEGORY_COLORS, key) ? (CATEGORY_COLORS[key] as string) : 'var(--primary)';
}

/**
 * @deprecated Ambiguous name — expense-helpers.ts exported its own `getCategoryColor` returning
 * Tailwind badge classes, so two functions one import apart shared a name and had incompatible
 * return contracts. Use {@link getCategoryChartColor}. This alias exists only until the remaining
 * chart call sites are renamed.
 */
export const getCategoryColor = getCategoryChartColor;

/**
 * Look up the display label for a category key, falling back to the raw key for unknown keys.
 */
export function getCategoryLabel(key: string): string {
	return Object.hasOwn(CATEGORY_LABELS, key) ? (CATEGORY_LABELS[key] as string) : key;
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
		color: getCategoryChartColor(item.category),
		percentage: (item.amount / computedTotal) * 100
	}));
}
