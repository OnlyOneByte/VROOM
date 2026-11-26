<script lang="ts">
	import { Download } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Table from '#lib/components/ui/table/index.ts';
	import { triggerBlobDownload } from '#lib/utils/download.ts';
	import { numbersCsv, type NumbersTable } from './explore-data';

	interface Props {
		table: NumbersTable;
		firstColumn: string;
		format: (_v: number) => string;
		filename: string;
	}

	let { table, firstColumn, format, filename }: Props = $props();

	function download() {
		const csv = '\uFEFF' + numbersCsv(table, firstColumn);
		triggerBlobDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
	}
</script>

<section aria-labelledby="explore-numbers-title" class="space-y-2">
	<div class="flex items-center justify-between gap-3">
		<h2 id="explore-numbers-title" class="text-base font-semibold">The numbers</h2>
		<Button variant="ghost" size="sm" onclick={download}>
			<Download class="mr-1 h-4 w-4" aria-hidden="true" />
			Download CSV
		</Button>
	</div>
	<div
		class="overflow-x-auto rounded-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&>[data-slot=table-container]]:overflow-visible"
		role="region"
		aria-label="The numbers table"
		tabindex="0"
	>
		<Table.Root>
			<Table.Caption class="sr-only">
				The numbers, one row per {firstColumn.toLowerCase()}
			</Table.Caption>
			<Table.Header>
				<Table.Row>
					<Table.Head scope="col" class="sticky left-0 bg-background">{firstColumn}</Table.Head>
					{#each table.columns as column, c (c)}
						<Table.Head scope="col" class="text-right">{column}</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each table.rows as row, r (r)}
					<Table.Row>
						<Table.Head scope="row" class="sticky left-0 bg-background font-normal">
							{row.label}
						</Table.Head>
						{#each row.values as value, i (i)}
							<Table.Cell class="text-right tabular-nums">
								{value == null ? '–' : format(value)}
							</Table.Cell>
						{/each}
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</section>
