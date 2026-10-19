// Typed chart wrappers only. Three of these import a CSS file for their enter animation, which
// makes their modules side-effectful and therefore unshakeable: anything this barrel re-exports
// drags layerchart and the d3 cluster into the importer's route chunk. Chart-free components that
// happen to live in this folder (StatCard, StatCardGrid, ChartCard, ChartLegend) must be imported
// from their own file so routes that render no chart stay free of the charting runtime — the
// `no-restricted-imports` rule in eslint.config.js enforces that.
export { default as AppLineChart } from './AppLineChart.svelte';
export { default as AppBarChart } from './AppBarChart.svelte';
export { default as AppPieChart } from './AppPieChart.svelte';
export { default as AppAreaChart } from './AppAreaChart.svelte';
