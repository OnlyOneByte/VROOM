<script lang="ts">
	import { getChartContext, Text, type TextProps } from 'layerchart';
	import { edgeLabelShift } from '#lib/utils/chart-formatters.ts';

	let { props }: { props: TextProps } = $props();

	const chart = getChartContext();
	let dx = $derived(
		(Number(props.dx) || 0) + edgeLabelShift(props.x, props.value, chart.width, chart.padding)
	);
</script>

<Text {...props} {dx} />
