import type { ExpenseCategory } from '#lib/types/index.ts';

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

export const CATEGORY_COLOR_TOKENS = {
	fuel: 'chart-1',
	maintenance: 'chart-2',
	financial: 'chart-3',
	regulatory: 'chart-4',
	enhancement: 'chart-5',
	misc: 'neutral'
} as const satisfies Record<ExpenseCategory, string>;

export type CategoryColorToken = (typeof CATEGORY_COLOR_TOKENS)[ExpenseCategory];

export function mapCategoryColorTokens<T>(
	render: (token: CategoryColorToken) => T
): Record<ExpenseCategory, T> & Record<string, T> {
	const rendered: Record<string, T> = {};
	for (const category of Object.keys(CATEGORY_COLOR_TOKENS) as ExpenseCategory[]) {
		rendered[category] = render(CATEGORY_COLOR_TOKENS[category]);
	}
	return rendered as Record<ExpenseCategory, T> & Record<string, T>;
}

function chartFillForToken(token: CategoryColorToken): string {
	return token === 'neutral' ? 'var(--primary)' : `var(--${token})`;
}

export const CATEGORY_COLORS: Record<ExpenseCategory, string> & Record<string, string> =
	mapCategoryColorTokens(chartFillForToken);

export const CATEGORY_LABELS: Record<ExpenseCategory, string> & Record<string, string> = {
	fuel: 'Fuel & Charging',
	maintenance: 'Maintenance',
	financial: 'Financial',
	regulatory: 'Regulatory',
	enhancement: 'Enhancement',
	misc: 'Misc'
};

export function getCategoryChartColor(key: string): string {
	return Object.hasOwn(CATEGORY_COLORS, key) ? (CATEGORY_COLORS[key] as string) : 'var(--primary)';
}

export function getCategoryLabel(key: string): string {
	return Object.hasOwn(CATEGORY_LABELS, key) ? (CATEGORY_LABELS[key] as string) : key;
}

export function buildChartConfig(
	series: Array<{ key: string; label: string; color: string }>
): Record<string, { label: string; color: string }> {
	const config: Record<string, { label: string; color: string }> = Object.create(null);
	for (const s of series) {
		config[s.key] = { label: s.label, color: s.color };
	}
	return config;
}

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
