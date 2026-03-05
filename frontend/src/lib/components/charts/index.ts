// Chart component library — foundation components
export { default as ChartCard } from './ChartCard.svelte';
export { default as ChartLegend } from './ChartLegend.svelte';
export { default as StatCard } from './StatCard.svelte';
export { default as StatCardGrid } from './StatCardGrid.svelte';

// Typed chart wrappers
export { default as AppLineChart } from './AppLineChart.svelte';
export { default as AppBarChart } from './AppBarChart.svelte';
export { default as AppPieChart } from './AppPieChart.svelte';
export { default as AppAreaChart } from './AppAreaChart.svelte';

// Chart color utilities
export {
	CHART_COLORS,
	CATEGORY_COLORS,
	CATEGORY_LABELS,
	getCategoryColor,
	getCategoryLabel,
	assignSeriesColors,
	buildChartConfig,
	buildCategoryPieData
} from '$lib/utils/chart-colors';
