<script lang="ts">
	import { getChartContext, Text, type TextProps } from 'layerchart';
	import { edgeTextAnchor } from '#lib/utils/chart-formatters.ts';

	let { props }: { props: TextProps } = $props();

	const chart = getChartContext();
	let textAnchor = $derived(edgeTextAnchor(props.x, props.value, chart.width, chart.padding));
</script>

<Text {...props} {textAnchor} />
