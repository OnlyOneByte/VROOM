<script lang="ts">
	import type { Expense, Vehicle } from '#lib/types/index.ts';
	import ExpenseCategoryFilter from './ExpenseCategoryFilter.svelte';
	import ExpenseSortButton from './ExpenseSortButton.svelte';
	import CompactStandaloneRow from './CompactStandaloneRow.svelte';
	import CompactGroupRow from './CompactGroupRow.svelte';
	import { rowKey, type DisplayRow, type GroupRow, type SortField } from './expense-table-rows';

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
		onDeleteGroup
	}: Props = $props();
</script>

<div class="rounded-md border bg-card">
	<div class="flex items-center gap-2 border-b px-3 py-2">
		<ExpenseCategoryFilter density="compact" value={categoryFilter} onChange={onCategoryChange} />

		<div class="ml-auto flex items-center gap-1">
			<ExpenseSortButton
				label="Date"
				field="date"
				{sortBy}
				{onSort}
				class="h-8 px-2 text-xs"
				iconClass="ml-1 h-3 w-3"
			/>
			<ExpenseSortButton
				label="Amount"
				field="amount"
				{sortBy}
				{onSort}
				class="h-8 px-2 text-xs"
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
			{#each rows as row (rowKey(row))}
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
			{/each}
		{/if}
	</div>
</div>
