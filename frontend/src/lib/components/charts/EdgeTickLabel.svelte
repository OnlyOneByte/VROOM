<script lang="ts">
	import { getChartContext, Text, type TextProps } from 'layerchart';
	import { edgeLabelShift } from '#lib/utils/chart-formatters.ts';

	let { props, clearGutter = false }: { props: TextProps; clearGutter?: boolean } = $props();

	const chart = getChartContext();
	let dx = $derived(
		(Number(props.dx) || 0) +
			edgeLabelShift(
				props.x,
				props.value,
				chart.width,
				clearGutter ? { left: 0, right: chart.padding.right } : chart.padding
			)
	);
</script>

<Text {...props} {dx} />
