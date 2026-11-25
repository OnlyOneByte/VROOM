<script lang="ts">
	import type { PendingRowState } from '#lib/utils/sync/pending-rows.ts';
	import type { Expense, Vehicle } from '#lib/types/index.ts';
	import ExpenseCategoryFilter from './ExpenseCategoryFilter.svelte';
	import ExpenseSortButton from './ExpenseSortButton.svelte';
	import CompactStandaloneRow from './CompactStandaloneRow.svelte';
	import CompactGroupRow from './CompactGroupRow.svelte';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import {
		monthLabel,
		monthSections,
		rowKey,
		type DisplayRow,
		type GroupRow,
		type SortField
	} from './expense-table-rows';

	interface Props {
		rows: DisplayRow[];
		vehicleMap: ReadonlyMap<string, Vehicle>;
		showVehicleColumn: boolean;
		canWrite: boolean;
		canDelete: boolean;
		returnTo: string;
		categoryFilter: string;
		sortBy: SortField;
		selectedRowId: string | null;
		onSelect: (_id: string) => void;
		onSort: (_field: SortField) => void;
		onCategoryChange: (_category: string) => void;
		onDeleteExpense: (_expense: Expense) => void;
		onDeleteGroup: (_row: GroupRow) => void;
		monthTotals?: ReadonlyMap<string, number> | undefined;
		pendingStates?: ReadonlyMap<string, PendingRowState> | undefined;
	}

	let {
		rows,
		vehicleMap,
		showVehicleColumn,
		canWrite,
		canDelete,
		returnTo,
		categoryFilter,
		sortBy,
		selectedRowId,
		onSelect,
		onSort,
		onCategoryChange,
		onDeleteExpense,
		onDeleteGroup,
		monthTotals,
		pendingStates
	}: Props = $props();

	let sections = $derived(
		sortBy === 'date' && monthTotals ? monthSections(rows) : [{ month: '', rows }]
	);
</script>

{#snippet row(row: DisplayRow)}
	{#if row.type === 'standalone'}
		<CompactStandaloneRow
			expense={row.expense}
			{vehicleMap}
			{showVehicleColumn}
			{canWrite}
			{canDelete}
			{returnTo}
			isSelected={selectedRowId === row.expense.id}
			{onSelect}
			onDelete={onDeleteExpense}
			pending={pendingStates?.get(row.expense.id)}
		/>
	{:else}
		<CompactGroupRow
			{row}
			{vehicleMap}
			{showVehicleColumn}
			{canWrite}
			{canDelete}
			{returnTo}
			isSelected={selectedRowId === row.groupId}
			{onSelect}
			onDelete={onDeleteGroup}
		/>
	{/if}
{/snippet}

<div class="rounded-md border bg-card">
	<div class="flex items-center gap-2 border-b px-3 py-2">
		<ExpenseCategoryFilter density="compact" value={categoryFilter} onChange={onCategoryChange} />

		<div class="ml-auto flex items-center gap-2">
			<ExpenseSortButton
				label="Date"
				field="date"
				{sortBy}
				{onSort}
				class="h-10 px-2 text-xs sm:h-9"
				iconClass="ml-1 h-3 w-3"
			/>
			<ExpenseSortButton
				label="Amount"
				field="amount"
				{sortBy}
				{onSort}
				class="h-10 px-2 text-xs sm:h-9"
				iconClass="ml-1 h-3 w-3"
			/>
		</div>
	</div>

	<div class="divide-y">
		{#if rows.length === 0}
			<div class="py-8 text-center">
				<p class="text-muted-foreground text-sm">No expenses match this category filter.</p>
			</div>
		{:else}
			{#each sections as section (section.month)}
				{#if section.month}
					{@const total = monthTotals?.get(section.month)}
					<h2
						class="sticky top-[calc(4rem+env(safe-area-inset-top))] short:top-0 z-10 flex items-baseline justify-between gap-3 bg-muted px-3 py-2 text-sm font-semibold text-foreground"
					>
						<span>{monthLabel(section.month)}</span>
						<span class="tabular-nums text-muted-foreground">
							{#if total !== undefined}
								<span class="sr-only">total</span>
								{formatCurrency(total)}
							{/if}
						</span>
					</h2>
				{/if}
				{#each section.rows as item (rowKey(item))}
					{@render row(item)}
				{/each}
			{/each}
		{/if}
	</div>
</div>
