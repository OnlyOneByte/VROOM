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
		ledger?: boolean;
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
		pendingStates,
		ledger = false
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
			pending={pendingStates?.get(row.children[0]?.id ?? '')}
		/>
	{/if}
{/snippet}

{#snippet monthTotal(month: string)}
	{@const total = monthTotals?.get(month)}
	{#if total !== undefined}
		<span class="sr-only">total</span>
		{formatCurrency(total)}
	{/if}
{/snippet}

{#if ledger}
	<div class="space-y-8" data-testid="expense-ledger">
		{#each sections as section (section.month)}
			<section>
				{#if section.month}
					<h2
						class="sticky top-[calc(4rem+env(safe-area-inset-top))] short:top-0 lg:top-0 z-10 flex items-baseline justify-between gap-3 border-b-2 border-foreground bg-background pt-2 pb-1.5"
					>
						<span
							class="font-(family-name:--font-fig) text-2xl leading-none font-bold uppercase lg:text-3xl"
						>
							{monthLabel(section.month)}
						</span>
						<span class="text-base font-semibold tabular-nums">
							{@render monthTotal(section.month)}
						</span>
					</h2>
				{/if}
				<div class="divide-y border-b">
					{#each section.rows as item (rowKey(item))}
						{@render row(item)}
					{/each}
				</div>
			</section>
		{/each}
	</div>
{:else}
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
						<h2
							class="sticky top-[calc(4rem+env(safe-area-inset-top))] short:top-0 z-10 flex items-baseline justify-between gap-3 bg-muted px-3 py-2 text-sm font-semibold text-foreground"
						>
							<span>{monthLabel(section.month)}</span>
							<span class="tabular-nums text-muted-foreground">
								{@render monthTotal(section.month)}
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
{/if}
