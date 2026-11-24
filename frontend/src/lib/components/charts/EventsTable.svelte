<script lang="ts">
	import * as Table from '#lib/components/ui/table/index.ts';
	import { annotationEvents } from './annotation-events.ts';
	import type { ChartAnnotations } from './types.ts';

	interface Props {
		annotations: ChartAnnotations;
		title: string;
		maxHeight: number;
	}

	let { annotations, title, maxHeight }: Props = $props();

	let events = $derived(annotationEvents(annotations));
</script>

{#if events.rows.length > 0}
	{#if annotations.note}
		<p class="text-muted-foreground mt-3 text-xs" aria-hidden="true">{annotations.note}</p>
	{/if}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="mt-3 overflow-auto rounded-md border"
		style="max-height: {maxHeight}px"
		role="region"
		aria-label="{title}: {events.label}"
		tabindex="0"
	>
		<table class="w-full text-sm">
			<Table.Caption class="sr-only">
				{events.label}{annotations.note ? `. ${annotations.note}` : ''}
			</Table.Caption>
			<Table.Header class="bg-card sticky top-0">
				<Table.Row>
					<Table.Head scope="col">When</Table.Head>
					<Table.Head scope="col">{events.label}</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each events.rows as row, i (i)}
					<Table.Row>
						<Table.Head scope="row" class="font-normal">{row.when}</Table.Head>
						<Table.Cell class="whitespace-normal">{row.what}</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</table>
	</div>
{/if}
